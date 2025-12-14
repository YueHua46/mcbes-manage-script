/**
 * 物品数据库服务
 * 完整迁移自 Modules/Economic/ItemDatabase.ts (387行)
 * 使用实体容器存储物品的高级数据库系统
 */

import { Entity, ItemStack, system, world } from "@minecraft/server";
import { Database } from "../../../shared/database/database";
import { SystemLog } from "../../../shared/utils/common";

// 每个实体可存储的最大槽位数
const ITEM_MAX_PER_ENTITY = 256;
// 在世界中用于存储的实体类型
const ENTITY_TYPE_ID = "pao:new_database";
// 记录已注册的数据库名称，防止重复
const nameRegistered: string[] = [];

/**
 * 单个槽位的数据结构
 */
interface SlotData {
  slot: number;
  item?: ItemStack;
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
    this.#db.edit(this.#data, newData);
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

  constructor(name: string) {
    if (nameRegistered.includes(name)) {
      throw new Error(`Database with name "${name}" already exists!`);
    }

    this.#name = name;
    system.run(() => {
      this.#database = new Database(`EntityDatabase_${name}`);
    });
    nameRegistered.push(name);

    this.init().catch((e) => console.error(e));
  }

  /** 初始化，加载已有实体与槽位数据 */
  private async init(): Promise<void> {
    await waitLoaded();
    system.run(() => {
      world.getDimension("minecraft:overworld").runCommand(`tickingarea add circle 8 0 8 4 "PaoDatabase" true`);
    });

    const start = Date.now();
    const loadedTimes: number[] = [];

    const ents = world
      .getDimension("minecraft:overworld")
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
        const inv = ent.getComponent("inventory")?.container;
        for (let i = 0; i < ITEM_MAX_PER_ENTITY; i++) {
          const t0 = Date.now();
          const it = inv?.getItem(i);
          const slot = i + entityCount * ITEM_MAX_PER_ENTITY;
          const stored = this.#database.get(`slot_${slot}`);
          if (it && stored) {
            stored.item = it;
            this.#itemData[slot] = stored;
          } else {
            this.#database.delete(`slot_${slot}`);
          }
          loadedTimes.push(Date.now() - t0);
        }
        this.#entities.push(ent);
        entityCount++;
      }
    } else {
      const id = system.run(() => {
        if (this.#entities.length === 0) {
          const e = world
            .getDimension("minecraft:overworld")
            .spawnEntity<"pao:new_database">(ENTITY_TYPE_ID, { x: 8, y: 0, z: 8 });
          e.nameTag = `DB_${this.#name}`;
          e.addTag(`spawntime:${Date.now()}`);
          this.#entities.push(e);
        } else {
          system.clearRun(id);
        }
      });
    }

    await new Promise<void>((resolve) => {
      const id = system.run(() => {
        if (this.#entities.length > 0) {
          system.clearRun(id);
          resolve();
        }
      });
    });

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
    const empties: number[] = [];
    for (let i = 0; i < this.fullInventory; i++) {
      if (!this.#itemData[i]) empties.push(i);
    }
    return empties;
  }

  /** 将数据写入指定槽位并更新实体与持久化 */
  #setItem(slot: number, item: ItemStack, data: Omit<SlotData, "slot" | "item">): SlotData {
    const entityIndex = Math.floor(slot / ITEM_MAX_PER_ENTITY);
    const entitySlot = slot % ITEM_MAX_PER_ENTITY;
    const ent = this.#entities[entityIndex];
    ent.getComponent("inventory")?.container.setItem(entitySlot, item);

    const fullData: SlotData = { slot, item, ...data };
    this.#database.set(`slot_${slot}`, fullData);
    this.#itemData[slot] = fullData;
    return fullData;
  }

  /** 删除指定槽位的物品与持久化数据 */
  #deleteItem(slot: number): void {
    const entityIndex = Math.floor(slot / ITEM_MAX_PER_ENTITY);
    const entitySlot = slot % ITEM_MAX_PER_ENTITY;
    const ent = this.#entities[entityIndex];
    const inv = ent.getComponent("inventory")?.container;
    if (!inv) return;
    inv.setItem(entitySlot);

    if (inv.emptySlotsCount >= ITEM_MAX_PER_ENTITY && this.#entities.length > 1) {
      this.#entities.splice(entityIndex, 1);
      ent.remove();
    }

    this.#database.delete(`slot_${slot}`);
    delete this.#itemData[slot];
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
    if (this.#findEmptySlot().length === 0) {
      const e = world
        .getDimension("minecraft:overworld")
        .spawnEntity<"pao:new_database">(ENTITY_TYPE_ID, { x: 8, y: 0, z: 8 });
      e.nameTag = `DB_${this.#name}`;
      e.addTag(`spawntime:${Date.now()}`);
      this.#entities.push(e);
    }
    const slot = this.#findEmptySlot()[0]!;
    this.#setItem(slot, item, data);
  }

  /**
   * 根据槽位索引获取封装后的 Item 对象
   */
  get(slot: number): Item | undefined {
    const d = this.#itemData[slot];
    return d ? new Item(d, this) : undefined;
  }

  /**
   * 按 data 删除物品
   */
  remove(data: Partial<SlotData>): void {
    if (!this.#loaded) throw new ReferenceError("Database is not loaded");
    const key = findIndexByValue(this.#itemData, data);
    if (key === undefined) throw new Error("Item not found!");
    this.#deleteItem(Number(key));
  }

  /**
   * 卸出物品，可选择是否保留原槽
   */
  unStore(data: Partial<SlotData>, keepItem = true): ItemStack {
    if (!this.#loaded) throw new ReferenceError("Database is not loaded");
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
  edit(oldData: Partial<SlotData>, newData: Partial<SlotData>): void {
    if (!this.#loaded) throw new ReferenceError("Database is not loaded");
    const key = findIndexByValue(this.#itemData, oldData);
    if (key === undefined) throw new Error("Item not found!");
    const slot = Number(key);
    const merged = { ...this.#itemData[slot], ...newData };
    this.#database.set(`slot_${slot}`, merged);
    this.#itemData[slot] = merged;
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
    for (const e of this.#entities) e.remove();
    this.#entities = [];
    this.#itemData = {};
    this.#database.clear();

    const e = world
      .getDimension("minecraft:overworld")
      .spawnEntity<"pao:new_database">(ENTITY_TYPE_ID, { x: 8, y: 0, z: 8 });
    e.nameTag = `DB_${this.#name}`;
    e.addTag(`spawntime:${Date.now()}`);
    this.#entities.push(e);
  }

  /**
   * 遍历所有 Item
   */
  forEach(callback: (item: Item) => void): void {
    if (!this.#loaded) throw new ReferenceError("Database is not loaded");
    for (const slot of Object.keys(this.#itemData).map((n) => Number(n))) {
      const it = this.get(slot);
      if (it) callback(it);
    }
  }

  /**
   * 硬重置：删除所有实体并重建
   */
  async hardReset(): Promise<void> {
    this.#entities = [];
    world
      .getDimension("minecraft:overworld")
      .getEntities()
      .filter((e) => e.typeId === ENTITY_TYPE_ID && e.nameTag === `DB_${this.#name}`)
      .forEach((e) => e.remove());

    await new Promise<void>((resolve) => {
      const id = system.run(() => {
        if (this.#entities.length === 0) {
          const e = world
            .getDimension("minecraft:overworld")
            .spawnEntity<"pao:new_database">(ENTITY_TYPE_ID, { x: 8, y: 0, z: 8 });
          e.nameTag = `DB_${this.#name}`;
          e.addTag(`spawntime:${Date.now()}`);
          this.#entities.push(e);
          system.clearRun(id);
          resolve();
        }
      });
    });

    this.#itemData = {};
  }
}
