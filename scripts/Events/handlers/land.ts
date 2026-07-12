/**
 * 领地相关事件处理器
 * 完整迁移自 Modules/Land/Event.ts (504行)
 */

import {
  world,
  system,
  Entity,
  Player,
  BlockVolume,
  EntityEquippableComponent,
  EquipmentSlot,
  EntityDamageCause,
} from "@minecraft/server";
import { eventRegistry } from "../registry";
import { color } from "../../shared/utils/color";
import { debounce, isAdmin, SystemLog } from "../../shared/utils/common";
import landManager from "../../features/land/services/land-manager";
import landParticle, {
  type LandSelectionGuideInfo,
  type LandSelectionOverlapInfo,
} from "../../features/land/services/land-particle";
import { useNotify } from "../../shared/hooks";
import { MinecraftBlockTypes } from "@minecraft/vanilla-data";
import type { ILand, Vector3 } from "../../core/types";
import { guildFacade } from "../../features/guild/services/guild-facade";
import behaviorLog from "../../features/behavior-log/services/behavior-log";
import { subscribePreviewEvent } from "../../features/platform/sapi-capabilities";
import { taskScheduler } from "../../features/platform/scheduler";
import setting from "../../features/system/services/setting";
import economic from "../../features/economic/services/economic";
import PlayerSetting from "../../features/player/services/player-settings";
import { getOnlineRealPlayers } from "../../shared/utils/online-players";

/** 避免玩家名/领地名的 § 破坏标题与 actionbar */
function stripLandDisplaySection(s: string): string {
  return s.replace(/§./g, "");
}

type LandBoundaryParticleLevel = "off" | "low" | "balanced" | "high";

const LAND_PARTICLE_LEVELS: Record<
  LandBoundaryParticleLevel,
  { renderDistance: number; boundaryRefreshTicks: number; scanRefreshTicks: number; scan: boolean }
> = {
  off: { renderDistance: 0, boundaryRefreshTicks: 200, scanRefreshTicks: 200, scan: false },
  low: { renderDistance: 80, boundaryRefreshTicks: 160, scanRefreshTicks: 80, scan: false },
  balanced: { renderDistance: 128, boundaryRefreshTicks: 100, scanRefreshTicks: 12, scan: true },
  high: { renderDistance: 192, boundaryRefreshTicks: 80, scanRefreshTicks: 4, scan: true },
};

function getLandParticleLevel(): LandBoundaryParticleLevel {
  const value = String(setting.getState("landBoundaryParticleLevel"));
  return value === "off" || value === "low" || value === "high" ? value : "balanced";
}

interface LandArea {
  start?: Vector3;
  end?: Vector3;
  lastChangeTime: number;
}

/**
 * 检查实体是否在移动
 */
const isMoving = (entity: Entity): boolean => {
  const MathRound = (x: number) => Math.round(x * 1000) / 1000;

  const vector = {
    x: MathRound(entity.getVelocity().x),
    y: MathRound(entity.getVelocity().y),
    z: MathRound(entity.getVelocity().z),
  };

  return !(vector.x === 0 && vector.y === 0 && vector.z === 0);
};

// 领地标记区域存储
export const landAreas = new Map<string, LandArea>();

function isLandNearPlayerForBoundaryDisplay(land: ILand, playerPos: Vector3, renderDistance: number): boolean {
  const minX = Math.min(land.vectors.start.x, land.vectors.end.x);
  const maxX = Math.max(land.vectors.start.x, land.vectors.end.x);
  const minZ = Math.min(land.vectors.start.z, land.vectors.end.z);
  const maxZ = Math.max(land.vectors.start.z, land.vectors.end.z);
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const dx = playerPos.x - centerX;
  const dz = playerPos.z - centerZ;
  return dx * dx + dz * dz <= renderDistance * renderDistance;
}

function getLandBoundaryVariantForPlayer(
  land: ILand,
  player: Player
): "owner" | "trusted" | "guild" | "public" | "foreign" {
  if (land.owner === player.name) return "owner";
  if (land.guildId) {
    if (landManager.isPlayerTrustedOnLand(land, player.name)) return "guild";
    return "foreign";
  }
  if (landManager.isPlayerTrustedOnLand(land, player.name)) return "trusted";
  if (land.public_auth.allowEnter === true) return "public";
  return "foreign";
}

function showUnifiedLandBoundary(player: Player, land: ILand): void {
  landParticle.createLandAmbientBoundaryBurst(player, [land.vectors.start, land.vectors.end], {
    seed: `${land.name}:${land.owner}`,
    variant: getLandBoundaryVariantForPlayer(land, player),
  });
}

// 玩家当前所在领地记录
const LandLog = new Map<string, ILand>();

// 领地内受保护实体的火焰来源追踪：entityId → 被玩家攻击的时间戳
// 用于拦截 fireTick（damagingEntity 为空）造成的持续燃烧伤害
const landEntityFireSourceMap = new Map<string, number>();
const LAND_FIRE_SOURCE_TIMEOUT_MS = 15_000;
const landBreakWarningState = new Map<string, string>();
const recentLandBreakAttemptLog = new Map<string, number>();
const LAND_BREAK_ATTEMPT_LOG_COOLDOWN_MS = 1500;
const WITHER_BOSS_TYPE_ID = "minecraft:wither";
const WITHER_BOSS_EJECT_MARGIN = 4;
const WITHER_BOSS_CHECK_INTERVAL_TICKS = 10;
const LAND_DIMENSION_IDS = ["overworld", "nether", "the_end"] as const;
const LAND_SENSITIVE_ENTITY_PLACE_ITEMS = new Map<string, string[]>([
  ["minecraft:end_crystal", ["minecraft:ender_crystal", "minecraft:end_crystal"]],
  ["minecraft:armor_stand", ["minecraft:armor_stand"]],
  ["minecraft:item_frame", ["minecraft:item_frame"]],
  ["minecraft:glow_item_frame", ["minecraft:glow_item_frame"]],
  ["minecraft:painting", ["minecraft:painting"]],
  ["minecraft:oak_boat", ["minecraft:boat"]],
  ["minecraft:spruce_boat", ["minecraft:boat"]],
  ["minecraft:birch_boat", ["minecraft:boat"]],
  ["minecraft:jungle_boat", ["minecraft:boat"]],
  ["minecraft:acacia_boat", ["minecraft:boat"]],
  ["minecraft:dark_oak_boat", ["minecraft:boat"]],
  ["minecraft:mangrove_boat", ["minecraft:boat"]],
  ["minecraft:cherry_boat", ["minecraft:boat"]],
  ["minecraft:bamboo_raft", ["minecraft:boat"]],
  ["minecraft:minecart", ["minecraft:minecart"]],
  ["minecraft:chest_minecart", ["minecraft:chest_minecart", "minecraft:minecart"]],
  ["minecraft:hopper_minecart", ["minecraft:hopper_minecart", "minecraft:minecart"]],
  ["minecraft:tnt_minecart", ["minecraft:tnt_minecart", "minecraft:minecart"]],
  ["minecraft:command_block_minecart", ["minecraft:command_block_minecart", "minecraft:minecart"]],
]);
const LAND_BREAK_PROTECTED_ENTITY_TYPE_IDS = new Set<string>();
for (const entityTypeIds of LAND_SENSITIVE_ENTITY_PLACE_ITEMS.values()) {
  for (const entityTypeId of entityTypeIds) {
    LAND_BREAK_PROTECTED_ENTITY_TYPE_IDS.add(entityTypeId);
  }
}
const LAND_SENSITIVE_ENTITY_SPAWN_TRACK_TICKS = 10;
const LAND_SENSITIVE_FLUID_ITEMS = new Map<string, string[]>([
  ["minecraft:water_bucket", ["minecraft:water", "minecraft:flowing_water"]],
  ["minecraft:lava_bucket", ["minecraft:lava", "minecraft:flowing_lava"]],
  ["minecraft:powder_snow_bucket", ["minecraft:powder_snow"]],
]);
const CONTAINER_BLOCK_KEYWORDS = ["chest", "barrel", "shulker_box", "dispenser", "dropper", "hopper", "crafter"];
const DOOR_BLOCK_KEYWORDS = ["door", "trapdoor", "fence_gate"];

interface SensitiveEntitySpawnRecord {
  id: string;
  typeId: string;
  dimensionId: string;
  location: Vector3;
  tick: number;
  entity: Entity;
}

interface DeniedSensitivePlacementRecord {
  playerName: string;
  ownerName: string;
  itemTypeId: string;
  dimensionId: string;
  targetLocation: Vector3;
  tick: number;
}

const recentSensitiveEntitySpawns: SensitiveEntitySpawnRecord[] = [];
const pendingDeniedSensitivePlacements: DeniedSensitivePlacementRecord[] = [];

function getCurrentPreviewPoint(player: Player): Vector3 {
  return {
    x: Math.floor(player.location.x),
    y: Math.floor(player.location.y),
    z: Math.floor(player.location.z),
  };
}

function getSelectionOverlaps(start: Vector3, end: Vector3, dimensionId: string): LandSelectionOverlapInfo[] {
  const volume = new BlockVolume(start, end);
  const min = volume.getMin();
  const max = volume.getMax();
  const overlaps: LandSelectionOverlapInfo[] = [];

  for (const land of Object.values(landManager.getLandList())) {
    if (land.dimension !== dimensionId) continue;
    const existingVolume = new BlockVolume(land.vectors.start, land.vectors.end);
    const existingMin = existingVolume.getMin();
    const existingMax = existingVolume.getMax();
    const separated =
      max.x < existingMin.x ||
      existingMax.x < min.x ||
      max.y < existingMin.y ||
      existingMax.y < min.y ||
      max.z < existingMin.z ||
      existingMax.z < min.z;
    if (!separated) {
      overlaps.push({
        name: stripLandDisplaySection(land.name),
        owner: stripLandDisplaySection(land.owner),
        start: land.vectors.start,
        end: land.vectors.end,
      });
    }
  }

  return overlaps;
}

function getSelectionSize(start: Vector3, end: Vector3): Vector3 {
  return {
    x: Math.abs(end.x - start.x) + 1,
    y: Math.abs(end.y - start.y) + 1,
    z: Math.abs(end.z - start.z) + 1,
  };
}

function buildLandSelectionGuide(player: Player, landArea: LandArea): LandSelectionGuideInfo {
  const start = landArea.start;
  const end = landArea.end;
  const preview = start && !end ? getCurrentPreviewPoint(player) : undefined;
  const activeEnd = end ?? preview;

  if (!start || !activeEnd) {
    return {
      start,
      end,
      complete: false,
      status: "preview",
      hint: start ? "潜行并用木棍点击方块设置终点" : "用木棍点击方块设置起点",
    };
  }

  const blockCount = landManager.calculateBlockCount(start, activeEnd);
  const maxBlocks = Number(setting.getState("maxLandBlocks") || "30000");
  const overlaps = getSelectionOverlaps(start, activeEnd, player.dimension.id);
  const overlapCount = overlaps.length;
  const economyOn = setting.getState("economy") === true;
  const cost = economyOn ? economic.calculateLandPrice(start, activeEnd) : 0;
  const balance = economyOn ? economic.getWallet(player.name).gold : undefined;
  const tooLarge = Number.isFinite(maxBlocks) && blockCount > maxBlocks;
  const cannotAfford = economyOn && typeof balance === "number" && balance < cost;
  const hasOverlap = overlapCount > 0;
  const complete = !!end;
  const status: LandSelectionGuideInfo["status"] =
    tooLarge || hasOverlap || cannotAfford ? "invalid" : complete ? "valid" : "preview";
  const size = getSelectionSize(start, activeEnd);
  const hints: string[] = [];

  if (tooLarge) {
    hints.push(`超出上限 ${blockCount}/${maxBlocks}`);
  } else {
    hints.push(`${blockCount}/${maxBlocks} 格`);
  }
  if (hasOverlap) {
    const overlapNames = overlaps
      .slice(0, 3)
      .map((land) => `${land.name}/${land.owner}`)
      .join("、");
    hints.push(`重叠：${overlapNames}${overlapCount > 3 ? ` 等${overlapCount}块` : ""}`);
  }
  if (economyOn) hints.push(cannotAfford ? `金币不足 ${cost}/${balance}` : `费用 ${cost} 金币`);
  hints.push(complete ? "打开领地申请确认创建" : "移动预览，潜行点击锁定终点");

  player.onScreenDisplay.setActionBar(
    [
      color.aqua(complete ? "领地范围已锁定" : "圈地预览"),
      color.white(`${size.x}x${size.y}x${size.z}`),
      status === "invalid" ? color.red(hints.join(" · ")) : color.gray(hints.join(" · ")),
    ].join("  ")
  );

  return {
    start,
    end,
    preview,
    blockCount,
    maxBlocks,
    cost: economyOn ? cost : undefined,
    balance,
    overlapCount,
    overlaps,
    complete,
    status,
    hint: hints.join(" · "),
  };
}

function cancelLandSelection(player: Player): boolean {
  if (!landAreas.has(player.name)) return false;
  landAreas.delete(player.name);
  landParticle.clearLandSelectionGuide(player);
  player.onScreenDisplay.setActionBar(color.gray("已取消圈地模式"));
  player.sendMessage(color.gray("已取消圈地模式，领地点已清除。"));
  try {
    player.playSound("random.pop", { pitch: 0.75 });
  } catch {
    // 忽略音效不可用。
  }
  return true;
}

function blockTypeContainsAny(blockTypeId: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => blockTypeId.includes(keyword));
}

function isLandBreakAllowed(player: Player, land: ILand): boolean {
  if (land.owner === player.name) return true;
  if (isAdmin(player)) return true;
  if (land.public_auth.break) return true;
  if (landManager.isPlayerTrustedOnLand(land, player.name)) return true;
  return false;
}

function landBreakAttemptKey(player: Player, block: { location: Vector3; dimension: { id: string } }): string {
  const { location } = block;
  return `${player.id}:${block.dimension.id}:${Math.floor(location.x)},${Math.floor(location.y)},${Math.floor(location.z)}`;
}

function logLandBreakAttemptOnce(player: Player, block: any, land: ILand): void {
  const key = landBreakAttemptKey(player, block);
  const now = Date.now();
  const prev = recentLandBreakAttemptLog.get(key) ?? 0;
  if (now - prev < LAND_BREAK_ATTEMPT_LOG_COOLDOWN_MS) return;

  recentLandBreakAttemptLog.set(key, now);
  behaviorLog.logLandBreakAttempt(player, block.typeId, block.location, block.dimension.id, {
    name: land.name,
    owner: land.owner,
  });
}

function warnDeniedLandBreaking(player: Player, block: any, land: ILand): void {
  const key = landBreakAttemptKey(player, block);
  landBreakWarningState.set(player.id, key);
  logLandBreakAttemptOnce(player, block, land);

  system.run(() => {
    const p = getOnlineRealPlayers().find((pl) => pl.id === player.id);
    if (!p) return;
    useNotify("actionbar", p, color.red(`无权限破坏 ${color.yellow(stripLandDisplaySection(land.owner))} 的领地方块`));
  });
}

function warnDeniedLandEntityBreaking(player: Player, entity: Entity, land: ILand): void {
  const pseudoBlock = {
    typeId: entity.typeId,
    location: entity.location,
    dimension: entity.dimension,
  };
  logLandBreakAttemptOnce(player, pseudoBlock, land);

  system.run(() => {
    const p = getOnlineRealPlayers().find((pl) => pl.id === player.id);
    if (!p) return;
    useNotify("actionbar", p, color.red(`无权限破坏 ${color.yellow(stripLandDisplaySection(land.owner))} 的领地展示实体`));
  });
}

function ensureLandAuthDefaults(landData: ILand): void {
  // 修复旧存档burn权限初始化问题
  if (landData.public_auth.burn === undefined) {
    landData.public_auth.burn = false;
  }

  // 修复旧存档attackNeutralMobs权限初始化问题
  if (landData.public_auth.attackNeutralMobs === undefined) {
    landData.public_auth.attackNeutralMobs = false;
  }

  // 修复旧存档allowEnter权限初始化问题
  if (landData.public_auth.allowEnter === undefined) {
    landData.public_auth.allowEnter = true;
  }

  // 修复旧存档allowWater权限初始化问题
  if (landData.public_auth.allowWater === undefined) {
    landData.public_auth.allowWater = true;
  }

  // 修复旧存档allowWitherBoss权限初始化问题：默认不允许凋零BOSS进入领地
  if (landData.public_auth.allowWitherBoss === undefined) {
    landData.public_auth.allowWitherBoss = false;
  }

  if (landData.config_public_auth && landData.config_public_auth.allowWitherBoss === undefined) {
    landData.config_public_auth.allowWitherBoss = false;
  }
}

function getNearestOutsideLandPosition(location: Vector3, land: ILand): Vector3 {
  const minX = Math.min(land.vectors.start.x, land.vectors.end.x);
  const maxX = Math.max(land.vectors.start.x, land.vectors.end.x);
  const minZ = Math.min(land.vectors.start.z, land.vectors.end.z);
  const maxZ = Math.max(land.vectors.start.z, land.vectors.end.z);

  const candidates = [
    { distance: Math.abs(location.x - minX), position: { ...location, x: minX - WITHER_BOSS_EJECT_MARGIN } },
    { distance: Math.abs(location.x - maxX), position: { ...location, x: maxX + WITHER_BOSS_EJECT_MARGIN } },
    { distance: Math.abs(location.z - minZ), position: { ...location, z: minZ - WITHER_BOSS_EJECT_MARGIN } },
    { distance: Math.abs(location.z - maxZ), position: { ...location, z: maxZ + WITHER_BOSS_EJECT_MARGIN } },
  ];

  candidates.sort((a, b) => a.distance - b.distance);
  return candidates[0].position;
}

function ejectWitherBossFromLand(wither: Entity, land: ILand): void {
  try {
    const target = getNearestOutsideLandPosition(wither.location, land);
    wither.teleport(target, { dimension: wither.dimension });
    wither.clearVelocity();
  } catch (error) {
    SystemLog.warn(`[Land] failed to eject wither boss from protected land: ${error}`);
  }
}

function enforceWitherBossLandAccess(): void {
  for (const dimensionId of LAND_DIMENSION_IDS) {
    let withers: Entity[] = [];
    try {
      withers = world.getDimension(dimensionId).getEntities({ type: WITHER_BOSS_TYPE_ID });
    } catch (error) {
      continue;
    }

    for (const wither of withers) {
      try {
        const { isInside, insideLand } = landManager.testLand(wither.location, wither.dimension.id);
        if (!isInside || !insideLand) continue;
        if (insideLand.public_auth.allowWitherBoss === true) continue;
        ejectWitherBossFromLand(wither, insideLand);
      } catch (error) {
        // 忽略实体失效、维度卸载等瞬时错误
      }
    }
  }
}

function registerLandBreakingPreviewEvents(): void {
  subscribePreviewEvent(
    "playerStartBreakingBlock",
    (event: any) => {
      const { player, block } = event;
      if (!player || !block) return;

      const { isInside, insideLand } = landManager.testLand(block.location, block.dimension.id);
      if (!isInside || !insideLand || isLandBreakAllowed(player, insideLand)) return;

      warnDeniedLandBreaking(player, block, insideLand);
    },
    "playerStartBreakingBlock"
  );

  subscribePreviewEvent(
    "playerCancelBreakingBlock",
    (event: any) => {
      const { player, block } = event;
      if (!player) return;

      const activeKey = landBreakWarningState.get(player.id);
      if (!activeKey) return;
      if (block && activeKey !== landBreakAttemptKey(player, block)) return;

      landBreakWarningState.delete(player.id);
      system.run(() => {
        const p = getOnlineRealPlayers().find((pl) => pl.id === player.id);
        p?.onScreenDisplay.setActionBar("");
      });
    },
    "playerCancelBreakingBlock"
  );
}

function getTargetLocationFromUseOn(blockLocation: Vector3, blockFace: string | number): Vector3 {
  const face = String(blockFace).toLowerCase();
  if (face === "up" || blockFace === 1) return { x: blockLocation.x, y: blockLocation.y + 1, z: blockLocation.z };
  if (face === "down" || blockFace === 0) return { x: blockLocation.x, y: blockLocation.y - 1, z: blockLocation.z };
  if (face === "north" || blockFace === 2) return { x: blockLocation.x, y: blockLocation.y, z: blockLocation.z - 1 };
  if (face === "south" || blockFace === 3) return { x: blockLocation.x, y: blockLocation.y, z: blockLocation.z + 1 };
  if (face === "west" || blockFace === 4) return { x: blockLocation.x - 1, y: blockLocation.y, z: blockLocation.z };
  if (face === "east" || blockFace === 5) return { x: blockLocation.x + 1, y: blockLocation.y, z: blockLocation.z };
  return { x: blockLocation.x, y: blockLocation.y + 1, z: blockLocation.z };
}

function isLandPlaceAllowed(player: Player, land: ILand): boolean {
  if (land.owner === player.name) return true;
  if (isAdmin(player)) return true;
  if (landManager.isPlayerTrustedOnLand(land, player.name)) return true;
  return land.public_auth.place === true;
}

function warnDeniedLandUse(player: Player, ownerName: string): void {
  useNotify("chat", player, color.red(`这里是 ${color.yellow(ownerName)} ${color.red("的领地，你没有权限这么做！")}`));
}

function locationDistanceSq(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function normalizeDimensionId(dimensionId: string): string {
  return dimensionId.replace(/^minecraft:/, "");
}

function isSensitivePlacedEntityType(typeId: string): boolean {
  for (const types of LAND_SENSITIVE_ENTITY_PLACE_ITEMS.values()) {
    if (types.includes(typeId)) return true;
  }
  return false;
}

function cleanupSensitivePlacementRecords(): void {
  const minTick = system.currentTick - LAND_SENSITIVE_ENTITY_SPAWN_TRACK_TICKS;
  for (let i = recentSensitiveEntitySpawns.length - 1; i >= 0; i--) {
    if (recentSensitiveEntitySpawns[i].tick < minTick) {
      recentSensitiveEntitySpawns.splice(i, 1);
    }
  }
  for (let i = pendingDeniedSensitivePlacements.length - 1; i >= 0; i--) {
    if (pendingDeniedSensitivePlacements[i].tick < minTick) {
      pendingDeniedSensitivePlacements.splice(i, 1);
    }
  }
}

function removeDeniedSpawnedEntities(record: DeniedSensitivePlacementRecord): void {
  const entityTypes = LAND_SENSITIVE_ENTITY_PLACE_ITEMS.get(record.itemTypeId);
  if (!entityTypes) return;

  const dimId = normalizeDimensionId(record.dimensionId);
  for (const spawn of recentSensitiveEntitySpawns) {
    if (spawn.dimensionId !== dimId) continue;
    if (!entityTypes.includes(spawn.typeId)) continue;
    if (locationDistanceSq(spawn.location, record.targetLocation) > 4) continue;
    try {
      if (spawn.entity.isValid) spawn.entity.remove();
    } catch (_) {}
  }
}

function registerDeniedSensitivePlacement(record: DeniedSensitivePlacementRecord): void {
  pendingDeniedSensitivePlacements.push(record);
  system.run(() => {
    removeDeniedSpawnedEntities(record);
    const index = pendingDeniedSensitivePlacements.indexOf(record);
    if (index >= 0) pendingDeniedSensitivePlacements.splice(index, 1);
  });
}

function handleSensitiveEntitySpawn(entity: Entity): void {
  if (!isSensitivePlacedEntityType(entity.typeId)) return;

  cleanupSensitivePlacementRecords();
  const spawn: SensitiveEntitySpawnRecord = {
    id: entity.id,
    typeId: entity.typeId,
    dimensionId: normalizeDimensionId(entity.dimension.id),
    location: { ...entity.location },
    tick: system.currentTick,
    entity,
  };
  recentSensitiveEntitySpawns.push(spawn);

  for (const record of pendingDeniedSensitivePlacements) {
    if (record.dimensionId !== spawn.dimensionId) continue;
    const entityTypes = LAND_SENSITIVE_ENTITY_PLACE_ITEMS.get(record.itemTypeId);
    if (!entityTypes?.includes(spawn.typeId)) continue;
    if (locationDistanceSq(record.targetLocation, spawn.location) > 4) continue;
    try {
      entity.remove();
    } catch (_) {}
    break;
  }
}

function cleanupDeniedSensitivePlacement(
  playerName: string,
  ownerName: string,
  dimensionId: string,
  targetLocation: Vector3,
  itemTypeId: string
): void {
  system.run(() => {
    const dimension = world.getDimension(normalizeDimensionId(dimensionId) as any);

    const fluidTypes = LAND_SENSITIVE_FLUID_ITEMS.get(itemTypeId);
    if (fluidTypes) {
      const block = dimension.getBlock(targetLocation);
      if (block && fluidTypes.includes(block.typeId)) {
        try {
          block.setType("minecraft:air");
        } catch (_) {}
      }
    }

    if (LAND_SENSITIVE_ENTITY_PLACE_ITEMS.has(itemTypeId)) {
      registerDeniedSensitivePlacement({
        playerName,
        ownerName,
        itemTypeId,
        dimensionId: normalizeDimensionId(dimensionId),
        targetLocation,
        tick: system.currentTick,
      });
    }

    const player = getOnlineRealPlayers().find((p) => p.name === playerName);
    if (player) warnDeniedLandUse(player, ownerName);
  });
}

/**
 * 判断实体是否为敌对生物（会主动攻击玩家的生物）
 */
function isMonster(entity: Entity): boolean {
  // 检查实体是否有 'minecraft:type_family' 组件 (通常都有)
  const familiesComponent = entity.getComponent("minecraft:type_family");

  if (familiesComponent) {
    // 获取实体所属的族群列表
    const families: string[] = familiesComponent.getTypeFamilies();

    // 常见的敌对生物族群 ID
    const monsterFamilies = [
      "monster", // 几乎所有标准敌对生物都属于这个族群 (如僵尸, 骷髅, 蜘蛛)
      "undead", // 亡灵生物 (僵尸, 骷髅, 尸壳等)
      "arthropod", // 节肢动物 (蜘蛛, 洞穴蜘蛛等)
    ];

    // 检查实体是否属于任何一个怪物族群
    return families.some((family) => monsterFamilies.includes(family));
  }

  return false; // 如果无法获取族群信息，则认为不是
}

/**
 * 清除领地内的燃烧方块（通过getBlocks）
 */
function clearLandFireByGetBlocks(landData: ILand): void {
  const landArea = new BlockVolume(landData.vectors.start, landData.vectors.end);
  const blocks = world.getDimension(landData.dimension).getBlocks(landArea, {
    includeTypes: ["minecraft:lava", "minecraft:flowing_lava", "minecraft:fire", "minecraft:soul_fire"],
  });

  const blocksIterator = blocks.getBlockLocationIterator();
  for (const blockLocation of blocksIterator) {
    const block = world.getDimension(landData.dimension).getBlock(blockLocation);
    if (block) {
      block.setType("minecraft:air");
    }
  }
}

/**
 * 清除领地内的水方块（通过getBlocks）
 */
function clearLandWaterByGetBlocks(landData: ILand): void {
  const landArea = new BlockVolume(landData.vectors.start, landData.vectors.end);
  const blocks = world.getDimension(landData.dimension).getBlocks(landArea, {
    includeTypes: ["minecraft:water", "minecraft:flowing_water"],
  });

  const blocksIterator = blocks.getBlockLocationIterator();
  for (const blockLocation of blocksIterator) {
    const block = world.getDimension(landData.dimension).getBlock(blockLocation);
    if (block) {
      block.setType("minecraft:air");
    }
  }
}

/**
 * 注册领地事件处理器
 */
export function registerLandEvents(): void {
  registerLandBreakingPreviewEvents();

  // ==================== 定时任务 ====================

  /**
   * 领地标记点管理和燃烧方块清理
   */
  taskScheduler.register({
    id: "land.markerCleanup",
    label: "领地标记与方块清理",
    category: "land",
    intervalTicks: 20,
    when: () => setting.getState("land") === true,
    run: () => {
      // 1. 清除过期的领地标记坐标点
      landAreas.forEach((landArea, playerId) => {
        if (landArea.lastChangeTime < Date.now() - 1000 * 60 * 10) {
          const player = getOnlineRealPlayers().find((p) => p.name === playerId);
          player?.sendMessage(color.red("领地标记坐标点已过期，请重新设置"));
          if (player) {
            landParticle.clearLandSelectionGuide(player);
          }
          landAreas.delete(playerId);
        }

        const player = getOnlineRealPlayers().find((p) => p.name === playerId);
        if (player) {
          landParticle.createLandSelectionGuide(player, buildLandSelectionGuide(player, landArea));
        }
      });

      // 2. 清除所有领地内的燃烧方块
      const lands = landManager.getLandList();
      for (const landName in lands) {
        const landData = lands[landName];
        ensureLandAuthDefaults(landData);

        // 清除燃烧方块
        if (!landData.public_auth.burn) {
          try {
            clearLandFireByGetBlocks(landData);
          } catch (error) {
            // 忽略区块未加载等错误
          }
        }

        // 清除水方块
        if (!landData.public_auth.allowWater) {
          try {
            clearLandWaterByGetBlocks(landData);
          } catch (error) {
            // 忽略区块未加载等错误
          }
        }
      }
    },
  });

  /**
   * 凋零BOSS进入权限检查
   */
  taskScheduler.register({
    id: "land.witherBossCheck",
    label: "凋零 BOSS 权限检查",
    category: "land",
    intervalTicks: WITHER_BOSS_CHECK_INTERVAL_TICKS,
    when: () => setting.getState("land") === true,
    run: () => {
      enforceWitherBossLandAccess();
    },
  });

  /**
   * 玩家个人开关：持续显示玩家当前维度内所有领地边界效果。
   */
  taskScheduler.register({
    id: "land.boundaryParticleDisplay",
    label: "领地范围常显",
    category: "land",
    intervalTicks: 20,
    when: () => setting.getState("land") === true,
    run: () => {
      const level = getLandParticleLevel();
      const config = LAND_PARTICLE_LEVELS[level];
      if (level === "off" || system.currentTick % config.boundaryRefreshTicks >= 20) return;
      getOnlineRealPlayers().forEach((p) => {
        if (!PlayerSetting.getLandBoundaryParticlesEnabled(p)) {
          return;
        }

        const lands = Object.values(landManager.getLandList()).filter(
          (land) =>
            land.dimension === p.dimension.id && isLandNearPlayerForBoundaryDisplay(land, p.location, config.renderDistance)
        );
        for (const land of lands) {
          try {
            landParticle.createLandAmbientBoundary(p, [land.vectors.start, land.vectors.end], {
              seed: `${land.name}:${land.owner}`,
              variant: getLandBoundaryVariantForPlayer(land, p),
              detail: level,
            });
          } catch (error) {
            // 忽略粒子生成错误
          }
        }
      });
    },
  });

  taskScheduler.register({
    id: "land.boundaryScanDisplay",
    label: "领地边界扫描光",
    category: "land",
    intervalTicks: 4,
    when: () => setting.getState("land") === true,
    run: () => {
      const level = getLandParticleLevel();
      const config = LAND_PARTICLE_LEVELS[level];
      if (!config.scan || system.currentTick % config.scanRefreshTicks >= 4) return;
      getOnlineRealPlayers().forEach((p) => {
        if (!PlayerSetting.getLandBoundaryParticlesEnabled(p)) {
          return;
        }

        const lands = Object.values(landManager.getLandList()).filter(
          (land) =>
            land.dimension === p.dimension.id && isLandNearPlayerForBoundaryDisplay(land, p.location, config.renderDistance)
        );
        for (const land of lands) {
          try {
            landParticle.createLandAmbientBoundaryScan(p, [land.vectors.start, land.vectors.end], {
              seed: `${land.name}:${land.owner}`,
              variant: getLandBoundaryVariantForPlayer(land, p),
            });
          } catch (error) {
            // 忽略粒子生成错误
          }
        }
      });
    },
  });

  /**
   * 玩家进入/离开领地提示和权限检查
   */
  taskScheduler.register({
    id: "land.enterLeaveDetect",
    label: "领地进入离开检测",
    category: "land",
    intervalTicks: 5,
    when: () => setting.getState("land") === true,
    run: () => {
      getOnlineRealPlayers().forEach((p) => {
        if (!isMoving(p)) return;
        if (p.location.y <= -63) return;

        const location = p.dimension.getBlock(p.location)?.location;
        const { isInside, insideLand } = landManager.testLand(location ?? p.location, p.dimension.id);

        // 进入领地
        if (isInside && insideLand && !LandLog.get(p.name)) {
          // 检查是否允许进入
          if (!insideLand.public_auth.allowEnter) {
            // 非管理员且非领地信任对象（含公会领地同公会成员）则传送出去
            if (!isAdmin(p) && !landManager.isPlayerTrustedOnLand(insideLand, p.name)) {
              // 计算领地外最近的安全位置
              const landMin = {
                x: Math.min(insideLand.vectors.start.x, insideLand.vectors.end.x),
                y: Math.min(insideLand.vectors.start.y, insideLand.vectors.end.y),
                z: Math.min(insideLand.vectors.start.z, insideLand.vectors.end.z),
              };
              const landMax = {
                x: Math.max(insideLand.vectors.start.x, insideLand.vectors.end.x),
                y: Math.max(insideLand.vectors.start.y, insideLand.vectors.end.y),
                z: Math.max(insideLand.vectors.start.z, insideLand.vectors.end.z),
              };

              // 找到最近的边界点
              const playerPos = p.location;
              let teleportPos = { ...playerPos };

              // 计算到各边界的距离，选择最近的边界
              const distToMinX = Math.abs(playerPos.x - landMin.x);
              const distToMaxX = Math.abs(playerPos.x - landMax.x);
              const distToMinZ = Math.abs(playerPos.z - landMin.z);
              const distToMaxZ = Math.abs(playerPos.z - landMax.z);

              if (distToMinX <= distToMaxX && distToMinX <= distToMinZ && distToMinX <= distToMaxZ) {
                teleportPos.x = landMin.x - 1;
              } else if (distToMaxX <= distToMinZ && distToMaxX <= distToMaxZ) {
                teleportPos.x = landMax.x + 1;
              } else if (distToMinZ <= distToMaxZ) {
                teleportPos.z = landMin.z - 1;
              } else {
                teleportPos.z = landMax.z + 1;
              }

              // 确保Y坐标在合理范围内
              teleportPos.y = Math.max(landMin.y, Math.min(landMax.y + 1, playerPos.y));

              // 先显示统一的领地边界，让玩家知道领地范围（传送前显示一次）
              try {
                showUnifiedLandBoundary(p, insideLand);
              } catch (error) {
                // 忽略粒子生成错误
              }

              // 传送玩家
              try {
                p.teleport(teleportPos, { dimension: p.dimension });
                useNotify(
                  "chat",
                  p,
                  color.red(`这里是 ${color.yellow(insideLand.owner)} ${color.red("的领地，您没有权限进入！")}`)
                );

                // 传送后再次显示轮廓，确保玩家在领地外也能看到
                system.runTimeout(() => {
                  try {
                    const playerAfterTeleport = getOnlineRealPlayers().find((pl) => pl.name === p.name);
                    if (playerAfterTeleport) {
                      showUnifiedLandBoundary(playerAfterTeleport, insideLand);
                    }
                  } catch (error) {
                    // 忽略粒子生成错误
                  }
                }, 5); // 延迟5 tick，确保传送完成
              } catch (error) {
                // 传送失败，忽略
              }
              return;
            }
          }

          if (insideLand.guildId) {
            const guildInfo = guildFacade.getGuildTagAndNameById(insideLand.guildId);
            // 仅 actionbar，不弹全屏 titleraw（音效与个人领地进入相同）
            try {
              p.playSound("random.pop", { volume: 0.45, pitch: 1.0 });
            } catch {
              /* ignore */
            }
            const ab = guildInfo
              ? `${color.gray("▸")} ${color.gold("公会领地")} ${color.aqua("[")}${color.yellow(stripLandDisplaySection(guildInfo.tag))}${color.aqua("]")} ${color.white(
                  stripLandDisplaySection(guildInfo.name)
                )} ${color.darkGray("·")} ${color.lightPurple("『")}${stripLandDisplaySection(insideLand.name)}${color.lightPurple("』")} ${color.gray("◂")}`
              : `${color.gray("▸")} ${color.gold("公会领地")} ${color.lightPurple("『")}${stripLandDisplaySection(insideLand.name)}${color.lightPurple("』")} ${color.gray("(数据异常)")}`;
            useNotify("actionbar", p, ab);
          } else {
            try {
              p.playSound("random.pop", { volume: 0.45, pitch: 1.0 });
            } catch {
              /* ignore */
            }
            const ownerDisp = stripLandDisplaySection(insideLand.owner);
            const landDisp = stripLandDisplaySection(insideLand.name);
            const ab = `${color.gray("▸")} ${color.gold("个人领地")} ${color.aqua("[")}${color.yellow(ownerDisp)}${color.aqua("]")} ${color.darkGray("·")} ${color.lightPurple("『")}${landDisp}${color.lightPurple("』")} ${color.gray("◂")}`;
            useNotify("actionbar", p, ab);
          }

          try {
            showUnifiedLandBoundary(p, insideLand);
          } catch (error) {}

          LandLog.set(p.name, insideLand);
        }
        // 离开领地
        else if (!isInside && LandLog.get(p.name)) {
          const landData = LandLog.get(p.name);
          if (landData) {
            if (landData.guildId) {
              const guildInfo = guildFacade.getGuildTagAndNameById(landData.guildId);
              // 仅 actionbar，不弹全屏 titleraw（音效与个人领地离开相同）
              try {
                p.playSound("random.click", { volume: 0.4, pitch: 1.0 });
              } catch {
                /* ignore */
              }
              const ab = guildInfo
                ? `${color.gray("▹")} ${color.darkGray("已离开")} ${color.aqua("[")}${color.yellow(stripLandDisplaySection(guildInfo.tag))}${color.aqua("]")} ${color.white(
                    stripLandDisplaySection(guildInfo.name)
                  )} ${color.darkGray("·")} ${color.lightPurple("『")}${stripLandDisplaySection(landData.name)}${color.lightPurple("』")} ${color.gray("▸")}`
                : `${color.gray("▹")} ${color.darkGray("已离开")} ${color.lightPurple("『")}${stripLandDisplaySection(landData.name)}${color.lightPurple("』")} ${color.gray("(数据异常)")}`;
              useNotify("actionbar", p, ab);
            } else {
              try {
                p.playSound("random.click", { volume: 0.4, pitch: 1.0 });
              } catch {
                /* ignore */
              }
              const ownerDisp = stripLandDisplaySection(landData.owner);
              const landDisp = stripLandDisplaySection(landData.name);
              const ab = `${color.gray("▹")} ${color.darkGray("已离开")} ${color.aqua("[")}${color.yellow(ownerDisp)}${color.aqua("]")} ${color.darkGray("·")} ${color.lightPurple("『")}${landDisp}${color.lightPurple("』")} ${color.gray("▸")}`;
              useNotify("actionbar", p, ab);
            }

            try {
              showUnifiedLandBoundary(p, landData);
            } catch (error) {}

            LandLog.delete(p.name);
          }
        }
      });
    },
  });

  // ==================== 领地标记事件 ====================

  /**
   * 使用木棍标记领地坐标点
   */
  world.afterEvents.entityHitBlock.subscribe((event) => {
    const { damagingEntity, hitBlock: block } = event;

    if (damagingEntity.typeId !== "minecraft:player") return;
    const source = damagingEntity as Player;

    // @ts-ignore
    const itemTypeId = source?.getComponent("minecraft:equippable")?.getEquipment("Mainhand")?.typeId;
    if (itemTypeId !== "minecraft:stick") return;

    debounce(
      () => {
        const playerId = source.name;
        let landArea = landAreas.get(playerId) || { lastChangeTime: Date.now() };

        if (source.isSneaking) {
          // 潜行 + 木棍 = 设置结束点
          const endPos = {
            x: block.location.x,
            y: block.location.y + 1,
            z: block.location.z,
          };
          source.sendMessage(color.yellow(`已设置领地结束点：${endPos.x} ${endPos.y} ${endPos.z}`));
          source.sendMessage(color.gray("领地范围已锁定，可打开领地申请确认创建。"));
          landArea.end = endPos;
          landArea.lastChangeTime = Date.now();
        } else {
          // 木棍 = 设置起始点
          const startPos = {
            x: block.location.x,
            y: block.location.y + 1,
            z: block.location.z,
          };
          source.sendMessage(color.yellow(`已设置领地起始点：${startPos.x} ${startPos.y} ${startPos.z}`));
          source.sendMessage(color.gray("移动时会实时预览范围；潜行并用木棍点击方块设置终点。"));
          landArea.start = startPos;
          landArea.lastChangeTime = Date.now();
        }

        landAreas.set(playerId, landArea);
        landParticle.createLandSelectionGuide(source, buildLandSelectionGuide(source, landArea));
        try {
          source.playSound(source.isSneaking ? "random.orb" : "random.click");
        } catch {
          // 忽略音效不可用。
        }
      },
      1000,
      source
    );
  });

  world.afterEvents.itemUse.subscribe((event) => {
    const { source, itemStack } = event;
    if (!source || source.typeId !== "minecraft:player") return;
    if (itemStack?.typeId !== "minecraft:stick") return;
    const player = source as Player;
    if (!player.isSneaking) return;
    cancelLandSelection(player);
  });

  const itemStartUseOn = (world.afterEvents as any).itemStartUseOn;
  if (typeof itemStartUseOn?.subscribe === "function") {
    itemStartUseOn.subscribe((event: any) => {
      const player = event.source as Player | undefined;
      const itemTypeId = event.itemStack?.typeId as string | undefined;
      const block = event.block;
      if (!player || player.typeId !== "minecraft:player" || !itemTypeId || !block?.location || !block.dimension?.id) {
        return;
      }
      if (!LAND_SENSITIVE_ENTITY_PLACE_ITEMS.has(itemTypeId) && !LAND_SENSITIVE_FLUID_ITEMS.has(itemTypeId)) return;

      const targetLocation = getTargetLocationFromUseOn(block.location, event.blockFace);
      const { isInside, insideLand } = landManager.testLand(targetLocation, block.dimension.id);
      if (!isInside || !insideLand) return;
      if (isLandPlaceAllowed(player, insideLand)) return;

      cleanupDeniedSensitivePlacement(player.name, insideLand.owner, block.dimension.id, targetLocation, itemTypeId);
    });
  }

  world.afterEvents.entitySpawn.subscribe((event) => {
    handleSensitiveEntitySpawn(event.entity);
  });

  // ==================== 领地保护事件 ====================

  /**
   * 玩家放置方块
   */
  world.beforeEvents.playerPlaceBlock.subscribe((event) => {
    const { player, block } = event;
    const { isInside, insideLand } = landManager.testLand(block.location, block.dimension.id);

    if (!isInside || !insideLand) return;
    if (insideLand.owner === player.name) return;
    if (isAdmin(player)) return;
    if (landManager.isPlayerTrustedOnLand(insideLand, player.name)) return;
    if (insideLand.public_auth.place) return;

    // 检查是否是水方块
    const blockTypeId = block.typeId;
    if (blockTypeId === "minecraft:water" || blockTypeId === "minecraft:flowing_water") {
      // 如果不允许水，则取消放置
      if (!insideLand.public_auth.allowWater) {
        event.cancel = true;
        const playerName = player.name;
        const ownerName = insideLand.owner;
        system.run(() => {
          const p = getOnlineRealPlayers().find((pl) => pl.name === playerName);
          if (p) {
            useNotify("chat", p, color.red(`这里是 ${color.yellow(ownerName)} ${color.red("的领地，不允许放置水！")}`));
          }
        });
        return;
      }
    }

    event.cancel = true;
    // 必须延迟发送消息，beforeEvents 中直接调用 sendMessage 可能导致事件处理异常
    const playerName = player.name;
    const ownerName = insideLand.owner;
    system.run(() => {
      const p = getOnlineRealPlayers().find((pl) => pl.name === playerName);
      if (p) {
        useNotify("chat", p, color.red(`这里是 ${color.yellow(ownerName)} ${color.red("的领地，你没有权限这么做！")}`));
      }
    });
  });

  /**
   * 玩家破坏方块
   */
  world.beforeEvents.playerBreakBlock.subscribe((event) => {
    const { player, block } = event;
    const { isInside, insideLand } = landManager.testLand(block.location, block.dimension.id);

    if (!isInside || !insideLand) return;
    if (isLandBreakAllowed(player, insideLand)) return;

    event.cancel = true;
    warnDeniedLandBreaking(player, block, insideLand);
    // 必须延迟发送消息，beforeEvents 中直接调用 sendMessage 可能导致事件处理异常
    const playerName = player.name;
    const ownerName = insideLand.owner;
    system.run(() => {
      const p = getOnlineRealPlayers().find((pl) => pl.name === playerName);
      if (p) {
        useNotify("chat", p, color.red(`这里是 ${color.yellow(ownerName)} ${color.red("的领地，你没有权限这么做！")}`));
      }
    });
  });

  /**
   * 玩家与方块交互
   */
  world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    const { player, block, itemStack } = event;
    const { isInside, insideLand } = landManager.testLand(block.location, block.dimension.id);

    if (!isInside || !insideLand) return;
    if (insideLand.owner === player.name) return;
    if (isAdmin(player)) return;
    if (landManager.isPlayerTrustedOnLand(insideLand, player.name)) return;

    // 检查是否是副手物品交互（防止使用副手放置方块）
    const equippableComponent = player.getComponent(EntityEquippableComponent.componentId) as EntityEquippableComponent;
    if (equippableComponent) {
      const offhandItem = equippableComponent.getEquipmentSlot(EquipmentSlot.Offhand);
      if (offhandItem && offhandItem.hasItem()) {
        const offhandItemStack = offhandItem.getItem();
        // 如果副手有物品且主手没有物品，或者副手物品是可以放置方块的物品（如水桶、岩浆桶等）
        if (offhandItemStack) {
          const offhandTypeId = offhandItemStack.typeId;
          // 检查是否是可能用于放置方块的物品
          if (
            offhandTypeId.includes("bucket") ||
            offhandTypeId.includes("water") ||
            offhandTypeId.includes("lava") ||
            offhandTypeId.includes("torch") ||
            offhandTypeId.includes("sign") ||
            offhandTypeId.includes("boat")
          ) {
            // 检查主手是否有物品
            const mainhandItem = equippableComponent.getEquipmentSlot(EquipmentSlot.Mainhand);
            if (!mainhandItem || !mainhandItem.hasItem()) {
              // 主手没有物品，可能是用副手放置的，需要检查权限
              if (!insideLand.public_auth.place) {
                event.cancel = true;
                const playerName = player.name;
                const ownerName = insideLand.owner;
                system.run(() => {
                  const p = getOnlineRealPlayers().find((pl) => pl.name === playerName);
                  if (p) {
                    useNotify(
                      "chat",
                      p,
                      color.red(
                        `这里是 ${color.yellow(ownerName)} ${color.red("的领地，你没有权限使用副手放置方块！")}`
                      )
                    );
                  }
                });
                return;
              }
            }
          }
        }
      }
    }

    // 延迟发送领地警告消息的辅助函数
    const sendLandWarning = (playerName: string, ownerName: string) => {
      system.run(() => {
        const p = getOnlineRealPlayers().find((pl) => pl.name === playerName);
        if (p) {
          useNotify(
            "chat",
            p,
            color.red(`这里是 ${color.yellow(ownerName)} ${color.red("的领地，你没有权限这么做！")}`)
          );
        }
      });
    };

    // 方块类型分类
    const chests = [
      MinecraftBlockTypes.Chest,
      MinecraftBlockTypes.EnderChest,
      MinecraftBlockTypes.Beehive,
      MinecraftBlockTypes.TrappedChest,
      MinecraftBlockTypes.Barrel,
      MinecraftBlockTypes.RedShulkerBox,
      MinecraftBlockTypes.OrangeShulkerBox,
      MinecraftBlockTypes.YellowShulkerBox,
      MinecraftBlockTypes.LimeShulkerBox,
      MinecraftBlockTypes.GreenShulkerBox,
      MinecraftBlockTypes.LightBlueShulkerBox,
      MinecraftBlockTypes.CyanShulkerBox,
      MinecraftBlockTypes.BlueShulkerBox,
      MinecraftBlockTypes.PurpleShulkerBox,
      MinecraftBlockTypes.MagentaShulkerBox,
      MinecraftBlockTypes.PinkShulkerBox,
      MinecraftBlockTypes.GrayShulkerBox,
      MinecraftBlockTypes.LightGrayShulkerBox,
      MinecraftBlockTypes.BlackShulkerBox,
      MinecraftBlockTypes.BrownShulkerBox,
      MinecraftBlockTypes.WhiteShulkerBox,
      MinecraftBlockTypes.UndyedShulkerBox,
    ];

    const buttons = [
      MinecraftBlockTypes.StoneButton,
      MinecraftBlockTypes.BambooButton,
      MinecraftBlockTypes.SpruceButton,
      MinecraftBlockTypes.BirchButton,
      MinecraftBlockTypes.CherryButton,
      MinecraftBlockTypes.JungleButton,
      MinecraftBlockTypes.AcaciaButton,
      MinecraftBlockTypes.DarkOakButton,
      MinecraftBlockTypes.CrimsonButton,
      MinecraftBlockTypes.WarpedButton,
      MinecraftBlockTypes.MangroveButton,
      MinecraftBlockTypes.PolishedBlackstoneButton,
      MinecraftBlockTypes.WoodenButton,
      MinecraftBlockTypes.Lever,
    ];

    const smelting = [
      MinecraftBlockTypes.Furnace,
      MinecraftBlockTypes.BlastFurnace,
      MinecraftBlockTypes.Smoker,
      MinecraftBlockTypes.Campfire,
      MinecraftBlockTypes.SmithingTable,
      MinecraftBlockTypes.Anvil,
      MinecraftBlockTypes.Grindstone,
      MinecraftBlockTypes.CartographyTable,
      MinecraftBlockTypes.Loom,
      MinecraftBlockTypes.EnchantingTable,
      MinecraftBlockTypes.Jukebox,
      MinecraftBlockTypes.Beacon,
      MinecraftBlockTypes.CraftingTable,
      MinecraftBlockTypes.RespawnAnchor,
      MinecraftBlockTypes.BrewingStand,
      MinecraftBlockTypes.Bed,
      // MinecraftBlockTypes.Stonecutter,
    ];

    const redstone = [
      MinecraftBlockTypes.Observer,
      MinecraftBlockTypes.DaylightDetector,
      MinecraftBlockTypes.DaylightDetectorInverted,
      MinecraftBlockTypes.UnpoweredRepeater,
      MinecraftBlockTypes.UnpoweredComparator,
    ];

    const fireItems = [
      "minecraft:fire_charge",
      "minecraft:flint_and_steel",
      "minecraft:water_bucket",
      "minecraft:lava_bucket",
    ];
    const blockTypeId = block.typeId;
    const itemTypeId = itemStack?.typeId ?? "";

    // 预先保存玩家名和领地主人名，避免在 system.run 中访问 beforeEvent 的对象
    const playerName = player.name;
    const ownerName = insideLand.owner;

    if (fireItems.includes(itemTypeId) && !insideLand.public_auth.burn) {
      event.cancel = true;
      sendLandWarning(playerName, ownerName);
      return;
    }

    // 检查箱子权限
    if (
      chests.includes(blockTypeId as MinecraftBlockTypes) ||
      blockTypeContainsAny(blockTypeId, CONTAINER_BLOCK_KEYWORDS)
    ) {
      if (!insideLand.public_auth.isChestOpen) {
        event.cancel = true;
        sendLandWarning(playerName, ownerName);
      }
      return;
    }

    // 检查按钮权限
    if (
      buttons.includes(blockTypeId as MinecraftBlockTypes) ||
      blockTypeContainsAny(blockTypeId, DOOR_BLOCK_KEYWORDS)
    ) {
      if (!insideLand.public_auth.useButton) {
        event.cancel = true;
        sendLandWarning(playerName, ownerName);
      }
      return;
    }

    // 检查告示牌权限
    if (blockTypeId.endsWith("sign")) {
      if (!insideLand.public_auth.useSign) {
        event.cancel = true;
        sendLandWarning(playerName, ownerName);
      }
      return;
    }

    // 检查红石权限
    if (redstone.includes(blockTypeId as MinecraftBlockTypes)) {
      if (!insideLand.public_auth.useRedstone) {
        event.cancel = true;
        sendLandWarning(playerName, ownerName);
      }
      return;
    }

    // 检查锻造类权限
    if (smelting.includes(blockTypeId as MinecraftBlockTypes)) {
      if (!insideLand.public_auth.useSmelting) {
        event.cancel = true;
        sendLandWarning(playerName, ownerName);
      }
      return;
    }

    // 检查火焰物品权限
    if (!insideLand.public_auth.useBlock) {
      event.cancel = true;
      sendLandWarning(playerName, ownerName);
      return;
    }
  });

  /**
   * 玩家与实体交互
   */
  world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
    const { player, target } = event;
    const { isInside, insideLand } = landManager.testLand(target.location, target.dimension.id);

    if (!isInside || !insideLand) return;
    if (LAND_BREAK_PROTECTED_ENTITY_TYPE_IDS.has(target.typeId) && !isLandBreakAllowed(player, insideLand)) {
      event.cancel = true;
      warnDeniedLandEntityBreaking(player, target, insideLand);
      return;
    }
    if (insideLand.owner === player.name) return;
    if (isAdmin(player)) return;
    if (insideLand.public_auth.useEntity) return;
    if (landManager.isPlayerTrustedOnLand(insideLand, player.name)) return;

    event.cancel = true;
    // 必须延迟发送消息，beforeEvents 中直接调用 sendMessage 可能导致事件处理异常
    const playerName = player.name;
    const ownerName = insideLand.owner;
    system.run(() => {
      const p = getOnlineRealPlayers().find((pl) => pl.name === playerName);
      if (p) {
        useNotify("chat", p, color.red(`这里是 ${color.yellow(ownerName)} ${color.red("的领地，你没有权限这么做！")}`));
      }
    });
  });

  /**
   * 爆炸保护
   */
  world.beforeEvents.explosion.subscribe((event) => {
    const impactedBlocks = event.getImpactedBlocks();
    const impact = impactedBlocks.filter((block) => {
      const { isInside, insideLand } = landManager.testLand(block.location, event.dimension.id);
      // 如果在领地内且开放爆炸权限，则返回true
      // 如果不在领地内，则返回true
      // 否则返回false
      return isInside ? insideLand?.public_auth?.explode : true;
    });
    event.setImpactedBlocks(impact);
  });

  /**
   * 玩家攻击领地内生物
   */
  world.beforeEvents.entityHurt.subscribe((event) => {
    const { hurtEntity, damageSource } = event;
    const cause = damageSource.cause;

    /**
     * 处理规则:
     * 0. 如果是玩家攻击玩家，交给PVP系统处理
     * 0.5. 如果是 fire/fireTick 且无 damagingEntity，检查是否为受保护实体的持续燃烧（兜底拦截）
     * 1. 如果伤害源不等于玩家,则不管
     * 2. 如果伤害源等于玩家,则检查领地权限
     * 3. 如果攻击者是领地主人或管理员,则允许
     * 4. 如果受伤实体是敌对生物(非中立生物),且没有"领地保护"标签,则允许攻击
     * 5. 如果领地的攻击中立生物权限为true,则允许攻击
     * 6. 如果攻击者是领地成员,则允许
     * 7. 如果受伤实体有"领地保护"标签,则取消攻击
     * 8. 其他情况取消攻击（无权限）
     */

    // 0. 如果是玩家攻击玩家，交给PVP系统处理，这里直接返回
    if (hurtEntity.typeId === "minecraft:player" && damageSource.damagingEntity?.typeId === "minecraft:player") {
      return;
    }

    // 0.5. fire/fireTick 且无 damagingEntity：检查是否为受保护实体的持续燃烧
    if ((cause === EntityDamageCause.fire || cause === EntityDamageCause.fireTick) && !damageSource.damagingEntity) {
      const fireTs = landEntityFireSourceMap.get(hurtEntity.id);
      if (fireTs && Date.now() - fireTs < LAND_FIRE_SOURCE_TIMEOUT_MS) {
        event.cancel = true;
        const targetEntity = hurtEntity;
        system.run(() => {
          try {
            targetEntity.extinguishFire(true);
          } catch (_) {}
        });
      } else {
        landEntityFireSourceMap.delete(hurtEntity.id);
      }
      return;
    }

    // 1. 如果伤害源不是玩家,则不管
    if (damageSource.damagingEntity?.typeId !== "minecraft:player") return;

    const attacker = damageSource.damagingEntity as Player;

    // 2. 检查受伤实体是否在领地内
    const { isInside, insideLand } = landManager.testLand(hurtEntity.location, hurtEntity.dimension.id);
    if (!isInside || !insideLand) return;

    if (LAND_BREAK_PROTECTED_ENTITY_TYPE_IDS.has(hurtEntity.typeId)) {
      if (isLandBreakAllowed(attacker, insideLand)) return;

      event.cancel = true;
      const targetEntity = hurtEntity;
      system.run(() => {
        try {
          targetEntity.extinguishFire(true);
          targetEntity.clearVelocity();
        } catch (_) {}
      });
      warnDeniedLandEntityBreaking(attacker, hurtEntity, insideLand);
      return;
    }

    // 3. 如果攻击者是领地主人,则允许
    if (insideLand.owner === attacker.name) return;

    // 4. 如果攻击者是管理员,则允许
    if (isAdmin(attacker)) return;

    // 5. 如果受伤实体是敌对生物（非中立生物），且没有"领地保护"标签，则允许攻击
    const hasLandProtectionTag = hurtEntity.nameTag && hurtEntity.nameTag.trim() === "领地保护";
    if (isMonster(hurtEntity) && !hasLandProtectionTag) return;

    // 6. 如果领地的攻击中立生物权限为true,则允许攻击
    if (insideLand.public_auth.attackNeutralMobs === true) return;

    // 7. 如果攻击者是领地信任对象（含公会领地同公会成员）,则允许
    if (landManager.isPlayerTrustedOnLand(insideLand, attacker.name)) return;

    // 攻击不被允许，记录火焰来源（用于后续 fireTick 兜底拦截）
    landEntityFireSourceMap.set(hurtEntity.id, Date.now());

    // 8. 如果受伤实体有名字标签(领地保护)，则取消攻击
    if (hasLandProtectionTag) {
      event.cancel = true;
      const playerName = attacker.name;
      const ownerName = insideLand.owner;
      const targetEntity = hurtEntity;
      system.run(() => {
        try {
          targetEntity.extinguishFire(true);
          targetEntity.clearVelocity();
        } catch (_) {}
        const p = getOnlineRealPlayers().find((pl) => pl.name === playerName);
        if (p) {
          useNotify(
            "chat",
            p,
            color.red(`这里是 ${color.yellow(ownerName)} ${color.red("的领地，你没有权限攻击这里的中立生物！")}`)
          );
        }
      });
      return;
    }

    // 9. 其他情况取消攻击（无权限）
    event.cancel = true;
    const playerName = attacker.name;
    const ownerName = insideLand.owner;
    const targetEntity = hurtEntity;
    system.run(() => {
      try {
        targetEntity.extinguishFire(true);
        targetEntity.clearVelocity();
      } catch (_) {}
      const p = getOnlineRealPlayers().find((pl) => pl.name === playerName);
      if (p) {
        useNotify(
          "chat",
          p,
          color.red(`这里是 ${color.yellow(ownerName)} ${color.red("的领地，你没有权限攻击这里的中立生物！")}`)
        );
      }
    });
  });
}

// 注册到事件中心
eventRegistry.register("land", registerLandEvents);
