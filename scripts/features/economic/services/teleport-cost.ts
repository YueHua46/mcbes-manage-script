import { Player } from "@minecraft/server";
import setting, { type IModules } from "../../system/services/setting";
import economic from "./economic";

export type TeleportCostSettingKey =
  | "randomTeleportCost"
  | "backToDeathCost"
  | "tpaTeleportCost"
  | "waypointTeleportCost"
  | "landTeleportCost";

export function getTeleportCost(settingKey: TeleportCostSettingKey): number {
  if (setting.getState("economy") !== true) return 0;
  const raw = Number(setting.getState(settingKey as IModules));
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.floor(raw);
}

export function chargeTeleportCost(
  player: Player,
  settingKey: TeleportCostSettingKey,
  reason: string
): string | undefined {
  const cost = getTeleportCost(settingKey);
  if (cost <= 0) return undefined;

  if (!economic.removeGold(player.name, cost, reason)) {
    return `金币不足，本次传送需要 ${cost} 金币`;
  }

  return undefined;
}

export function refundTeleportCost(player: Player, settingKey: TeleportCostSettingKey, reason: string): void {
  const cost = getTeleportCost(settingKey);
  if (cost <= 0) return;
  economic.addGold(player.name, cost, reason, true);
}
