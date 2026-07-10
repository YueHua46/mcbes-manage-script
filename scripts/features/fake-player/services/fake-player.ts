import { Dimension, Entity, GameMode, Player, system, Vector2, Vector3, world } from "@minecraft/server";
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
  /** 可额外打开假人背包的玩家名列表；创建者与管理员始终可访问 */
  inventoryViewers?: string[];
  /** 假人背包持久化快照（实体卸载/脚本重载后恢复） */
  inventory?: PersistedFakeInventory;
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

export type FakePlayerType = "entity" | "simulated";

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
  const message = error instanceof Error ? error.message : String(error);
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

  constructor() {
    system.run(() => {
      this.db = new Database<IFakePlayer>("fake_players");
      for (const item of this.db.values()) registerKnownFakePlayerName(item.name);
      this.ensureAllSpawned();
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
      system.run(() => {
        this.handleFakePlayerDeath(fakeId);
      });
    });

    world.beforeEvents.entityHurt.subscribe((event) => {
      if (!isFakePlayer(event.hurtEntity)) return;

      event.cancel = true;
      const hurtEntity = event.hurtEntity;
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
    return parseNonNegativeInteger(setting.getState("fakePlayerCreateCost"), 0);
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
      gameMode: GameMode.Survival,
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
    this.db.save(true);
    return { deleted: items.length, kicked };
  }

  refresh(id: string): IFakePlayer | string {
    const item = this.getById(id);
    if (!item) return "假人不存在";

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
    const spawned = this.spawnForType(item);
    if (!spawned) return "新位置所在区块未加载，数据已保存，稍后会自动生成";
    item.entityId = spawned.id;
    this.db.set(item.id, item);
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

  private handleFakePlayerDeath(fakeId: string): void {
    const item = this.getById(fakeId);
    if (!item) return;

    const simulated = this.getSimulatedPlayer(item);
    if (simulated?.isValid) {
      try {
        simulated.respawn();
      } catch {
        // respawn 失败时走完整 refresh
      }
    }

    system.runTimeout(() => {
      const refreshed = this.refresh(fakeId);
      if (typeof refreshed === "string" && refreshed !== fakeId) {
        SystemLog.warn(`[FakePlayer] 假人死亡后恢复失败: ${fakeId}`);
      }
    }, 5);
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
        item.gameMode ?? GameMode.Survival
      );
      this.prepareSimulatedPlayer(simulated, item, true);
      this.activeById.set(item.id, simulated);
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
      this.applyStoredRotation(simulated, item);
      if (restoreInventory && hasPersistedInventory(item.inventory)) {
        restorePlayerInventory(simulated, item.inventory);
      }
      simulated.stopMoving();
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
