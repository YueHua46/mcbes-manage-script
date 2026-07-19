/**
 * PVP统计管理器
 * 处理击杀/死亡/夺取统计和排行榜
 */

import { Player, system } from "@minecraft/server";
import { Database } from "../../../shared/database/database";
import type { IPvpKillLog } from "../models/pvp-data";
import pvpManager from "./pvp-manager";
import { isKnownRealPlayerName } from "../../../shared/utils/online-players";
import economic from "../../economic/services/economic";
import { color } from "../../../shared/utils/color";
import { useNotify } from "../../../shared/hooks";

class PvpStatsManager {
  private killLogDb!: Database<IPvpKillLog>;

  constructor() {
    system.run(() => {
      this.killLogDb = new Database<IPvpKillLog>("pvp_kill_logs");
    });
  }

  /**
   * 处理击杀
   */
  handleKill(killer: Player, victim: Player): void {
    const killerData = pvpManager.getPlayerData(killer.name);
    const victimData = pvpManager.getPlayerData(victim.name);
    const config = pvpManager.getConfig();

    // 更新击杀统计
    killerData.kills++;
    killerData.killStreak++;
    if (killerData.killStreak > killerData.bestKillStreak) {
      killerData.bestKillStreak = killerData.killStreak;
    }

    // 更新死亡统计
    victimData.deaths++;
    victimData.killStreak = 0;

    // 清除战斗状态
    killerData.inCombat = false;
    victimData.inCombat = false;

    // 处理金币夺取（固定金额）
    const victimWallet = economic.getWallet(victim.name);
    const availableGold = Math.max(0, victimWallet.gold - config.minGoldProtection);
    const seizeAmount = Math.min(config.seizeAmount, availableGold);

    let actualSeized = 0;
    if (seizeAmount > 0 && economic.isEconomyEnabled()) {
      const transferred = economic.transfer(victim.name, killer.name, seizeAmount, "PVP击杀夺取");
      actualSeized = transferred === true ? seizeAmount : 0;

      killerData.totalSeized += actualSeized;
      victimData.totalLost += actualSeized;
    }

    // 保存数据
    pvpManager.savePlayerData(killer.name, killerData);
    pvpManager.savePlayerData(victim.name, victimData);

    // 记录日志
    this.logKill(killer, victim, actualSeized, killerData.killStreak);

    // 发送通知
    this.sendKillNotification(killer, victim, actualSeized, killerData.killStreak);
  }

  /**
   * 记录击杀日志
   */
  private logKill(killer: Player, victim: Player, seizeAmount: number, killStreak: number): void {
    const log: IPvpKillLog = {
      killer: killer.name,
      victim: victim.name,
      seizeAmount,
      killStreak,
      timestamp: Date.now(),
      location: victim.location,
      dimension: victim.dimension.id,
    };

    // 使用时间戳作为key，确保唯一性
    const logKey = `${killer.name}_${Date.now()}`;
    this.killLogDb.set(logKey, log);

    // 只保留最近1000条日志
    const allLogs = this.killLogDb.getAll();
    const logKeys = Object.keys(allLogs);
    if (logKeys.length > 1000) {
      // 按时间戳排序，删除最旧的
      const sortedKeys = logKeys.sort((a, b) => {
        const logA = allLogs[a];
        const logB = allLogs[b];
        return logA.timestamp - logB.timestamp;
      });

      // 删除最旧的日志
      const toDelete = sortedKeys.slice(0, logKeys.length - 1000);
      toDelete.forEach((key) => this.killLogDb.delete(key));
    }
  }

  /**
   * 发送击杀通知
   */
  private sendKillNotification(
    killer: Player,
    victim: Player,
    seizeAmount: number,
    killStreak: number
  ): void {
    const economyEnabled = economic.isEconomyEnabled();
    // 击杀者通知
    const killerMessage = economyEnabled
      ? `${color.green("[PVP]")} ${color.yellow("你击杀了")} ${color.red(victim.name)}${color.yellow("！")}\n${color.gold("夺取金币：")}${color.yellow(seizeAmount.toString())} ${color.gold("连杀数：")}${color.aqua(killStreak.toString())}`
      : `${color.green("[PVP]")} ${color.yellow("你击杀了")} ${color.red(victim.name)}${color.yellow("！")}\n${color.gold("连杀数：")}${color.aqua(killStreak.toString())}`;
    useNotify("chat", killer, killerMessage);

    // 被击杀者通知
    const victimMessage = economyEnabled
      ? (() => {
          const victimWallet = economic.getWallet(victim.name);
          return `${color.red("[PVP]")} ${color.yellow("你被")} ${color.green(killer.name)} ${color.yellow("击杀了！")}\n${color.gold("被夺取：")}${color.red(seizeAmount.toString())} ${color.gold("剩余金币：")}${color.yellow(victimWallet.gold.toString())}`;
        })()
      : `${color.red("[PVP]")} ${color.yellow("你被")} ${color.green(killer.name)} ${color.yellow("击杀了！")}`;
    useNotify("chat", victim, victimMessage);

    // 连杀广播（3连杀以上）
    if (killStreak >= 3) {
      const broadcastMessage = `${color.aqua("[PVP]")} ${color.green(killer.name)} ${color.yellow("已达成")} ${color.red(killStreak.toString())} ${color.yellow("连杀！")}`;
      useNotify("chat", killer, broadcastMessage);
      useNotify("chat", victim, broadcastMessage);
    }
  }

  /**
   * 获取排行榜
   */
  getLeaderboard(
    type: "kills" | "killStreak" | "seize",
    limit: number = 10
  ): Array<{ name: string; value: number }> {
    const allData = Object.fromEntries(
      Object.entries(pvpManager.getAllPlayerData()).filter(([name]) => isKnownRealPlayerName(name))
    );
    let sorted: Array<{ name: string; value: number }> = [];

    switch (type) {
      case "kills":
        sorted = Object.entries(allData)
          .map(([name, data]) => ({ name, value: data.kills }))
          .sort((a, b) => b.value - a.value);
        break;
      case "killStreak":
        sorted = Object.entries(allData)
          .map(([name, data]) => ({ name, value: data.bestKillStreak }))
          .sort((a, b) => b.value - a.value);
        break;
      case "seize":
        sorted = Object.entries(allData)
          .map(([name, data]) => ({ name, value: data.totalSeized }))
          .sort((a, b) => b.value - a.value);
        break;
    }

    const lim = Math.max(1, Math.min(100, Math.floor(limit)));
    return sorted.slice(0, lim);
  }

  /**
   * 获取玩家在排行榜中的排名
   */
  getPlayerRank(playerName: string, type: "kills" | "killStreak" | "seize"): number {
    const leaderboard = Object.entries(pvpManager.getAllPlayerData()).filter(([name]) => isKnownRealPlayerName(name));
    let sorted: Array<[string, number]> = [];

    switch (type) {
      case "kills":
        sorted = leaderboard
          .map(([name, data]) => [name, data.kills] as [string, number])
          .sort((a, b) => b[1] - a[1]);
        break;
      case "killStreak":
        sorted = leaderboard
          .map(([name, data]) => [name, data.bestKillStreak] as [string, number])
          .sort((a, b) => b[1] - a[1]);
        break;
      case "seize":
        sorted = leaderboard
          .map(([name, data]) => [name, data.totalSeized] as [string, number])
          .sort((a, b) => b[1] - a[1]);
        break;
    }

    const rank = sorted.findIndex(([name]) => name === playerName);
    return rank === -1 ? -1 : rank + 1;
  }
}

export default new PvpStatsManager();

