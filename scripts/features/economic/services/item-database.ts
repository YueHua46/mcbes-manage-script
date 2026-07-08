/**
 * 物品数据库服务
 * 完整迁移自 Modules/Economic/ItemDatabase.ts (387行)
 * 使用实体容器存储物品的高级数据库系统
 */

import { Dimension, Entity, ItemStack, LocationInUnloadedChunkError, system, world } from "@minecraft/server";
import { Database } from "../../../shared/database/database";
import { isAdmin, SystemLog } from "../../../shared/utils/common";
import { deserializeItemStack, PersistedItemStack, serializeItemStack } from "../../../shared/utils/item-stack-persist";
import { getOnlineRealPlayerCount, getOnlineRealPlayers, isScriptFakePlayerEntity } from "../../../shared/utils/online-players";

// 每个实体可存储的最大槽位数
const ITEM_MAX_PER_ENTITY = 256;
// 在世界中用于存储的实体类型
const ENTITY_TYPE_ID = "pao:new_database";
/** 存储实体固定坐标（与 tickingarea 圆心一致） */
const DB_ANCHOR = { x: 8, y: 0, z: 8 };
/** 常驻加载区：保证 anchor 区块进入 tick 后再 spawn / 访问 */
const TICKING_AREA_CMD = `tickingarea add circle 8 0 8 4 "PaoDatabase" true`;
/** tickingarea 生效后再等待的 tick 数 */
const ANCHOR_LOAD_WAIT_TICKS = 25;
/** spawn 遇未加载区块时的最大重试次数 */
const SPAWN_ANCHOR_MAX_ATTEMPTS = 45;
const DB_ENTITY_TAG = "pao_item_database";
const DB_NAME_TAG_PREFIX = "pao_db_name:";
const DB_INDEX_TAG_PREFIX = "pao_db_index:";
// 记录已注册的数据库名称，防止重复
const nameRegistered: string[] = [];
const databaseInstances = new Set<ItemDatabase>();
let entityRemoveGuardRegistered = false;
let storageWindDownGuardRegistered = false;
/** 最后一名真实玩家离线后，存储实体随区块卸载属于预期行为 */
let storageWindDownActive = false;

interface RescueSlot {
  slot: number;
  item: ItemStack;
}

interface RescueSnapshot {
  entityIndex: number;
  entityId: string;
  slots: RescueSlot[];
}

/**
 * 单个槽位的数据结构
 */
interface SlotData {
  slot: number;
  item?: ItemStack;
  itemSnapshot?: PersistedItemStack;
  [key: string]: unknown;
}

/**
 * 工具：等待世界与玩家加载完成
 */
function waitLoaded(): Promise<void> {
  return new Promise((resolve) => {
    const id = system.runInterval(() => {
      if (world.getAllPlayers().length > 0) {
        system.clearRun(id);
        resolve();
      }
    }, 10);
  });
}

/**
 * 等待若干游戏刻（从下一次 system.run 起算）
 */
function waitTicks(tickCount: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number) => {
      if (left <= 0) {
        resolve();
        return;
      }
      system.run(() => step(left - 1));
    };
    step(tickCount);
  });
}

/**
 * 注册常驻加载区并在几 tick 后再继续，避免 (DB_ANCHOR) 尚未加载/tick 就 spawn。
 */
async function prepareDatabaseAnchorRegion(
  dimension: Dimension = world.getDimension("minecraft:overworld")
): Promise<void> {
  await new Promise<void>((resolve) => {
    system.run(() => {
      dimension.runCommand(TICKING_AREA_CMD);
      void waitTicks(ANCHOR_LOAD_WAIT_TICKS).then(resolve);
    });
  });
}

async function spawnEntityAtAnchorWithRetry(dimension: Dimension, attemptSpawn: () => Entity): Promise<Entity> {
  for (let i = 0; i < SPAWN_ANCHOR_MAX_ATTEMPTS; i++) {
    try {
      return attemptSpawn();
    } catch (e) {
      if (e instanceof LocationInUnloadedChunkError && i < SPAWN_ANCHOR_MAX_ATTEMPTS - 1) {
        await waitTicks(2);
        continue;
      }
      throw e;
    }
  }
  throw new Error("spawnEntityAtAnchorWithRetry: exhausted retries");
}

/**
 * 工具：计算数组平均值
 */
function calculateAverage(array: number[]): number {
  if (array.length === 0) return 0;
  return array.reduce((a, b) => a + b, 0) / array.length;
}

/**
 * 根据值在对象中查找键
 */
function findIndexByValue<T extends Record<string, any>>(obj: T, value: any): string | undefined {
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key) && JSON.stringify(obj[key]) === JSON.stringify(value)) {
      return key;
    }
  }
  return undefined;
}

function getEntityDbName(entity: Entity): string | undefined {
  const dynamicName = entity.getDynamicProperty("paoDbName");
  if (typeof dynamicName === "string" && dynamicName) return dynamicName;

  const tagName = entity
    .getTags()
    .find((tag) => tag.startsWith(DB_NAME_TAG_PREFIX))
    ?.slice(DB_NAME_TAG_PREFIX.length);
  if (tagName) return tagName;

  const nameTag = entity.nameTag;
  if (nameTag.startsWith("DB_")) return nameTag.slice(3);
  return undefined;
}

function registerEntityRemoveGuard(): void {
  if (entityRemoveGuardRegistered) return;
  entityRemoveGuardRegistered = true;

  world.beforeEvents.entityRemove.subscribe((event) => {
    const entity = event.removedEntity;
    if (entity.typeId !== ENTITY_TYPE_ID) return;

    const dbName = getEntityDbName(entity);
    if (!dbName) return;

    for (const db of databaseInstances) {
      if (db.name === dbName) {
        db.captureUnexpectedEntityRemoval(entity);
        return;
      }
    }
  });
}

function registerStorageWindDownGuard(): void {
  if (storageWindDownGuardRegistered) return;
  storageWindDownGuardRegistered = true;

  world.afterEvents.playerSpawn.subscribe((event) => {
    if (isScriptFakePlayerEntity(event.player)) return;
    storageWindDownActive = false;
  });

  world.beforeEvents.playerLeave.subscribe((event) => {
    if (isScriptFakePlayerEntity(event.player)) return;

    const realPlayers = getOnlineRealPlayers();
    if (realPlayers.length <= 1 && realPlayers[0]?.id === event.player.id) {
      storageWindDownActive = true;
    }

    system.run(() => {
      storageWindDownActive = getOnlineRealPlayerCount() === 0;
    });
  });
}

function isExpectedStorageUnload(): boolean {
  return storageWindDownActive || getOnlineRealPlayerCount() === 0;
}

/**
 * 封装单个物品，提供对数据库操作的方法
 */
export class Item {
  readonly item: ItemStack;
  #data: SlotData;
  #db: ItemDatabase;

  constructor(data: SlotData, db: ItemDatabase) {
    this.#data = data;
    this.#db = db;
    this.item = data.item!;
  }

  get data(): SlotData {
    return { ...this.#data };
  }

  isValid(): boolean {
    return this.#db.isValid(this.#data);
  }

  delete(): void {
    this.#db.remove(this.#data);
  }

  unStore(keepItem = true): ItemStack {
    return this.#db.unStore(this.#data, keepItem);
  }

  editData(newData: Partial<SlotData> = {}): void {
    this.#data = this.#db.edit(this.#data, newData);
  }
}

/**
 * 主类：实体背包数据库
 */
export default class ItemDatabase {
  #name: string;
  #loaded = false;
  #entities: Entity[] = [];
  #itemData: Record<number, SlotData> = {};
  #database!: Database;
  #unhealthyReason?: string;
  #expectedRemovalIds = new Set<string>();

  constructor(name: string) {
    if (nameRegistered.includes(name)) {
      throw new Error(`Database with name "${name}" already exists!`);
    }

    this.#name = name;
    system.run(() => {
      this.#database = new Database(`EntityDatabase_${name}`);
    });
    nameRegistered.push(name);
    databaseInstances.add(this);
    registerEntityRemoveGuard();
    registerStorageWindDownGuard();

    this.init().catch((e) => console.error(e));
  }

  get name(): string {
    return this.#name;
  }

  /** 初始化，加载已有实体与槽位数据 */
  private async init(): Promise<void> {
    await waitLoaded();
    const overworld = world.getDimension("minecraft:overworld");
    await prepareDatabaseAnchorRegion(overworld);

    const start = Date.now();
    const loadedTimes: number[] = [];

    const ents = overworld
      .getEntities()
      .filter((e) => e.typeId === ENTITY_TYPE_ID && e.nameTag === `DB_${this.#name}`)
      .sort((a, b) => {
        const ta = Number(
          a
            .getTags()
            .find((t) => t.startsWith("spawntime:"))
            ?.slice(9) ?? 0
        );
        const tb = Number(
          b
            .getTags()
            .find((t) => t.startsWith("spawntime:"))
            ?.slice(9) ?? 0
        );
        return ta - tb;
      });

    if (ents.length > 0) {
      let entityCount = 0;
      for (const ent of ents) {
        this.#bindDatabaseEntity(ent, entityCount);
        const inv = ent.getComponent("inventory")?.container;
        for (let i = 0; i < ITEM_MAX_PER_ENTITY; i++) {
          const t0 = Date.now();
          const it = inv?.getItem(i);
          const slot = i + entityCount * ITEM_MAX_PER_ENTITY;
          const stored = this.#database.get(`slot_${slot}`);
          if (it && stored) {
            stored.item = it;
            stored.itemSnapshot = serializeItemStack(it);
            this.#itemData[slot] = stored;
            this.#database.set(`slot_${slot}`, stored);
          } else if (it && !stored) {
            this.#quarantineOrphanEntityItem(slot, it);
            inv?.setItem(i);
          } else if (!it && stored) {
            if (stored.itemSnapshot) {
              try {
                const restored = deserializeItemStack(stored.itemSnapshot);
                inv?.setItem(i, restored);
                stored.item = restored;
                this.#itemData[slot] = stored;
                this.#database.set(`slot_${slot}`, stored);
              } catch (error) {
                this.#quarantineMissingIndexedItem(
                  slot,
                  stored,
                  `slot index exists but item snapshot cannot be restored: ${String(error)}`
                );
              }
            } else {
              this.#quarantineMissingIndexedItem(slot, stored, "slot index exists but entity item is missing");
            }
          } else {
            // empty slot
          }
          loadedTimes.push(Date.now() - t0);
        }
        this.#entities.push(ent);
        entityCount++;
      }
    } else if (this.#database.keys().some((key) => key.startsWith("slot_"))) {
      await this.#bootstrapStorageFromPersisted(overworld);
    } else {
      const e = await spawnEntityAtAnchorWithRetry(overworld, () =>
        overworld.spawnEntity<"pao:new_database">(ENTITY_TYPE_ID, DB_ANCHOR)
      );
      this.#bindDatabaseEntity(e, 0);
      this.#entities.push(e);
    }

    this.#loaded = true;
    const avg = calculateAverage(loadedTimes) || 0;
    SystemLog.info(
      `[Entity Database] ${this.#name} loaded in ${Date.now() - start}ms, ${this.length} items, avg ${avg}ms/item.`
    );
  }

  /** 当前所有实体可用的总槽位 */
  private get fullInventory(): number {
    return this.#entities.length * ITEM_MAX_PER_ENTITY;
  }

  /** 查找空槽位索引列表 */
  #findEmptySlot(): number[] {
    this.#assertHealthy();
    const empties: number[] = [];
    for (let i = 0; i < this.fullInventory; i++) {
      if (!this.#itemData[i]) empties.push(i);
    }
    return empties;
  }

  /** 将数据写入指定槽位并更新实体与持久化 */
  #setItem(slot: number, item: ItemStack, data: Omit<SlotData, "slot" | "item">): SlotData {
    this.#assertHealthy();
    const entityIndex = Math.floor(slot / ITEM_MAX_PER_ENTITY);
    const entitySlot = slot % ITEM_MAX_PER_ENTITY;
    const ent = this.#entities[entityIndex];

    const fullData: SlotData = { slot, item, itemSnapshot: serializeItemStack(item), ...data };
    this.#database.set(`slot_${slot}`, fullData);
    this.#itemData[slot] = fullData;
    this.#database.save();
    ent.getComponent("inventory")?.container.setItem(entitySlot, item);
    return fullData;
  }

  /** 删除指定槽位的物品与持久化数据 */
  #deleteItem(slot: number): void {
    this.#assertHealthy();
    const entityIndex = Math.floor(slot / ITEM_MAX_PER_ENTITY);
    const entitySlot = slot % ITEM_MAX_PER_ENTITY;
    const ent = this.#entities[entityIndex];
    const inv = ent.getComponent("inventory")?.container;
    if (!inv) return;
    this.#database.delete(`slot_${slot}`);
    delete this.#itemData[slot];
    this.#database.save();
    inv.setItem(entitySlot);

    if (
      inv.emptySlotsCount >= ITEM_MAX_PER_ENTITY &&
      this.#entities.length > 1 &&
      entityIndex === this.#entities.length - 1
    ) {
      this.#entities.pop();
      this.#markExpectedRemoval(ent);
      ent.remove();
    }
  }

  /** 在已加载的 anchor 上生成一只存储实体并加入列表 */
  #spawnAndRegisterOneEntity(): void {
    this.#assertHealthy();
    const overworld = world.getDimension("minecraft:overworld");
    const e = overworld.spawnEntity<"pao:new_database">(ENTITY_TYPE_ID, DB_ANCHOR);
    this.#bindDatabaseEntity(e, this.#entities.length);
    this.#entities.push(e);
  }

  async #finishAddAfterAnchorReady(item: ItemStack, data: Record<string, any>): Promise<void> {
    try {
      const overworld = world.getDimension("minecraft:overworld");
      await prepareDatabaseAnchorRegion(overworld);
      const e = await spawnEntityAtAnchorWithRetry(overworld, () =>
        overworld.spawnEntity<"pao:new_database">(ENTITY_TYPE_ID, DB_ANCHOR)
      );
      this.#bindDatabaseEntity(e, this.#entities.length);
      this.#entities.push(e);
      const slot = this.#findEmptySlot()[0]!;
      this.#setItem(slot, item, data);
    } catch (err) {
      console.error(`[ItemDatabase ${this.#name}] deferred add failed`, err);
    }
  }

  async #finishClearAfterAnchorReady(): Promise<void> {
    try {
      const overworld = world.getDimension("minecraft:overworld");
      await prepareDatabaseAnchorRegion(overworld);
      const e = await spawnEntityAtAnchorWithRetry(overworld, () =>
        overworld.spawnEntity<"pao:new_database">(ENTITY_TYPE_ID, DB_ANCHOR)
      );
      this.#bindDatabaseEntity(e, this.#entities.length);
      this.#entities.push(e);
    } catch (err) {
      console.error(`[ItemDatabase ${this.#name}] deferred clear respawn failed`, err);
    }
  }

  /** 当前已存储的物品数量 */
  get length(): number {
    return Object.keys(this.#itemData).length;
  }

  /** 查询匹配特定 data 的物品数量 */
  getAmountByData(data: Partial<SlotData> = {}): number {
    return Object.values(this.#itemData).filter((d) => Object.entries(data).every(([k, v]) => d[k] === v)).length;
  }

  /**
   * 添加物品到数据库
   */
  add(item: ItemStack, data: Record<string, any> = {}): void {
    if (!this.#loaded) throw new ReferenceError("Database is not loaded");
    this.#assertHealthy();
    if (this.#findEmptySlot().length === 0) {
      try {
        this.#spawnAndRegisterOneEntity();
      } catch (e) {
        if (e instanceof LocationInUnloadedChunkError) {
          void this.#finishAddAfterAnchorReady(item, data);
          return;
        }
        throw e;
      }
    }
    const slot = this.#findEmptySlot()[0]!;
    this.#setItem(slot, item, data);
  }

  /**
   * 根据槽位索引获取封装后的 Item 对象
   */
  get(slot: number): Item | undefined {
    this.#assertHealthy();
    const d = this.#itemData[slot];
    return d ? new Item(d, this) : undefined;
  }

  /**
   * 按 data 删除物品
   */
  remove(data: Partial<SlotData>): void {
    if (!this.#loaded) throw new ReferenceError("Database is not loaded");
    this.#assertHealthy();
    const key = findIndexByValue(this.#itemData, data);
    if (key === undefined) throw new Error("Item not found!");
    this.#deleteItem(Number(key));
  }

  /**
   * 卸出物品，可选择是否保留原槽
   */
  unStore(data: Partial<SlotData>, keepItem = true): ItemStack {
    if (!this.#loaded) throw new ReferenceError("Database is not loaded");
    this.#assertHealthy();
    const key = findIndexByValue(this.#itemData, data);
    if (key === undefined) throw new Error("Item not found!");
    const slot = Number(key);
    const orig = this.#itemData[slot].item!;
    const copy = orig.clone();
    if (!keepItem) this.#deleteItem(slot);
    return copy;
  }

  /**
   * 编辑已有槽位的数据
   */
  edit(oldData: Partial<SlotData>, newData: Partial<SlotData>): SlotData {
    if (!this.#loaded) throw new ReferenceError("Database is not loaded");
    this.#assertHealthy();
    const key = findIndexByValue(this.#itemData, oldData);
    if (key === undefined) throw new Error("Item not found!");
    const slot = Number(key);
    const merged = { ...this.#itemData[slot], ...newData };

    if (newData.item) {
      merged.itemSnapshot = serializeItemStack(newData.item);
    }

    this.#database.set(`slot_${slot}`, merged);
    this.#itemData[slot] = merged;
    this.#database.save();

    if (newData.item) {
      const entityIndex = Math.floor(slot / ITEM_MAX_PER_ENTITY);
      const entitySlot = slot % ITEM_MAX_PER_ENTITY;
      const ent = this.#entities[entityIndex];
      ent.getComponent("inventory")?.container.setItem(entitySlot, newData.item);
    }

    return merged;
  }

  /**
   * 验证某 data 是否仍存在于数据库
   */
  isValid(data: Partial<SlotData>): boolean {
    return findIndexByValue(this.#itemData, data) !== undefined;
  }

  /** 清空整个数据库并重置实体 */
  clear(): void {
    if (!this.#loaded) throw new ReferenceError("Database is not loaded");
    for (const e of this.#entities) {
      this.#markExpectedRemoval(e);
      e.remove();
    }
    this.#entities = [];
    this.#itemData = {};
    this.#database.clear();
    this.#unhealthyReason = undefined;

    try {
      this.#spawnAndRegisterOneEntity();
    } catch (e) {
      if (e instanceof LocationInUnloadedChunkError) {
        void this.#finishClearAfterAnchorReady();
        return;
      }
      throw e;
    }
  }

  /**
   * 遍历所有 Item
   */
  forEach(callback: (item: Item) => void): void {
    if (!this.#loaded) throw new ReferenceError("Database is not loaded");
    this.#assertHealthy();
    for (const slot of Object.keys(this.#itemData).map((n) => Number(n))) {
      const it = this.get(slot);
      if (it) callback(it);
    }
  }

  /**
   * 硬重置：删除所有实体并重建
   */
  async hardReset(): Promise<void> {
    const overworld = world.getDimension("minecraft:overworld");
    for (const e of this.#entities) this.#markExpectedRemoval(e);
    this.#entities = [];
    overworld
      .getEntities()
      .filter((e) => e.typeId === ENTITY_TYPE_ID && e.nameTag === `DB_${this.#name}`)
      .forEach((e) => {
        this.#markExpectedRemoval(e);
        e.remove();
      });

    await prepareDatabaseAnchorRegion(overworld);
    const e = await spawnEntityAtAnchorWithRetry(overworld, () =>
      overworld.spawnEntity<"pao:new_database">(ENTITY_TYPE_ID, DB_ANCHOR)
    );
    this.#bindDatabaseEntity(e, 0);
    this.#entities.push(e);

    this.#itemData = {};
    this.#unhealthyReason = undefined;
  }

  #bindDatabaseEntity(entity: Entity, index: number): void {
    entity.nameTag = `DB_${this.#name}`;
    for (const tag of entity.getTags()) {
      if (tag.startsWith(DB_NAME_TAG_PREFIX) || tag.startsWith(DB_INDEX_TAG_PREFIX)) {
        entity.removeTag(tag);
      }
    }
    entity.addTag(DB_ENTITY_TAG);
    entity.addTag(`${DB_NAME_TAG_PREFIX}${this.#name}`);
    entity.addTag(`${DB_INDEX_TAG_PREFIX}${index}`);
    if (!entity.getTags().some((tag) => tag.startsWith("spawntime:"))) {
      entity.addTag(`spawntime:${Date.now()}`);
    }
    entity.setDynamicProperty("paoDbName", this.#name);
    entity.setDynamicProperty("paoDbIndex", index);
  }

  #markExpectedRemoval(entity: Entity): void {
    this.#expectedRemovalIds.add(entity.id);
    system.runTimeout(() => {
      this.#expectedRemovalIds.delete(entity.id);
    }, 5);
  }

  #markUnhealthy(reason: string): void {
    if (!this.#unhealthyReason) {
      SystemLog.error(`[ItemDatabase ${this.#name}] 数据库进入保护状态: ${reason}`);
      this.#notifyAdmins(`§c物品数据库 ${this.#name} 进入保护状态: §e${reason}`);
    }
    this.#unhealthyReason = reason;
  }

  #assertHealthy(): void {
    if (this.#unhealthyReason) {
      throw new Error(`ItemDatabase ${this.#name} is unhealthy: ${this.#unhealthyReason}`);
    }

    for (const entity of this.#entities) {
      if (!entity?.isValid) {
        this.#markUnhealthy("存储实体已失效");
        throw new Error(`ItemDatabase ${this.#name} is unhealthy: ${this.#unhealthyReason}`);
      }
      if (!entity.getComponent("inventory")?.container) {
        this.#markUnhealthy("存储实体缺少 inventory 容器");
        throw new Error(`ItemDatabase ${this.#name} is unhealthy: ${this.#unhealthyReason}`);
      }
    }
  }

  #notifyAdmins(message: string): void {
    for (const player of getOnlineRealPlayers()) {
      if (isAdmin(player)) {
        player.sendMessage(message);
      }
    }
  }

  #getEntityIndex(entity: Entity): number {
    const dynamicIndex = entity.getDynamicProperty("paoDbIndex");
    if (typeof dynamicIndex === "number" && Number.isInteger(dynamicIndex) && dynamicIndex >= 0) {
      return dynamicIndex;
    }

    const tagIndex = entity
      .getTags()
      .find((tag) => tag.startsWith(DB_INDEX_TAG_PREFIX))
      ?.slice(DB_INDEX_TAG_PREFIX.length);
    const parsed = Number.parseInt(tagIndex ?? "", 10);
    if (Number.isInteger(parsed) && parsed >= 0) return parsed;

    const byId = this.#entities.findIndex((candidate) => candidate.id === entity.id);
    return byId >= 0 ? byId : 0;
  }

  #syncSlotFromEntityItem(slot: number, item: ItemStack, stored?: SlotData): SlotData {
    const merged: SlotData = {
      ...(stored ?? {}),
      slot,
      item,
      itemSnapshot: serializeItemStack(item),
    };
    this.#itemData[slot] = merged;
    this.#database.set(`slot_${slot}`, merged);
    return merged;
  }

  #quarantineOrphanEntityItem(slot: number, item: ItemStack): void {
    try {
      const detectedAt = Date.now();
      const backupKey = `orphan_${slot}_${detectedAt}`;
      this.#database.set(backupKey, {
        slot,
        detectedAt,
        reason: "entity item exists but slot index is missing",
        itemSnapshot: serializeItemStack(item),
      });
      this.#database.save();
      SystemLog.warn(
        `[ItemDatabase ${this.#name}] 槽位 ${slot} 有实体物品但缺少索引记录，已备份为 ${backupKey} 并清空实体槽位`
      );
      this.#notifyAdmins(`§e物品数据库 ${this.#name} 已隔离无索引物品槽位 ${slot}，数据库已自动恢复。`);
    } catch (error) {
      this.#markUnhealthy(`槽位 ${slot} 有实体物品但缺少索引记录，且备份失败: ${String(error)}`);
    }
  }

  #quarantineMissingIndexedItem(slot: number, stored: SlotData, reason: string): void {
    try {
      const detectedAt = Date.now();
      const backupKey = `missing_${slot}_${detectedAt}`;
      const { item: _item, ...backupData } = stored;

      this.#database.set(backupKey, {
        ...backupData,
        slot,
        detectedAt,
        reason,
      });
      this.#database.delete(`slot_${slot}`);
      delete this.#itemData[slot];
      this.#database.save();

      SystemLog.warn(
        `[ItemDatabase ${this.#name}] 槽位 ${slot} 有索引记录但实体物品缺失，已备份为 ${backupKey} 并删除坏索引，数据库已自动恢复`
      );
      this.#notifyAdmins(`§e物品数据库 ${this.#name} 已隔离缺失物品槽位 ${slot}，商店已自动恢复。`);
    } catch (error) {
      this.#markUnhealthy(`槽位 ${slot} 有索引记录但实体物品缺失，且自动隔离失败: ${String(error)}`);
    }
  }

  #handleExpectedStorageUnload(entity: Entity): void {
    try {
      const entityIndex = this.#getEntityIndex(entity);
      const container = entity.getComponent("inventory")?.container;
      let syncedSlots = 0;

      if (container) {
        for (let localSlot = 0; localSlot < Math.min(container.size, ITEM_MAX_PER_ENTITY); localSlot++) {
          const item = container.getItem(localSlot);
          if (!item) continue;

          const fullSlot = entityIndex * ITEM_MAX_PER_ENTITY + localSlot;
          this.#syncSlotFromEntityItem(fullSlot, item.clone(), this.#itemData[fullSlot] ?? this.#database.get(`slot_${fullSlot}`));
          syncedSlots++;
        }
      }

      const entityIdx = this.#entities.findIndex((candidate) => candidate.id === entity.id);
      if (entityIdx >= 0) {
        this.#entities.splice(entityIdx, 1);
      }

      this.#database.save();
      SystemLog.info(
        `[ItemDatabase ${this.#name}] 世界暂无真实玩家在线，存储实体已随区块卸载（已同步 ${syncedSlots} 个物品索引，下次进服将自动重建，无需处理）`
      );
    } catch (error) {
      SystemLog.warn(`[ItemDatabase ${this.#name}] 关服前同步物品索引失败: ${String(error)}`);
    }
  }

  async #bootstrapStorageFromPersisted(overworld: Dimension): Promise<void> {
    const slotKeys = this.#database.keys().filter((key) => key.startsWith("slot_"));
    const maxSlot = slotKeys.reduce((max, key) => Math.max(max, Number(key.slice(5))), -1);
    const entityCount = Math.max(1, Math.floor(maxSlot / ITEM_MAX_PER_ENTITY) + 1);

    for (let entityIndex = 0; entityIndex < entityCount; entityIndex++) {
      const entity = await spawnEntityAtAnchorWithRetry(overworld, () =>
        overworld.spawnEntity<"pao:new_database">(ENTITY_TYPE_ID, DB_ANCHOR)
      );
      this.#bindDatabaseEntity(entity, entityIndex);
      this.#entities.push(entity);

      const container = entity.getComponent("inventory")?.container;
      if (!container) {
        this.#markUnhealthy("重建存储实体后缺少 inventory 容器");
        return;
      }

      for (let localSlot = 0; localSlot < ITEM_MAX_PER_ENTITY; localSlot++) {
        const fullSlot = entityIndex * ITEM_MAX_PER_ENTITY + localSlot;
        const key = `slot_${fullSlot}`;
        if (!this.#database.has(key)) continue;

        const stored = this.#database.get(key) as SlotData | undefined;
        if (!stored?.itemSnapshot) continue;

        try {
          const restored = deserializeItemStack(stored.itemSnapshot);
          container.setItem(localSlot, restored);
          stored.item = restored;
          this.#itemData[fullSlot] = stored;
        } catch {
          // ignore invalid snapshot
        }
      }
    }

    this.#database.save();
    SystemLog.info(
      `[ItemDatabase ${this.#name}] 未找到存储实体，已根据物品索引重建 ${this.#entities.length} 个存储实体并恢复 ${this.length} 个物品槽`
    );
  }

  captureUnexpectedEntityRemoval(entity: Entity): void {
    if (this.#expectedRemovalIds.has(entity.id)) {
      this.#expectedRemovalIds.delete(entity.id);
      return;
    }

    if (isExpectedStorageUnload()) {
      this.#handleExpectedStorageUnload(entity);
      return;
    }

    try {
      const entityIndex = this.#getEntityIndex(entity);
      const container = entity.getComponent("inventory")?.container;
      const slots: RescueSlot[] = [];

      if (container) {
        for (let slot = 0; slot < Math.min(container.size, ITEM_MAX_PER_ENTITY); slot++) {
          const item = container.getItem(slot);
          if (item) slots.push({ slot, item: item.clone() });
        }
      }

      const snapshot: RescueSnapshot = {
        entityIndex,
        entityId: entity.id,
        slots,
      };

      this.#markUnhealthy(`存储实体在有人在线时被意外移除，正在尝试抢救 ${slots.length} 个物品槽`);
      system.run(() => {
        void this.#restoreRemovedEntity(snapshot);
      });
    } catch (error) {
      this.#markUnhealthy(`存储实体被意外移除，但抢救快照读取失败: ${String(error)}`);
      SystemLog.error(`[ItemDatabase ${this.#name}] 存储实体抢救快照读取失败`, error);
    }
  }

  async #restoreRemovedEntity(snapshot: RescueSnapshot): Promise<void> {
    try {
      const overworld = world.getDimension("minecraft:overworld");
      await prepareDatabaseAnchorRegion(overworld);
      const replacement = await spawnEntityAtAnchorWithRetry(overworld, () =>
        overworld.spawnEntity<"pao:new_database">(ENTITY_TYPE_ID, DB_ANCHOR)
      );
      this.#bindDatabaseEntity(replacement, snapshot.entityIndex);
      this.#entities[snapshot.entityIndex] = replacement;

      const container = replacement.getComponent("inventory")?.container;
      if (!container) {
        this.#markUnhealthy("抢救后新实体缺少 inventory 容器");
        return;
      }

      for (const rescued of snapshot.slots) {
        container.setItem(rescued.slot, rescued.item);
        const fullSlot = snapshot.entityIndex * ITEM_MAX_PER_ENTITY + rescued.slot;
        const stored = this.#itemData[fullSlot] ?? this.#database.get(`slot_${fullSlot}`);
        const restoredData: SlotData = {
          ...(stored ?? {}),
          slot: fullSlot,
          item: rescued.item,
          itemSnapshot: serializeItemStack(rescued.item),
        };
        this.#itemData[fullSlot] = restoredData;
        this.#database.set(`slot_${fullSlot}`, restoredData);
      }

      this.#unhealthyReason = undefined;
      SystemLog.warn(
        `[ItemDatabase ${this.#name}] 检测到存储实体 ${snapshot.entityId} 被移除，已重建并恢复 ${snapshot.slots.length} 个物品槽`
      );
      this.#notifyAdmins(`§e物品数据库 ${this.#name} 的存储实体被移除，已恢复 ${snapshot.slots.length} 个物品槽。`);
    } catch (error) {
      this.#markUnhealthy(`存储实体抢救失败: ${String(error)}`);
      SystemLog.error(`[ItemDatabase ${this.#name}] 存储实体抢救失败`, error);
    }
  }
}
