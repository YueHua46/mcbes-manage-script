/**
 * 在线时长排行榜（消息框）
 */

import { Player } from "@minecraft/server";
import { MessageFormData } from "@minecraft/server-ui";
import onlineTimeService, { formatOnlineDuration } from "../../../features/player/services/online-time";
import { color } from "../../../shared/utils/color";

const TOP_N = 20;

export function openOnlineTimeLeaderboardForm(player: Player): void {
  const rows = onlineTimeService.getLeaderboard(TOP_N);
  const mySec = onlineTimeService.getDisplayTotalSeconds(player);

  const lines: string[] = [];
  lines.push(`${color.yellow(`=== 在线时长排行 TOP ${TOP_N} ===`)}`);
  if (rows.length === 0) {
    lines.push(color.gray("暂无已记录的排行数据（游玩后会逐步累计）。"));
  } else {
    rows.forEach((r, i) => {
      lines.push(
        `${color.white(`#${i + 1}`)} ${color.aqua(r.name)} ${color.darkGray("·")} ${color.green(
          formatOnlineDuration(r.totalSeconds)
        )}`
      );
    });
  }
  lines.push("");
  lines.push(`${color.gold("--- 我的累计在线 ---")}`);
  lines.push(`${color.white("时长：")}${color.green(formatOnlineDuration(mySec))}`);
  lines.push(color.darkGray("（含本段在线未落库部分）"));

  const form = new MessageFormData();
  form.title("§w在线时长排行");
  form.body({ rawtext: [{ text: lines.join("\n") }] });
  form.button1("§w返回");
  form.button2("§w刷新");

  form.show(player).then((data) => {
    if (data.canceled) return;
    if (data.selection === 0) {
      void import("../other").then((m) => m.openBaseFunctionForm(player));
    } else if (data.selection === 1) {
      openOnlineTimeLeaderboardForm(player);
    }
  });
}
