import { PlayerPermissionLevel, type Player } from "@minecraft/server";

export function isBackroomsAdmin(player: Player): boolean {
  return player.hasTag("admin") || player.playerPermissionLevel === PlayerPermissionLevel.Operator;
}
