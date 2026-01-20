/**
 * PVP管理器
 * 处理PVP核心逻辑
 */

import { Player, system } from "@minecraft/server";
import { Database } from "../../../shared/database/database";
import type { IPvpPlayerData, IPvpConfig } from "../models/pvp-data";
import { isAdmin } from "../../../shared/utils/common";
import landManager from "../../land/services/land-manager";
import setting from "../../system/services/setting";

class PvpManager {
  private playerDataDb!: Database<IPvpPlayerData>;
  private combatPlayers = new Map<string, number>();

  constructor() {
    system.run(() => {
      this.playerDataDb = new Database<IPvpPlayerData>("pvp_players");
    });
  }

  /**
   * 获取PVP全局配置
   */
  getConfig(): IPvpConfig {
    return {
      enabled: setting.getState("pvpEnabled") as boolean,
      seizeAmount: Number(setting.getState("pvpSeizeAmount")) || 100,
      minGoldProtection: Number(setting.getState("pvpMinProtection")) || 100,
      toggleCooldown: Number(setting.getState("pvpToggleCooldown")) || 30,
      combatTagDuration: Number(setting.getState("pvpCombatTagDuration")) || 10,
    };
  }

  /**
   * 更新PVP配置
   */
  updateConfig(config: Partial<IPvpConfig>): void {
    if (config.enabled !== undefined) {
      setting.setState("pvpEnabled", config.enabled);
    }
    if (config.seizeAmount !== undefined) {
      setting.setState("pvpSeizeAmount", config.seizeAmount.toString());
    }
    if (config.minGoldProtection !== undefined) {
      setting.setState("pvpMinProtection", config.minGoldProtection.toString());
    }
    if (config.toggleCooldown !== undefined) {
      setting.setState("pvpToggleCooldown", config.toggleCooldown.toString());
    }
    if (config.combatTagDuration !== undefined) {
      setting.setState("pvpCombatTagDuration", config.combatTagDuration.toString());
    }
  }

  /**
   * 获取玩家PVP数据
   */
  getPlayerData(playerName: string): IPvpPlayerData {
    let data = this.playerDataDb.get(playerName);
    if (!data) {
      data = this.initPlayerData();
      this.playerDataDb.set(playerName, data);
    }
    return data;
  }

  /**
   * 获取所有玩家PVP数据
   */
  getAllPlayerData(): Record<string, IPvpPlayerData> {
    return this.playerDataDb.getAll();
  }

  /**
   * 保存玩家PVP数据
   */
  savePlayerData(playerName: string, data: IPvpPlayerData): void {
    this.playerDataDb.set(playerName, data);
  }

  /**
   * 初始化玩家PVP数据
   */
  private initPlayerData(): IPvpPlayerData {
    return {
      pvpEnabled: false,
      lastToggleTime: 0,
      inCombat: false,
      lastCombatTime: 0,
      kills: 0,
      deaths: 0,
      killStreak: 0,
      bestKillStreak: 0,
      totalSeized: 0,
      totalLost: 0,
    };
  }

  /**
   * 检查是否可以PVP
   */
  canPvp(attacker: Player, victim: Player): boolean {
    // 1. 检查全局开关
    const config = this.getConfig();
    if (!config.enabled) {
      return false;
    }

    // 2. 管理员可以攻击任何人
    if (isAdmin(attacker)) {
      return true;
    }

    // 3. 检查双方PVP状态
    const attackerData = this.getPlayerData(attacker.name);
    const victimData = this.getPlayerData(victim.name);
    if (!attackerData.pvpEnabled || !victimData.pvpEnabled) {
      return false;
    }

    // 4. 检查领地保护
    const { isInside } = landManager.testLand(victim.location, victim.dimension.id);
    if (isInside) {
      return false;
    }

    return true;
  }

  /**
   * 切换PVP状态
   */
  togglePvp(player: Player): { success: boolean; message: string } {
    const data = this.getPlayerData(player.name);
    const config = this.getConfig();
    const now = Date.now();

    // 检查冷却
    const cooldownRemaining = config.toggleCooldown * 1000 - (now - data.lastToggleTime);
    if (cooldownRemaining > 0) {
      const remaining = Math.ceil(cooldownRemaining / 1000);
      return {
        success: false,
        message: `冷却中，还需等待 ${remaining} 秒`,
      };
    }

    // 检查战斗状态
    if (data.inCombat) {
      return {
        success: false,
        message: "战斗中无法切换PVP状态",
      };
    }

    // 切换状态
    data.pvpEnabled = !data.pvpEnabled;
    data.lastToggleTime = now;
    this.playerDataDb.set(player.name, data);

    return {
      success: true,
      message: `PVP已${data.pvpEnabled ? "开启" : "关闭"}`,
    };
  }

  /**
   * 进入战斗状态
   */
  enterCombat(attacker: Player, victim: Player): void {
    const now = Date.now();
    const attackerData = this.getPlayerData(attacker.name);
    const victimData = this.getPlayerData(victim.name);

    attackerData.inCombat = true;
    attackerData.lastCombatTime = now;
    victimData.inCombat = true;
    victimData.lastCombatTime = now;

    this.playerDataDb.set(attacker.name, attackerData);
    this.playerDataDb.set(victim.name, victimData);

    this.combatPlayers.set(attacker.name, now);
    this.combatPlayers.set(victim.name, now);
  }

  /**
   * 检查战斗超时
   */
  checkCombatTimeout(): void {
    const now = Date.now();
    const config = this.getConfig();
    const timeoutMs = config.combatTagDuration * 1000;

    this.combatPlayers.forEach((lastTime, playerName) => {
      if (now - lastTime > timeoutMs) {
        const data = this.getPlayerData(playerName);
        data.inCombat = false;
        this.playerDataDb.set(playerName, data);
        this.combatPlayers.delete(playerName);
      }
    });
  }
}

export default new PvpManager();

