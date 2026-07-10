import { Player, world } from "@minecraft/server";
import {
  filterRealPlayerRecords,
  isFakePlayerEntity,
  isKnownFakePlayerName,
  isKnownRealPlayerName,
  isRealPlayerEntity,
  registerKnownFakePlayerName,
  registerKnownRealPlayer,
} from "./player-identity-filter";

export {
  filterRealPlayerRecords,
  isKnownFakePlayerName,
  isKnownRealPlayerName,
  isRealPlayerEntity,
  registerKnownFakePlayerName,
  registerKnownRealPlayer,
};

export const isScriptFakePlayerEntity = isFakePlayerEntity;

export function getOnlineRealPlayers(): Player[] {
  return world.getAllPlayers().filter((player) => !isScriptFakePlayerEntity(player));
}

export function getOnlineRealPlayerByName(name: string): Player | undefined {
  return getOnlineRealPlayers().find((player) => player.name === name);
}

export function getOnlineRealPlayerCount(): number {
  return getOnlineRealPlayers().length;
}
