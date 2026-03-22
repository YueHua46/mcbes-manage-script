/**
 * 全服玩家累计在线时长（秒），每分钟落库 + 离线立即结算本会话。
 */

import { Player, system, world } from "@minecraft/server";
import { Database } from "../../../shared/database/database";

const DATABASE_NAME = "online_time";
const TICK_INTERVAL = 1200;

/** 展示用：天/小时/分钟 */
export function formatOnlineDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) {
    return `${d}天${h}小时${m}分钟`;
  }
  if (h > 0) {
    return `${h}小时${m}分钟`;
  }
  return `${m}分钟`;
}

export interface OnlineTimeRecord {
  totalSeconds: number;
}

const anchorMsByName = new Map<string, number>();

function findOnlinePlayerByName(name: string): Player | undefined {
  return world.getPlayers().find((p) => p.name === name);
}

class OnlineTimeService {
  private db?: Database<OnlineTimeRecord>;

  constructor() {
    system.run(() => {
      this.db = new Database<OnlineTimeRecord>(DATABASE_NAME);
    });
  }

  private ensureDb(): Database<OnlineTimeRecord> | undefined {
    return this.db;
  }

  getTotalSeconds(name: string): number {
    const db = this.ensureDb();
    if (!db) return 0;
    const r = db.get(name);
    const n = r?.totalSeconds;
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.floor(n as number));
  }

  /** 已持久化 + 当前在线且存在锚点时的未落库秒数 */
  getDisplayTotalSeconds(player: Player): number {
    const base = this.getTotalSeconds(player.name);
    const anchor = anchorMsByName.get(player.name);
    if (anchor === undefined) return base;
    const extra = Math.floor((Date.now() - anchor) / 1000);
    return base + Math.max(0, extra);
  }

  /** 用于排行榜行：在线用展示值，离线用库内值 */
  getDisplayTotalSecondsByName(name: string): number {
    const p = findOnlinePlayerByName(name);
    if (p) return this.getDisplayTotalSeconds(p);
    return this.getTotalSeconds(name);
  }

  private writeTotal(name: string, totalSeconds: number): void {
    const db = this.ensureDb();
    if (!db) return;
    db.set(name, { totalSeconds: Math.max(0, Math.floor(totalSeconds)) });
  }

  private addSeconds(name: string, seconds: number): void {
    if (seconds <= 0) return;
    const cur = this.getTotalSeconds(name);
    this.writeTotal(name, cur + seconds);
  }

  onPlayerSpawn(player: Player): void {
    if (!anchorMsByName.has(player.name)) {
      anchorMsByName.set(player.name, Date.now());
    }
  }

  onPlayerLeave(player: Player): void {
    const name = player.name;
    const anchor = anchorMsByName.get(name);
    if (anchor !== undefined) {
      const secs = Math.max(0, Math.floor((Date.now() - anchor) / 1000));
      if (secs > 0) this.addSeconds(name, secs);
    }
    anchorMsByName.delete(name);
  }

  onTick(): void {
    const db = this.ensureDb();
    if (!db) return;
    const now = Date.now();
    for (const player of world.getAllPlayers()) {
      const name = player.name;
      if (!anchorMsByName.has(name)) {
        anchorMsByName.set(name, now);
        continue;
      }
      const anchor = anchorMsByName.get(name)!;
      const secs = Math.max(0, Math.floor((now - anchor) / 1000));
      if (secs > 0) {
        this.addSeconds(name, secs);
        anchorMsByName.set(name, now);
      }
    }
  }

  getLeaderboard(limit: number): Array<{ name: string; totalSeconds: number }> {
    const db = this.ensureDb();
    if (!db) return [];
    const all = db.getAll() as Record<string, OnlineTimeRecord>;
    const rows = Object.entries(all)
      .map(([name]) => ({
        name,
        totalSeconds: this.getDisplayTotalSecondsByName(name),
      }))
      .filter((e) => e.name.length > 0)
      .sort((a, b) => b.totalSeconds - a.totalSeconds)
      .slice(0, Math.max(1, Math.min(limit, 100)));
    return rows;
  }
}

const onlineTimeService = new OnlineTimeService();
export default onlineTimeService;

export const ONLINE_TIME_TICK_INTERVAL = TICK_INTERVAL;
