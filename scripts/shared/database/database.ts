/**
 * 数据库管理类
 * 用于持久化存储数据到世界动态属性
 *
 * 存储格式（v2）：
 * - `${name}Meta`：JSON 字符串 `{ v: 2, gen, count }`，是唯一的“提交点”
 * - `${name}@${gen}:${i}`：第 gen 代数据的第 i 个分块（gen 在 1 / 2 之间交替）
 *
 * 保存时先把所有分块写入“另一代”的 key，全部成功后才切换 Meta，
 * 任何一步失败都不会影响当前代的数据，避免新旧分块混杂导致整库损坏。
 *
 * 动态属性字符串上限是 32767 **字节**（UTF-8），中文每字 3 字节，
 * 因此分块必须按 UTF-8 字节数切分，而不是按 JS 字符数。
 *
 * 兼容旧格式：`${name}Index` + `${name}:${i}`。读取时若没有 Meta 则回退读取旧格式；
 * 首次保存成功后改用新格式，并写入 `${name}Format` 标记。旧格式的 key 保持原样不再写入。
 *
 * Meta 存在但无法解析，或者已有新格式标记却找不到 Meta，都视为数据损坏（loadState = "reset"），
 * 绝不回退去读升级前遗留的旧格式数据。
 */

import { world, system } from "@minecraft/server";

// 自动保存只负责兜底持久化。将同一数据库一分钟内的修改合并，并把不同
// 数据库拆到不同调度轮次，避免在一个 tick 内连续序列化、写入所有脏库。
const AUTO_SAVE_INTERVAL_TICKS = 100;
const AUTO_SAVE_DIRTY_AGE_MS = 60_000;
const AUTO_SAVE_RETRY_DELAY_MS = 60_000;

/** Minecraft 字符串动态属性上限（UTF-8 字节） */
export const MAX_DYNAMIC_PROPERTY_BYTES = 32767;
/** 单个分块的目标字节数，留出余量 */
const CHUNK_TARGET_BYTES = 30000;
const STORAGE_FORMAT_VERSION = 2;

/**
 * - fresh：世界里没有该库的数据，使用默认值
 * - ok：正常读取
 * - repaired：数据损坏，已备份原始数据并修复出部分内容
 * - reset：数据损坏且无法修复，已备份原始数据并回退到默认值
 */
export type DatabaseLoadState = "fresh" | "ok" | "repaired" | "reset";

interface StorageMeta {
  v: number;
  gen: number;
  count: number;
}

interface LoadResult {
  data: Record<string, any>;
  state: DatabaseLoadState;
}

/** 计算字符串按 UTF-8 编码后的字节数（SAPI 运行时不保证有 TextEncoder） */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/**
 * 按 UTF-8 字节数切分字符串，保证每块不超过 maxBytes，且不会把代理对（emoji 等）拆到两块里。
 */
export function splitByUtf8Bytes(value: string, maxBytes: number = CHUNK_TARGET_BYTES): string[] {
  if (value.length === 0) return [""];
  const chunks: string[] = [];
  let start = 0;
  let bytes = 0;
  let i = 0;
  while (i < value.length) {
    const code = value.charCodeAt(i);
    let width: number;
    let units = 1;
    if (code < 0x80) {
      width = 1;
    } else if (code < 0x800) {
      width = 2;
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        width = 4;
        units = 2;
      } else {
        width = 3;
      }
    } else {
      width = 3;
    }

    if (bytes + width > maxBytes && i > start) {
      chunks.push(value.slice(start, i));
      start = i;
      bytes = 0;
    }
    bytes += width;
    i += units;
  }
  chunks.push(value.slice(start));
  return chunks;
}

function metaKey(name: string): string {
  return `${name}Meta`;
}

function chunkKey(name: string, gen: number, index: number): string {
  return `${name}@${gen}:${index}`;
}

function legacyIndexKey(name: string): string {
  return `${name}Index`;
}

function legacyChunkKey(name: string, index: number): string {
  return `${name}:${index}`;
}

function formatMarkerKey(name: string): string {
  return `${name}Format`;
}

type MetaReadResult = { status: "absent" } | { status: "invalid"; raw: unknown } | { status: "ok"; meta: StorageMeta };

/**
 * 区分三种情况：
 * - absent：从未以新格式保存过（可以回退读取旧格式）
 * - invalid：Meta 无法解析，或已迁移到新格式但 Meta 丢失（属于损坏）
 * - ok：正常
 */
function readMetaState(name: string): MetaReadResult {
  const raw = world.getDynamicProperty(metaKey(name));
  if (raw === undefined) {
    return world.getDynamicProperty(formatMarkerKey(name)) === undefined
      ? { status: "absent" }
      : { status: "invalid", raw };
  }
  if (typeof raw === "string") {
    try {
      const meta = JSON.parse(raw) as StorageMeta;
      if (
        meta &&
        meta.v === STORAGE_FORMAT_VERSION &&
        (meta.gen === 1 || meta.gen === 2) &&
        Number.isInteger(meta.count) &&
        meta.count > 0
      ) {
        return { status: "ok", meta };
      }
    } catch {
      // 落到 invalid
    }
  }
  return { status: "invalid", raw };
}

function readMeta(name: string): StorageMeta | undefined {
  const result = readMetaState(name);
  return result.status === "ok" ? result.meta : undefined;
}

export class Database<V = any> {
  static readonly databases = new Array<Database<any>>();
  private cache!: Record<string, V>;
  private isDirty = false; // 标记数据库是否被修改
  private dirtySinceMs?: number;
  private nextAutoSaveAttemptAtMs = 0;
  /** 本次启动时读取数据的结果，调用方可据此判断数据是否可信 */
  readonly loadState: DatabaseLoadState;

  public constructor(
    readonly name: string,
    private readonly defaultValue: string = "{}"
  ) {
    const loaded = Database.load(this.name, this.defaultValue);
    this.cache = loaded.data as Record<string, V>;
    this.loadState = loaded.state;
    // 修复/重置出的数据只存在内存里，不自动落盘：是否采用由调用方根据 loadState 决定
    // （原始数据已备份）。调用方之后的正常写入会照常保存。
    Database.databases.push(this);
  }

  /**
   * 设置键值
   * @remarks 不会立即保存，调用 .save() 或等待约 1 分钟后排队自动保存
   * @param property 键名
   * @param value 值
   */
  public set(property: string, value: V): void {
    this.cache[property] = value;
    this.markDirty();
  }

  /**
   * 获取键值
   * @param property 键名
   * @returns 该键对应的值（如果不存在则返回 undefined）
   */
  public get(property: string): V {
    return this.cache[property];
  }

  /**
   * 测试数据库是否包含某个键
   * @param property 键名
   * @returns 数据库是否包含该键
   */
  public has(property: string): boolean {
    return property in this.cache;
  }

  /**
   * 从数据库删除键
   * @remarks 不会立即保存，调用 .save() 或等待约 1 分钟后排队自动保存
   * @param property 要删除的键名
   * @returns 数据库是否原本包含该键
   */
  public delete(property: string): boolean {
    if (!(property in this.cache)) {
      return false;
    }

    const result = delete this.cache[property];
    if (result) {
      this.markDirty();
    }
    return result;
  }

  /**
   * 获取数据库中所有键的数组
   * @returns 所有键的数组
   */
  public keys(): string[] {
    return Object.keys(this.cache);
  }

  /**
   * 获取数据库中所有值的数组
   * @returns 所有值的数组
   */
  public values(): V[] {
    return Object.values(this.cache);
  }

  /**
   * 清空数据库中的所有值
   * @remarks 立即保存
   */
  public clear() {
    this.replaceAll({});
  }

  /**
   * 用新数据整体替换并立即保存。保存失败时恢复原缓存与 dirty 状态并抛出。
   */
  public replaceAll(data: Record<string, V>): void {
    const previousCache = this.cache;
    const previousDirty = this.isDirty;
    const previousDirtySinceMs = this.dirtySinceMs;
    this.cache = data;
    this.markDirty();
    try {
      this.save(true); // 强制保存
    } catch (error) {
      // 保存失败必须恢复原缓存，否则清空后的缓存会在下一次（自动）保存时被写出去。
      this.cache = previousCache;
      this.isDirty = previousDirty;
      this.dirtySinceMs = previousDirtySinceMs;
      throw error;
    }
  }

  /**
   * 获取包含所有键值对的对象
   * @remarks 所有更改都会保存
   * @returns 包含所有键值对的对象
   */
  public getAll(): Record<string, V> {
    return (this.cache ??= Database.getAll(this.name, this.defaultValue));
  }

  /**
   * 立即保存数据库
   * @param force 强制保存，即使数据库未被修改
   * @throws 写入失败时抛出；此时已持久化的旧数据保持不变，内存数据保持 dirty 等待重试
   */
  public save(force: boolean = false): void {
    // 如果数据库未被修改且不是强制保存，则跳过
    if (!force && !this.isDirty) {
      return;
    }

    const stringified = JSON.stringify(this.cache);
    try {
      Database.writeStorage(this.name, stringified);
    } catch (error) {
      console.error(`[Database] 保存数据库 "${this.name}" 时发生错误:`, error);
      throw error;
    }

    // 保存成功后，清除修改标记
    this.isDirty = false;
    this.dirtySinceMs = undefined;
    this.nextAutoSaveAttemptAtMs = 0;
  }

  private markDirty(): void {
    if (!this.isDirty) {
      this.dirtySinceMs = Date.now();
    }
    this.isDirty = true;
  }

  public static saveNextDirty(): void {
    const now = Date.now();
    let candidate: Database<any> | undefined;

    // 优先保存最早变脏的数据库。一次调度最多写一个库，避免多个大库的
    // JSON.stringify 和动态属性写入叠加在同一个游戏 tick 中。
    for (const database of this.databases) {
      if (
        !database.isDirty ||
        database.dirtySinceMs === undefined ||
        now - database.dirtySinceMs < AUTO_SAVE_DIRTY_AGE_MS ||
        now < database.nextAutoSaveAttemptAtMs
      ) {
        continue;
      }

      if (!candidate || database.dirtySinceMs < candidate.dirtySinceMs!) {
        candidate = database;
      }
    }

    if (!candidate) return;

    try {
      candidate.save();
    } catch (error) {
      // 保存失败时保留 dirty 状态，但延迟重试，避免坏库每轮反复阻塞主线程。
      candidate.nextAutoSaveAttemptAtMs = now + AUTO_SAVE_RETRY_DELAY_MS;
      console.error(`[Database] 自动保存数据库 "${candidate.name}" 失败:`, error);
    }
  }

  /**
   * 以“先写新一代分块、最后切换 Meta”的方式写入整库字符串。
   * - Meta 写入之前的任何失败都会直接抛出，Meta 不变，旧数据完整保留；
   * - Meta 写入成功即视为提交，之后的步骤（迁移标记、清理旧分块）都是尽力而为，
   *   失败只记日志、绝不抛出，避免调用方把“已提交”误当成“失败”去回滚。
   */
  private static writeStorage(name: string, stringified: string): void {
    const chunks = splitByUtf8Bytes(stringified, CHUNK_TARGET_BYTES);
    const previous = readMeta(name);
    const nextGen = previous?.gen === 1 ? 2 : 1;

    // 第一步：写入新一代的全部分块（不影响当前代）
    for (let i = 0; i < chunks.length; i++) {
      world.setDynamicProperty(chunkKey(name, nextGen, i), chunks[i]);
    }

    // 第二步：切换 Meta（提交点），并标记该库已迁移到新格式
    world.setDynamicProperty(
      metaKey(name),
      JSON.stringify({ v: STORAGE_FORMAT_VERSION, gen: nextGen, count: chunks.length } satisfies StorageMeta)
    );

    // 以下均为提交后的善后步骤，不得抛出。
    // 迁移标记：用于识别“已迁移但 Meta 丢失”。写入失败时下次保存会重试；
    // 只有标记一直写不进去且 Meta 又恰好丢失这种双重故障，才会回退读取旧格式。
    try {
      if (world.getDynamicProperty(formatMarkerKey(name)) !== STORAGE_FORMAT_VERSION) {
        world.setDynamicProperty(formatMarkerKey(name), STORAGE_FORMAT_VERSION);
      }
    } catch (error) {
      console.warn(`[Database] 数据库 "${name}" 已提交，但写入迁移标记失败（下次保存重试）:`, error);
    }

    // 第三步：清理上一代分块，失败不影响已提交的数据
    if (previous) {
      for (let i = 0; i < previous.count; i++) {
        try {
          world.setDynamicProperty(chunkKey(name, previous.gen, i), undefined);
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * 读取当前持久化的分块数量（新格式取 Meta.count，旧格式取 Index）。
   */
  public static getStoredChunkCount(name: string): number {
    const metaState = readMetaState(name);
    if (metaState.status === "ok") return metaState.meta.count;
    if (metaState.status === "invalid") return 0;
    const legacy = Number(world.getDynamicProperty(legacyIndexKey(name)));
    return Number.isFinite(legacy) && legacy > 0 ? legacy : 0;
  }

  /**
   * 直接用给定 JSON 覆盖某个库的持久化数据（不经过实例缓存）。
   * 返回需要清理的旧分块 key，调用方可分批删除，避免单 tick 删除过多。
   */
  public static resetStorage(name: string, stringified: string): string[] {
    const legacyCount = Number(world.getDynamicProperty(legacyIndexKey(name)));
    Database.writeStorage(name, stringified);

    const staleKeys: string[] = [];
    if (Number.isFinite(legacyCount) && legacyCount > 0) {
      for (let i = 0; i < legacyCount; i++) staleKeys.push(legacyChunkKey(name, i));
      staleKeys.push(legacyIndexKey(name));
    }
    return staleKeys;
  }

  protected static getAll(name: string, defaultValue: string): Record<string, any> {
    return Database.load(name, defaultValue).data;
  }

  private static parseDefault(name: string, defaultValue: string): Record<string, any> {
    try {
      return JSON.parse(defaultValue);
    } catch {
      console.warn(`[Database] 数据库 "${name}" 默认值无效，使用空对象`);
      return {};
    }
  }

  /**
   * 读取数据库。读取过程不写入任何数据，损坏时只做备份并返回修复/默认数据，
   * 由调用方根据 loadState 决定是否继续写入。
   */
  private static load(name: string, defaultValue: string): LoadResult {
    let stringified = "";
    let expectedChunks = 0;
    const missingChunks: number[] = [];

    const metaState = readMetaState(name);
    if (metaState.status === "invalid") {
      console.error(`[Database] 数据库 "${name}" 的 Meta 损坏或丢失，不会回退读取旧格式数据`);
      this.backupInvalidMeta(name, metaState.raw);
      return { data: Database.parseDefault(name, defaultValue), state: "reset" };
    }

    if (metaState.status === "ok") {
      const meta = metaState.meta;
      expectedChunks = meta.count;
      for (let i = 0; i < meta.count; i++) {
        const value = world.getDynamicProperty(chunkKey(name, meta.gen, i));
        if (typeof value === "string") {
          stringified += value;
        } else {
          missingChunks.push(i);
        }
      }
    } else {
      const index = Number(world.getDynamicProperty(legacyIndexKey(name)));
      if (!Number.isFinite(index) || index <= 0) {
        return { data: Database.parseDefault(name, defaultValue), state: "fresh" };
      }
      expectedChunks = index;
      for (let i = 0; i < index; i++) {
        const value = world.getDynamicProperty(legacyChunkKey(name, i));
        if (typeof value === "string" && value) {
          stringified += value;
        } else {
          missingChunks.push(i);
        }
      }
    }

    if (missingChunks.length > 0) {
      console.warn(`[Database] 数据库 "${name}" 缺少 ${missingChunks.length} 个数据块: [${missingChunks.join(", ")}]`);
    }

    if (!stringified) {
      if (missingChunks.length > 0) {
        return { data: Database.parseDefault(name, defaultValue), state: "reset" };
      }
      return { data: Database.parseDefault(name, defaultValue), state: "fresh" };
    }

    if (missingChunks.length === 0) {
      try {
        return { data: JSON.parse(stringified), state: "ok" };
      } catch (error) {
        console.error(`[Database] 无法解析数据库 "${name}" 的数据:`, error);
      }
    }

    // 数据损坏：先备份原始数据，再尝试修复；整个过程不覆盖原有分块。
    console.error(`[Database] 数据长度: ${stringified.length}, 期望块数: ${expectedChunks}`);
    console.error(`[Database] 损坏的数据预览: ${stringified.substring(0, 500)}...`);
    console.error(`[Database] 数据末尾预览: ...${stringified.substring(Math.max(0, stringified.length - 200))}`);
    this.backupCorruptedData(name, expectedChunks, stringified);

    const repaired = this.tryRepairJson(stringified);
    if (repaired !== null) {
      console.warn(`[Database] 已修复数据库 "${name}" 的部分数据，将在下次保存时写入（原始数据已备份）`);
      return { data: repaired, state: "repaired" };
    }

    console.warn(`[Database] 数据库 "${name}" 数据已损坏且无法修复，暂用默认值（原始数据已备份）`);
    return { data: Database.parseDefault(name, defaultValue), state: "reset" };
  }

  /**
   * Meta 损坏时无法确定哪一代是当前数据，把两代分块都原样备份，供人工恢复。
   */
  private static backupInvalidMeta(name: string, rawMeta: unknown): void {
    for (const gen of [1, 2]) {
      let joined = "";
      for (let i = 0; ; i++) {
        const value = world.getDynamicProperty(chunkKey(name, gen, i));
        if (typeof value !== "string") break;
        joined += value;
      }
      if (joined) this.backupCorruptedData(`${name}@${gen}`, 0, joined);
    }
    try {
      world.setDynamicProperty(`${name}:corruptMeta:${Date.now()}`, JSON.stringify({ rawMeta: String(rawMeta) }));
    } catch {
      // ignore
    }
  }

  private static backupCorruptedData(name: string, originalIndex: number, corruptedJson: string): void {
    const timestamp = Date.now();
    const backupPrefix = `${name}:corruptBackup:${timestamp}`;
    const chunks = splitByUtf8Bytes(corruptedJson, CHUNK_TARGET_BYTES);

    try {
      for (let i = 0; i < chunks.length; i++) {
        world.setDynamicProperty(`${backupPrefix}:${i}`, chunks[i]);
      }
      world.setDynamicProperty(
        `${backupPrefix}:meta`,
        JSON.stringify({ name, originalIndex, backupIndex: chunks.length, timestamp })
      );
      console.warn(`[Database] 已备份数据库 "${name}" 的损坏原始数据到 ${backupPrefix}`);
    } catch (backupError) {
      console.error(`[Database] 备份数据库 "${name}" 的损坏数据失败:`, backupError);
    }
  }

  /**
   * 尝试修复损坏的 JSON 数据
   * @param corruptedJson 损坏的 JSON 字符串
   * @returns 修复后的对象，如果无法修复则返回 null
   */
  private static tryRepairJson(corruptedJson: string): Record<string, any> | null {
    try {
      // 尝试找到最后一个完整的 JSON 对象
      // 对于数组数据，尝试找到最后一个完整的数组项

      // 如果数据以 {"transactions":[... 开头，尝试修复数组
      if (corruptedJson.includes('"transactions"') && corruptedJson.includes("[")) {
        const transactionsStart = corruptedJson.indexOf('"transactions":[');
        if (transactionsStart !== -1) {
          const arrayStart = corruptedJson.indexOf("[", transactionsStart) + 1;
          let braceCount = 0;
          let bracketCount = 1; // 已经找到了开头的 [
          let lastValidIndex = arrayStart;
          let inString = false;
          let escapeNext = false;

          // 从数组开始位置查找最后一个完整的对象
          for (let i = arrayStart; i < corruptedJson.length; i++) {
            const char = corruptedJson[i];

            // 处理字符串内的字符
            if (escapeNext) {
              escapeNext = false;
              continue;
            }
            if (char === "\\") {
              escapeNext = true;
              continue;
            }
            if (char === '"') {
              inString = !inString;
              continue;
            }
            if (inString) continue;

            // 处理 JSON 结构
            if (char === "{") {
              braceCount++;
            } else if (char === "}") {
              braceCount--;
              if (braceCount === 0 && bracketCount === 1) {
                // 找到了一个完整的对象
                lastValidIndex = i + 1;
              }
            } else if (char === "[") {
              bracketCount++;
            } else if (char === "]") {
              bracketCount--;
              if (bracketCount === 0) {
                // 数组结束，但可能不完整
                break;
              }
            }
          }

          // 尝试构建完整的 JSON
          if (lastValidIndex > arrayStart) {
            const validPart = corruptedJson.substring(0, lastValidIndex);
            // 移除末尾可能的逗号
            const cleanedPart = validPart.replace(/,\s*$/, "");
            const repairedJson = cleanedPart + "]}";

            try {
              const parsed = JSON.parse(repairedJson);
              // 确保返回的数据结构正确
              if (parsed && typeof parsed === "object" && "transactions" in parsed) {
                return parsed;
              }
            } catch {
              // 修复失败，继续尝试其他方法
            }
          }
        }
      }

      // 通用修复：尝试找到最后一个完整的对象
      let lastBrace = -1;
      let braceCount = 0;
      for (let i = 0; i < corruptedJson.length; i++) {
        if (corruptedJson[i] === "{") {
          braceCount++;
        } else if (corruptedJson[i] === "}") {
          braceCount--;
          if (braceCount === 0) {
            lastBrace = i;
          }
        }
      }

      if (lastBrace > 0) {
        const repairedJson = corruptedJson.substring(0, lastBrace + 1);
        try {
          return JSON.parse(repairedJson);
        } catch {
          // 修复失败
        }
      }

      return null;
    } catch {
      return null;
    }
  }
}

import { taskScheduler } from "../../features/platform/scheduler";

// 每 5 秒检查一次队列；每个库的修改至少合并 1 分钟，且每轮只保存一个库。
taskScheduler.register({
  id: "database.autoSave",
  label: "数据库自动保存",
  category: "core",
  intervalTicks: AUTO_SAVE_INTERVAL_TICKS,
  skipIfRunning: true,
  // 仍以半个 tick（25ms）作为慢写入标准；慢任务会由调度器额外退避一轮。
  slowThresholdRatio: 0.005,
  run: () => {
    Database.saveNextDirty();
  },
});
