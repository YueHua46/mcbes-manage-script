import { GameMode, system, world } from "@minecraft/server";
import setting, { defaultSetting } from "./Setting";
import { color } from "../../utils/color";
const playerTimerIds = new Map();
// 初始化玩家计时
function initPlayerTimer(player) {
    var _a, _b;
    // 获取配置
    const isEnabled = (_a = setting.getState("trialMode")) !== null && _a !== void 0 ? _a : defaultSetting.trialMode;
    const duration = Number((_b = setting.getState("trialModeDuration")) !== null && _b !== void 0 ? _b : "3600");
    // 如果未启用试玩模式，则跳过
    if (!isEnabled) {
        return;
    }
    // 如果玩家是管理员，或是正式会员，则跳过
    if (player.isOp() || player.hasTag("admin") || player.hasTag("vip")) {
        return;
    }
    // 如果玩家已经试玩所有时间，则自动进入冒险模式
    if (player.hasTag("trialed")) {
        player.sendMessage(`${color.green("你已经使用完所有试玩时间，已自动切换为")} ${color.red("冒险模式")} ${color.green("如需继续游玩，请联系管理员申请正式会员！")}`);
        player.setGameMode(GameMode.adventure);
        return;
    }
    // 获取时长
    const _playerTrialModeTimer = player.getDynamicProperty("trialModeTimer");
    // 假设时长不存在，则初始化，否则使用现有时长
    const __playerTrialModeTimer = _playerTrialModeTimer !== null && _playerTrialModeTimer !== void 0 ? _playerTrialModeTimer : 0;
    // 初始化计时
    player.setDynamicProperty("trialModeTimer", __playerTrialModeTimer);
    // 发送提示信息
    player.sendMessage(`${color.green("本服已经开启试玩模式，您已进入试玩模式，时间达到指定时间后将变为冒险模式")} ${color.red(Number(duration) - Number(__playerTrialModeTimer) + "")} ${color.green("秒")}`);
    // 每秒检查一次
    const timerId = system.runInterval(() => {
        const playerTrialModeTimer = player.getDynamicProperty("trialModeTimer");
        const currentTrialModeTimer = playerTrialModeTimer + 1;
        // 更新计时
        player.setDynamicProperty("trialModeTimer", currentTrialModeTimer);
        // 检查是否达到时长
        if (currentTrialModeTimer >= duration) {
            player.addTag("trialed");
            player.sendMessage(`${color.green("你已经使用完所有试玩时间，已自动切换为")} ${color.red("冒险模式")} ${color.green("如需继续游玩，请联系管理员申请正式会员！")}`);
            // 设置为冒险模式
            player.setGameMode(GameMode.adventure);
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
    if (isJoin)
        return;
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
//# sourceMappingURL=TrialMode.js.map