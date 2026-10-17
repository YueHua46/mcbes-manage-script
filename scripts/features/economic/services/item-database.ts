/**
 * 物品数据库服务
 * 使用实体容器存储物品的数据库系统（官方商店、玩家交易市场共用）。
 *
 * 数据分三层：
 * 1. 主存储：`pao:new_database` 实体背包中的真实 ItemStack（完整 NBT，含潜影盒内容、药水类型等）。
 * 2. 完整备份：存储实体所在方块的结构（StructureSaveMode.World，includeEntities），A/B 两份交替写入，
 *    实体丢失时通过 place 还原，保留完整 NBT。
 * 3. 索引：世界动态属性中的槽位记录（稳定 id、版本号、元数据、JSON 快照）。JSON 快照无法覆盖所有 NBT
 *    （见 item-stack-persist 的 LOSSY_ITEM_RULES），只作为最后手段。
 *
 * 设计约束：
 * - 核对：启动、结构还原、抢救、卸载四条路径都通过 decideSlot() 决定如何处理（见 item-database-reconcile）。
 * - 写入：所有用户操作都经过 #transact()：先写实体 → 提交索引 → 失败回滚 / 成功后善后。
 *   提交点之前失败一律回滚并抛出，提交点之后一律不再抛出。
 * - 闸门：索引只有在“已加载且不在保护状态”时才允许写入；保护状态下只做不改索引的物理抢救。
 * - 任何情况下都不把“对不上索引”的实体物品登记为商品，只隔离保留；已交付物品的残留副本只清理不恢复。
 */

import {
  Container,
  Dimension,
  Entity,
  ItemStack,
  LocationInUnloadedChunkError,
  StructureSaveMode,
  Vector3,
  system,
  world,
} from "@minecraft/server";
import { Database } from "../../../shared/database/database";
import { isAdmin, SystemLog } from "../../../shared/utils/common";
import {
  collectLossyReasons,
  describeLossyReasons,
  deserializeItemStack,
  PersistedItemStack,
  serializeItemStack,
} from "../../../shared/utils/item-stack-persist";
import {
  getOnlineRealPlayerCount,
  getOnlineRealPlayers,
  isScriptFakePlayerEntity,
} from "../../../shared/utils/online-players";
import { decideSlot, SlotDecision, SlotRecordView, SlotSource } from "./item-database-reconcile";

// 每个实体可存储的最大槽位数
const ITEM_MAX_PER_ENTITY = 256;
// 在世界中用于存储的实体类型
const ENTITY_TYPE_ID = "pao:new_database";
/** 存储区基准坐标（与 tickingarea 圆心一致）。每个数据库在此基础上分配独立的方块。 */
const DB_ANCHOR_BASE = { x: 8, y: 0, z: 8 };
/** 不同数据库存储方块之间的间距与每行数量，保证结构备份只包含本库实体 */
const DB_ANCHOR_SPACING = 2;
const DB_ANCHOR_GRID = 8;
/** 数据库名 -> 存储方块编号 */
const DB_ANCHOR_REGISTRY_KEY = "pao_item_db_anchors";
/** 常驻加载区：保证 anchor 区块进入 tick 后再 spawn / 访问 */
const TICKING_AREA_CMD = `tickingarea add circle 8 0 8 4 "PaoDatabase" true`;
/** tickingarea 生效后再等待的 tick 数 */
const ANCHOR_LOAD_WAIT_TICKS = 25;
/** spawn 遇未加载区块时的最大重试次数 */
const SPAWN_ANCHOR_MAX_ATTEMPTS = 45;
/** 有索引但实体不全时，再等待实体加载的轮数与间隔 */
const ENTITY_LOOKUP_RETRY_ATTEMPTS = 6;
const ENTITY_LOOKUP_RETRY_INTERVAL_TICKS = 20;
/** 放置备份结构后等待实体出现的 tick 数 */
const STRUCTURE_RESTORE_WAIT_TICKS = 5;
/** 提交后清理实体槽位失败时，重试清理的间隔 tick 数 */
const STALE_COPY_RETRY_TICKS = 20;
/** 物品变动后延迟写结构备份的 tick 数（合并短时间内的多次变动） */
const STRUCTURE_BACKUP_DEBOUNCE_TICKS = 100;
const STRUCTURE_BACKUP_META_PREFIX = "pao_item_db_backup:";
/** 索引中保存全库写入序号的 key（每次实体内容变化 +1，并写入对应槽位的 rev） */
const SEQ_KEY = "__seq";
const SLOT_KEY_PREFIX = "slot_";
/** 审计记录（丢弃的备份副本、对不上的记录等）的 key 前缀与保留上限 */
const AUDIT_KEY_PREFIX = "audit_";
const LEGACY_AUDIT_KEY_PREFIXES = ["orphan_", "missing_", "discarded_"];
const MAX_AUDIT_RECORDS = 100;
const DB_ENTITY_TAG = "pao_item_database";
const DB_NAME_TAG_PREFIX = "pao_db_name:";
const DB_INDEX_TAG_PREFIX = "pao_db_index:";
/** 调用方不能通过元数据覆盖的字段 */
const RESERVED_FIELDS = new Set(["slot", "id", "ver", "rev", "itemSnapshot", "quarantined", "staleCopy", "item"]);

// 记录已注册的数据库名称，防止重复
const nameRegistered: string[] = [];
const databaseInstances = new Set<ItemDatabase>();
let entityRemoveGuardRegistered = false;
let storageWindDownGuardRegistered = false;
/** 最后一名真实玩家离线后，存储实体随区块卸载属于预期行为 */
let storageWindDownActive = false;

/** 持久化的槽位记录 */
interface SlotRecord {
  slot: number;
  /** 稳定 id：商品的身份 */
  id: string;
  /** 记录版本：每次修改 +1，用于乐观并发校验 */
  ver: number;
  /** 该槽位实体内容最后一次写入时的全库写入序号 */
  rev?: number;
  itemSnapshot?: PersistedItemStack;
  /** 实体中存在但没有可信记录的物品：保留在实体里，不对外展示，也不会被覆盖 */
  quarantined?: boolean;
  /** 物品已交付后清理失败留下的残留副本：只能清理，绝不恢复（总是与 quarantined 同时为 true） */
  staleCopy?: boolean;
  reason?: string;
  detectedAt?: number;
  [key: string]: unknown;
}

/**
 * 对外暴露的槽位数据：记录字段 + 物品副本。
 * 调用方拿到的 item 都是副本，修改它不会影响数据库。
 */
interface SlotData {
  slot?: number;
  id?: string;
  ver?: number;
  item?: ItemStack;
  itemSnapshot?: PersistedItemStack;
  [key: string]: unknown;
}

interface SlotState {
  record: SlotRecord;
  /** 实体中物品的内存副本（正常与隔离记录都有；残留副本没有） */
  item?: ItemStack;
}

interface StructureBackupMeta {
  /** 最近一次写入的备份 */
  slot: "a" | "b";
  at: number;
  entityCount: number;
  itemCount: number;
  /** 每份备份写入时的全库写入序号；槽位 rev 大于它说明该槽位在备份后被改写过 */
  seqs?: Partial<Record<"a" | "b", number>>;
}

interface LossyRestoreTracker {
  count: number;
  reasons: Set<string>;
}

interface RescueSnapshot {
  entityIndex: number;
  entityId: string;
  items: Map<number, ItemStack>;
  /** 抢救开始前数据库是否已经处于保护状态（或尚未加载完成） */
  indexLocked: boolean;
  /** 本次抢救临时设置的保护原因（抢救完成后只清除它自己设置的这一条） */
  placeholder?: string;
}

interface PhysicalWrite {
  slot: number;
  item: ItemStack | undefined;
}

interface TransactionPlan {
  /** 提交前写入实体的内容（新增、换物品）；提交失败时回滚 */
  before?: PhysicalWrite[];
  /** 槽位记录变更：next 为 undefined 表示删除；bumpRev 表示实体内容随本次提交改变 */
  slots?: Array<{ slot: number; next?: SlotState; bumpRev?: boolean }>;
  /** 随本次提交写入的审计记录 */
  audits?: Array<{ kind: string; slot: number; data: Record<string, unknown> }>;
  /** 提交成功后清理的实体槽位（交付、删除）；失败时登记残留副本 */
  after?: number[];
}

export interface ItemDatabaseStatus {
  name: string;
  loaded: boolean;
  protection?: string;
  items: number;
  quarantined: number;
  staleCopies: number;
  entities: number;
}

export interface QuarantinedItemInfo {
  id: string;
  slot: number;
  typeId: string;
  amount: number;
  item: ItemStack;
  reason?: string;
  detectedAt?: number;
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
 * 注册常驻加载区并在几 tick 后再继续，避免存储方块尚未加载/tick 就 spawn。
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
 * 为每个数据库分配独立的存储方块（持久化在世界动态属性中），
 * 这样结构备份只会包含本库的实体，还原时不会复制出其它库的实体。
 */
function resolveDatabaseAnchorBlock(name: string): Vector3 {
  let registry: Record<string, number> = {};
  try {
    const raw = world.getDynamicProperty(DB_ANCHOR_REGISTRY_KEY);
    if (typeof raw === "string") registry = JSON.parse(raw) ?? {};
  } catch {
    registry = {};
  }

  let index = registry[name];
  if (!Number.isInteger(index) || index < 0) {
    const used = new Set(Object.values(registry));
    index = 0;
    while (used.has(index)) index++;
    registry[name] = index;
    world.setDynamicProperty(DB_ANCHOR_REGISTRY_KEY, JSON.stringify(registry));
  }

  return {
    x: DB_ANCHOR_BASE.x + (index % DB_ANCHOR_GRID) * DB_ANCHOR_SPACING,
    y: DB_ANCHOR_BASE.y,
    z: DB_ANCHOR_BASE.z + Math.floor(index / DB_ANCHOR_GRID) * DB_ANCHOR_SPACING,
  };
}

function anchorCenter(block: Vector3): Vector3 {
  return { x: block.x + 0.5, y: block.y, z: block.z + 0.5 };
}

function isInsideBlock(location: Vector3, block: Vector3): boolean {
  return Math.floor(location.x) === block.x && Math.floor(location.y) === block.y && Math.floor(location.z) === block.z;
}

function hashName(name: string): string {
  let hash = 5381;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) + hash + name.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

function structureBackupId(name: string, slot: "a" | "b"): string {
  const safeName = name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  return `yuehua:item_db_${safeName}_${hashName(name)}_${slot}`;
}

function readStructureBackupMeta(name: string): StructureBackupMeta | undefined {
  try {
    const raw = world.getDynamicProperty(`${STRUCTURE_BACKUP_META_PREFIX}${name}`);
    if (typeof raw !== "string") return undefined;
    const meta = JSON.parse(raw) as StructureBackupMeta;
    if (meta && (meta.slot === "a" || meta.slot === "b")) return meta;
  } catch {
    // ignore
  }
  return undefined;
}

function slotKey(slot: number): string {
  return `${SLOT_KEY_PREFIX}${slot}`;
}

/** 去掉调用方不能覆盖的字段，只留元数据 */
function pickMetadata(data: Record<string, unknown> | undefined): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  if (!data) return metadata;
  for (const key of Object.keys(data)) {
    if (!RESERVED_FIELDS.has(key)) metadata[key] = data[key];
  }
  return metadata;
}

/** 兼容不带 id 的旧调用：按元数据字段比较 */
function metadataKey(data: Record<string, unknown>): string {
  return JSON.stringify(pickMetadata(data));
}

function recordView(record: SlotRecord | undefined): SlotRecordView | undefined {
  if (!record) return undefined;
  return {
    quarantined: record.quarantined,
    staleCopy: record.staleCopy,
    rev: record.rev,
    snapshotTypeId: record.itemSnapshot?.typeId,
  };
}

function isAuditKey(key: string): boolean {
  return key.startsWith(AUDIT_KEY_PREFIX) || LEGACY_AUDIT_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
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

function readEntityIndex(entity: Entity): number | undefined {
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
  return undefined;
}

function readEntitySpawnTime(entity: Entity): number {
  return Number(
    entity
      .getTags()
      .find((t) => t.startsWith("spawntime:"))
      ?.slice(9) ?? 0
  );
}

/**
 * 按 paoDbIndex 分配实体编号；没有编号的旧实体按生成时间补到空位上。
 * 编号重复的实体单独返回，调用方不得改动它们。
 */
function assignEntityIndices(ents: Entity[]): { byIndex: Map<number, Entity>; duplicates: Entity[] } {
  const byIndex = new Map<number, Entity>();
  const duplicates: Entity[] = [];
  const unindexed: Entity[] = [];

  for (const entity of ents) {
    const index = readEntityIndex(entity);
    if (index === undefined) {
      unindexed.push(entity);
    } else if (byIndex.has(index)) {
      duplicates.push(entity);
    } else {
      byIndex.set(index, entity);
    }
  }

  let next = 0;
  for (const entity of unindexed) {
    while (byIndex.has(next)) next++;
    byIndex.set(next, entity);
  }

  return { byIndex, duplicates };
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
    // 无人在线期间随区块卸载的存储实体，在玩家回来后重新绑定
    for (const db of databaseInstances) {
      db.rebindUnloadedEntities();
    }
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

/** 当前已注册的全部物品数据库（供管理员维护界面使用） */
export function getItemDatabases(): ItemDatabase[] {
  return [...databaseInstances];
}

/**
 * 封装单个物品，提供对数据库操作的方法。
 * 内部按 id + 版本号定位：数据被其它操作修改过后，旧的 Item 会失效而不是误操作。
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

  /** 只修改元数据；要替换物品本身请用 replaceItem */
  editData(newData: Partial<SlotData> = {}): void {
    this.#data = this.#db.edit(this.#data, newData);
  }

  /** 替换存储的物品（例如部分售出后的剩余数量），可同时修改元数据 */
  replaceItem(item: ItemStack, newData: Partial<SlotData> = {}): void {
    this.#data = this.#db.replaceItem(this.#data, item, newData);
  }
}

/**
 * 主类：实体背包数据库
 */
export default class ItemDatabase {
  #name: string;
  #loaded = false;
  /** 按实体编号（paoDbIndex）存放；无人在线时被卸载的实体位置会暂时为空 */
  #entities: Array<Entity | undefined> = [];
  #slots = new Map<number, SlotState>();
  #idToSlot = new Map<string, number>();
  #database!: Database;
  /** 保护状态原因；存在时禁止一切索引写入 */
  #protection?: string;
  #expectedRemovalIds = new Set<string>();
  #anchorBlock: Vector3 = { ...DB_ANCHOR_BASE };
  #backupTimer?: number;
  #staleCopyTimer?: number;
  #saveFailureNotified = false;
  #seq = 0;
  #idCounter = 0;
  /** 进行中的抢救；初始化需要等它们完成后再查找实体，避免两边各自生成同编号实体 */
  #pendingRescues = new Set<Promise<void>>();

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

    void this.init();
  }

  get name(): string {
    return this.#name;
  }

  // ---------------------------------------------------------------------------
  // 查询
  // ---------------------------------------------------------------------------

  /** 当前已存储（对外可见）的物品数量 */
  get length(): number {
    let count = 0;
    for (const state of this.#slots.values()) if (!state.record.quarantined) count++;
    return count;
  }

  /** 查询匹配特定 data 的物品数量 */
  getAmountByData(data: Partial<SlotData> = {}): number {
    let count = 0;
    for (const state of this.#slots.values()) {
      if (state.record.quarantined) continue;
      if (Object.entries(data).every(([k, v]) => state.record[k] === v)) count++;
    }
    return count;
  }

  /**
   * 根据槽位索引获取封装后的 Item 对象
   */
  get(slot: number): Item | undefined {
    this.#assertUsable();
    const state = this.#slots.get(slot);
    return state && !state.record.quarantined ? new Item(this.#toData(slot), this) : undefined;
  }

  /**
   * 遍历所有 Item
   */
  forEach(callback: (item: Item) => void): void {
    this.#assertUsable();
    for (const slot of [...this.#slots.keys()]) {
      const state = this.#slots.get(slot);
      if (!state || state.record.quarantined) continue;
      callback(new Item(this.#toData(slot), this));
    }
  }

  /**
   * 验证某 data 是否仍存在于数据库（且未被修改过）
   */
  isValid(data: Partial<SlotData>): boolean {
    return this.#resolveSlot(data) !== undefined;
  }

  getStatus(): ItemDatabaseStatus {
    let quarantined = 0;
    let staleCopies = 0;
    for (const state of this.#slots.values()) {
      if (state.record.staleCopy) staleCopies++;
      else if (state.record.quarantined) quarantined++;
    }
    return {
      name: this.#name,
      loaded: this.#loaded,
      protection: this.#protection,
      items: this.length,
      quarantined,
      staleCopies,
      entities: this.#entities.filter(Boolean).length,
    };
  }

  /** 隔离中的物品（不含残留副本），供管理员查看与处理 */
  listQuarantined(): QuarantinedItemInfo[] {
    const result: QuarantinedItemInfo[] = [];
    for (const [slot, state] of this.#slots) {
      if (!state.record.quarantined || state.record.staleCopy || !state.item) continue;
      result.push({
        id: state.record.id,
        slot,
        typeId: state.item.typeId,
        amount: state.item.amount,
        item: state.item.clone(),
        reason: state.record.reason,
        detectedAt: state.record.detectedAt,
      });
    }
    return result.sort((a, b) => a.slot - b.slot);
  }

  // ---------------------------------------------------------------------------
  // 写入（全部经过 #transact）
  // ---------------------------------------------------------------------------

  /**
   * 添加物品到数据库，返回商品 id。
   * @throws 无法立即提交时抛出，此时数据库与实体均未改变，调用方不应扣除玩家物品
   */
  add(item: ItemStack, data: Record<string, any> = {}): string {
    this.#assertUsable();
    const metadata = pickMetadata(data);

    for (let attempt = 0; attempt < ITEM_MAX_PER_ENTITY; attempt++) {
      const slot = this.#reserveEmptySlot();
      const { container, entitySlot } = this.#containerAt(slot);
      const occupant = container.getItem(entitySlot);
      if (occupant) {
        // 索引认为是空位但实体里有东西：隔离保留，换下一个空位，绝不覆盖。
        this.#transact({
          slots: [{ slot, next: this.#quarantineState(slot, occupant, "entity slot occupied while index says empty") }],
        });
        continue;
      }

      const stored = item.clone();
      const record: SlotRecord = {
        ...metadata,
        slot,
        id: this.#newId(),
        ver: 1,
        itemSnapshot: serializeItemStack(stored),
      };
      this.#transact({
        before: [{ slot, item: stored }],
        slots: [{ slot, next: { record, item: stored }, bumpRev: true }],
      });
      return record.id;
    }

    throw new Error(`ItemDatabase ${this.#name}: 找不到可用的存储槽位`);
  }

  /**
   * 按 data（id + 版本）删除物品
   */
  remove(data: Partial<SlotData>): void {
    this.#assertUsable();
    const slot = this.#resolveSlot(data);
    if (slot === undefined) throw new Error("Item not found!");
    this.#transact({ slots: [{ slot }], after: [slot] });
  }

  /**
   * 一次提交删除多件物品（不存在或已变化的会被跳过），返回实际删除的数量。
   */
  removeMany(dataList: Array<Partial<SlotData>>): number {
    this.#assertUsable();
    const slots = [
      ...new Set(dataList.map((data) => this.#resolveSlot(data)).filter((s): s is number => s !== undefined)),
    ];
    if (slots.length === 0) return 0;
    this.#transact({ slots: slots.map((slot) => ({ slot })), after: slots });
    return slots.length;
  }

  /**
   * 取出物品。返回的是实体中真实存储的物品（完整 NBT）。
   * @param keepItem 为 true 时只读取不删除
   * @throws 实体中的物品缺失或与记录不符时拒绝交付
   */
  unStore(data: Partial<SlotData>, keepItem = true): ItemStack {
    this.#assertUsable();
    const slot = this.#resolveSlot(data);
    if (slot === undefined) throw new Error("Item not found!");
    const actual = this.#readVerifiedEntityItem(slot);
    if (!keepItem) {
      this.#transact({ slots: [{ slot }], after: [slot] });
    }
    return actual;
  }

  /**
   * 修改元数据（价格、数量等）。传入的 item 字段会被忽略；要替换物品请用 replaceItem。
   */
  edit(oldData: Partial<SlotData>, newData: Partial<SlotData>): SlotData {
    this.#assertUsable();
    const slot = this.#resolveSlot(oldData);
    if (slot === undefined) throw new Error("Item not found!");
    const state = this.#slots.get(slot)!;
    const record: SlotRecord = { ...state.record, ...pickMetadata(newData), ver: state.record.ver + 1 };
    this.#transact({ slots: [{ slot, next: { record, item: state.item } }] });
    return this.#toData(slot);
  }

  /**
   * 替换存储的物品，可同时修改元数据。
   */
  replaceItem(oldData: Partial<SlotData>, item: ItemStack, newData: Partial<SlotData> = {}): SlotData {
    this.#assertUsable();
    const slot = this.#resolveSlot(oldData);
    if (slot === undefined) throw new Error("Item not found!");
    const state = this.#slots.get(slot)!;
    const stored = item.clone();
    const record: SlotRecord = {
      ...state.record,
      ...pickMetadata(newData),
      ver: state.record.ver + 1,
      itemSnapshot: serializeItemStack(stored),
    };
    this.#transact({
      before: [{ slot, item: stored }],
      slots: [{ slot, next: { record, item: stored }, bumpRev: true }],
    });
    return this.#toData(slot);
  }

  /**
   * 管理员取回隔离物品到指定容器（先放入容器，再提交删除；提交失败则撤回容器改动）。
   */
  takeQuarantined(id: string, target: Container): ItemStack {
    this.#assertUsable();
    const slot = this.#idToSlot.get(id);
    const state = slot === undefined ? undefined : this.#slots.get(slot);
    if (slot === undefined || !state?.record.quarantined || state.record.staleCopy) {
      throw new Error("隔离物品不存在或已被处理");
    }
    const { container, entitySlot } = this.#containerAt(slot);
    const actual = container.getItem(entitySlot);
    if (!actual) throw new Error("存储实体中已没有该物品");

    const snapshot: Array<ItemStack | undefined> = [];
    for (let i = 0; i < target.size; i++) snapshot.push(target.getItem(i));
    const restoreTarget = () => {
      for (let i = 0; i < snapshot.length; i++) target.setItem(i, snapshot[i]);
    };

    const leftover = target.addItem(actual.clone());
    if (leftover) {
      restoreTarget();
      throw new Error("背包空间不足");
    }
    try {
      this.#transact({ slots: [{ slot }], after: [slot] });
    } catch (error) {
      restoreTarget();
      throw error;
    }
    return actual;
  }

  /** 管理员销毁隔离物品 */
  discardQuarantined(id: string): void {
    this.#assertUsable();
    const slot = this.#idToSlot.get(id);
    const state = slot === undefined ? undefined : this.#slots.get(slot);
    if (slot === undefined || !state?.record.quarantined || state.record.staleCopy) {
      throw new Error("隔离物品不存在或已被处理");
    }
    this.#transact({
      slots: [{ slot }],
      audits: [
        { kind: "discarded", slot, data: { reason: "discarded by admin", itemSnapshot: state.record.itemSnapshot } },
      ],
      after: [slot],
    });
  }

  /**
   * 统一事务：先写实体 → 提交索引 → 失败回滚（含回滚失败的处理）/ 成功后善后。
   * 提交点是 Database.save() 成功；此前失败一律回滚并抛出，此后一律不再抛出。
   */
  #transact(plan: TransactionPlan): void {
    this.#assertWritable();

    // 1. 提交前的实体写入
    const applied: Array<{ slot: number; container: Container; entitySlot: number; previous?: ItemStack }> = [];
    try {
      for (const write of plan.before ?? []) {
        const { container, entitySlot } = this.#containerAt(write.slot);
        const previous = container.getItem(entitySlot);
        container.setItem(entitySlot, write.item);
        applied.push({ slot: write.slot, container, entitySlot, previous });
      }
    } catch (error) {
      this.#rollbackPhysical(applied);
      throw error;
    }

    // 2. 在缓存中应用索引变更（记录原值以便回滚）
    const previousValues = new Map<string, unknown>();
    const setKey = (key: string, value: unknown) => {
      if (!previousValues.has(key)) previousValues.set(key, this.#database.get(key));
      if (value === undefined) this.#database.delete(key);
      else this.#database.set(key, value);
    };
    const seqBefore = this.#seq;
    let seq = this.#seq;
    const nextStates = new Map<number, SlotState | undefined>();
    for (const change of plan.slots ?? []) {
      let next = change.next;
      if (next && change.bumpRev) {
        seq += 1;
        next = { record: { ...next.record, rev: seq }, item: next.item };
      }
      nextStates.set(change.slot, next);
      setKey(slotKey(change.slot), next ? next.record : undefined);
    }
    if (seq !== seqBefore) setKey(SEQ_KEY, seq);
    for (const audit of plan.audits ?? []) {
      setKey(this.#auditKey(audit.kind, audit.slot), { ...audit.data, slot: audit.slot, detectedAt: Date.now() });
    }

    // 3. 提交
    try {
      this.#database.save();
    } catch (error) {
      for (const [key, value] of previousValues) {
        if (value === undefined) this.#database.delete(key);
        else this.#database.set(key, value);
      }
      this.#rollbackPhysical(applied);
      throw new Error(`ItemDatabase ${this.#name}: 物品索引保存失败，操作已撤销（${String(error)}）`);
    }

    // ---- 提交点之后：不再抛出 ----
    this.#saveFailureNotified = false;
    this.#seq = seq;
    for (const [slot, next] of nextStates) this.#setState(slot, next);

    for (const slot of plan.after ?? []) {
      this.#afterCommit(() => this.#clearSlotAfterCommit(slot));
    }
    this.#afterCommit(() => this.#removeTrailingEmptyEntity());
    this.#afterCommit(() => this.#pruneAudits());
    if ((plan.before?.length ?? 0) > 0 || (plan.after?.length ?? 0) > 0) {
      this.#afterCommit(() => this.#scheduleStructureBackup());
    }
  }

  /**
   * 回滚提交前的实体写入。回滚本身失败时：
   * - 原本是空槽：实体里多了一件调用方仍然持有的物品 → 登记为残留副本（只清理不恢复）；
   * - 原本有物品：实体内容与索引已无法保证一致 → 进入保护状态。
   */
  #rollbackPhysical(applied: Array<{ slot: number; container: Container; entitySlot: number; previous?: ItemStack }>) {
    for (const entry of [...applied].reverse()) {
      try {
        entry.container.setItem(entry.entitySlot, entry.previous);
      } catch (error) {
        if (entry.previous) {
          this.#enterProtection(`回滚槽位 ${entry.slot} 失败，实体内容与索引可能不一致: ${String(error)}`);
        } else {
          this.#markStaleCopy(entry.slot, `rollback failed: ${String(error)}`);
        }
      }
    }
  }

  /** 提交后清理实体槽位；失败时登记残留副本并重试 */
  #clearSlotAfterCommit(slot: number): void {
    try {
      const { container, entitySlot } = this.#containerAt(slot);
      container.setItem(entitySlot);
    } catch (error) {
      this.#markStaleCopy(slot, `entity slot cleanup failed after commit: ${String(error)}`);
    }
  }

  /** 最后一个实体完全空了就移除；先移除成功再出列，避免出现同编号的两个实体 */
  #removeTrailingEmptyEntity(): void {
    if (this.#entities.length <= 1) return;
    const lastIndex = this.#entities.length - 1;
    const entity = this.#entities[lastIndex];
    if (!entity) return;
    for (let i = 0; i < ITEM_MAX_PER_ENTITY; i++) {
      if (this.#slots.has(lastIndex * ITEM_MAX_PER_ENTITY + i)) return;
    }
    const container = entity.getComponent("inventory")?.container;
    if (!container || container.emptySlotsCount < ITEM_MAX_PER_ENTITY) return;
    this.#markExpectedRemoval(entity);
    entity.remove();
    this.#entities.pop();
  }

  /** 提交之后的善后步骤：只记录错误，绝不抛出 */
  #afterCommit(step: () => void): void {
    try {
      step();
    } catch (error) {
      SystemLog.warn(`[ItemDatabase ${this.#name}] 索引已提交，但善后步骤失败: ${String(error)}`);
    }
  }

  /**
   * 登记“已交付物品的残留副本”：阻止任何路径把它放回商店，并安排重试清理。
   * 保护状态下只登记在内存中。
   */
  #markStaleCopy(slot: number, reason: string): void {
    const record: SlotRecord = {
      slot,
      id: this.#newId(),
      ver: 1,
      quarantined: true,
      staleCopy: true,
      reason,
      detectedAt: Date.now(),
    };
    this.#setState(slot, { record });
    if (this.#isWritable()) {
      this.#database.set(slotKey(slot), record);
      this.#saveIndexBestEffort();
    }
    SystemLog.warn(`[ItemDatabase ${this.#name}] 槽位 ${slot} 登记为残留副本，将重试清理: ${reason}`);
    this.#scheduleStaleCopyCleanup();
  }

  #scheduleStaleCopyCleanup(): void {
    if (this.#staleCopyTimer !== undefined) return;
    this.#staleCopyTimer = system.runTimeout(() => {
      this.#staleCopyTimer = undefined;
      this.#cleanupStaleCopies();
    }, STALE_COPY_RETRY_TICKS);
  }

  #cleanupStaleCopies(): void {
    let cleaned = false;
    let pending = false;
    for (const [slot, state] of [...this.#slots]) {
      if (!state.record.staleCopy) continue;
      try {
        const { container, entitySlot } = this.#containerAt(slot);
        container.setItem(entitySlot);
        this.#setState(slot, undefined);
        if (this.#isWritable()) this.#database.delete(slotKey(slot));
        cleaned = true;
      } catch {
        pending = true;
      }
    }
    if (cleaned && this.#isWritable()) {
      this.#saveIndexBestEffort();
      this.#scheduleStructureBackup();
    }
    if (pending) this.#scheduleStaleCopyCleanup();
  }

  // ---------------------------------------------------------------------------
  // 清空 / 重置 / 维护
  // ---------------------------------------------------------------------------

  /**
   * 清空整个数据库并重置实体。
   * 提交点是索引清空保存成功；之前失败会抛出且什么都不动，之后的步骤一律不再抛出。
   */
  clear(): void {
    if (!this.#loaded) throw new ReferenceError("Database is not loaded");
    this.#database.clear();

    const previous = this.#entities.filter((e): e is Entity => !!e);
    this.#resetStateAfterCommit();
    for (const entity of previous) this.#retireEntity(entity);
    this.#afterCommit(() => {
      try {
        this.#spawnEntity(0);
        this.#scheduleStructureBackup();
      } catch (e) {
        if (e instanceof LocationInUnloadedChunkError) {
          void this.#spawnEntityWhenReady(0);
          return;
        }
        throw e;
      }
    });
  }

  /**
   * 硬重置：删除所有实体、索引与结构备份并重建。提交之后的步骤一律不再抛出。
   */
  async hardReset(): Promise<void> {
    const overworld = world.getDimension("minecraft:overworld");
    this.#database.clear();

    const previous = new Map<string, Entity>();
    for (const e of this.#entities) if (e) previous.set(e.id, e);
    this.#afterCommit(() => {
      for (const e of this.#findOwnEntities(overworld)) previous.set(e.id, e);
    });
    this.#resetStateAfterCommit();
    for (const entity of previous.values()) this.#retireEntity(entity);
    await this.#spawnEntityWhenReady(0);
  }

  /**
   * 管理员解除保护：以实体中的物品为准重建索引。
   * - 实体物品若在现有索引中有类型一致的正常记录，保留为商品；
   * - 其余实体物品全部隔离保留（之后可在维护界面取回或销毁）；
   * - 编号重复的实体会被分配新的编号，其物品同样隔离。
   * 只改索引与实体编号，不移动、不删除任何物品。
   */
  rebuildIndexFromEntities(): { items: number; quarantined: number } {
    if (!this.#loaded) throw new ReferenceError("Database is not loaded");
    const overworld = world.getDimension("minecraft:overworld");
    const { byIndex, duplicates } = assignEntityIndices(this.#findOwnEntities(overworld));
    let nextIndex = byIndex.size > 0 ? Math.max(...byIndex.keys()) + 1 : 0;
    for (const entity of duplicates) byIndex.set(nextIndex++, entity);
    const reassigned = new Set(duplicates.map((e) => e.id));

    const current = this.#database.getAll();
    const nextCache: Record<string, unknown> = {};
    for (const key of Object.keys(current)) {
      if (!key.startsWith(SLOT_KEY_PREFIX)) nextCache[key] = current[key];
    }

    const nextSlots = new Map<number, SlotState>();
    let items = 0;
    let quarantined = 0;
    let hasStaleCopies = false;
    for (const [entityIndex, entity] of byIndex) {
      const container = entity.getComponent("inventory")?.container;
      if (!container) continue;
      for (let i = 0; i < Math.min(container.size, ITEM_MAX_PER_ENTITY); i++) {
        const item = container.getItem(i);
        if (!item) continue;
        const slot = entityIndex * ITEM_MAX_PER_ENTITY + i;
        const existing = reassigned.has(entity.id) ? undefined : (current[slotKey(slot)] as SlotRecord | undefined);
        const knownStale = !reassigned.has(entity.id) && this.#slots.get(slot)?.record.staleCopy;
        let state: SlotState;
        if (existing?.staleCopy || knownStale) {
          // 已交付物品的残留副本：保持“只能清理、不可取回”，不暴露物品
          const record = existing?.staleCopy ? existing : this.#slots.get(slot)!.record;
          state = { record: { ...record, slot } };
          hasStaleCopies = true;
        } else if (
          existing &&
          !existing.quarantined &&
          typeof existing.id === "string" &&
          existing.itemSnapshot?.typeId === item.typeId
        ) {
          state = { record: { ...existing, slot, itemSnapshot: serializeItemStack(item) }, item };
          items++;
        } else {
          state = this.#quarantineState(slot, item, "index rebuilt from entities by admin");
          quarantined++;
        }
        nextSlots.set(slot, state);
        nextCache[slotKey(slot)] = state.record;
      }
    }

    // 有正常记录但实体里已经没有物品的槽位：不再作为商品，但留下审计记录
    for (const key of Object.keys(current)) {
      if (!key.startsWith(SLOT_KEY_PREFIX) || key in nextCache) continue;
      const record = current[key] as SlotRecord | undefined;
      if (!record || record.quarantined) continue;
      nextCache[this.#auditKey("missing", record.slot)] = {
        reason: "index rebuilt from entities by admin: entity item missing",
        record,
        slot: record.slot,
        detectedAt: Date.now(),
      };
    }

    this.#database.replaceAll(nextCache);

    // ---- 已提交 ----
    this.#entities = [];
    for (const [entityIndex, entity] of byIndex) {
      this.#afterCommit(() => this.#bindDatabaseEntity(entity, entityIndex));
      this.#afterCommit(() => this.#ensureAtAnchor(entity));
      this.#entities[entityIndex] = entity;
    }
    for (let i = 0; i < this.#entities.length; i++) {
      if (!this.#entities[i]) this.#afterCommit(() => this.#spawnEntity(i));
    }
    this.#slots = new Map();
    this.#idToSlot = new Map();
    for (const [slot, state] of nextSlots) this.#setState(slot, state);
    this.#seq = this.#computePersistedSeq();
    this.#protection = undefined;
    this.#saveFailureNotified = false;
    SystemLog.warn(`[ItemDatabase ${this.#name}] 管理员已按实体重建索引：保留 ${items} 件商品，隔离 ${quarantined} 件`);
    this.#scheduleStructureBackup();
    if (hasStaleCopies) this.#scheduleStaleCopyCleanup();
    return { items, quarantined };
  }

  /** 索引清空已提交：立即让旧缓存失效，任何查询都不会再看到旧商品 */
  #resetStateAfterCommit(): void {
    this.#seq = 0;
    this.#slots = new Map();
    this.#idToSlot = new Map();
    this.#entities = [];
    this.#protection = undefined;
    this.#afterCommit(() => this.#deleteStructureBackups());
  }

  /**
   * 移除一个不再使用的存储实体。移除失败时清空它的背包并解除与本库的绑定、移出存储方块，
   * 使它不会在之后被当成本库实体（避免重复编号、结构备份夹带或抢救复活）。
   */
  #retireEntity(entity: Entity): void {
    try {
      this.#markExpectedRemoval(entity);
      entity.remove();
      return;
    } catch (error) {
      SystemLog.warn(
        `[ItemDatabase ${this.#name}] 移除存储实体 ${entity.id} 失败，改为清空并解除绑定: ${String(error)}`
      );
    }

    this.#afterCommit(() => {
      const container = entity.getComponent("inventory")?.container;
      if (!container) return;
      for (let i = 0; i < Math.min(container.size, ITEM_MAX_PER_ENTITY); i++) {
        if (!container.getItem(i)) continue;
        try {
          container.setItem(i);
        } catch {
          // 继续清其它槽位；解除绑定后这些残留不会再进入商店
        }
      }
    });
    this.#afterCommit(() => this.#detachEntity(entity));
  }

  #detachEntity(entity: Entity): void {
    const steps: Array<() => void> = [
      () => entity.setDynamicProperty("paoDbName", undefined),
      () => entity.setDynamicProperty("paoDbIndex", undefined),
      () => {
        for (const tag of entity.getTags()) {
          if (tag === DB_ENTITY_TAG || tag.startsWith(DB_NAME_TAG_PREFIX) || tag.startsWith(DB_INDEX_TAG_PREFIX)) {
            entity.removeTag(tag);
          }
        }
      },
      () => {
        entity.nameTag = "";
      },
      () => {
        const center = anchorCenter(this.#anchorBlock);
        entity.teleport({ x: center.x, y: center.y + 1, z: center.z });
      },
    ];
    for (const step of steps) this.#afterCommit(step);
  }

  // ---------------------------------------------------------------------------
  // 初始化与核对
  // ---------------------------------------------------------------------------

  private async init(): Promise<void> {
    try {
      await this.#initialize();
    } catch (error) {
      // 初始化失败不能静默：进入保护状态，管理员能看到原因。
      this.#loaded = true;
      this.#enterProtection(`初始化失败: ${String(error)}`);
      SystemLog.error(`[ItemDatabase ${this.#name}] 初始化失败`, error);
    }
  }

  async #initialize(): Promise<void> {
    await waitLoaded();
    const overworld = world.getDimension("minecraft:overworld");
    await prepareDatabaseAnchorRegion(overworld);
    this.#anchorBlock = resolveDatabaseAnchorBlock(this.#name);
    while (this.#pendingRescues.size > 0) {
      await Promise.all([...this.#pendingRescues]);
    }

    const start = Date.now();
    const persistedEntityIndices = this.#getPersistedEntityIndices();

    let ents = this.#findOwnEntities(overworld);
    if (this.#countMissingIndices(ents, persistedEntityIndices) > 0) {
      ents = await this.#findOwnEntitiesWithRetry(overworld, persistedEntityIndices);
    }

    // 索引数据损坏时，不能拿它去“纠正”实体里的物品：只绑定实体并进入保护状态。
    const loadState = this.#database.loadState;
    if (loadState === "repaired" || loadState === "reset") {
      const { byIndex } = assignEntityIndices(ents);
      for (const [index, entity] of byIndex) this.#entities[index] = entity;
      this.#loaded = true;
      this.#enterProtection(
        `物品索引数据损坏（${loadState}），为避免误删实体中的物品已进入保护状态，原始数据已备份在世界动态属性中`
      );
      return;
    }

    const { byIndex, duplicates } = assignEntityIndices(ents);
    if (duplicates.length > 0) {
      // 例如结构备份还原后原实体又加载出来：无法判断哪份是最新的，全部保留不动。
      for (const [index, entity] of byIndex) this.#entities[index] = entity;
      this.#loaded = true;
      this.#enterProtection(
        `发现 ${duplicates.length} 个编号重复的存储实体（${duplicates.map((e) => e.id).join(", ")}），已保留全部实体并进入保护状态，请管理员处理`
      );
      return;
    }

    this.#seq = this.#computePersistedSeq();

    // 部分或全部存储实体缺失：用结构备份补齐缺失的编号，并记录每个实体来自哪一次备份。
    const backupSeqByIndex = new Map<number, number>();
    const missing = [...persistedEntityIndices].filter((index) => !byIndex.has(index));
    if (missing.length > 0) {
      const restored = await this.#restoreMissingFromStructure(overworld, missing);
      for (const [index, { entity, seq }] of restored) {
        byIndex.set(index, entity);
        backupSeqByIndex.set(index, seq);
      }
    }

    const persistedEntityCount = persistedEntityIndices.size > 0 ? Math.max(...persistedEntityIndices) + 1 : 0;
    const existingEntityCount = byIndex.size > 0 ? Math.max(...byIndex.keys()) + 1 : 0;
    const entityCount = Math.max(1, persistedEntityCount, existingEntityCount);
    const lossy: LossyRestoreTracker = { count: 0, reasons: new Set<string>() };

    for (let entityIndex = 0; entityIndex < entityCount; entityIndex++) {
      let entity = byIndex.get(entityIndex);
      if (!entity) {
        entity = await spawnEntityAtAnchorWithRetry(overworld, () =>
          overworld.spawnEntity<"pao:new_database">(ENTITY_TYPE_ID, anchorCenter(this.#anchorBlock))
        );
      }
      this.#bindDatabaseEntity(entity, entityIndex);
      this.#ensureAtAnchor(entity);
      this.#entities[entityIndex] = entity;

      const container = entity.getComponent("inventory")?.container;
      if (!container) throw new Error(`存储实体 ${entityIndex} 缺少 inventory 容器`);

      const backupSeq = backupSeqByIndex.get(entityIndex);
      const source: SlotSource = backupSeq === undefined ? { kind: "live" } : { kind: "backup", seq: backupSeq };
      for (let i = 0; i < ITEM_MAX_PER_ENTITY; i++) {
        const slot = entityIndex * ITEM_MAX_PER_ENTITY + i;
        const entityItem = container.getItem(i);
        const record = this.#database.get(slotKey(slot)) as SlotRecord | undefined;
        const decision = decideSlot(entityItem?.typeId, recordView(record), source);
        this.#applyDecision(decision, { slot, container, entitySlot: i, entityItem, record, lossy, writeIndex: true });
      }
    }

    this.#loaded = true;
    this.#pruneAudits();
    this.#saveIndexBestEffort();

    if (lossy.count > 0) {
      const message = `物品数据库 ${this.#name} 有 ${lossy.count} 件物品只能从 JSON 快照恢复，可能丢失：${describeLossyReasons(lossy.reasons)}`;
      SystemLog.warn(`[ItemDatabase ${this.#name}] ${message}`);
      this.#notifyAdmins(`§e${message}`);
    }

    SystemLog.info(`[Entity Database] ${this.#name} loaded in ${Date.now() - start}ms, ${this.length} items.`);
    this.#scheduleStructureBackup();
    if ([...this.#slots.values()].some((s) => s.record.staleCopy)) this.#scheduleStaleCopyCleanup();
  }

  /**
   * 执行 decideSlot 的结论。
   * - container/entitySlot：该槽位物品“应在”的实体容器（抢救时为新实体）；
   * - entityItem：核对时看到的物品（抢救时是旧实体中抓取的副本，尚未放入新实体）；
   * - placeEntityItem：抢救模式下，保留的物品需要放进新实体；
   * - writeIndex：是否允许修改索引（保护状态下为 false）。
   */
  #applyDecision(
    decision: SlotDecision,
    ctx: {
      slot: number;
      container: Container;
      entitySlot: number;
      entityItem?: ItemStack;
      record?: SlotRecord;
      lossy: LossyRestoreTracker;
      writeIndex: boolean;
      placeEntityItem?: boolean;
      memoryItem?: ItemStack;
    }
  ): void {
    const { slot, container, entitySlot, entityItem, record, lossy, writeIndex } = ctx;
    const place = () => {
      if (ctx.placeEntityItem && entityItem) container.setItem(entitySlot, entityItem);
    };
    const putRecord = (next: SlotState | undefined) => {
      this.#setState(slot, next);
      if (!writeIndex) return;
      if (next) this.#database.set(slotKey(slot), next.record);
      else this.#database.delete(slotKey(slot));
    };
    const audit = (kind: string, data: Record<string, unknown>) => {
      if (writeIndex) this.#database.set(this.#auditKey(kind, slot), { ...data, slot, detectedAt: Date.now() });
    };
    // 补全旧版本记录缺少的 id / ver，并去掉旧版本误存的 item 字段（ItemStack 序列化后只是 {}）
    const ensureIdentity = (r: SlotRecord): SlotRecord => {
      const { item: _legacyItem, ...rest } = r as SlotRecord & { item?: unknown };
      return {
        ...rest,
        slot,
        id: typeof rest.id === "string" && rest.id ? rest.id : this.#newId(),
        ver: Number.isInteger(rest.ver) ? rest.ver : 1,
      };
    };

    switch (decision.kind) {
      case "noop":
        return;
      case "activate": {
        place();
        putRecord({
          record: { ...ensureIdentity(record!), itemSnapshot: serializeItemStack(entityItem!) },
          item: entityItem,
        });
        return;
      }
      case "keepQuarantine": {
        place();
        putRecord({ record: ensureIdentity(record!), item: entityItem });
        return;
      }
      case "dropRecord":
        putRecord(undefined);
        return;
      case "clearStaleCopy": {
        if (entityItem && !ctx.placeEntityItem) {
          try {
            container.setItem(entitySlot);
          } catch {
            this.#setState(slot, { record: ensureIdentity(record!) });
            this.#scheduleStaleCopyCleanup();
            return;
          }
        }
        putRecord(undefined);
        return;
      }
      case "quarantine": {
        place();
        putRecord(this.#quarantineState(slot, entityItem!, decision.reason));
        SystemLog.warn(`[ItemDatabase ${this.#name}] 槽位 ${slot}（${entityItem!.typeId}）没有索引记录，已隔离保留`);
        return;
      }
      case "quarantineMismatch": {
        place();
        audit("mismatch", { reason: decision.reason, record: record });
        putRecord(this.#quarantineState(slot, entityItem!, decision.reason));
        SystemLog.warn(`[ItemDatabase ${this.#name}] 槽位 ${slot} 的实体物品与索引不符，已隔离保留，原记录另存审计`);
        return;
      }
      case "discardBackupCopy": {
        audit("discarded", { reason: decision.reason, itemSnapshot: serializeItemStack(entityItem!) });
        if (!ctx.placeEntityItem) {
          try {
            container.setItem(entitySlot);
          } catch {
            this.#markStaleCopy(slot, decision.reason);
            return;
          }
        }
        this.#setState(slot, undefined);
        SystemLog.warn(`[ItemDatabase ${this.#name}] 槽位 ${slot}（${entityItem!.typeId}）是过期的备份副本，已丢弃`);
        return;
      }
      case "rebuild": {
        if (decision.discardEntityItem && entityItem) {
          audit("discarded", { reason: decision.reason, itemSnapshot: serializeItemStack(entityItem) });
          if (!ctx.placeEntityItem) container.setItem(entitySlot);
        }
        const fromMemory = ctx.memoryItem?.clone();
        let restored = fromMemory;
        if (!restored && record?.itemSnapshot) {
          try {
            restored = deserializeItemStack(record.itemSnapshot);
            const reasons = collectLossyReasons(record.itemSnapshot);
            if (reasons.size > 0) {
              lossy.count++;
              reasons.forEach((reason) => lossy.reasons.add(reason));
              SystemLog.warn(
                `[ItemDatabase ${this.#name}] 槽位 ${slot}（${record.itemSnapshot.typeId}）从 JSON 快照恢复，可能丢失：${describeLossyReasons(reasons)}`
              );
            }
          } catch (error) {
            restored = undefined;
            SystemLog.warn(`[ItemDatabase ${this.#name}] 槽位 ${slot} 的快照无法还原: ${String(error)}`);
          }
        }
        if (!restored) {
          audit("missing", { reason: decision.reason, record });
          putRecord(undefined);
          this.#notifyAdmins(
            `§e物品数据库 ${this.#name} 槽位 ${slot} 的物品已缺失且无法重建，已移除该商品（记录已另存审计）。`
          );
          return;
        }
        container.setItem(entitySlot, restored);
        putRecord({ record: ensureIdentity(record!), item: restored });
        return;
      }
    }
  }

  #quarantineState(slot: number, item: ItemStack, reason: string): SlotState {
    return {
      record: {
        slot,
        id: this.#newId(),
        ver: 1,
        quarantined: true,
        reason,
        detectedAt: Date.now(),
        itemSnapshot: serializeItemStack(item),
      },
      item,
    };
  }

  // ---------------------------------------------------------------------------
  // 抢救与卸载
  // ---------------------------------------------------------------------------

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
      const entityIndex =
        readEntityIndex(entity) ??
        Math.max(
          0,
          this.#entities.findIndex((e) => e?.id === entity.id)
        );
      const container = entity.getComponent("inventory")?.container;
      const items = new Map<number, ItemStack>();
      if (container) {
        for (let i = 0; i < Math.min(container.size, ITEM_MAX_PER_ENTITY); i++) {
          const item = container.getItem(i);
          if (item) items.set(i, item.clone());
        }
      }

      const indexLocked = !this.#isWritable();
      let placeholder: string | undefined;
      if (!indexLocked) {
        // 抢救完成前阻止一切读写
        placeholder = `存储实体被意外移除，正在抢救 ${items.size} 个物品槽`;
        this.#protection = placeholder;
      }
      const task = new Promise<void>((resolve) => {
        system.run(() => {
          void this.#restoreRemovedEntity({
            entityIndex,
            entityId: entity.id,
            items,
            indexLocked,
            placeholder,
          }).finally(resolve);
        });
      });
      this.#pendingRescues.add(task);
      void task.then(() => this.#pendingRescues.delete(task));
    } catch (error) {
      this.#enterProtection(`存储实体被意外移除，但抢救快照读取失败: ${String(error)}`);
      SystemLog.error(`[ItemDatabase ${this.#name}] 存储实体抢救快照读取失败`, error);
    }
  }

  async #restoreRemovedEntity(snapshot: RescueSnapshot): Promise<void> {
    try {
      const overworld = world.getDimension("minecraft:overworld");
      await prepareDatabaseAnchorRegion(overworld);
      const replacement = await spawnEntityAtAnchorWithRetry(overworld, () =>
        overworld.spawnEntity<"pao:new_database">(ENTITY_TYPE_ID, anchorCenter(this.#anchorBlock))
      );
      this.#bindDatabaseEntity(replacement, snapshot.entityIndex);
      this.#entities[snapshot.entityIndex] = replacement;

      const container = replacement.getComponent("inventory")?.container;
      if (!container) throw new Error("抢救后新实体缺少 inventory 容器");

      const base = snapshot.entityIndex * ITEM_MAX_PER_ENTITY;
      // 抢救期间若已因其它原因进入保护状态（占位原因被覆盖），同样只做物理抢救。
      const locked = snapshot.indexLocked || this.#protection !== snapshot.placeholder;
      if (locked) {
        // 索引不可写（保护状态或尚未加载完）：只做物理抢救，物品原样放回，不碰索引。
        for (const [localSlot, item] of snapshot.items) {
          if (this.#slots.get(base + localSlot)?.record.staleCopy) continue;
          container.setItem(localSlot, item);
        }
        this.#notifyAdmins(
          `§e物品数据库 ${this.#name} 的存储实体被移除，已原样放回 ${snapshot.items.size} 个物品槽（保护状态未解除）。`
        );
        return;
      }

      const lossy: LossyRestoreTracker = { count: 0, reasons: new Set<string>() };
      for (let i = 0; i < ITEM_MAX_PER_ENTITY; i++) {
        const slot = base + i;
        const entityItem = snapshot.items.get(i);
        const record = this.#database.get(slotKey(slot)) as SlotRecord | undefined;
        const decision = decideSlot(entityItem?.typeId, recordView(record), { kind: "rescue" });
        this.#applyDecision(decision, {
          slot,
          container,
          entitySlot: i,
          entityItem,
          record,
          lossy,
          writeIndex: true,
          placeEntityItem: true,
          memoryItem: this.#slots.get(slot)?.item,
        });
      }

      if (snapshot.placeholder && this.#protection === snapshot.placeholder) this.#protection = undefined;
      this.#saveIndexBestEffort();
      SystemLog.warn(
        `[ItemDatabase ${this.#name}] 检测到存储实体 ${snapshot.entityId} 被移除，已重建并核对 ${snapshot.items.size} 个物品槽`
      );
      this.#notifyAdmins(`§e物品数据库 ${this.#name} 的存储实体被移除，已恢复 ${snapshot.items.size} 个物品槽。`);
      this.#scheduleStructureBackup();
    } catch (error) {
      if (snapshot.placeholder && this.#protection === snapshot.placeholder) this.#protection = undefined;
      this.#enterProtection(`存储实体抢救失败: ${String(error)}`);
      SystemLog.error(`[ItemDatabase ${this.#name}] 存储实体抢救失败`, error);
    }
  }

  #handleExpectedStorageUnload(entity: Entity): void {
    try {
      const entityIndex = readEntityIndex(entity) ?? this.#entities.findIndex((e) => e?.id === entity.id);
      let quarantined = 0;

      // 这里处于 beforeEvents（受限执行）。只在索引可写时登记无索引物品，不改动实体、不重写已有记录。
      if (this.#isWritable() && entityIndex >= 0) {
        const container = entity.getComponent("inventory")?.container;
        const lossy: LossyRestoreTracker = { count: 0, reasons: new Set<string>() };
        if (container) {
          for (let i = 0; i < Math.min(container.size, ITEM_MAX_PER_ENTITY); i++) {
            const item = container.getItem(i);
            if (!item) continue;
            const slot = entityIndex * ITEM_MAX_PER_ENTITY + i;
            const record = this.#database.get(slotKey(slot)) as SlotRecord | undefined;
            const decision = decideSlot(item.typeId, recordView(record), { kind: "unload" });
            if (decision.kind !== "quarantine") continue;
            this.#applyDecision(decision, {
              slot,
              container,
              entitySlot: i,
              entityItem: item.clone(),
              record,
              lossy,
              writeIndex: true,
            });
            quarantined++;
          }
        }
      }

      // 只清空对应编号的位置，不能 splice：否则后面实体的编号整体前移，槽位会映射到错误的实体。
      const idx = this.#entities.findIndex((candidate) => candidate?.id === entity.id);
      if (idx >= 0) this.#entities[idx] = undefined;

      if (this.#isWritable() && quarantined > 0) this.#saveIndexBestEffort();
      SystemLog.info(
        `[ItemDatabase ${this.#name}] 世界暂无真实玩家在线，存储实体已随区块卸载（登记 ${quarantined} 个无索引物品为隔离），下次进服将自动重新绑定`
      );
    } catch (error) {
      SystemLog.warn(`[ItemDatabase ${this.#name}] 处理存储实体卸载失败: ${String(error)}`);
    }
  }

  /**
   * 玩家重新上线时，补绑无人在线期间随区块卸载的存储实体。
   */
  rebindUnloadedEntities(): void {
    if (!this.#loaded) return;
    if (!this.#hasEntityHoles()) return;
    system.run(() => this.#tryRebindMissingEntities());
  }

  #hasEntityHoles(): boolean {
    for (let i = 0; i < this.#entities.length; i++) {
      if (!this.#entities[i]) return true;
    }
    return false;
  }

  #tryRebindMissingEntities(): void {
    try {
      const overworld = world.getDimension("minecraft:overworld");
      const boundIds = new Set(this.#entities.filter((e): e is Entity => !!e).map((e) => e.id));
      for (const entity of this.#findOwnEntities(overworld)) {
        if (boundIds.has(entity.id)) continue;
        const index = readEntityIndex(entity);
        if (index === undefined || index >= this.#entities.length || this.#entities[index]) continue;
        this.#entities[index] = entity;
        boundIds.add(entity.id);
        SystemLog.info(`[ItemDatabase ${this.#name}] 已重新绑定存储实体 ${index}`);
      }
    } catch (error) {
      SystemLog.warn(`[ItemDatabase ${this.#name}] 重新绑定存储实体失败: ${String(error)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // 结构备份
  // ---------------------------------------------------------------------------

  /**
   * 用结构备份补齐缺失编号的存储实体（全部或部分丢失都适用）。
   * 备份里包含本库所有实体：只保留缺失编号的那些，其余放出来的副本立即移除，避免重复。
   */
  async #restoreMissingFromStructure(
    overworld: Dimension,
    missing: number[]
  ): Promise<Map<number, { entity: Entity; seq: number }>> {
    const restored = new Map<number, { entity: Entity; seq: number }>();
    const meta = readStructureBackupMeta(this.#name);
    if (!meta) return restored;

    const order: Array<"a" | "b"> = meta.slot === "a" ? ["a", "b"] : ["b", "a"];
    for (const slot of order) {
      const remaining = missing.filter((index) => !restored.has(index));
      if (remaining.length === 0) break;

      const id = structureBackupId(this.#name, slot);
      const seq = meta.seqs?.[slot] ?? 0;
      const existingIds = new Set(this.#findOwnEntities(overworld).map((e) => e.id));
      try {
        if (!world.structureManager.get(id)) continue;
        world.structureManager.place(id, overworld, this.#anchorBlock, {
          includeBlocks: false,
          includeEntities: true,
        });
      } catch (error) {
        SystemLog.warn(`[ItemDatabase ${this.#name}] 放置结构备份 ${id} 失败: ${String(error)}`);
        continue;
      }

      await waitTicks(STRUCTURE_RESTORE_WAIT_TICKS);
      for (const entity of this.#findOwnEntities(overworld)) {
        if (existingIds.has(entity.id)) continue;
        const index = readEntityIndex(entity);
        if (index !== undefined && remaining.includes(index) && !restored.has(index)) {
          restored.set(index, { entity, seq });
        } else {
          this.#retireEntity(entity);
        }
      }
    }

    if (restored.size > 0) {
      const message = `物品数据库 ${this.#name} 缺少 ${missing.length} 个存储实体，已从结构备份还原 ${restored.size} 个（之后改动过的槽位会按索引重建）`;
      SystemLog.warn(`[ItemDatabase ${this.#name}] ${message}`);
      this.#notifyAdmins(`§e${message}`);
    }
    return restored;
  }

  #scheduleStructureBackup(): void {
    if (this.#backupTimer !== undefined) return;
    this.#backupTimer = system.runTimeout(() => {
      this.#backupTimer = undefined;
      this.#writeStructureBackup();
    }, STRUCTURE_BACKUP_DEBOUNCE_TICKS);
  }

  /**
   * 把本库所有存储实体（含完整 NBT）存成世界结构，A/B 交替写入，写成功后才切换 meta。
   * 实体不完整或数据库处于保护状态时不写，避免用残缺状态覆盖好的备份。
   */
  #writeStructureBackup(): void {
    if (!this.#isWritable()) return;
    if (this.#entities.length === 0 || this.#hasEntityHoles()) return;

    const entities = this.#entities as Entity[];
    if (entities.some((e) => !e.isValid)) return;

    // 所有实体必须位于本库的存储方块里；不在的先移回去，下一轮再备份。
    let moved = false;
    for (const entity of entities) {
      if (this.#ensureAtAnchor(entity)) moved = true;
    }
    if (moved) {
      this.#scheduleStructureBackup();
      return;
    }

    const meta = readStructureBackupMeta(this.#name);
    const nextSlot: "a" | "b" = meta?.slot === "a" ? "b" : "a";
    const id = structureBackupId(this.#name, nextSlot);

    try {
      const overworld = world.getDimension("minecraft:overworld");
      if (world.structureManager.get(id)) world.structureManager.delete(id);
      world.structureManager.createFromWorld(id, overworld, this.#anchorBlock, this.#anchorBlock, {
        includeBlocks: false,
        includeEntities: true,
        saveMode: StructureSaveMode.World,
      });
      const nextMeta: StructureBackupMeta = {
        slot: nextSlot,
        at: Date.now(),
        entityCount: entities.length,
        itemCount: this.#slots.size,
        seqs: { ...(meta?.seqs ?? {}), [nextSlot]: this.#seq },
      };
      world.setDynamicProperty(`${STRUCTURE_BACKUP_META_PREFIX}${this.#name}`, JSON.stringify(nextMeta));
    } catch (error) {
      SystemLog.warn(`[ItemDatabase ${this.#name}] 写入结构备份失败: ${String(error)}`);
    }
  }

  #deleteStructureBackups(): void {
    for (const slot of ["a", "b"] as const) {
      try {
        world.structureManager.delete(structureBackupId(this.#name, slot));
      } catch {
        // ignore
      }
    }
    try {
      world.setDynamicProperty(`${STRUCTURE_BACKUP_META_PREFIX}${this.#name}`, undefined);
    } catch {
      // ignore
    }
  }

  // ---------------------------------------------------------------------------
  // 内部工具
  // ---------------------------------------------------------------------------

  #isWritable(): boolean {
    return this.#loaded && !this.#protection;
  }

  /** 可读可写的前置检查：已加载、不在保护状态、实体齐全且有效 */
  #assertUsable(): void {
    if (!this.#loaded) throw new ReferenceError("Database is not loaded");
    if (this.#protection) {
      throw new Error(`ItemDatabase ${this.#name} is unhealthy: ${this.#protection}`);
    }

    if (this.#hasEntityHoles()) {
      this.#tryRebindMissingEntities();
      if (this.#hasEntityHoles()) {
        // 暂时性状态（实体随区块卸载后尚未重新加载），不进入保护状态。
        throw new Error(`ItemDatabase ${this.#name}: 存储实体尚未加载，请稍后再试`);
      }
    }

    for (const entity of this.#entities) {
      if (!entity?.isValid) {
        this.#enterProtection("存储实体已失效");
        throw new Error(`ItemDatabase ${this.#name} is unhealthy: ${this.#protection}`);
      }
      if (!entity.getComponent("inventory")?.container) {
        this.#enterProtection("存储实体缺少 inventory 容器");
        throw new Error(`ItemDatabase ${this.#name} is unhealthy: ${this.#protection}`);
      }
    }
  }

  #assertWritable(): void {
    if (!this.#isWritable()) {
      throw new Error(`ItemDatabase ${this.#name} is unhealthy: ${this.#protection ?? "not loaded"}`);
    }
  }

  #enterProtection(reason: string): void {
    if (!this.#protection) {
      SystemLog.error(`[ItemDatabase ${this.#name}] 数据库进入保护状态: ${reason}`);
      this.#notifyAdmins(`§c物品数据库 ${this.#name} 进入保护状态: §e${reason}`);
    }
    this.#protection = reason;
  }

  #toData(slot: number): SlotData {
    const state = this.#slots.get(slot)!;
    return { ...state.record, item: state.item?.clone() };
  }

  #setState(slot: number, next: SlotState | undefined): void {
    const previous = this.#slots.get(slot);
    if (previous) this.#idToSlot.delete(previous.record.id);
    if (next) {
      this.#slots.set(slot, next);
      this.#idToSlot.set(next.record.id, slot);
    } else {
      this.#slots.delete(slot);
    }
  }

  /** 按 id（+ 版本）定位可见商品；不带 id 的旧调用按元数据比较 */
  #resolveSlot(data: Partial<SlotData>): number | undefined {
    if (typeof data.id === "string") {
      const slot = this.#idToSlot.get(data.id);
      if (slot === undefined) return undefined;
      const state = this.#slots.get(slot);
      if (!state || state.record.quarantined) return undefined;
      if (typeof data.ver === "number" && data.ver !== state.record.ver) return undefined;
      return slot;
    }
    const target = metadataKey(data);
    for (const [slot, state] of this.#slots) {
      if (!state.record.quarantined && metadataKey(state.record) === target) return slot;
    }
    return undefined;
  }

  /** 读取实体中真实存储的物品，并与记录核对 */
  #readVerifiedEntityItem(slot: number): ItemStack {
    const state = this.#slots.get(slot)!;
    const { container, entitySlot } = this.#containerAt(slot);
    const actual = container.getItem(entitySlot);
    if (!actual) {
      throw new Error(`ItemDatabase ${this.#name}: 槽位 ${slot} 的实体物品缺失，已拒绝交付`);
    }
    const expectedType = state.record.itemSnapshot?.typeId;
    if (expectedType !== undefined && expectedType !== actual.typeId) {
      throw new Error(`ItemDatabase ${this.#name}: 槽位 ${slot} 的实体物品与记录不符，已拒绝交付`);
    }
    return actual;
  }

  /** 找一个索引中空着的槽位；没有就新建一个存储实体 */
  #reserveEmptySlot(): number {
    const total = this.#entities.length * ITEM_MAX_PER_ENTITY;
    for (let slot = 0; slot < total; slot++) {
      if (!this.#slots.has(slot)) return slot;
    }
    try {
      this.#spawnEntity(this.#entities.length);
    } catch (e) {
      if (e instanceof LocationInUnloadedChunkError) {
        throw new Error("物品存储区块尚未加载，请稍后再试");
      }
      throw e;
    }
    return total;
  }

  #containerAt(slot: number): { container: Container; entitySlot: number } {
    const entityIndex = Math.floor(slot / ITEM_MAX_PER_ENTITY);
    const entity = this.#entities[entityIndex];
    if (!entity) throw new Error(`ItemDatabase ${this.#name}: 存储实体 ${entityIndex} 尚未加载`);
    const container = entity.getComponent("inventory")?.container;
    if (!container) throw new Error(`ItemDatabase ${this.#name}: 存储实体 ${entityIndex} 缺少 inventory 容器`);
    return { container, entitySlot: slot % ITEM_MAX_PER_ENTITY };
  }

  #spawnEntity(index: number): void {
    const overworld = world.getDimension("minecraft:overworld");
    const entity = overworld.spawnEntity<"pao:new_database">(ENTITY_TYPE_ID, anchorCenter(this.#anchorBlock));
    this.#bindDatabaseEntity(entity, index);
    this.#entities[index] = entity;
  }

  async #spawnEntityWhenReady(index: number): Promise<void> {
    try {
      const overworld = world.getDimension("minecraft:overworld");
      await prepareDatabaseAnchorRegion(overworld);
      const entity = await spawnEntityAtAnchorWithRetry(overworld, () =>
        overworld.spawnEntity<"pao:new_database">(ENTITY_TYPE_ID, anchorCenter(this.#anchorBlock))
      );
      this.#bindDatabaseEntity(entity, index);
      this.#entities[index] = entity;
      this.#scheduleStructureBackup();
    } catch (error) {
      SystemLog.warn(`[ItemDatabase ${this.#name}] 生成存储实体失败，将在下次写入时重试: ${String(error)}`);
    }
  }

  #findOwnEntities(overworld: Dimension): Entity[] {
    return overworld
      .getEntities({ type: ENTITY_TYPE_ID })
      .filter((e) => getEntityDbName(e) === this.#name)
      .sort((a, b) => readEntitySpawnTime(a) - readEntitySpawnTime(b));
  }

  /** 有索引但实体不全时，多等几轮实体加载，避免把“加载慢”误判成“丢失” */
  async #findOwnEntitiesWithRetry(overworld: Dimension, persisted: Set<number>): Promise<Entity[]> {
    let ents = this.#findOwnEntities(overworld);
    for (let attempt = 0; attempt < ENTITY_LOOKUP_RETRY_ATTEMPTS; attempt++) {
      await waitTicks(ENTITY_LOOKUP_RETRY_INTERVAL_TICKS);
      ents = this.#findOwnEntities(overworld);
      if (this.#countMissingIndices(ents, persisted) === 0) break;
    }
    return ents;
  }

  #countMissingIndices(ents: Entity[], persisted: Set<number>): number {
    const { byIndex } = assignEntityIndices(ents);
    return [...persisted].filter((index) => !byIndex.has(index)).length;
  }

  #getPersistedEntityIndices(): Set<number> {
    const indices = new Set<number>();
    for (const key of this.#database.keys()) {
      if (!key.startsWith(SLOT_KEY_PREFIX)) continue;
      const slot = Number(key.slice(SLOT_KEY_PREFIX.length));
      if (Number.isInteger(slot) && slot >= 0) indices.add(Math.floor(slot / ITEM_MAX_PER_ENTITY));
    }
    return indices;
  }

  #computePersistedSeq(): number {
    let seq = Number(this.#database.get(SEQ_KEY));
    if (!Number.isFinite(seq) || seq < 0) seq = 0;
    for (const key of this.#database.keys()) {
      if (!key.startsWith(SLOT_KEY_PREFIX)) continue;
      const rev = Number((this.#database.get(key) as SlotRecord | undefined)?.rev);
      if (Number.isFinite(rev) && rev > seq) seq = rev;
    }
    return seq;
  }

  #newId(): string {
    this.#idCounter = (this.#idCounter + 1) % 1_000_000;
    return `${Date.now().toString(36)}-${this.#idCounter.toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  }

  #auditKey(kind: string, slot: number): string {
    return `${AUDIT_KEY_PREFIX}${kind}_${slot}_${Date.now()}_${this.#newId()}`;
  }

  /** 只保留最近的审计记录，避免索引无限增长（只改缓存，随下次保存落盘） */
  #pruneAudits(): void {
    if (!this.#isWritable()) return;
    const keys = this.#database.keys().filter(isAuditKey);
    if (keys.length <= MAX_AUDIT_RECORDS) return;
    const byTime = keys
      .map((key) => ({ key, at: Number((this.#database.get(key) as { detectedAt?: number })?.detectedAt) || 0 }))
      .sort((a, b) => a.at - b.at);
    for (const { key } of byTime.slice(0, byTime.length - MAX_AUDIT_RECORDS)) {
      this.#database.delete(key);
    }
  }

  /** 尽力保存索引，失败不抛出、由自动保存重试。只用于不会让玩家拿到物品的路径。 */
  #saveIndexBestEffort(): void {
    try {
      this.#database.save();
      this.#saveFailureNotified = false;
    } catch (error) {
      SystemLog.error(`[ItemDatabase ${this.#name}] 保存物品索引失败，将自动重试`, error);
      if (!this.#saveFailureNotified) {
        this.#saveFailureNotified = true;
        this.#notifyAdmins(`§c物品数据库 ${this.#name} 索引保存失败，将自动重试；请勿关服并查看日志。`);
      }
    }
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

  /** 实体不在本库存储方块内时移回去，返回是否发生了移动 */
  #ensureAtAnchor(entity: Entity): boolean {
    try {
      if (isInsideBlock(entity.location, this.#anchorBlock)) return false;
      entity.teleport(anchorCenter(this.#anchorBlock), { dimension: world.getDimension("minecraft:overworld") });
      return true;
    } catch (error) {
      SystemLog.warn(`[ItemDatabase ${this.#name}] 移动存储实体失败: ${String(error)}`);
      return false;
    }
  }

  #markExpectedRemoval(entity: Entity): void {
    this.#expectedRemovalIds.add(entity.id);
    system.runTimeout(() => {
      this.#expectedRemovalIds.delete(entity.id);
    }, 5);
  }

  #notifyAdmins(message: string): void {
    for (const player of getOnlineRealPlayers()) {
      if (isAdmin(player)) {
        player.sendMessage(message);
      }
    }
  }
}
