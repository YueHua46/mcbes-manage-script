/**
 * TPA 传送与通知逻辑（供表单与命令共用）
 */

import { Player } from "@minecraft/server";
import { color } from "../../../shared/utils/color";
import { getOnlineRealPlayerByName } from "../../../shared/utils/online-players";
import { chargeTeleportCost, refundTeleportCost } from "../../economic/services/teleport-cost";
import { BACKROOMS_DIMENSION_ID } from "../../backrooms/constants";

export type TpaType = "to" | "come";

export function teleportPlayer(requestPlayer: Player, targetPlayer: Player, type: TpaType): void {
  if (
    requestPlayer.dimension.id === BACKROOMS_DIMENSION_ID ||
    targetPlayer.dimension.id === BACKROOMS_DIMENSION_ID
  ) {
    requestPlayer.sendMessage(color.gray("目标信号无法穿过 backrooms 的隔离层。"));
    targetPlayer.sendMessage(color.gray("一段传送信号消失在荧光灯的噪声中。"));
    return;
  }

  const chargeError = chargeTeleportCost(requestPlayer, "tpaTeleportCost", "TPA传送");
  if (chargeError) {
    requestPlayer.sendMessage(color.red(chargeError));
    targetPlayer.sendMessage(
      `${color.red("玩家")} ${color.yellow(requestPlayer.name)} ${color.red("金币不足，传送请求未执行")}`
    );
    return;
  }

  try {
    if (type === "to") {
      requestPlayer.teleport(targetPlayer.location, {
        dimension: targetPlayer.dimension,
      });
      requestPlayer.sendMessage(
        `${color.green("你已")}${color.green("传送到")} ${color.yellow(targetPlayer.name)} ${color.green("的旁边")}`
      );
      targetPlayer.sendMessage(
        `${color.green("玩家")} ${color.yellow(requestPlayer.name)} ${color.green("已传送到你的旁边")}`
      );
    } else {
      targetPlayer.teleport(requestPlayer.location, {
        dimension: requestPlayer.dimension,
      });
      requestPlayer.sendMessage(`${color.yellow(targetPlayer.name)} ${color.green("已传送到你的旁边")}`);
      targetPlayer.sendMessage(
        `${color.green("你已")}${color.green("传送到")} ${color.yellow(requestPlayer.name)} ${color.green("的旁边")}`
      );
    }
  } catch {
    refundTeleportCost(requestPlayer, "tpaTeleportCost", "TPA传送失败退款");
    requestPlayer.sendMessage(color.red("传送失败，已退回金币。"));
    targetPlayer.sendMessage(color.red("传送失败，请稍后再试。"));
  }
}

export function notifyReject(requestPlayer: Player, targetPlayer: Player): void {
  requestPlayer.sendMessage(
    `${color.red("玩家")} ${color.yellow(targetPlayer.name)} ${color.red("拒绝了你的传送请求")}`
  );
  targetPlayer.sendMessage(
    `${color.red("你已")}${color.red("拒绝了")} ${color.yellow(requestPlayer.name)} ${color.red("的传送请求")}`
  );
}

export function notifyTimeout(requestPlayerName: string, targetPlayerName: string): void {
  const req = getOnlineRealPlayerByName(requestPlayerName);
  const tgt = getOnlineRealPlayerByName(targetPlayerName);
  const msg = color.gray("传送请求已超时，自动拒绝。");
  if (req) req.sendMessage(msg);
  if (tgt) tgt.sendMessage(msg);
}
