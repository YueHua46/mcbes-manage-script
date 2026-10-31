import { Player, system, world } from "@minecraft/server";
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

let cachedTick = -1;
let cachedPlayers: Player[] = [];

function invalidateOnlinePlayerCache(): void {
  cachedTick = -1;
  cachedPlayers = [];
}

world.afterEvents.playerLeave.subscribe(() => {
  invalidateOnlinePlayerCache();
});

export function getOnlineRealPlayers(): Player[] {
  const tick = system.currentTick;
  if (cachedTick === tick) return cachedPlayers;
  cachedTick = tick;
  cachedPlayers = world.getAllPlayers().filter((player) => !isScriptFakePlayerEntity(player));
  return cachedPlayers;
}

export function getOnlineRealPlayerByName(name: string): Player | undefined {
  return getOnlineRealPlayers().find((player) => {
    try {
      return player.isValid && player.name === name;
    } catch {
      return false;
    }
  });
}

export function getOnlineRealPlayerCount(): number {
  return getOnlineRealPlayers().length;
}
