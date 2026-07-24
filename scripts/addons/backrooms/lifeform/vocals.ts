import { system, world, type Entity } from "@minecraft/server";
import { hashParts32 } from "../core";
import { BACKROOMS_DIMENSION_ID } from "../constants";
import { LIFEFORM_TYPE_ID } from "./config";

const VOCAL_AUDIT_TICKS = 20;
const FIRST_VOCAL_MIN_TICKS = 4 * 20;
const FIRST_VOCAL_MAX_TICKS = 8 * 20;
const MIN_VOCAL_DELAY_TICKS = 8 * 20;
const MAX_VOCAL_DELAY_TICKS = 16 * 20;
const ROAR_SOUND_ID = "yuehua.backrooms.lifeform.roar";
const RANDOM_VOCAL_SOUND_ID = "yuehua.backrooms.lifeform.random_vocal";
const SIGNATURE_WAIL_SOUND_ID = "yuehua.backrooms.lifeform.signature_wail";
const OWNER_PROPERTY = "yuehua:backroomsLifeformOwner";
const MANUAL_SPAWN_DELAY_TICKS = 2;
const MANUAL_SPAWN_AUDIBLE_DISTANCE = 96;
const MANUAL_SPAWN_VOLUME = 1.6;

const nextVocalTicks = new Map<string, number>();
const playedSignatureVocals = new Set<string>();
let registered = false;

function entityAvailable(entity: Entity): boolean {
  try { return entity.isValid && entity.dimension.id === BACKROOMS_DIMENSION_ID; } catch { return false; }
}

function delayFor(entityId: string, first: boolean): number {
  const minimum = first ? FIRST_VOCAL_MIN_TICKS : MIN_VOCAL_DELAY_TICKS;
  const maximum = first ? FIRST_VOCAL_MAX_TICKS : MAX_VOCAL_DELAY_TICKS;
  return minimum + hashParts32(
    world.seed,
    entityId,
    first ? "lifeform:vocal:first" : "lifeform:vocal:repeat",
    system.currentTick,
  ) % (maximum - minimum + 1);
}

function schedule(entity: Entity, first: boolean): void {
  nextVocalTicks.set(entity.id, system.currentTick + delayFor(entity.id, first));
}

function playSpatialSound(
  entity: Entity,
  soundId: string,
  volume: number,
  pitch: number,
  maxDistance = MANUAL_SPAWN_AUDIBLE_DISTANCE,
): void {
  const location = entity.location;
  for (const player of entity.dimension.getPlayers({ location, maxDistance })) {
    try {
      player.playSound(soundId, { location, volume, pitch });
    } catch { /* A player can leave between the query and playback. */ }
  }
}

function maintainManualTarget(entity: Entity): void {
  try {
    if (entity.getDynamicProperty(OWNER_PROPERTY) !== undefined) return;
    if (entity.target?.typeId === "minecraft:player") return;
    const origin = entity.location;
    let target: Entity | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const player of entity.dimension.getPlayers({ location: origin, maxDistance: 512 })) {
      if (!player.isValid) continue;
      const dx = player.location.x - origin.x;
      const dy = player.location.y - origin.y;
      const dz = player.location.z - origin.z;
      const distance = dx * dx + dy * dy + dz * dz;
      if (distance < nearestDistance) {
        target = player;
        nearestDistance = distance;
      }
    }
    if (!target) return;
    try { Reflect.set(entity, "target", target); } catch { /* Event reset remains available. */ }
    if (entity.target?.id !== target.id) entity.triggerEvent("yuehua:manual_retarget");
  } catch { /* Entity/target may invalidate during the audit. */ }
}

function announceManualSpawn(entity: Entity): void {
  system.runTimeout(() => {
    try {
      if (!entity.isValid || entity.typeId !== LIFEFORM_TYPE_ID) return;
      // Director spawns write this owner immediately after spawnEntity(). Wait
      // two ticks so the entitySpawn callback can distinguish them from a
      // command/spawn-egg summon and avoid playing over the director roar.
      if (entity.getDynamicProperty(OWNER_PROPERTY) !== undefined) return;
      maintainManualTarget(entity);
      const pitch = 0.94 + (
        hashParts32(world.seed, entity.id, "lifeform:manual-spawn-wail", system.currentTick) % 9
      ) / 100;
      playedSignatureVocals.add(entity.id);
      // Player-scoped playback is reliable in a custom dimension while the
      // supplied entity location keeps CJB123's wail properly spatial.
      playSpatialSound(entity, SIGNATURE_WAIL_SOUND_ID, MANUAL_SPAWN_VOLUME, pitch);
    } catch { /* The summoned entity may invalidate before the delayed check. */ }
  }, MANUAL_SPAWN_DELAY_TICKS);
}

function auditEntity(entity: Entity): void {
  if (!entityAvailable(entity)) return;
  maintainManualTarget(entity);
  const nextTick = nextVocalTicks.get(entity.id);
  if (nextTick === undefined) {
    schedule(entity, true);
    return;
  }
  if (system.currentTick < nextTick) return;
  try {
    const firstSignature = !playedSignatureVocals.has(entity.id);
    const vocalRoll = hashParts32(world.seed, entity.id, "lifeform:vocal:type", system.currentTick) % 5;
    const soundId = firstSignature || vocalRoll === 0
      ? SIGNATURE_WAIL_SOUND_ID
      : vocalRoll === 1 ? RANDOM_VOCAL_SOUND_ID : ROAR_SOUND_ID;
    if (soundId === SIGNATURE_WAIL_SOUND_ID) playedSignatureVocals.add(entity.id);
    playSpatialSound(
      entity,
      soundId,
      soundId === SIGNATURE_WAIL_SOUND_ID ? 1.45 : 1.2,
      0.96 + (hashParts32(world.seed, entity.id, "lifeform:vocal:pitch", system.currentTick) % 9) / 100,
    );
  } catch { /* The entity may invalidate between the audit and playback. */ }
  schedule(entity, false);
}

export function registerBackroomsLifeformVocals(): void {
  if (registered) return;
  registered = true;
  world.afterEvents.entitySpawn.subscribe(({ entity }) => {
    try {
      if (entity.isValid && entity.typeId === LIFEFORM_TYPE_ID) announceManualSpawn(entity);
    } catch { /* Some transient spawn handles invalidate inside the callback. */ }
  });
  system.runInterval(() => {
    let entities: Entity[];
    try {
      entities = world.getDimension(BACKROOMS_DIMENSION_ID).getEntities({ type: LIFEFORM_TYPE_ID });
    } catch {
      return;
    }
    const present = new Set<string>();
    for (const entity of entities) {
      present.add(entity.id);
      auditEntity(entity);
    }
    for (const entityId of nextVocalTicks.keys()) {
      if (!present.has(entityId)) {
        nextVocalTicks.delete(entityId);
        playedSignatureVocals.delete(entityId);
      }
    }
  }, VOCAL_AUDIT_TICKS);
}
