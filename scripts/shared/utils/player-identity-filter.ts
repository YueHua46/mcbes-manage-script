import { Entity, Player, system } from "@minecraft/server";
import { Database } from "../database/database";

const FAKE_PLAYER_ID_PROPERTY = "fakePlayerId";
const FAKE_PLAYER_TAG = "yuehua_fake_player";
const LEGACY_FAKE_PLAYER_TYPE = "yuehua:fake_player";
const DATABASE_NAME = "fake_player_identity_names";

const knownFakePlayerNames = new Set<string>();
let identityDb: Database<boolean> | undefined;

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

system.run(() => {
  identityDb = new Database<boolean>(DATABASE_NAME);
  for (const name of identityDb.keys()) {
    if (identityDb.get(name) === true) knownFakePlayerNames.add(name);
  }
  for (const name of knownFakePlayerNames) identityDb.set(name, true);
});

/** 实体级判定：同时识别旧版实体假人和新版 SimulatedPlayer。 */
export function isFakePlayerEntity(entity: Entity): boolean {
  if (entity.typeId === LEGACY_FAKE_PLAYER_TYPE) return true;
  if (entity.typeId !== "minecraft:player") return false;
  if (entity.hasTag(FAKE_PLAYER_TAG)) return true;
  const fakeId = entity.getDynamicProperty(FAKE_PLAYER_ID_PROPERTY);
  return typeof fakeId === "string" && fakeId.length > 0;
}

export function isRealPlayerEntity(entity: Entity): entity is Player {
  return entity.typeId === "minecraft:player" && !isFakePlayerEntity(entity);
}

/**
 * 将假人名加入持久化身份档案。即使假人稍后被删除，历史排行榜也不会重新显示其脏数据。
 * 若未来同名真实玩家进入服务器，调用 registerKnownRealPlayer 会自动解除该名字的假人标记。
 */
export function registerKnownFakePlayerName(name: string): void {
  const normalized = normalizeName(name);
  if (!normalized) return;
  knownFakePlayerNames.add(normalized);
  identityDb?.set(normalized, true);
}

export function registerKnownRealPlayer(player: Player): void {
  if (isFakePlayerEntity(player)) return;
  const normalized = normalizeName(player.name);
  if (!knownFakePlayerNames.delete(normalized)) return;
  identityDb?.delete(normalized);
}

export function isKnownFakePlayerName(name: string): boolean {
  return knownFakePlayerNames.has(normalizeName(name));
}

export function isKnownRealPlayerName(name: string): boolean {
  return !!name.trim() && !isKnownFakePlayerName(name);
}

export function filterRealPlayerRecords<T extends { name: string }>(records: T[]): T[] {
  return records.filter((record) => isKnownRealPlayerName(record.name));
}
