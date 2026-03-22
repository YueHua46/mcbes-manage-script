/**
 * 在线时长排行入口已并入「数据统计」；保留此导出供旧引用。
 */

import { Player } from "@minecraft/server";
import { openStatsHubForm } from "../stats";

export function openOnlineTimeLeaderboardForm(player: Player, back?: () => void): void {
  openStatsHubForm(player, { focus: "onlineTime", back });
}
