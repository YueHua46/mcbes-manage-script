/**
 * PVP管理器
 * 处理PVP核心逻辑
 */

import { Player, system } from "@minecraft/server";
import { Database } from "../../../shared/database/database";
import type { IPvpPlayerData, IPvpConfig, PvpMode } from "../models/pvp-data";
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
    const mode = this.getMode();
    return {
      mode,
      enabled: mode === "plugin",
      seizeAmount: Number(setting.getState("pvpSeizeAmount")) || 100,
      minGoldProtection: Number(setting.getState("pvpMinProtection")) || 100,
      toggleCooldown: Number(setting.getState("pvpToggleCooldown")) || 30,
      combatTagDuration: Number(setting.getState("pvpCombatTagDuration")) || 10,
    };
  }

  getMode(): PvpMode {
    const rawMode = setting.getState("pvpMode");
    if (rawMode === "vanilla" || rawMode === "plugin" || rawMode === "off") {
      return rawMode;
    }

    // 兼容旧存档：历史上仅有 pvpEnabled 布尔开关
    return setting.getState("pvpEnabled") === true ? "plugin" : "off";
  }

  getModeDisplay(mode: PvpMode): string {
    switch (mode) {
      case "vanilla":
        return "原版模式";
      case "plugin":
        return "插件模式";
      case "off":
      default:
        return "禁止模式";
    }
  }

  getModeDescription(mode: PvpMode): string {
    switch (mode) {
      case "vanilla":
        return "是否可互相伤害完全由原版世界/存档的玩家互相伤害设置决定，插件不接管PVP规则。";
      case "plugin":
        return "由插件接管PVP，按全局开关、双方个人PVP状态、领地限制、战斗状态和夺金规则执行。";
      case "off":
      default:
        return "插件会强制禁止玩家之间互相伤害，不受原版世界PVP设置影响。";
    }
  }

  /**
   * 更新PVP配置
   */
  updateConfig(config: Partial<IPvpConfig>): void {
    if (config.mode !== undefined) {
      setting.setState("pvpMode", config.mode);
      // 兼容旧逻辑：仅插件模式视为旧版的“启用PVP功能”
      setting.setState("pvpEnabled", config.mode === "plugin");
    }
    if (config.enabled !== undefined) {
      const nextMode = config.enabled ? "plugin" : "off";
      setting.setState("pvpMode", nextMode);
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
    if (config.mode !== "plugin") {
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
    if (config.mode !== "plugin") {
      return {
        success: false,
        message: `当前为${this.getModeDisplay(config.mode)}，个人PVP开关不生效`,
      };
    }
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

