/**
 * 订阅物品获得时的背包/装备快照（独立持久化，避免行为日志 m/v 80 字截断）
 * Database 在 system.run 中初始化，避免 early execution 调用 getDynamicProperty。
 */

import { system } from "@minecraft/server";
import { Database } from "../../../shared/database/database";
import setting from "../../system/services/setting";

/** 背包槽位上的物品行（含 slotIndex）；可递归带潜影盒/收纳袋内容 */
export type ItemWatchNestedSlot = ItemWatchSlotLine & { slotIndex: number };

/**
 * 单件物品快照行；若有 `minecraft:inventory`（潜影盒、收纳袋等）则带 `contents`。
 */
export interface ItemWatchSlotLine {
  typeId: string;
  amount: number;
  localizationKey: string;
  contents?: ItemWatchNestedSlot[];
  /** 达到深度/条数上限，子容器未完全序列化 */
  contentsTruncated?: boolean;
}

export interface ItemWatchSnapshotPayload {
  t: number;
  playerName: string;
  acquiredTypeId: string;
  /** 触发监控的物品 localizationKey，用于表单里 translate 显示客户端语言名称 */
  acquiredLocalizationKey?: string;
  equipment: Array<{ label: string; slot: ItemWatchSlotLine | null }>;
  /** 非空槽位，含 slotIndex；子容器见 contents */
  slots: ItemWatchNestedSlot[];
}

interface SnapshotState {
  v: 1;
  entries: Record<string, { t: number; data: ItemWatchSnapshotPayload }>;
}

const DATABASE_NAME = "itemWatchSnapshots";
const STORE_KEY = "state";
const DEFAULT_MAX = 20000;

function generateId(): string {
  return `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

function getMaxSnapshots(): number {
  const raw = Number(setting.getState("behaviorLogMaxEntries" as never));
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_MAX;
  return Math.min(Math.floor(raw), 200000);
}

class ItemWatchSnapshotStore {
  private db?: Database<SnapshotState>;
  /** db 未就绪时待落盘的写入 */
  private pendingSave: Array<{ id: string; data: ItemWatchSnapshotPayload }> = [];
  /** 与 pending 及已落盘项统一供 get 在首帧前可读 */
  private readonly memoryCache = new Map<string, ItemWatchSnapshotPayload>();

  constructor() {
    system.run(() => {
      this.db = new Database<SnapshotState>(DATABASE_NAME);
      this.ensureState();
      if (this.pendingSave.length > 0) {
        const state = this.getState();
        for (const { id, data } of this.pendingSave) {
          state.entries[id] = { t: data.t, data };
        }
        this.pendingSave.length = 0;
        this.trim(state);
        this.saveState(state);
      }
    });
  }

  private ensureState(): void {
    if (!this.db) return;
    if (!this.db.get(STORE_KEY)) {
      this.db.set(STORE_KEY, { v: 1, entries: {} });
    }
  }

  private getState(): SnapshotState {
    this.ensureState();
    const raw = this.db?.get(STORE_KEY);
    if (!raw || raw.v !== 1 || typeof raw.entries !== "object") {
      return { v: 1, entries: {} };
    }
    return { v: 1, entries: { ...raw.entries } };
  }

  private saveState(state: SnapshotState): void {
    if (!this.db) return;
    this.db.set(STORE_KEY, state);
  }

  /**
   * 写入快照，返回 sid（写入行为日志 m 字段）
   */
  save(data: ItemWatchSnapshotPayload): string {
    const id = generateId();
    this.memoryCache.set(id, data);

    if (!this.db) {
      this.pendingSave.push({ id, data });
      return id;
    }

    const state = this.getState();
    state.entries[id] = { t: data.t, data };
    this.trim(state);
    this.saveState(state);
    return id;
  }

  get(id: string): ItemWatchSnapshotPayload | undefined {
    const mem = this.memoryCache.get(id);
    if (mem) return mem;
    if (!this.db) return undefined;
    return this.getState().entries[id]?.data;
  }

  private trim(state: SnapshotState): void {
    const max = getMaxSnapshots();
    const keys = Object.keys(state.entries);
    if (keys.length <= max) return;

    const sorted = keys
      .map((k) => ({ k, t: state.entries[k]?.t ?? 0 }))
      .sort((a, b) => a.t - b.t);
    const remove = sorted.length - max;
    for (let i = 0; i < remove; i++) {
      const k = sorted[i].k;
      delete state.entries[k];
      this.memoryCache.delete(k);
    }
  }

  /** 删除指定快照（可选维护用） */
  delete(id: string): void {
    this.memoryCache.delete(id);
    this.pendingSave = this.pendingSave.filter((p) => p.id !== id);
    if (!this.db) return;
    const state = this.getState();
    delete state.entries[id];
    this.saveState(state);
  }
}

const itemWatchSnapshotStore = new ItemWatchSnapshotStore();

export default itemWatchSnapshotStore;
