/**
 * 全服玩家统计：怪物击杀、累计死亡、等级快照（持久化，排行榜含离线玩家）
 */

import { Player, system, world } from "@minecraft/server";
import { Database } from "../../../shared/database/database";

const DATABASE_NAME = "player_stats";

export interface PlayerStatRecord {
  mobKills: number;
  totalDeaths: number;
  /** 历史最高等级快照（避免等级回退写入） */
  level: number;
  xpAtCurrentLevel: number;
}

function findOnlinePlayerByName(name: string): Player | undefined {
  return world.getPlayers().find((p) => p.name === name);
}

function emptyRecord(): PlayerStatRecord {
  return {
    mobKills: 0,
    totalDeaths: 0,
    level: 0,
    xpAtCurrentLevel: 0,
  };
}

function lexLevel(a: { level: number; xpAtCurrentLevel: number }, b: { level: number; xpAtCurrentLevel: number }): number {
  if (a.level !== b.level) return a.level - b.level;
  return a.xpAtCurrentLevel - b.xpAtCurrentLevel;
}

class PlayerStatsService {
  private db?: Database<PlayerStatRecord>;

  constructor() {
    system.run(() => {
      this.db = new Database<PlayerStatRecord>(DATABASE_NAME);
    });
  }

  private ensureDb(): Database<PlayerStatRecord> | undefined {
    return this.db;
  }

  private getRecord(name: string): PlayerStatRecord {
    const db = this.ensureDb();
    if (!db) return emptyRecord();
    const r = db.get(name);
    if (!r) return emptyRecord();
    return {
      mobKills: Math.max(0, Math.floor(Number(r.mobKills) || 0)),
      totalDeaths: Math.max(0, Math.floor(Number(r.totalDeaths) || 0)),
      level: Math.max(0, Math.floor(Number(r.level) || 0)),
      xpAtCurrentLevel: Math.max(0, Math.floor(Number(r.xpAtCurrentLevel) || 0)),
    };
  }

  private setRecord(name: string, rec: PlayerStatRecord): void {
    const db = this.ensureDb();
    if (!db) return;
    db.set(name, rec);
  }

  incrementMobKill(playerName: string): void {
    const cur = this.getRecord(playerName);
    cur.mobKills += 1;
    this.setRecord(playerName, cur);
  }

  incrementTotalDeath(playerName: string): void {
    const cur = this.getRecord(playerName);
    cur.totalDeaths += 1;
    this.setRecord(playerName, cur);
  }

  /**
   * 仅当 (level,xp) 不低于已存快照时更新，避免死亡掉级等导致回退
   */
  refreshLevelSnapshot(player: Player): void {
    const name = player.name;
    const curLv = Math.max(0, Math.floor(player.level));
    const curXp = Math.max(0, Math.floor(player.xpEarnedAtCurrentLevel));
    const old = this.getRecord(name);
    const next = { level: curLv, xpAtCurrentLevel: curXp };
    const oldT = { level: old.level, xpAtCurrentLevel: old.xpAtCurrentLevel };
    if (lexLevel(next, oldT) > 0) {
      old.level = curLv;
      old.xpAtCurrentLevel = curXp;
      this.setRecord(name, old);
    }
  }

  getDisplayLevelByName(name: string): { level: number; xpAtCurrentLevel: number } {
    const p = findOnlinePlayerByName(name);
    if (p) {
      return {
        level: Math.max(0, Math.floor(p.level)),
        xpAtCurrentLevel: Math.max(0, Math.floor(p.xpEarnedAtCurrentLevel)),
      };
    }
    const r = this.getRecord(name);
    return { level: r.level, xpAtCurrentLevel: r.xpAtCurrentLevel };
  }

  /** 排行用：在线取实时与库内较高者（按字典序） */
  private displayLevelForRank(name: string): { level: number; xpAtCurrentLevel: number } {
    const fromDb = this.getRecord(name);
    const p = findOnlinePlayerByName(name);
    if (!p) {
      return { level: fromDb.level, xpAtCurrentLevel: fromDb.xpAtCurrentLevel };
    }
    const live = {
      level: Math.max(0, Math.floor(p.level)),
      xpAtCurrentLevel: Math.max(0, Math.floor(p.xpEarnedAtCurrentLevel)),
    };
    if (lexLevel(live, { level: fromDb.level, xpAtCurrentLevel: fromDb.xpAtCurrentLevel }) > 0) {
      return live;
    }
    return { level: fromDb.level, xpAtCurrentLevel: fromDb.xpAtCurrentLevel };
  }

  getLeaderboard(
    kind: "mobKills" | "totalDeaths" | "level",
    limit: number
): Array<{ name: string; value: number; subValue?: number }> {
    const lim = Math.max(1, Math.min(100, Math.floor(limit)));
    const db = this.ensureDb();
    if (!db) return [];

    const names = new Set<string>(Object.keys(db.getAll() as Record<string, PlayerStatRecord>));
    if (kind === "level") {
      for (const p of world.getAllPlayers()) {
        names.add(p.name);
      }
    }

    const rows: Array<{ name: string; value: number; subValue?: number }> = [];
    for (const name of names) {
      if (!name) continue;
      if (kind === "mobKills") {
        const r = this.getRecord(name);
        rows.push({ name, value: r.mobKills });
      } else if (kind === "totalDeaths") {
        const r = this.getRecord(name);
        rows.push({ name, value: r.totalDeaths });
      } else {
        const lv = this.displayLevelForRank(name);
        rows.push({ name, value: lv.level, subValue: lv.xpAtCurrentLevel });
      }
    }

    if (kind === "level") {
      rows.sort((a, b) => {
        if (b.value !== a.value) return b.value - a.value;
        return (b.subValue ?? 0) - (a.subValue ?? 0);
      });
    } else {
      rows.sort((a, b) => b.value - a.value);
    }

    return rows.slice(0, lim);
  }

  getPlayerRank(kind: "mobKills" | "totalDeaths" | "level", playerName: string): number {
    const full = this.getLeaderboard(kind, 10000);
    const idx = full.findIndex((r) => r.name === playerName);
    return idx === -1 ? -1 : idx + 1;
  }

  getMobKills(name: string): number {
    return this.getRecord(name).mobKills;
  }

  getTotalDeaths(name: string): number {
    return this.getRecord(name).totalDeaths;
  }

  refreshAllOnlineLevels(): void {
    for (const p of world.getAllPlayers()) {
      try {
        this.refreshLevelSnapshot(p);
      } catch (_) {}
    }
  }
}

const playerStatsService = new PlayerStatsService();
export default playerStatsService;
