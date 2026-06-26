import { Dimension, Entity, Player, Vector2, Vector3, system, world } from "@minecraft/server";
import { Database } from "../../../shared/database/database";
import { generateId, isAdmin, SystemLog } from "../../../shared/utils/common";
import { formatDateTimeBeijing } from "../../../shared/utils/datetime-beijing";
import setting from "../../system/services/setting";
import economic from "../../economic/services/economic";
import { taskScheduler } from "../../platform/scheduler";
import { normalizeFakePlayerSkinId } from "./fake-player-skins";

export interface IFakePlayer {
  id: string;
  name: string;
  ownerName: string;
  location: Vector3;
  dimension: string;
  created: string;
  skinId?: number;
  rotationX?: number;
  rotationY?: number;
  entityId?: string;
}

export interface FakePlayerCreateInput {
  player: Player;
  name: string;
  skinId?: number;
}

export const FAKE_PLAYER_ENTITY_TYPE = "yuehua:fake_player";

const MAX_NAME_LENGTH = 24;

function nowText(): string {
  return formatDateTimeBeijing(Date.now());
}

function sanitizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH);
}

function normalizeLocation(location: Vector3): Vector3 {
  return {
    x: Number(location.x.toFixed(2)),
    y: Number(location.y.toFixed(2)),
    z: Number(location.z.toFixed(2)),
  };
}

function parseNonNegativeInteger(value: unknown, fallback: number): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function normalizeRotationX(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-90, Math.min(90, n));
}

function normalizeRotationY(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return ((((n + 180) % 360) + 360) % 360) - 180;
}

function getStoredRotation(item: IFakePlayer): Vector2 {
  return {
    x: normalizeRotationX(item.rotationX),
    y: normalizeRotationY(item.rotationY),
  };
}

function getDimension(id: string): Dimension | undefined {
  try {
    return world.getDimension(id);
  } catch {
    return undefined;
  }
}

function isUnloadedChunkError(error: unknown): boolean {
  const message = String((error as Error)?.message ?? error);
  return message.includes("LocationInUnloadedChunkError") || message.includes("not in a chunk currently loaded");
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

class FakePlayerService {
  private db!: Database<IFakePlayer>;

  constructor() {
    system.run(() => {
      this.db = new Database<IFakePlayer>("fake_players");
      this.ensureAllSpawned();
    });

    taskScheduler.register({
      id: "fakePlayer.ensureAnchors",
      label: "假人加载锚点自愈",
      category: "system",
      intervalTicks: 20 * 60,
      skipIfRunning: true,
      when: () => setting.getState("fakePlayer") === true,
      run: () => this.ensureAllSpawned(),
    });
  }

  private ensureEnabled(player?: Player): string | undefined {
    if (setting.getState("fakePlayer") !== true) {
      return player && isAdmin(player) ? "假人系统已关闭，请先在功能开关中开启。" : "服务器暂未开放假人功能。";
    }
    return undefined;
  }

  getMaxPerPlayer(): number {
    return parseNonNegativeInteger(setting.getState("fakePlayerMaxPerPlayer"), 3);
  }

  getCreateCost(): number {
    return parseNonNegativeInteger(setting.getState("fakePlayerCreateCost"), 0);
  }

  canUse(player: Player): boolean {
    return setting.getState("fakePlayer") === true || isAdmin(player);
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

  create(input: FakePlayerCreateInput): IFakePlayer | string {
    const enabledError = this.ensureEnabled(input.player);
    if (enabledError) return enabledError;

    const name = sanitizeName(input.name);
    if (!name) return "假人名称不能为空";
    if (name.length > MAX_NAME_LENGTH) return `假人名称最多 ${MAX_NAME_LENGTH} 个字符`;

    const admin = isAdmin(input.player);
    if (!admin) {
      const max = this.getMaxPerPlayer();
      if (this.listForPlayer(input.player.name).length >= max) {
        return `您的假人数量已达到服务器设置上限(${max})`;
      }
    }

    const cost = this.getCreateCost();
    if (cost > 0 && !economic.isEconomyEnabled()) {
      return "经济系统未启用，无法扣除创建费用。请将假人创建费用设为 0，或开启经济系统。";
    }
    if (cost > 0 && !economic.removeGold(input.player.name, cost, "创建假人加载锚点")) {
      return `金币不足，创建假人需要 ${cost} 金币`;
    }

    const time = nowText();
    const rotation = input.player.getRotation();
    const item: IFakePlayer = {
      id: generateId(),
      name,
      ownerName: input.player.name,
      location: normalizeLocation(input.player.location),
      dimension: input.player.dimension.id,
      created: time,
      skinId: normalizeFakePlayerSkinId(input.skinId),
      rotationX: normalizeRotationX(rotation.x),
      rotationY: normalizeRotationY(rotation.y),
    };

    const entity = this.spawnEntity(item);
    if (!entity) {
      if (cost > 0) {
        economic.addGold(input.player.name, cost, "创建假人失败退款", true);
      }
      return "创建假人实体失败，请确认实体包已加载后重试。";
    }

    item.entityId = entity.id;
    this.db.set(item.id, item);
    return item;
  }

  delete(player: Player, id: string): boolean | string {
    const item = this.db.get(id);
    if (!item) return "假人不存在";
    if (!isAdmin(player) && item.ownerName !== player.name) return "您只能删除自己创建的假人";

    this.removeEntity(item);
    return this.db.delete(id);
  }

  updateSkin(player: Player, id: string, skinId: number): IFakePlayer | string {
    const item = this.db.get(id);
    if (!item) return "假人不存在";
    if (!isAdmin(player) && item.ownerName !== player.name) return "您只能修改自己创建的假人";

    item.skinId = normalizeFakePlayerSkinId(skinId);
    this.db.set(item.id, item);

    const entity = this.getEntity(item);
    if (entity) {
      this.prepareEntity(entity, item);
    }
    return item;
  }

  refresh(id: string): IFakePlayer | string {
    const item = this.db.get(id);
    if (!item) return "假人不存在";
    const entity = this.getEntity(item);
    if (entity) {
      this.prepareEntity(entity, item);
      item.entityId = entity.id;
      this.db.set(item.id, item);
      return item;
    }

    const dimension = getDimension(item.dimension);
    if (!dimension) return "假人所在维度不存在";
    if (!isLocationLoaded(dimension, item.location)) {
      return item;
    }

    const spawned = this.spawnEntity(item);
    if (!spawned) return "重生成假人实体失败";
    item.entityId = spawned.id;
    this.db.set(item.id, item);
    return item;
  }

  ensureAllSpawned(): void {
    if (!this.db) return;
    for (const item of this.db.values()) {
      try {
        this.refresh(item.id);
      } catch (error) {
        SystemLog.warn(`[FakePlayer] 自愈假人失败: ${item.id} ${item.name}`);
        console.warn(error);
      }
    }
  }

  private spawnEntity(item: IFakePlayer): Entity | undefined {
    const dimension = getDimension(item.dimension);
    if (!dimension) return undefined;

    try {
      const entity = dimension.spawnEntity(FAKE_PLAYER_ENTITY_TYPE as any, item.location);
      this.prepareEntity(entity, item);
      return entity;
    } catch (error) {
      if (isUnloadedChunkError(error)) {
        return undefined;
      }
      SystemLog.warn(`[FakePlayer] 生成实体失败: ${item.id} ${item.name}`);
      console.warn(error);
      return undefined;
    }
  }

  private prepareEntity(entity: Entity, item: IFakePlayer): void {
    try {
      const dimension = getDimension(item.dimension);
      entity.nameTag = `§b${item.name}\n§7${item.ownerName} 的假人`;
      entity.addTag("yuehua_fake_player");
      entity.addTag(`yuehua_fake_player_id:${item.id}`);
      entity.setDynamicProperty("fakePlayerId", item.id);
      entity.setDynamicProperty("fakePlayerSkinId", normalizeFakePlayerSkinId(item.skinId));
      entity.triggerEvent(`yuehua:set_skin_${normalizeFakePlayerSkinId(item.skinId)}`);
      if (dimension) {
        this.applyStoredRotation(entity, item, dimension);
        this.queueRotationSync(entity.id, item);
      }
    } catch {
      // Entity handles can be invalid during reload; the next ensure pass will repair them.
    }
  }

  private applyStoredRotation(entity: Entity, item: IFakePlayer, dimension?: Dimension): void {
    const rotation = getStoredRotation(item);
    const targetDimension = dimension ?? getDimension(item.dimension);
    entity.teleport(item.location, {
      ...(targetDimension ? { dimension: targetDimension } : {}),
      rotation,
    });
    entity.setRotation(rotation);
  }

  private queueRotationSync(entityId: string, item: IFakePlayer): void {
    const sync = () => {
      try {
        const currentItem = this.db?.get(item.id) ?? item;
        const entity = world.getEntity(entityId) ?? this.getEntity(currentItem);
        if (!entity) return;
        this.applyStoredRotation(entity, currentItem);
      } catch {
        // The entity may be unloaded or gone; the periodic self-heal will retry later.
      }
    };

    system.run(sync);
    system.runTimeout(sync, 5);
  }

  private getEntity(item: IFakePlayer): Entity | undefined {
    const dimension = getDimension(item.dimension);
    if (!dimension) return undefined;

    if (item.entityId) {
      const byId = world.getEntity(item.entityId);
      if (byId) return byId;
    }

    const entities = dimension.getEntities({
      type: FAKE_PLAYER_ENTITY_TYPE,
      tags: [`yuehua_fake_player_id:${item.id}`],
    });
    return entities[0];
  }

  private removeEntity(item: IFakePlayer): void {
    const entity = this.getEntity(item);
    if (!entity) return;
    try {
      entity.remove();
    } catch {
      try {
        entity.triggerEvent("minecraft:despawn");
      } catch {
        // ignore stale entity handles
      }
    }
  }
}

export const fakePlayerService = new FakePlayerService();
export default fakePlayerService;
