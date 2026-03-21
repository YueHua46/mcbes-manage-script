/**
 * 系统设置服务
 * 完整迁移自 Modules/System/Setting.ts (120行)
 */

import { system } from "@minecraft/server";
import { SystemLog } from "../../../shared/utils/common";
import { Database } from "../../../shared/database/database";

// 导入试玩模式（自动注册事件）
import "./trial-mode";

export type IModules =
  | "player"
  | "land"
  | "wayPoint"
  | "economy"
  | "other"
  | "help"
  | "sm"
  | "setting"
  | "killItem"
  | "killItemAmount"
  | "randomTpRange"
  | "maxLandPerPlayer"
  | "maxLandBlocks"
  | "maxPrivatePointsPerPlayer"
  | "maxPublicPointsPerPlayer"
  | "playerNameColor"
  | "playerChatColor"
  | "trialMode"
  | "trialModeDuration"
  | "randomTeleport"
  | "backToDeath"
  | "enableTreeCutOneClick"
  | "enableDigOreOneClick"
  | "land1BlockPerPrice"
  | "daily_gold_limit"
  | "startingGold"
  | "monsterKillGoldReward"
  | "allowPlayerDisplaySettings"
  | "pvp"
  | "pvpEnabled"
  | "pvpSeizeAmount"
  | "pvpMinProtection"
  | "pvpToggleCooldown"
  | "pvpCombatTagDuration"
  | "serverName"
  | "welcomeMessage"
  | "blacklistEnabled"
  | "behaviorLogEnabled"
  | "behaviorLogMaxEntries"
  | "behaviorLogLocationIntervalSec"
  | "logPlayerJoin"
  | "logPlayerLeave"
  | "logPlayerChat"
  | "logPlayerDeath"
  | "logPvpHit"
  | "logPlaceWater"
  | "logPlaceLava"
  | "logIgniteFire"
  | "logPlaceTnt"
  | "logSummonWither"
  | "logEnterLand"
  | "logLeaveLand"
  | "logAttackMobInLand"
  | "logOpenChest"
  | "logOpenBarrel"
  | "logOpenShulker"
  | "logOpenOtherContainers"
  | "logLocationSnapshot"
  | "guild"
  | "guildCreateCost"
  | "guildMaxMembers"
  | "guildTagMaxLen"
  | "guildNameMaxLen"
  | "guildShowTagInChat"
  | "guildShowTagInName"
  | "guildInviteExpireSec"
  | "guildLeaveOnBlacklist"
  | "guildBankOfficerWithdraw"
  | "logGuildEvents"
  | "guildMaxLandsPerGuild"
  | "guildMaxWaypointsPerGuild"
  | "guildTreasuryCostLandCreate"
  | "guildTreasuryCostLandBind"
  | "guildTreasuryCostWaypointCreate";

export type IValueType = boolean | string;

export const defaultSetting = {
  player: true,
  land: true,
  wayPoint: true,
  economy: true,
  other: true,
  help: true,
  sm: true,
  setting: true,
  killItem: true,
  killItemAmount: "1500",
  randomTpRange: "50000",
  maxLandPerPlayer: "5",
  maxLandBlocks: "30000",
  maxPrivatePointsPerPlayer: "10",
  maxPublicPointsPerPlayer: "10",
  playerNameColor: "§f",
  playerChatColor: "§f",
  trialMode: false,
  trialModeDuration: "3600",
  randomTeleport: true,
  backToDeath: true,
  enableTreeCutOneClick: true,
  enableDigOreOneClick: true,
  land1BlockPerPrice: "2",
  daily_gold_limit: "100000",
  startingGold: "500",
  monsterKillGoldReward: true,
  allowPlayerDisplaySettings: true, // 允许玩家编辑名字显示设置
  pvp: true, // PVP系统菜单显示开关
  pvpEnabled: false, // PVP功能全局开关（默认关闭）
  pvpSeizeAmount: "100", // 固定夺取金额
  pvpMinProtection: "100", // 最低金币保护
  pvpToggleCooldown: "30", // 切换冷却时间（秒）
  pvpCombatTagDuration: "30", // 战斗标签持续时间（秒）
  serverName: "服务器", // 服务器名称
  welcomeMessage:
    "§a欢迎使用杜绝熊孩服务器插件~\\n§a此插件由 §eYuehua §a制作，B站ID： §e月花zzZ\\n§a管理员请输入命令 §b/tag @s add admin §a来获取服务器菜单管理员权限", // 进服欢迎消息
  blacklistEnabled: false, // 黑名单系统（仅 BDS 可用，默认关闭）
  behaviorLogEnabled: true, // 玩家行为日志
  behaviorLogMaxEntries: "20000", // 行为日志最大保留条数
  behaviorLogLocationIntervalSec: "60", // 玩家坐标采样间隔（秒）
  logPlayerJoin: true,
  logPlayerLeave: true,
  logPlayerChat: true,
  logPlayerDeath: true,
  logPvpHit: false,
  logPlaceWater: true,
  logPlaceLava: true,
  logIgniteFire: true,
  logPlaceTnt: true,
  logSummonWither: true,
  logEnterLand: true,
  logLeaveLand: true,
  logAttackMobInLand: true,
  logOpenChest: true,
  logOpenBarrel: true,
  logOpenShulker: true,
  logOpenOtherContainers: true,
  logLocationSnapshot: false,
  guild: true,
  guildCreateCost: "1000",
  guildMaxMembers: "50",
  guildTagMaxLen: "6",
  guildNameMaxLen: "16",
  guildShowTagInChat: true,
  guildShowTagInName: true,
  guildInviteExpireSec: "86400",
  guildLeaveOnBlacklist: true,
  guildBankOfficerWithdraw: true,
  logGuildEvents: true,
  /** 每个公会最多可登记几块公会领地（与个人 maxLandPerPlayer 独立） */
  guildMaxLandsPerGuild: "5",
  /** 每个公会最多可保存多少个公会坐标（不占成员私人路点名额） */
  guildMaxWaypointsPerGuild: "20",
  /** 新建公会领地时从金库扣除（0 为不扣）；不扣领主个人方块费 */
  guildTreasuryCostLandCreate: "0",
  /** 将已有领地首次登记为公会领地时从金库扣除（0 为不扣） */
  guildTreasuryCostLandBind: "0",
  /** 新增公会坐标时从金库扣除（0 为不扣） */
  guildTreasuryCostWaypointCreate: "0",
};

export class ServerSetting {
  private db!: Database<IValueType>;

  constructor() {
    system.run(() => {
      this.db = new Database<IValueType>("setting");
    });
  }

  turnOn(module: IModules): void {
    console.log(`Turn on ${module}`);
    this.db.set(module, true);
  }

  turnOff(module: IModules): void {
    console.log(`Turn off ${module}`);
    this.db.set(module, false);
  }

  getState(module: IModules): IValueType {
    if (this.db.get(module) === undefined) {
      this.setState(module, defaultSetting[module]);
    }
    return this.db.get(module);
  }

  setState(module: IModules, state: IValueType): void {
    SystemLog.info(`setState: ${module} = ${state}`);
    this.db.set(module, state);
  }
}

export default new ServerSetting();
