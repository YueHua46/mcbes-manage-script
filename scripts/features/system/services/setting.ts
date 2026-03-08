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
  | "blacklistEnabled";

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
  welcomeMessage: "§a欢迎使用杜绝熊孩服务器插件~\\n§a此插件由 §eYuehua §a制作，B站ID： §e月花zzZ\\n§a管理员请输入命令 §b/tag @s add admin §a来获取服务器菜单管理员权限", // 进服欢迎消息
  blacklistEnabled: false, // 黑名单系统（仅 BDS 可用，默认关闭）
};

export class ServerSetting {
  private db!: Database<IValueType>;

  constructor() {
    system.run(() => {
      this.db = new Database<boolean>("setting");
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
