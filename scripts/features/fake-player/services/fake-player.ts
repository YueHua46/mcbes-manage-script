import { Dimension, Entity, EntityDamageSource, EquipmentSlot, GameMode, ItemStack, Player, RawMessage, system, Vector2, Vector3, world } from "@minecraft/server";
import { spawnSimulatedPlayer, SimulatedPlayer } from "@minecraft/server-gametest";
import { Database } from "../../../shared/database/database";
import { generateId, isAdmin, SystemLog } from "../../../shared/utils/common";
import { formatDateTimeBeijing } from "../../../shared/utils/datetime-beijing";
import {
  isScriptFakePlayerEntity,
  isKnownFakePlayerName,
  registerKnownFakePlayerName,
} from "../../../shared/utils/online-players";
import economic from "../../economic/services/economic";
import { taskScheduler } from "../../platform/scheduler";
import setting from "../../system/services/setting";
import identityService from "../../player/services/identity-service";
import {
  hasPersistedInventory,
  PersistedFakeInventory,
  restorePlayerInventory,
  snapshotPlayerInventory,
} from "./fake-player-inventory-store";

const LEGACY_ENTITY_TYPE = "yuehua:fake_player";
const FAKE_PLAYER_ID_PROPERTY = "fakePlayerId";
export const FAKE_PLAYER_TAG = "yuehua_fake_player";
const MAX_NAME_LENGTH = 24;
const POSITION_GUARD_DISTANCE_SQ = 1;

/** 判断实体是否为脚本创建的假人（SimulatedPlayer） */
export function isFakePlayer(entity: Entity): boolean {
  return isScriptFakePlayerEntity(entity);
}

/** 假人头顶名称：第一行假人名，第二行创建者 */
export function buildFakePlayerNameTag(item: Pick<IFakePlayer, "name" | "ownerName">): string {
  return `§b${item.name}\n§7${item.ownerName} 的假人`;
}

export interface IFakePlayer {
  id: string;
  name: string;
  ownerName: string;
  location: Vector3;
  dimension: string;
  created: string;
  /** entity=兼容性更好的旧版实体；simulated=可参与原版玩家刷怪判定的新版模拟玩家 */
  type?: FakePlayerType;
  skinId?: number;
  rotationX?: number;
  rotationY?: number;
  entityId?: string;
  gameMode?: GameMode;
  /** 新版模拟玩家是否已经死亡并等待付费复活。 */
  isDead?: boolean;
  diedAt?: string;
  /** 面向玩家展示的最近一次死亡原因。 */
  deathReason?: string;
  /** 击杀实体的原版本地化键，例如 entity.zombie.name。 */
  deathSourceLocalizationKey?: string;
  /** 击杀实体的自定义名称；存在时优先于原版本地化名称。 */
  deathSourceName?: string;
  deathCause?: string;
  /** 可额外打开假人背包的玩家名列表；创建者与管理员始终可访问 */
  inventoryViewers?: string[];
  /** 假人背包持久化快照（实体卸载/脚本重载后恢复） */
  inventory?: PersistedFakeInventory;
  /** 新版模拟玩家的自动化行为；脚本重载或假人重生后会继续执行。 */
  behavior?: FakePlayerBehavior;
  /** 由原子动作组成的通用行为脚本。 */
  program?: FakePlayerProgram;
  /** 旧版本遗留字段：当前不再尝试复制玩家皮肤 */
  ownerSkinJson?: string;
  /** 旧版本遗留字段：当前不再尝试复制玩家皮肤 */
  skinSourceName?: string;
}

export interface FakePlayerCreateInput {
  player: Player;
  name: string;
  type?: FakePlayerType;
  skinId?: number;
}

/** 按查看者的客户端语言显示假人的死亡原因。 */
export function buildFakePlayerDeathReason(item: IFakePlayer): RawMessage {
  let localizationKey = item.deathSourceLocalizationKey;
  let cause = item.deathCause;

  // 兼容本功能上线初期已保存的“被 zombie 通过近战攻击击杀”记录。
  if (!localizationKey && item.deathReason) {
    const legacy = /^被 ([a-z0-9_]+) 通过(.+)击杀$/i.exec(item.deathReason);
    if (legacy) {
      localizationKey = `entity.${legacy[1]}.name`;
      cause ??= legacy[2];
    }
  }

  if (item.deathSourceName || localizationKey) {
    return {
      rawtext: [
        { text: "被 " },
        item.deathSourceName ? { text: item.deathSourceName } : { translate: localizationKey! },
        { text: ` 通过${cause ?? "攻击"}击杀` },
      ],
    };
  }
  return { text: item.deathReason ?? cause ?? "未知" };
}

interface FakePlayerDeathDetails {
  fallbackReason: string;
  cause: string;
  sourceLocalizationKey?: string;
  sourceName?: string;
}

export type FakePlayerType = "entity" | "simulated";

export type FakePlayerMovement = "idle" | "station" | "follow" | "forward" | "backward" | "left" | "right";
export type FakePlayerPeriodicAction =
  | "none"
  | "interact"
  | "interact_block"
  | "attack"
  | "jump"
  | "use_slot"
  | "use_slot_block"
  | "hold_slot"
  | "hold_break";

export interface FakePlayerBehavior {
  movement: FakePlayerMovement;
  targetPlayer?: string;
  speed: number;
  action: FakePlayerPeriodicAction;
  intervalTicks: number;
  hotbarSlot: number;
  stationLocation?: Vector3;
  stationDimension?: string;
  lookAtLocation?: Vector3;
  /** 是否持续保持蹲下。 */
  sneaking: boolean;
}

const DEFAULT_BEHAVIOR: FakePlayerBehavior = {
  movement: "idle",
  speed: 1,
  action: "none",
  intervalTicks: 20,
  hotbarSlot: 0,
  sneaking: false,
};

export type FakePlayerProgramStep =
  | { type: "wait"; ticks: number }
  | { type: "teleport"; location: Vector3; dimension: string }
  | { type: "move_to"; location: Vector3; speed: number }
  | { type: "move_relative"; leftRight: number; forward: number; speed: number }
  | { type: "move_stop" }
  | { type: "follow"; playerName: string; speed: number }
  | { type: "look_at"; location: Vector3 }
  | { type: "select_slot"; slot: number }
  | { type: "use_start"; slot: number }
  | { type: "use_stop" }
  | { type: "attack" }
  | { type: "interact" }
  | { type: "interact_block"; location: Vector3 }
  | { type: "use_on_block"; location: Vector3; slot: number }
  | { type: "break_start"; location: Vector3 }
  | { type: "break_stop" }
  | { type: "jump" }
  | { type: "sneak_start" }
  | { type: "sneak_stop" };

export interface FakePlayerProgram {
  enabled: boolean;
  loop: boolean;
  steps: FakePlayerProgramStep[];
}

export function getFakePlayerType(item: IFakePlayer): FakePlayerType {
  return item.type === "entity" ? "entity" : "simulated";
}

function parseNonNegativeInteger(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function formatLocation(location: Vector3): Vector3 {
  return {
    x: Number(location.x.toFixed(2)),
    y: Number(location.y.toFixed(2)),
    z: Number(location.z.toFixed(2)),
  };
}

function normalizeYaw(value: number): number {
  let yaw = value;
  while (yaw > 180) yaw -= 360;
  while (yaw < -180) yaw += 360;
  return yaw;
}

function clampPitch(value: number): number {
  return Math.max(-90, Math.min(90, value));
}

function getStoredRotation(item: IFakePlayer): Vector2 {
  return {
    x: clampPitch(item.rotationX ?? 0),
    y: normalizeYaw(item.rotationY ?? 0),
  };
}

function isUnloadedChunkError(error: unknown): boolean {
  // Native SAPI errors may put the error class only in String(error), while
  // Error.message contains just "Trying to access location...".
  const message = String(error);
  return message.includes("LocationInUnloadedChunkError") || message.includes("Unloaded chunk");
}

function isLocationLoaded(dimension: Dimension, location: Vector3): boolean {
  try {
    dimension.getBlock(location);
    return true;
  } catch (error) {
    if (isUnloadedChunkError(error)) return false;
    return true;
  }
}

function distanceSquared(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function getDimension(dimensionId: string): Dimension {
  return world.getDimension(dimensionId);
}

class FakePlayerService {
  private db!: Database<IFakePlayer>;
  private readonly activeById = new Map<string, SimulatedPlayer>();
  private readonly lastActionTick = new Map<string, number>();
  private readonly programState = new Map<string, { index: number; resumeTick: number }>();
  private readonly breakingTargetById = new Map<string, string>();

  constructor() {
    system.run(() => {
      this.db = new Database<IFakePlayer>("fake_players");
      for (const item of this.db.values()) registerKnownFakePlayerName(item.name);
      this.ensureAllSpawned();
      system.runInterval(() => this.tickBehaviors(), 1);
    });

    taskScheduler.register({
      id: "fakePlayer.ensureAnchors",
      label: "假人模拟玩家自愈",
      category: "system",
      intervalTicks: 20 * 60,
      skipIfRunning: true,
      when: () => setting.getState("fakePlayer") === true,
      run: () => this.ensureAllSpawned(),
    });

    world.afterEvents.entityDie.subscribe((event) => {
      if (event.deadEntity.typeId !== "minecraft:player") return;
      const fakeId = event.deadEntity.getDynamicProperty(FAKE_PLAYER_ID_PROPERTY) as string | undefined;
      if (!fakeId) return;
      const deathDetails = this.getDeathDetails(event.damageSource);
      system.run(() => this.handleFakePlayerDeath(fakeId, deathDetails));
    });

    world.beforeEvents.entityHurt.subscribe((event) => {
      if (!isFakePlayer(event.hurtEntity)) return;

      const hurtEntity = event.hurtEntity;
      const item = this.getByEntity(hurtEntity);
      const attacker = event.damageSource.damagingEntity;
      // 旧版实体保持完全免伤；新版只允许 monster 家族造成伤害。
      // 因此玩家的近战、弹射物、宠物以及所有环境伤害都无法扣血。
      const allowHostileMobDamage =
        item !== undefined &&
        getFakePlayerType(item) === "simulated" &&
        attacker !== undefined &&
        !isFakePlayer(attacker) &&
        attacker.typeId !== "minecraft:player" &&
        this.isHostileMob(attacker);
      event.cancel = !allowHostileMobDamage;
      system.run(() => {
        try {
          if (hurtEntity.typeId === "minecraft:player") {
            (hurtEntity as Player).extinguishFire(true);
          }
          hurtEntity.clearVelocity();
        } catch {
          // ignore
        }
      });
    });

    world.beforeEvents.entityRemove.subscribe((event) => {
      const entity = event.removedEntity;
      if (!isFakePlayer(entity)) return;

      const fakeId = entity.getDynamicProperty(FAKE_PLAYER_ID_PROPERTY) as string | undefined;
      if (!fakeId) return;

      try {
        const item = this.getById(fakeId);
        if (!item) return;
        if (getFakePlayerType(item) === "simulated" && entity.typeId === "minecraft:player") {
          item.inventory = snapshotPlayerInventory(entity as SimulatedPlayer);
          this.db.set(item.id, item);
          this.db.save();
        }
      } catch (error) {
        SystemLog.warn(`[FakePlayer] 假人移除前持久化背包失败: ${fakeId} ${String(error)}`);
      }
    });

    world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
      if (!isFakePlayer(event.target) || isFakePlayer(event.player)) return;
      // 手持服务器菜单右键时，同一次输入还会命中准星下的假人。
      // 让 itemUse 独占这次操作，避免假人交互表单排队覆盖服务器菜单。
      if (event.itemStack?.typeId === "yuehua:sm") return;

      event.cancel = true;
      const player = event.player;
      const fakeId = event.target.getDynamicProperty(FAKE_PLAYER_ID_PROPERTY) as string | undefined;
      if (!fakeId) return;

      system.run(async () => {
        const item = this.getById(fakeId);
        if (!item) {
          player.sendMessage("§c这个假人的数据不存在。");
          return;
        }

        if (!this.canAccessInventory(player, item)) {
          player.sendMessage("§c你没有权限打开这个假人的背包。");
          return;
        }

        try {
          const { openFakePlayerInteractMenu } = await import("../../../ui/forms/player/fake-player-inventory");
          openFakePlayerInteractMenu(player, fakeId);
        } catch (error) {
          SystemLog.warn(`[FakePlayer] 打开假人交互菜单失败: ${fakeId} ${String(error)}`);
          player.sendMessage("§c打开假人交互菜单失败，请稍后再试。");
        }
      });
    });
  }

  canUse(player: Player): boolean {
    if (setting.getState("fakePlayer") !== true) {
      return isAdmin(player);
    }
    return true;
  }

  getMaxPerPlayer(): number {
    return parseNonNegativeInteger(setting.getState("fakePlayerMaxPerPlayer"), 3);
  }

  getCreateCost(): number {
    if (setting.getState("economy") !== true) return 0;
    return parseNonNegativeInteger(setting.getState("fakePlayerCreateCost"), 0);
  }

  getReviveCost(): number {
    if (setting.getState("economy") !== true) return 0;
    return parseNonNegativeInteger(setting.getState("fakePlayerReviveCost"), 100);
  }

  listAllForAdmin(): IFakePlayer[] {
    return this.db.values().sort((a, b) => a.created.localeCompare(b.created));
  }

  listForPlayer(playerName: string): IFakePlayer[] {
    return this.db
      .values()
      .filter((item) => item.ownerName === playerName)
      .sort((a, b) => a.created.localeCompare(b.created));
  }

  getById(id: string): IFakePlayer | undefined {
    return this.db.get(id);
  }

  getByName(name: string): IFakePlayer | undefined {
    const normalized = name.trim();
    return this.db.values().find((item) => item.name === normalized);
  }

  getByEntity(entity: Entity): IFakePlayer | undefined {
    const fakeId = entity.getDynamicProperty(FAKE_PLAYER_ID_PROPERTY);
    return typeof fakeId === "string" ? this.getById(fakeId) : undefined;
  }

  getLivePlayer(id: string): SimulatedPlayer | undefined {
    const item = this.getById(id);
    return item && getFakePlayerType(item) === "simulated" ? this.getSimulatedPlayer(item) : undefined;
  }

  getLiveEntity(id: string): Entity | undefined {
    const item = this.getById(id);
    if (!item) return undefined;
    return getFakePlayerType(item) === "entity" ? this.getLegacyEntity(item) : this.getSimulatedPlayer(item);
  }

  persistInventory(id: string, inventory?: PersistedFakeInventory): void {
    const item = this.getById(id);
    if (!item || getFakePlayerType(item) !== "simulated") return;

    if (inventory) {
      item.inventory = inventory;
    } else {
      const simulated = this.getSimulatedPlayer(item);
      if (!simulated?.isValid) return;
      item.inventory = snapshotPlayerInventory(simulated);
    }

    this.db.set(item.id, item);
    this.db.save();
  }

  persistInventoryFromEntity(fakeId: string, entity: SimulatedPlayer): void {
    const item = this.getById(fakeId);
    if (!item) return;

    try {
      item.inventory = snapshotPlayerInventory(entity);
      this.db.set(item.id, item);
      this.db.save();
    } catch (error) {
      SystemLog.warn(`[FakePlayer] 持久化假人背包失败: ${fakeId} ${String(error)}`);
    }
  }

  canAccessInventory(player: Player, item: IFakePlayer): boolean {
    return item.ownerName === player.name || isAdmin(player) || this.getInventoryViewers(item).includes(player.name);
  }

  canManageInventoryAccess(player: Player, item: IFakePlayer): boolean {
    return item.ownerName === player.name || isAdmin(player);
  }

  getInventoryViewers(item: IFakePlayer): string[] {
    return Array.from(new Set((item.inventoryViewers ?? []).map((name) => name.trim()).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b)
    );
  }

  addInventoryViewer(operator: Player, id: string, viewerName: string): string | true {
    const item = this.getById(id);
    if (!item) return "假人不存在";
    if (!this.canManageInventoryAccess(operator, item)) return "无权管理这个假人的背包权限";

    const normalized = viewerName.trim();
    const nameError = this.validateInventoryViewerName(item, normalized);
    if (nameError) return nameError;

    const viewers = this.getInventoryViewers(item);
    if (viewers.includes(normalized)) return "该玩家已经拥有背包查看权限";

    item.inventoryViewers = [...viewers, normalized];
    this.db.set(item.id, item);
    return true;
  }

  removeInventoryViewer(operator: Player, id: string, viewerName: string): string | true {
    const item = this.getById(id);
    if (!item) return "假人不存在";
    if (!this.canManageInventoryAccess(operator, item)) return "无权管理这个假人的背包权限";

    const viewers = this.getInventoryViewers(item);
    const next = viewers.filter((name) => name !== viewerName.trim());
    if (next.length === viewers.length) return "该玩家不在授权名单中";

    item.inventoryViewers = next;
    this.db.set(item.id, item);
    return true;
  }

  create(input: FakePlayerCreateInput): IFakePlayer | string {
    if (setting.getState("fakePlayer") !== true && !isAdmin(input.player)) {
      return "假人功能未开启";
    }

    const name = input.name.trim();
    const nameError = this.validateName(name);
    if (nameError) return nameError;

    const admin = isAdmin(input.player);
    if (!admin && this.listForPlayer(input.player.name).length >= this.getMaxPerPlayer()) {
      return `已达到假人数量上限（${this.getMaxPerPlayer()}）`;
    }

    const cost = this.getCreateCost();
    if (cost > 0 && !economic.removeGold(input.player.name, cost, "创建假人")) {
      return `金币不足，创建假人需要 ${cost} 金币`;
    }

    const time = formatDateTimeBeijing(Date.now());

    const item: IFakePlayer = {
      id: generateId(),
      name,
      ownerName: input.player.name,
      location: formatLocation(input.player.location),
      dimension: input.player.dimension.id,
      created: time,
      type: input.type === "entity" ? "entity" : "simulated",
      skinId: input.type === "entity" ? this.normalizeSkinId(input.skinId) : undefined,
      rotationX: input.player.getRotation().x,
      rotationY: input.player.getRotation().y,
      gameMode: input.type === "simulated" ? GameMode.Survival : undefined,
    };

    registerKnownFakePlayerName(item.name);

    const spawned = this.spawnForType(item);
    if (!spawned) {
      if (cost > 0) {
        economic.addGold(input.player.name, cost, "创建假人失败退款", true);
      }
      return "创建假人失败，请确认当前区块已加载";
    }

    item.entityId = spawned.id;
    this.db.set(item.id, item);
    return item;
  }

  delete(player: Player, id: string): boolean | string {
    const item = this.getById(id);
    if (!item) return "假人不存在";
    if (item.ownerName !== player.name && !isAdmin(player)) {
      return "无权删除该假人";
    }

    this.removeManagedPlayer(item);
    return this.db.delete(id);
  }

  deleteByName(player: Player, name: string): boolean | string {
    const item = this.getByName(name);
    if (!item) return `未找到名为 ${name} 的假人`;
    return this.delete(player, item.id);
  }

  dropAllItems(operator: Player, id: string): { stacks: number; items: number } | string {
    const item = this.getById(id);
    if (!item) return "假人不存在";
    if (!this.canManageInventoryAccess(operator, item)) return "无权让这个假人丢出物品";
    if (getFakePlayerType(item) !== "simulated") return "旧版实体假人没有玩家背包";
    const simulated = this.getSimulatedPlayer(item);
    if (!simulated?.isValid) return "假人当前不在线或所在区块未加载";

    let stacks = 0;
    let items = 0;
    const drop = (stack: ItemStack): boolean => {
      try {
        simulated.dimension.spawnItem(stack, simulated.location);
        stacks++;
        items += stack.amount;
        return true;
      } catch {
        return false;
      }
    };

    simulated.stopUsingItem();
    simulated.stopBreakingBlock();
    const container = simulated.getComponent("inventory")?.container;
    if (container) {
      for (let slot = 0; slot < container.size; slot++) {
        const stack = container.getItem(slot);
        if (stack && drop(stack)) container.setItem(slot, undefined);
      }
    }

    const equippable = simulated.getComponent("equippable");
    for (const slot of [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet, EquipmentSlot.Offhand]) {
      const stack = equippable?.getEquipment(slot);
      if (stack && drop(stack)) equippable?.setEquipment(slot, undefined);
    }

    item.inventory = {};
    this.db.set(item.id, item);
    this.db.save();
    return { stacks, items };
  }

  getBehavior(item: IFakePlayer): FakePlayerBehavior {
    return this.normalizeBehavior(item.behavior);
  }

  setBehavior(operator: Player, id: string, behavior: FakePlayerBehavior): IFakePlayer | string {
    const item = this.getById(id);
    if (!item) return "假人不存在";
    if (item.ownerName !== operator.name && !isAdmin(operator)) return "无权控制该假人";
    if (getFakePlayerType(item) !== "simulated") return "只有新版模拟玩家支持行为控制";

    const normalized = this.normalizeBehavior(behavior);
    if (normalized.movement === "follow") {
      const target = this.findRealPlayer(normalized.targetPlayer ?? "");
      if (!target) return "跟随目标当前不在线或名称不正确";
      if (target.dimension.id !== item.dimension) return "跟随目标与假人不在同一维度";
      normalized.targetPlayer = target.name;
    }
    if (normalized.movement === "station") {
      if (!normalized.stationLocation || !normalized.lookAtLocation || !normalized.stationDimension) {
        return "位置锁定需要站位坐标、维度和注视目标";
      }
      if (normalized.stationDimension !== item.dimension) return "锁定位置与假人必须在同一维度";
    }
    if (["interact_block", "use_slot_block"].includes(normalized.action) && !normalized.lookAtLocation) {
      return "指定方块动作需要目标方块坐标";
    }
    item.behavior = normalized;
    delete item.program;
    this.db.set(item.id, item);
    this.db.save();
    this.lastActionTick.delete(item.id);
    this.applyBehavior(item, true);
    return item;
  }

  stopBehavior(operator: Player, id: string): IFakePlayer | string {
    return this.setBehavior(operator, id, { ...DEFAULT_BEHAVIOR });
  }

  getProgram(item: IFakePlayer): FakePlayerProgram {
    return {
      enabled: item.program?.enabled === true,
      loop: item.program?.loop !== false,
      steps: Array.isArray(item.program?.steps) ? item.program.steps : [],
    };
  }

  setProgram(operator: Player, id: string, program: FakePlayerProgram): IFakePlayer | string {
    const item = this.getById(id);
    if (!item) return "假人不存在";
    if (item.ownerName !== operator.name && !isAdmin(operator)) return "无权控制该假人";
    if (getFakePlayerType(item) !== "simulated") return "只有新版模拟玩家支持行为编排";
    if (program.steps.length > 128) return "一个行为脚本最多包含 128 个步骤";
    item.program = { enabled: program.enabled, loop: program.loop, steps: program.steps };
    this.db.set(item.id, item);
    this.db.save();
    this.programState.set(item.id, { index: 0, resumeTick: system.currentTick });
    if (!program.enabled) this.stopAllSimulatedActions(item);
    return item;
  }

  deleteAll(player: Player): { deleted: number; kicked: number } | string {
    if (!isAdmin(player)) return "无权删除全服假人";

    const items = this.listAllForAdmin();
    const knownFakeIds = new Set(items.map((item) => item.id));
    let kicked = 0;

    for (const item of items) {
      const entity = this.getLiveEntity(item.id);
      if (entity?.isValid) kicked++;
      this.removeManagedPlayer(item);
      this.db.delete(item.id);
    }

    for (const online of world.getAllPlayers()) {
      if (!isFakePlayer(online)) continue;
      const fakeId = online.getDynamicProperty(FAKE_PLAYER_ID_PROPERTY);
      if (typeof fakeId === "string" && knownFakeIds.has(fakeId)) continue;
      kicked++;
      this.removeLiveFakePlayer(online as SimulatedPlayer);
    }

    for (const dimensionId of ["overworld", "nether", "the_end"]) {
      try {
        for (const entity of world.getDimension(dimensionId).getEntities({ type: LEGACY_ENTITY_TYPE as any })) {
          const fakeId = entity.getDynamicProperty(FAKE_PLAYER_ID_PROPERTY);
          if (typeof fakeId === "string" && knownFakeIds.has(fakeId)) continue;
          kicked++;
          entity.remove();
        }
      } catch {
        // 忽略未加载维度或已卸载实体。
      }
    }

    this.activeById.clear();
    this.breakingTargetById.clear();
    this.db.save(true);
    return { deleted: items.length, kicked };
  }

  refresh(id: string): IFakePlayer | string {
    const item = this.getById(id);
    if (!item) return "假人不存在";
    if (getFakePlayerType(item) === "simulated" && item.isDead) return "假人已死亡，请先复活";

    const dimension = getDimension(item.dimension);
    if (!isLocationLoaded(dimension, item.location)) {
      return item;
    }

    const existing = this.getLiveEntity(item.id);
    if (existing) {
      if (getFakePlayerType(item) === "entity") {
        this.prepareLegacyEntity(existing, item);
      } else {
        this.prepareSimulatedPlayer(existing as SimulatedPlayer, item, false);
        this.guardPosition(existing as SimulatedPlayer, item);
      }
      item.entityId = existing.id;
      this.db.set(item.id, item);
      return item;
    }

    const spawned = this.spawnForType(item);
    if (!spawned) {
      return item;
    }

    item.entityId = spawned.id;
    this.db.set(item.id, item);
    return item;
  }

  moveToOperator(operator: Player, id: string): IFakePlayer | string {
    const item = this.getById(id);
    if (!item) return "假人不存在";
    if (item.ownerName !== operator.name && !isAdmin(operator)) return "无权移动该假人";

    this.removeManagedPlayer(item);
    item.location = formatLocation(operator.location);
    item.dimension = operator.dimension.id;
    item.rotationX = operator.getRotation().x;
    item.rotationY = operator.getRotation().y;
    delete item.entityId;
    this.db.set(item.id, item);
    if (getFakePlayerType(item) === "simulated" && item.isDead) return item;
    const spawned = this.spawnForType(item);
    if (!spawned) return "新位置所在区块未加载，数据已保存，稍后会自动生成";
    item.entityId = spawned.id;
    this.db.set(item.id, item);
    return item;
  }

  revive(operator: Player, id: string): IFakePlayer | string {
    const item = this.getById(id);
    if (!item) return "假人不存在";
    if (getFakePlayerType(item) !== "simulated") return "旧版实体假人无需复活";
    if (item.ownerName !== operator.name && !isAdmin(operator)) return "无权复活该假人";
    if (!item.isDead) return "假人当前未死亡";

    const cost = this.getReviveCost();
    if (cost > 0 && !economic.removeGold(operator.name, cost, `复活假人 ${item.name}`)) {
      return `金币不足，复活假人需要 ${cost} 金币`;
    }

    delete item.entityId;
    item.isDead = false;
    const spawned = this.spawnSimulatedPlayer(item);
    if (!spawned) {
      item.isDead = true;
      if (cost > 0) economic.addGold(operator.name, cost, `复活假人 ${item.name} 失败退款`, true);
      return "复活失败，请确认假人所在区块已加载；金币已退回";
    }

    item.entityId = spawned.id;
    delete item.diedAt;
    delete item.deathReason;
    delete item.deathSourceLocalizationKey;
    delete item.deathSourceName;
    delete item.deathCause;
    this.db.set(item.id, item);
    this.db.save();
    return item;
  }

  setLegacySkin(operator: Player, id: string, skinId: number): IFakePlayer | string {
    const item = this.getById(id);
    if (!item) return "假人不存在";
    if (getFakePlayerType(item) !== "entity") return "新版模拟玩家不支持二次元皮肤";
    if (item.ownerName !== operator.name && !isAdmin(operator)) return "无权修改该假人";
    item.skinId = this.normalizeSkinId(skinId);
    const entity = this.getLegacyEntity(item);
    if (entity) this.applyLegacySkin(entity, item.skinId);
    this.db.set(item.id, item);
    return item;
  }

  ensureAllSpawned(): void {
    if (setting.getState("fakePlayer") !== true) return;

    for (const item of this.db.values()) {
      try {
        registerKnownFakePlayerName(item.name);
        if (getFakePlayerType(item) === "simulated" && item.isDead) continue;
        const simulated = getFakePlayerType(item) === "simulated" ? this.getSimulatedPlayer(item) : undefined;
        if (simulated?.isValid) {
          this.persistInventory(item.id);
        }

        const result = this.refresh(item.id);
        if (typeof result === "string" && result !== item.id) {
          SystemLog.warn(`[FakePlayer] 自愈假人失败: ${item.id} ${item.name}`);
        }
      } catch (error) {
        SystemLog.warn(`[FakePlayer] 自愈假人异常: ${item.id} ${item.name} ${String(error)}`);
      }
    }
  }

  private validateName(name: string): string | undefined {
    if (!name) return "假人名称不能为空";
    if (name.length > MAX_NAME_LENGTH) return `假人名称不能超过 ${MAX_NAME_LENGTH} 个字符`;

    if (this.getByName(name)) {
      return "已有同名假人，请换一个名称";
    }

    if (identityService.getProfileByName(name) && !isKnownFakePlayerName(name)) {
      return "该名称属于曾进入服务器的真实玩家，请换一个名称";
    }

    for (const online of world.getAllPlayers()) {
      if (online.name === name) {
        return "该名称已被在线玩家占用";
      }
    }

    return undefined;
  }

  private validateInventoryViewerName(item: IFakePlayer, name: string): string | undefined {
    if (!name) return "玩家名不能为空";
    if (name.length > 32) return "玩家名不能超过 32 个字符";
    if (name === item.ownerName) return "创建者默认拥有权限，无需添加";
    return undefined;
  }

  private handleFakePlayerDeath(fakeId: string, details: FakePlayerDeathDetails): void {
    const item = this.getById(fakeId);
    if (!item || getFakePlayerType(item) !== "simulated") return;

    const simulated = this.getSimulatedPlayer(item);
    if (simulated?.isValid) {
      try {
        item.location = formatLocation(simulated.location);
        item.dimension = simulated.dimension.id;
        const rotation = simulated.getRotation();
        item.rotationX = rotation.x;
        item.rotationY = rotation.y;
      } catch {
        // 死亡实体可能已失效，保留最后一次持久化的位置。
      }
    }
    item.isDead = true;
    item.diedAt = formatDateTimeBeijing(Date.now());
    item.deathReason = details.fallbackReason;
    item.deathCause = details.cause;
    item.deathSourceLocalizationKey = details.sourceLocalizationKey;
    item.deathSourceName = details.sourceName;
    delete item.entityId;
    this.activeById.delete(item.id);
    this.programState.delete(item.id);
    this.lastActionTick.delete(item.id);
    this.breakingTargetById.delete(item.id);
    this.db.set(item.id, item);
    this.db.save();

    const owner = this.findRealPlayer(item.ownerName);
    owner?.sendMessage({
      rawtext: [
        { text: `§c你的假人 §e${item.name} §c已死亡：§f` },
        buildFakePlayerDeathReason(item),
        { text: "§c。可在假人管理中付费复活。" },
      ],
    });
    if (simulated?.isValid) this.removeLiveFakePlayer(simulated);
  }

  private isHostileMob(entity: Entity): boolean {
    try {
      return entity.matches({ families: ["monster"] });
    } catch {
      return false;
    }
  }

  private getDeathDetails(source: EntityDamageSource): FakePlayerDeathDetails {
    const causeNames: Record<string, string> = {
      entityAttack: "近战攻击",
      entityExplosion: "爆炸",
      projectile: "弹射物攻击",
      magic: "魔法攻击",
      contact: "接触伤害",
      thorns: "反伤",
    };
    const cause = causeNames[source.cause] ?? String(source.cause);
    const attacker = source.damagingEntity;
    if (!attacker) return { fallbackReason: cause, cause };

    try {
      const customName = attacker.nameTag?.trim();
      const sourceName = customName || attacker.typeId.replace("minecraft:", "");
      return {
        fallbackReason: `被 ${sourceName} 通过${cause}击杀`,
        cause,
        sourceLocalizationKey: customName ? undefined : attacker.localizationKey,
        sourceName: customName || undefined,
      };
    } catch {
      return { fallbackReason: `被敌对生物通过${cause}击杀`, cause, sourceName: "敌对生物" };
    }
  }

  private spawnForType(item: IFakePlayer): Entity | undefined {
    return getFakePlayerType(item) === "entity" ? this.spawnLegacyEntity(item) : this.spawnSimulatedPlayer(item);
  }

  private spawnLegacyEntity(item: IFakePlayer): Entity | undefined {
    const dimension = getDimension(item.dimension);
    if (!isLocationLoaded(dimension, item.location)) return undefined;
    try {
      const entity = dimension.spawnEntity(LEGACY_ENTITY_TYPE as any, item.location);
      this.prepareLegacyEntity(entity, item);
      return entity;
    } catch (error) {
      // The chunk can unload between the probe above and spawnEntity. This is a
      // normal deferred-spawn condition; the periodic self-heal will retry when
      // a real player loads the area, so do not report it as an add-on failure.
      if (isUnloadedChunkError(error)) return undefined;
      SystemLog.warn(`[FakePlayer] 生成旧版实体假人失败: ${item.id} ${item.name} ${String(error)}`);
      return undefined;
    }
  }

  private prepareLegacyEntity(entity: Entity, item: IFakePlayer): void {
    try {
      registerKnownFakePlayerName(item.name);
      entity.addTag(FAKE_PLAYER_TAG);
      entity.addTag(`yuehua_fake_player_id:${item.id}`);
      entity.setDynamicProperty(FAKE_PLAYER_ID_PROPERTY, item.id);
      entity.setDynamicProperty("fakePlayerOwner", item.ownerName);
      entity.nameTag = buildFakePlayerNameTag(item);
      this.applyLegacySkin(entity, this.normalizeSkinId(item.skinId));
      entity.teleport(item.location, {
        dimension: getDimension(item.dimension),
        rotation: getStoredRotation(item),
      });
    } catch (error) {
      SystemLog.warn(`[FakePlayer] 绑定旧版实体假人失败: ${item.id} ${String(error)}`);
    }
  }

  private applyLegacySkin(entity: Entity, skinId: number): void {
    try {
      entity.triggerEvent(`yuehua:set_skin_${this.normalizeSkinId(skinId)}`);
    } catch {
      // 资源版本过旧时保留默认皮肤。
    }
  }

  private getLegacyEntity(item: IFakePlayer): Entity | undefined {
    try {
      const entities = getDimension(item.dimension).getEntities({ type: LEGACY_ENTITY_TYPE as any });
      return entities.find((entity) => {
        if (item.entityId && entity.id === item.entityId) return true;
        return entity.getDynamicProperty(FAKE_PLAYER_ID_PROPERTY) === item.id;
      });
    } catch {
      return undefined;
    }
  }

  private spawnSimulatedPlayer(item: IFakePlayer): SimulatedPlayer | undefined {
    const dimension = getDimension(item.dimension);
    if (!isLocationLoaded(dimension, item.location)) {
      return undefined;
    }

    try {
      const simulated = spawnSimulatedPlayer(
        {
          dimension,
          x: item.location.x,
          y: item.location.y,
          z: item.location.z,
        },
        item.name,
        GameMode.Survival
      );
      this.activeById.set(item.id, simulated);
      this.prepareSimulatedPlayer(simulated, item, true);
      return simulated;
    } catch (error) {
      SystemLog.warn(`[FakePlayer] 生成模拟玩家失败: ${item.id} ${item.name} ${String(error)}`);
      return undefined;
    }
  }

  private prepareSimulatedPlayer(simulated: SimulatedPlayer, item: IFakePlayer, restoreInventory: boolean): void {
    try {
      registerKnownFakePlayerName(item.name);
      simulated.addTag(FAKE_PLAYER_TAG);
      simulated.addTag(`yuehua_fake_player_id:${item.id}`);
      simulated.setDynamicProperty(FAKE_PLAYER_ID_PROPERTY, item.id);
      simulated.setDynamicProperty("fakePlayerOwner", item.ownerName);
      simulated.nameTag = buildFakePlayerNameTag(item);
      simulated.setGameMode(GameMode.Survival);
      item.gameMode = GameMode.Survival;
      this.applyStoredRotation(simulated, item);
      if (restoreInventory && hasPersistedInventory(item.inventory)) {
        restorePlayerInventory(simulated, item.inventory);
      }
      this.applyBehavior(item, true);
    } catch (error) {
      SystemLog.warn(`[FakePlayer] 绑定模拟玩家失败: ${item.id} ${String(error)}`);
    }
  }

  private applyStoredRotation(simulated: SimulatedPlayer, item: IFakePlayer): void {
    const rotation = getStoredRotation(item);
    const dimension = getDimension(item.dimension);
    simulated.teleport(item.location, {
      dimension,
      rotation,
    });
  }

  private guardPosition(simulated: SimulatedPlayer, item: IFakePlayer): void {
    if (this.getBehavior(item).movement !== "idle") return;
    if (distanceSquared(simulated.location, item.location) <= POSITION_GUARD_DISTANCE_SQ) {
      simulated.stopMoving();
      return;
    }

    this.applyStoredRotation(simulated, item);
    simulated.stopMoving();
  }

  private getSimulatedPlayer(item: IFakePlayer): SimulatedPlayer | undefined {
    const cached = this.activeById.get(item.id);
    if (cached?.isValid) {
      return cached;
    }
    if (cached) {
      this.activeById.delete(item.id);
    }

    if (item.entityId) {
      for (const player of world.getAllPlayers()) {
        if (player.id === item.entityId && player.getDynamicProperty(FAKE_PLAYER_ID_PROPERTY) === item.id) {
          const simulated = player as SimulatedPlayer;
          this.activeById.set(item.id, simulated);
          return simulated;
        }
      }
    }

    for (const player of world.getAllPlayers()) {
      if (player.getDynamicProperty(FAKE_PLAYER_ID_PROPERTY) === item.id) {
        const simulated = player as SimulatedPlayer;
        this.activeById.set(item.id, simulated);
        return simulated;
      }
    }

    return undefined;
  }

  private removeSimulatedPlayer(item: IFakePlayer): void {
    const simulated = this.getSimulatedPlayer(item);
    if (simulated?.isValid) {
      this.persistInventoryFromEntity(item.id, simulated);
    }
    this.activeById.delete(item.id);
    this.breakingTargetById.delete(item.id);
    if (!simulated?.isValid) return;

    try {
      simulated.remove();
      return;
    } catch {
      // fall through
    }

    try {
      simulated.disconnect();
    } catch (error) {
      SystemLog.warn(`[FakePlayer] 移除模拟玩家失败: ${item.id} ${item.name} ${String(error)}`);
    }
  }

  private normalizeBehavior(value?: Partial<FakePlayerBehavior>): FakePlayerBehavior {
    const movements: FakePlayerMovement[] = ["idle", "station"];
    const actions: FakePlayerPeriodicAction[] = [
      "none",
      "interact",
      "interact_block",
      "attack",
      "jump",
      "use_slot",
      "use_slot_block",
      "hold_slot",
      "hold_break",
    ];
    const movement = movements.includes(value?.movement as FakePlayerMovement)
      ? (value?.movement as FakePlayerMovement)
      : DEFAULT_BEHAVIOR.movement;
    const action = actions.includes(value?.action as FakePlayerPeriodicAction)
      ? (value?.action as FakePlayerPeriodicAction)
      : DEFAULT_BEHAVIOR.action;
    return {
      movement,
      targetPlayer: String(value?.targetPlayer ?? "").trim() || undefined,
      speed: Math.max(0.1, Math.min(1, Number(value?.speed) || DEFAULT_BEHAVIOR.speed)),
      action,
      intervalTicks: Math.max(1, Math.min(20 * 60 * 60, Math.floor(Number(value?.intervalTicks) || 20))),
      hotbarSlot: Math.max(0, Math.min(8, Math.floor(Number(value?.hotbarSlot) || 0))),
      sneaking: value?.sneaking === true,
      stationLocation: this.normalizeVector(value?.stationLocation),
      stationDimension: String(value?.stationDimension ?? "").trim() || undefined,
      lookAtLocation: this.normalizeVector(value?.lookAtLocation),
    };
  }

  private normalizeVector(value?: Vector3): Vector3 | undefined {
    if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y) || !Number.isFinite(value.z)) return undefined;
    return formatLocation(value);
  }

  private findRealPlayer(name: string): Player | undefined {
    return world.getAllPlayers().find((player) => !isFakePlayer(player) && player.name === name.trim());
  }

  private tickBehaviors(): void {
    if (!this.db || setting.getState("fakePlayer") !== true) return;
    let positionChanged = false;
    for (const item of this.db.values()) {
      if (getFakePlayerType(item) !== "simulated") continue;
      if (item.isDead) continue;
      if (this.getProgram(item).enabled) {
        try {
          this.tickProgram(item);
        } catch (error) {
          SystemLog.warn(`[FakePlayer] 执行动作序列失败: ${item.id} ${item.name} ${String(error)}`);
        }
        continue;
      }
      const behavior = this.getBehavior(item);
      if (behavior.movement === "idle" && behavior.action === "none" && !behavior.sneaking) continue;
      try {
        this.applyBehavior(item, false);
        if (system.currentTick % 100 === 0) {
          const simulated = this.getSimulatedPlayer(item);
          if (simulated?.isValid) {
            item.location = formatLocation(simulated.location);
            item.dimension = simulated.dimension.id;
            const rotation = simulated.getRotation();
            item.rotationX = rotation.x;
            item.rotationY = rotation.y;
            this.db.set(item.id, item);
            positionChanged = true;
          }
        }
      } catch (error) {
        SystemLog.warn(`[FakePlayer] 执行行为失败: ${item.id} ${item.name} ${String(error)}`);
      }
    }
    if (positionChanged) this.db.save();
  }

  private tickProgram(item: IFakePlayer): void {
    const program = this.getProgram(item);
    const simulated = this.getSimulatedPlayer(item);
    if (!simulated?.isValid || program.steps.length === 0) return;
    const state = this.programState.get(item.id) ?? { index: 0, resumeTick: system.currentTick };
    if (system.currentTick < state.resumeTick) return;
    if (state.index >= program.steps.length) {
      if (!program.loop) {
        item.program = { ...program, enabled: false };
        this.db.set(item.id, item);
        this.db.save();
        this.stopAllSimulatedActions(item);
        return;
      }
      state.index = 0;
    }
    const step = program.steps[state.index++];
    this.executeProgramStep(simulated, step, state);
    this.programState.set(item.id, state);
  }

  private executeProgramStep(
    simulated: SimulatedPlayer,
    step: FakePlayerProgramStep,
    state: { index: number; resumeTick: number }
  ): void {
    switch (step.type) {
      case "wait":
        state.resumeTick = system.currentTick + Math.max(1, Math.floor(step.ticks));
        break;
      case "teleport":
        simulated.teleport(step.location, { dimension: getDimension(step.dimension) });
        break;
      case "move_to":
        simulated.navigateToLocation(step.location, Math.max(0.1, Math.min(1, step.speed)));
        break;
      case "move_relative":
        simulated.moveRelative(step.leftRight, step.forward, Math.max(0.1, Math.min(1, step.speed)));
        break;
      case "move_stop":
        simulated.stopMoving();
        break;
      case "follow": {
        const target = this.findRealPlayer(step.playerName);
        if (target?.dimension.id === simulated.dimension.id) simulated.navigateToEntity(target, step.speed);
        break;
      }
      case "look_at":
        simulated.lookAtLocation(step.location);
        break;
      case "select_slot":
        simulated.selectedSlotIndex = Math.max(0, Math.min(8, Math.floor(step.slot)));
        break;
      case "use_start":
        simulated.useItemInSlot(Math.max(0, Math.min(8, Math.floor(step.slot))));
        break;
      case "use_stop":
        simulated.stopUsingItem();
        break;
      case "attack":
        simulated.attack();
        break;
      case "interact":
        simulated.interact();
        break;
      case "interact_block":
        simulated.interactWithBlock(step.location);
        break;
      case "use_on_block":
        simulated.useItemInSlotOnBlock(step.slot, step.location);
        break;
      case "break_start":
        simulated.breakBlock(step.location);
        break;
      case "break_stop":
        simulated.stopBreakingBlock();
        break;
      case "jump":
        simulated.jump();
        break;
      case "sneak_start":
        simulated.isSneaking = true;
        break;
      case "sneak_stop":
        simulated.isSneaking = false;
        break;
    }
  }

  private stopAllSimulatedActions(item: IFakePlayer): void {
    const simulated = this.getSimulatedPlayer(item);
    if (!simulated?.isValid) return;
    simulated.stopMoving();
    simulated.stopInteracting();
    simulated.stopBreakingBlock();
    simulated.stopUsingItem();
    simulated.isSneaking = false;
    this.breakingTargetById.delete(item.id);
  }

  private applyBehavior(item: IFakePlayer, force: boolean): void {
    const simulated = this.getSimulatedPlayer(item);
    if (!simulated?.isValid) return;
    const behavior = this.getBehavior(item);
    simulated.selectedSlotIndex = behavior.hotbarSlot;
    simulated.isSneaking = behavior.sneaking;

    if (force) {
      simulated.stopMoving();
      simulated.stopInteracting();
      simulated.stopBreakingBlock();
      simulated.stopUsingItem();
      this.breakingTargetById.delete(item.id);
    }

    if (force || system.currentTick % 10 === 0) switch (behavior.movement) {
      case "station":
        if (behavior.stationLocation && behavior.stationDimension && behavior.lookAtLocation) {
          if (
            simulated.dimension.id !== behavior.stationDimension ||
            distanceSquared(simulated.location, behavior.stationLocation) > 0.0025
          ) {
            simulated.teleport(behavior.stationLocation, { dimension: getDimension(behavior.stationDimension) });
          }
          simulated.stopMoving();
          simulated.lookAtLocation(behavior.lookAtLocation);
        }
        break;
      case "follow": {
        const target = this.findRealPlayer(behavior.targetPlayer ?? "");
        if (target?.dimension.id === simulated.dimension.id) simulated.navigateToEntity(target, behavior.speed);
        else simulated.stopMoving();
        break;
      }
      case "forward":
        simulated.moveRelative(0, 1, behavior.speed);
        break;
      case "backward":
        simulated.moveRelative(0, -1, behavior.speed);
        break;
      case "left":
        simulated.moveRelative(-1, 0, behavior.speed);
        break;
      case "right":
        simulated.moveRelative(1, 0, behavior.speed);
        break;
      default:
        if (force) simulated.stopMoving();
    }

    if (behavior.action === "none") return;
    if (behavior.action === "hold_slot") {
      if (force) simulated.useItemInSlot(behavior.hotbarSlot);
      return;
    }
    if (behavior.action === "hold_break") {
      const hit = simulated.getBlockFromViewDirection({ maxDistance: 6 });
      const previousTarget = this.breakingTargetById.get(item.id);
      if (!hit) {
        if (previousTarget) simulated.stopBreakingBlock();
        this.breakingTargetById.delete(item.id);
        return;
      }

      const { x, y, z } = hit.block.location;
      const targetKey = `${simulated.dimension.id}:${x},${y},${z}:${hit.block.typeId}`;
      if (previousTarget !== targetKey) {
        if (previousTarget) simulated.stopBreakingBlock();
        if (simulated.breakBlock(hit.block.location)) {
          this.breakingTargetById.set(item.id, targetKey);
        }
      }
      return;
    }

    const lastTick = this.lastActionTick.get(item.id) ?? -behavior.intervalTicks;
    if (!force && system.currentTick - lastTick < behavior.intervalTicks) return;
    this.lastActionTick.set(item.id, system.currentTick);
    switch (behavior.action) {
      case "interact":
        simulated.interact();
        break;
      case "interact_block":
        if (behavior.lookAtLocation) simulated.interactWithBlock(behavior.lookAtLocation);
        break;
      case "attack":
        simulated.attack();
        break;
      case "jump":
        simulated.jump();
        break;
      case "use_slot":
        simulated.useItemInSlot(behavior.hotbarSlot);
        system.runTimeout(() => {
          if (simulated.isValid) simulated.stopUsingItem();
        }, 1);
        break;
      case "use_slot_block":
        if (behavior.lookAtLocation) simulated.useItemInSlotOnBlock(behavior.hotbarSlot, behavior.lookAtLocation);
        break;
    }
  }

  private removeManagedPlayer(item: IFakePlayer): void {
    if (getFakePlayerType(item) === "simulated") {
      this.removeSimulatedPlayer(item);
      return;
    }
    const entity = this.getLegacyEntity(item);
    if (!entity?.isValid) return;
    try {
      entity.remove();
    } catch (error) {
      SystemLog.warn(`[FakePlayer] 移除旧版实体假人失败: ${item.id} ${item.name} ${String(error)}`);
    }
  }

  private normalizeSkinId(value: unknown): number {
    const skinId = Math.floor(Number(value));
    return Number.isFinite(skinId) && skinId >= 0 && skinId <= 15 ? skinId : 0;
  }

  private removeLiveFakePlayer(simulated: SimulatedPlayer): void {
    if (!simulated?.isValid) return;

    try {
      simulated.remove();
      return;
    } catch {
      // fall through
    }

    try {
      simulated.disconnect();
    } catch (error) {
      SystemLog.warn(`[FakePlayer] 移除游离模拟玩家失败: ${String(error)}`);
    }
  }
}

export const fakePlayerService = new FakePlayerService();
export default fakePlayerService;
