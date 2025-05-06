import { GameMode, Player, system, world } from "@minecraft/server";
import setting, { defaultSetting } from "./Setting";
import { color } from "../../utils/color";
import { isAdmin } from "../../utils/utils";
import { Database } from "../Database";
import { usePlayerByName } from "../../hooks/hooks";

// 存储玩家计时器ID的Map
const playerTimerIds = new Map<string, number>();

// 会员数据库
class MemberManager {
  private db!: Database<boolean>;

  constructor() {
    system.run(() => {
      this.db = new Database<boolean>("vip_members");
    });
  }

  // 添加会员
  addMember(playerName: string): boolean {
    // 检查玩家名是否为空
    if (!playerName.trim()) return false;
    
    // 添加到数据库
    this.db.set(playerName, true);
    
    // 如果玩家在线，给他添加vip标签
    const player = usePlayerByName(playerName);
    if (player) {
      player.addTag("vip");
      // 清除计时器
      const timerId = playerTimerIds.get(player.name);
      if (timerId) {
        system.clearRun(timerId);
        playerTimerIds.delete(player.name);
      }
      player.sendMessage(color.green("恭喜！您已成为正式会员，可以无限制游玩！"));
    }
    
    return true;
  }

  // 移除会员
  removeMember(playerName: string): boolean {
    // 检查玩家名是否为空
    if (!playerName.trim()) return false;
    
    // 从数据库移除
    this.db.delete(playerName);
    
    // 如果玩家在线，移除vip标签
    const player = usePlayerByName(playerName);
    if (player) {
      player.removeTag("vip");
      player.sendMessage(color.red("您的会员资格已被移除，将受到试玩时间限制。"));
      // 重新初始化计时器
      initPlayerTimer(player);
    }
    
    return true;
  }

  // 检查是否是会员
  isMember(playerName: string): boolean {
    return this.db.has(playerName) && this.db.get(playerName) === true;
  }

  // 获取所有会员
  getAllMembers(): string[] {
    return Object.keys(this.db.getAll());
  }
}

// 创建会员管理器实例
const memberManager = new MemberManager();

// 初始化玩家计时
function initPlayerTimer(player: Player) {
  // 获取配置
  const isEnabled = setting.getState("trialMode") ?? defaultSetting.trialMode;
  const duration = Number(setting.getState("trialModeDuration") ?? "3600");

  // 如果未启用试玩模式，则跳过
  if (!isEnabled) {
    return;
  }

  // 如果玩家是管理员，或是正式会员，则跳过
  if (isAdmin(player) || player.hasTag("vip") || memberManager.isMember(player.name)) {
    // 确保玩家有vip标签
    if (memberManager.isMember(player.name) && !player.hasTag("vip")) {
      player.addTag("vip");
    }
    return;
  }

  // 如果玩家已经试玩所有时间，则自动进入冒险模式
  if (player.hasTag("trialed")) {
    player.sendMessage(
      `${color.green("你已经使用完所有试玩时间，已自动切换为")} ${color.red("冒险模式")} ${color.green(
        "如需继续游玩，请联系管理员申请正式会员！"
      )}`
    );
    player.setGameMode(GameMode.Adventure);
    return;
  }

  // 获取时长
  const _playerTrialModeTimer = player.getDynamicProperty("trialModeTimer") as number | undefined;
  // 假设时长不存在，则初始化，否则使用现有时长
  const __playerTrialModeTimer = _playerTrialModeTimer ?? 0;
  // 初始化计时
  player.setDynamicProperty("trialModeTimer", __playerTrialModeTimer);

  // 发送提示信息
  player.sendMessage(
    `${color.green("本服已经开启试玩模式，您已进入试玩模式，时间达到指定时间后将变为冒险模式")} ${color.red(
      Number(duration) - Number(__playerTrialModeTimer) + ""
    )} ${color.green("秒")}`
  );

  // 每秒检查一次
  const timerId = system.runInterval(() => {
    const playerTrialModeTimer = player.getDynamicProperty("trialModeTimer") as number;
    const currentTrialModeTimer = playerTrialModeTimer + 1;
    // 更新计时
    player.setDynamicProperty("trialModeTimer", currentTrialModeTimer);

    // 检查是否达到时长
    if (currentTrialModeTimer >= duration) {
      player.addTag("trialed");
      player.sendMessage(
        `${color.green("你已经使用完所有试玩时间，已自动切换为")} ${color.red("冒险模式")} ${color.green(
          "如需继续游玩，请联系管理员申请正式会员！"
        )}`
      );
      // 设置为冒险模式
      player.setGameMode(GameMode.Adventure);
      // 取消计时
      system.clearRun(timerId);
      playerTimerIds.delete(player.name);
      return;
    }
  }, 20);

  playerTimerIds.set(player.name, timerId);
}

// 监听玩家加入事件
world.afterEvents.playerSpawn.subscribe((event) => {
  const { player } = event;
  const isJoin = player.getDynamicProperty("join");
  if (isJoin) return;
  
  // 如果玩家是会员但没有vip标签，添加标签
  if (memberManager.isMember(player.name) && !player.hasTag("vip")) {
    player.addTag("vip");
  }
  
  initPlayerTimer(player);
});

// 监听玩家离开事件
world.afterEvents.playerLeave.subscribe((event) => {
  const { playerName } = event;
  const timerId = playerTimerIds.get(playerName);
  if (timerId) {
    system.clearRun(timerId);
    playerTimerIds.delete(playerName);
  }
});

// 导出会员管理器，供表单使用
export { memberManager, initPlayerTimer };
