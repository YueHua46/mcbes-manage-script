/**
 * TPA 传送与通知逻辑（供表单与命令共用）
 */

import { Player, world } from "@minecraft/server";
import { color } from "../../../shared/utils/color";

export type TpaType = "to" | "come";

export function teleportPlayer(
  requestPlayer: Player,
  targetPlayer: Player,
  type: TpaType
): void {
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
  const req = world.getPlayers().find((p: Player) => p.name === requestPlayerName);
  const tgt = world.getPlayers().find((p: Player) => p.name === targetPlayerName);
  const msg = color.gray("传送请求已超时，自动拒绝。");
  if (req) req.sendMessage(msg);
  if (tgt) tgt.sendMessage(msg);
}
