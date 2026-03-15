import { Player, system, Vector3, world } from "@minecraft/server";
import behaviorLog, { LandLogInfo } from "../../features/behavior-log/services/behavior-log";
import { landManager } from "../../features/land/services";
import { eventRegistry } from "../registry";

const JOIN_FLAG = "behaviorLogJoinState";
const LAND_SCAN_INTERVAL_TICKS = 20;
const WITHER_PREP_EXPIRE_MS = 15_000;

interface PlayerLandState {
  name: string;
  owner?: string;
  dimensionId: string;
}

interface WitherPrepRecord {
  playerName: string;
  location: Vector3;
  dimensionId: string;
  timestamp: number;
}

const playerLandState = new Map<string, PlayerLandState>();
const recentWitherPrep: WitherPrepRecord[] = [];
/** 上次执行定时坐标记录时的世界 tick，用于按间隔稳定触发 */
let lastLocationSnapshotTick = 0;

function toLandInfo(input: { isInside: boolean; insideLand: any | null }): LandLogInfo | undefined {
  if (!input.isInside || !input.insideLand) return undefined;
  return {
    name: input.insideLand.name,
    owner: input.insideLand.owner,
  };
}

function getLandInfoAt(location: Vector3, dimensionId: string): LandLogInfo | undefined {
  return toLandInfo(landManager.testLand(location, dimensionId));
}

function isWaterBlock(typeId: string): boolean {
  return typeId === "minecraft:water" || typeId === "minecraft:flowing_water";
}

function isLavaBlock(typeId: string): boolean {
  return typeId === "minecraft:lava" || typeId === "minecraft:flowing_lava";
}

function isWitherPrepBlock(typeId: string): boolean {
  return (
    typeId === "minecraft:soul_sand" ||
    typeId === "minecraft:soul_soil" ||
    typeId.includes("wither_skeleton_skull")
  );
}

/** 根据点击的方块面，计算流体实际放置的格子坐标（相邻格）。基岩版用桶放水/岩浆时可能不触发 playerPlaceBlock，需用 itemStartUseOn 补录。 */
function getPlaceOffsetByBlockFace(blockFace: string | number): { x: number; y: number; z: number } {
  const face = String(blockFace).toLowerCase();
  if (face === "up" || blockFace === 1) return { x: 0, y: 1, z: 0 };
  if (face === "down" || blockFace === 0) return { x: 0, y: -1, z: 0 };
  if (face === "north" || blockFace === 2) return { x: 0, y: 0, z: -1 };
  if (face === "south" || blockFace === 3) return { x: 0, y: 0, z: 1 };
  if (face === "west" || blockFace === 4) return { x: -1, y: 0, z: 0 };
  if (face === "east" || blockFace === 5) return { x: 1, y: 0, z: 0 };
  return { x: 0, y: 1, z: 0 };
}

function recordWitherPreparation(player: Player, location: Vector3, dimensionId: string): void {
  recentWitherPrep.push({
    playerName: player.name,
    location,
    dimensionId,
    timestamp: Date.now(),
  });
}

function cleanupWitherPreparation(): void {
  const now = Date.now();
  for (let i = recentWitherPrep.length - 1; i >= 0; i--) {
    if (now - recentWitherPrep[i].timestamp > WITHER_PREP_EXPIRE_MS) {
      recentWitherPrep.splice(i, 1);
    }
  }
}

/** 凋零召唤者判定：优先取凋零附近最近的玩家，其次取近期摆过凋零架方块的玩家。 */
const WITHER_SUMMONER_RADIUS_SQ = 64 * 64;

/** 取与某位置同维度、距离最近的玩家名，仅在距离平方不超过 radiusSq 时返回。 */
function findNearestPlayer(location: Vector3, dimensionId: string, radiusSq: number): string | undefined {
  let nearestName: string | undefined;
  let nearestDistSq = radiusSq;

  for (const player of world.getAllPlayers()) {
    if (player.dimension.id !== dimensionId) continue;
    const dx = player.location.x - location.x;
    const dy = player.location.y - location.y;
    const dz = player.location.z - location.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq < nearestDistSq) {
      nearestDistSq = distSq;
      nearestName = player.name;
    }
  }

  return nearestName;
}

function findWitherSummoner(location: Vector3, dimensionId: string): string | undefined {
  const nearest = findNearestPlayer(location, dimensionId, WITHER_SUMMONER_RADIUS_SQ);
  if (nearest) return nearest;

  cleanupWitherPreparation();

  let closestRecord: WitherPrepRecord | undefined;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const record of recentWitherPrep) {
    if (record.dimensionId !== dimensionId) continue;
    const dx = record.location.x - location.x;
    const dy = record.location.y - location.y;
    const dz = record.location.z - location.z;
    const distance = dx * dx + dy * dy + dz * dz;
    if (distance < closestDistance) {
      closestDistance = distance;
      closestRecord = record;
    }
  }

  if (!closestRecord || closestDistance > WITHER_SUMMONER_RADIUS_SQ) {
    return undefined;
  }

  return closestRecord.playerName;
}

export function registerBehaviorLogEvents(): void {
  world.afterEvents.playerSpawn.subscribe((event) => {
    const { player } = event;
    const joined = player.getDynamicProperty(JOIN_FLAG) as boolean | undefined;

    if (joined) return;

    player.setDynamicProperty(JOIN_FLAG, true);
    behaviorLog.logJoin(player);
  });

  world.beforeEvents.playerLeave.subscribe((event: any) => {
    const player = event.player as Player | undefined;
    const playerName = player?.name ?? event.playerName;

    if (player) {
      player.setDynamicProperty(JOIN_FLAG, false);
      playerLandState.delete(player.id);
    }

    if (playerName) {
      behaviorLog.logLeave(playerName);
    }
  });

  world.beforeEvents.chatSend.subscribe((event) => {
    const { sender, message } = event;
    if (!message.trim()) return;
    if (message === "服务器菜单") return;
    behaviorLog.logChat(sender, message);
  });

  world.afterEvents.playerPlaceBlock.subscribe((event: any) => {
    if (!event.block?.typeId) return;
    const blockTypeId = event.block.typeId;
    const { player, block } = event;

    if (isWaterBlock(blockTypeId)) {
      behaviorLog.logPlaceWater(player, block.location, block.dimension.id);
    } else if (isLavaBlock(blockTypeId)) {
      behaviorLog.logPlaceLava(player, block.location, block.dimension.id);
    } else if (blockTypeId === "minecraft:tnt") {
      behaviorLog.logPlaceTnt(player, block.location, block.dimension.id);
    }

    if (isWitherPrepBlock(blockTypeId)) {
      recordWitherPreparation(player, block.location, block.dimension.id);
    }
  });

  // 基岩版用桶放水/岩浆时，playerPlaceBlock 可能不触发（流体/replaceable 等），用 itemStartUseOn 补录
  const itemStartUseOn = (world.afterEvents as any).itemStartUseOn;
  if (typeof itemStartUseOn?.subscribe === "function") {
    itemStartUseOn.subscribe((event: any) => {
      const itemId = event.itemStack?.typeId;
      if (!itemId || !event.block?.location) return;
      const { source: player, block, blockFace } = event;
      const dimId = block.dimension?.id;
      if (!dimId) return;

      const offset = getPlaceOffsetByBlockFace(blockFace);
      const loc = block.location;
      const placeAt: Vector3 = {
        x: loc.x + offset.x,
        y: loc.y + offset.y,
        z: loc.z + offset.z,
      };

      if (itemId === "minecraft:water_bucket") {
        behaviorLog.logPlaceWater(player, placeAt, dimId);
      } else if (itemId === "minecraft:lava_bucket") {
        behaviorLog.logPlaceLava(player, placeAt, dimId);
      }
    });
  }

  world.beforeEvents.playerInteractWithBlock.subscribe((event: any) => {
    if (event.cancel) return;
    const { player, block, itemStack } = event;
    const blockTypeId = block?.typeId;
    if (!blockTypeId) return;

    if (itemStack?.typeId === "minecraft:flint_and_steel") {
      behaviorLog.logIgniteFire(player, block.location, block.dimension.id, blockTypeId);
    }

    const containerEventType = behaviorLog.getContainerEventType(blockTypeId);
    if (!containerEventType) return;

    const landInfo = getLandInfoAt(block.location, block.dimension.id);
    behaviorLog.logOpenContainer(player, containerEventType, blockTypeId, block.location, block.dimension.id, landInfo);
  });

  world.beforeEvents.playerInteractWithEntity.subscribe((event: any) => {
    if (event.cancel) return;
    const { player, target } = event;
    if (!target) return;

    const containerEventType = behaviorLog.getContainerEventType(target.typeId);
    if (!containerEventType) return;

    const landInfo = getLandInfoAt(target.location, target.dimension.id);
    behaviorLog.logOpenContainer(player, containerEventType, target.typeId, target.location, target.dimension.id, landInfo);
  });

  world.beforeEvents.entityHurt.subscribe((event: any) => {
    if (event.cancel) return;
    const victim = event.hurtEntity;
    const attacker = event.damageSource?.damagingEntity;

    if (attacker?.typeId !== "minecraft:player") {
      return;
    }

    const source = attacker as Player;

    if (victim?.typeId === "minecraft:player") {
      if (victim.id === attacker.id) return;
      behaviorLog.logPvpHit(source, victim as Player);
      return;
    }

    const landInfo = getLandInfoAt(victim.location, victim.dimension.id);
    if (!landInfo) return;
    behaviorLog.logAttackMobInLand(source, victim.typeId, victim.location, victim.dimension.id, landInfo);
  });

  world.afterEvents.entityDie.subscribe((event: any) => {
    const victim = event.deadEntity;
    if (victim?.typeId !== "minecraft:player") return;

    const player = victim as Player;
    const killer = event.damageSource?.damagingEntity;
    const reason =
      killer?.typeId === "minecraft:player"
        ? `被玩家 ${(killer as Player).name} 击杀`
        : `原因:${String(event.damageSource?.cause ?? "unknown")}`;

    behaviorLog.logDeath(player, reason);
  });

  world.afterEvents.entitySpawn.subscribe((event: any) => {
    const entity = event.entity;
    if (!entity || entity.typeId !== "minecraft:wither") return;

    const playerName = findWitherSummoner(entity.location, entity.dimension.id) ?? "未知玩家";
    behaviorLog.logSummonWither(playerName, entity.location, entity.dimension.id, "检测到凋零生成");
  });

  system.runInterval(() => {
    const onlineIds = new Set(world.getAllPlayers().map((player) => player.id));

    for (const [playerId] of playerLandState) {
      if (!onlineIds.has(playerId)) {
        playerLandState.delete(playerId);
      }
    }

    for (const player of world.getAllPlayers()) {
      const landInfo = getLandInfoAt(player.location, player.dimension.id);
      const previous = playerLandState.get(player.id);

      if (!previous && landInfo) {
        playerLandState.set(player.id, {
          name: landInfo.name,
          owner: landInfo.owner,
          dimensionId: player.dimension.id,
        });
        behaviorLog.logEnterLand(player, landInfo);
        continue;
      }

      if (previous && !landInfo) {
        behaviorLog.logLeaveLand(player.name, player.location, player.dimension.id, previous);
        playerLandState.delete(player.id);
        continue;
      }

      if (
        previous &&
        landInfo &&
        (previous.name !== landInfo.name || previous.owner !== landInfo.owner || previous.dimensionId !== player.dimension.id)
      ) {
        behaviorLog.logLeaveLand(player.name, player.location, previous.dimensionId, previous);
        behaviorLog.logEnterLand(player, landInfo);
        playerLandState.set(player.id, {
          name: landInfo.name,
          owner: landInfo.owner,
          dimensionId: player.dimension.id,
        });
      }
    }
  }, LAND_SCAN_INTERVAL_TICKS);

  system.runInterval(() => {
    const intervalTicks = Math.max(20, behaviorLog.getLocationIntervalSeconds() * 20);
    const currentTick = system.currentTick;
    // 用“距上次记录的 tick 数”判断，避免依赖 currentTick % intervalTicks 可能永远不成立
    if (currentTick - lastLocationSnapshotTick < intervalTicks) {
      return;
    }
    lastLocationSnapshotTick = currentTick;

    for (const player of world.getAllPlayers()) {
      const landInfo = getLandInfoAt(player.location, player.dimension.id);
      behaviorLog.logLocationSnapshot(player, landInfo);
    }
  }, 20);
}

eventRegistry.register("behaviorLog", registerBehaviorLogEvents);
