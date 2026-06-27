import { Entity, Player, world } from "@minecraft/server";

const FAKE_PLAYER_ID_PROPERTY = "fakePlayerId";
const FAKE_PLAYER_TAG = "yuehua_fake_player";

export function isScriptFakePlayerEntity(entity: Entity): boolean {
  if (entity.typeId !== "minecraft:player") return false;
  if (entity.hasTag(FAKE_PLAYER_TAG)) return true;

  const fakeId = entity.getDynamicProperty(FAKE_PLAYER_ID_PROPERTY);
  return typeof fakeId === "string" && fakeId.length > 0;
}

export function getOnlineRealPlayers(): Player[] {
  return world.getAllPlayers().filter((player) => !isScriptFakePlayerEntity(player));
}

export function getOnlineRealPlayerByName(name: string): Player | undefined {
  return getOnlineRealPlayers().find((player) => player.name === name);
}

export function getOnlineRealPlayerCount(): number {
  return getOnlineRealPlayers().length;
}
