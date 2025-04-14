import { system } from "@minecraft/server";
import { SystemLog } from "../../utils/utils";
import { Database } from "../Database";
import "./Events";
import "./TrialMode";

export type IModules =
  | "player"
  | "land"
  | "wayPoint"
  | "other"
  | "help"
  | "sm"
  | "setting"
  | "killItem"
  | "killItemAmount"
  | "randomTpRange"
  | "maxLandPerPlayer"
  | "maxLandBlocks"
  | "maxPointsPerPlayer"
  | "playerNameColor"
  | "playerChatColor"
  | "trialMode" // 新增试玩模式开关
  | "trialModeDuration"; // 新增试玩模式时长配置

export type IValueType = boolean | string;

export const defaultSetting = {
  player: true,
  land: true,
  wayPoint: true,
  other: true,
  help: true,
  sm: true,
  setting: true,
  killItem: true,
  killItemAmount: "1500",
  randomTpRange: "50000",
  maxLandPerPlayer: "5",
  maxLandBlocks: "30000",
  maxPointsPerPlayer: "20",
  playerNameColor: "§f",
  playerChatColor: "§f",
  trialMode: false, // 默认关闭试玩模式
  trialModeDuration: "3600", // 默认1小时(3600秒)
};

export class ServerSetting {
  private db!: Database<IValueType>;
  constructor() {
    system.run(() => {
      this.db = new Database<boolean>("setting");
    });
  }
  turnOn(module: IModules) {
    console.log(`Turn on ${module}`);
    this.db.set(module, true);
  }
  turnOff(module: IModules) {
    console.log(`Turn off ${module}`);
    this.db.set(module, false);
  }
  init() {
    this.db.set("player", true);
    this.db.set("land", true);
    this.db.set("wayPoint", true);
    this.db.set("other", true);
    this.db.set("help", true);
    this.db.set("sm", true);
    this.db.set("setting", true);
    this.db.set("killItem", true);
    this.db.set("killItemAmount", defaultSetting.killItemAmount);
    this.db.set("randomTpRange", defaultSetting.randomTpRange);
    this.db.set("maxLandPerPlayer", defaultSetting.maxLandPerPlayer);
    this.db.set("maxLandBlocks", defaultSetting.maxLandBlocks);
    this.db.set("maxPointsPerPlayer", "10");
    this.db.set("playerNameColor", defaultSetting.playerNameColor);
    this.db.set("playerChatColor", defaultSetting.playerChatColor);
    this.db.set("trialMode", defaultSetting.trialMode); // 初始化试玩模式开关
    this.db.set("trialModeDuration", defaultSetting.trialModeDuration); // 初始化试玩模式时长
  }
  getState(module: IModules) {
    if (this.db.get(module) === undefined) {
      this.setState(module, defaultSetting[module]);
    }
    return this.db.get(module);
  }
  setState(module: IModules, state: IValueType) {
    SystemLog("setState enter");
    SystemLog("module -->" + module);
    SystemLog("state -->" + state);
    this.db.set(module, state);
  }
}

export default new ServerSetting();
