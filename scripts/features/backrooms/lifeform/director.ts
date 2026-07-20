import { system, world, type Dimension, type Entity, type Player, type Vector3 } from "@minecraft/server";
import type { RegionLayout } from "../core";
import { hashParts32 } from "../core";
import {
  BACKROOMS_DIMENSION_ID,
  BACKROOMS_REGION_SIZE,
  BACKROOMS_WALK_Y,
} from "../constants";
import type { BackroomsManifestation } from "../manifestation";
import { getBackroomsRegionVariant } from "../layout-adapter";
import { locationToRegion } from "../runtime";
import {
  ACTIVE_AUDIT_TICKS,
  canStartEncounter,
  DIRECTOR_CHECK_TICKS,
  ENCOUNTER_COOLDOWN_MS,
  evaluateEncounterEligibility,
  LIFEFORM_TYPE_ID,
  MAX_CHASE_TICKS,
  MAX_GLOBAL_LIFEFORMS,
} from "./config";
import {
  createEncounterState,
  reduceEncounterState,
  type EncounterPhase,
  type EncounterState,
  type SpawnRegionSnapshot,
} from "./contracts";
import { selectLifeformSpawnSite } from "./spawn-site-selector";

const OWNER_PROPERTY = "yuehua:backroomsLifeformOwner";
const SLOT_PROPERTY = "yuehua:manifestation_slot";
// V2 intentionally ignores cooldowns written by the old pre-reveal director,
// which could consume 30 minutes for an entity the player never encountered.
const COOLDOWN_PROPERTY = "yuehua:backroomsLifeformCooldownUntilV2";
const LIFEFORM_TARGET_TAG = "yuehua.backrooms_lifeform_target";
const INSPECT_TICKS = 48;
const ROAR_TICKS = 29;
const LURE_TICKS = 40;
const LOST_SIGHT_TICKS = 6 * 20;
const SEARCH_MIN_TICKS = 10 * 20;
const SEARCH_MAX_TICKS = 14 * 20;
const LURE_ELIGIBILITY_TICKS = 60 * 20;

interface PlayerSession {
  enteredTick: number;
  uniqueRegions: Set<string>;
  failedChecks: number;
  sessionEncountered: boolean;
  entityId?: string;
  lureEligibleUntilTick: number;
}

interface ActiveEncounter {
  entity: Entity;
  state: EncounterState;
  revealed: boolean;
  lastEventPhase: EncounterPhase | "stagger";
  lostSightSince?: number;
  searchExpiresTick?: number;
  lureCount: number;
  lurePlayed: number;
  nextLureTick: number;
  staggerApplied: boolean;
  lastHurtSoundTick: number;
}

export interface BackroomsLifeformDirectorOptions {
  getLayout(region: { rx: number; rz: number }): RegionLayout | undefined;
  getManifestation(player: Player): BackroomsManifestation;
}

export interface BackroomsLifeformDirectorHandle {
  markVoiceLureEligible(player: Player): void;
}

const sessions = new Map<string, PlayerSession>();
const encounters = new Map<string, ActiveEncounter>();
let registered = false;
let handle: BackroomsLifeformDirectorHandle | undefined;

function entityValid(entity: Entity | undefined): entity is Entity {
  if (!entity) return false;
  try { return entity.isValid; } catch { return false; }
}

function playerAvailable(player: Player | undefined): player is Player {
  if (!player) return false;
  try { return player.isValid && player.dimension.id === BACKROOMS_DIMENSION_ID; } catch { return false; }
}

function playerById(id: string): Player | undefined {
  try { return world.getAllPlayers().find((player) => player.id === id); } catch { return undefined; }
}

function clearTargetTag(player: Player | undefined): void {
  if (!player) return;
  try { player.removeTag(LIFEFORM_TARGET_TAG); } catch { /* Player is invalid/offline. */ }
}

function readCooldown(player: Player): number {
  try {
    const value = player.getDynamicProperty(COOLDOWN_PROPERTY);
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function createSession(player: Player): PlayerSession {
  return {
    enteredTick: system.currentTick,
    uniqueRegions: new Set(),
    failedChecks: 0,
    sessionEncountered: false,
    lureEligibleUntilTick: 0,
  };
}

function safeRemove(entity: Entity | undefined): void {
  if (!entityValid(entity)) return;
  try { entity.triggerEvent("yuehua:despawn"); } catch {
    try { if (entity.isValid) entity.remove(); } catch { /* Already invalid. */ }
  }
}

function triggerPhase(encounter: ActiveEncounter, phase: EncounterPhase | "stagger"): boolean {
  if (!entityValid(encounter.entity)) return false;
  try {
    encounter.entity.triggerEvent(`yuehua:phase_${phase}`);
    encounter.lastEventPhase = phase;
    return true;
  } catch {
    return false;
  }
}

function markEncounterRevealed(encounter: ActiveEncounter): void {
  if (encounter.revealed) return;
  encounter.revealed = true;
  const session = sessions.get(encounter.state.ownerId);
  if (session) session.sessionEncountered = true;
  const owner = playerById(encounter.state.ownerId);
  if (!owner) return;
  try { owner.setDynamicProperty(COOLDOWN_PROPERTY, Date.now() + ENCOUNTER_COOLDOWN_MS); } catch {
    // A disconnect between the sight check and persistence must not invalidate the entity audit.
  }
}

function logicalSnapshots(
  player: Player,
  options: BackroomsLifeformDirectorOptions,
): SpawnRegionSnapshot[] {
  const center = locationToRegion(player.location, BACKROOMS_REGION_SIZE);
  const snapshots: SpawnRegionSnapshot[] = [];
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const region = { rx: center.rx + dx, rz: center.rz + dz };
      const layout = options.getLayout(region);
      if (!layout) continue;
      snapshots.push({
        region,
        size: layout.size,
        // Exact candidate chunk loading is checked separately; this flag means the snapshot itself is available.
        loaded: true,
        blackout: getBackroomsRegionVariant(world.seed, region).blackout,
        getCell: (x, z) => layout.grid.contains(x, z) ? layout.grid.get(x, z) : undefined,
      });
    }
  }
  return snapshots;
}

function hasClearance(dimension: Dimension, location: Vector3): boolean {
  try {
    if (!dimension.isChunkLoaded(location)) return false;
    const x = Math.floor(location.x);
    const z = Math.floor(location.z);
    const floor = dimension.getBlock({ x, y: BACKROOMS_WALK_Y - 1, z });
    if (!floor || floor.isAir) return false;
    for (let y = BACKROOMS_WALK_Y; y <= BACKROOMS_WALK_Y + 2; y += 1) {
      if (!dimension.getBlock({ x, y, z })?.isAir) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function physicalLineOfSight(dimension: Dimension, from: Vector3, to: Vector3): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance < 0.01) return true;
  try {
    return !dimension.getBlockFromRay(from, { x: dx / distance, y: dy / distance, z: dz / distance }, {
      maxDistance: Math.max(1, distance - 0.75),
      includeLiquidBlocks: true,
      includePassableBlocks: false,
    });
  } catch {
    return false;
  }
}

function ownerCanSee(owner: Player, entity: Entity): boolean {
  if (!entityValid(entity)) return false;
  try {
    const from = owner.getHeadLocation();
    const to = { x: entity.location.x, y: entity.location.y + 1.8, z: entity.location.z };
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance > 64 || distance < 0.01) return false;
    const view = owner.getViewDirection();
    const dot = (dx * view.x + dy * view.y + dz * view.z) / distance;
    return dot >= 0.70 && physicalLineOfSight(owner.dimension, from, to);
  } catch {
    return false;
  }
}

function directLineOfSight(owner: Player, entity: Entity): boolean {
  if (!entityValid(entity)) return false;
  try {
    return physicalLineOfSight(
      owner.dimension,
      owner.getHeadLocation(),
      { x: entity.location.x, y: entity.location.y + 1.6, z: entity.location.z },
    );
  } catch {
    return false;
  }
}

function sessionFor(player: Player): PlayerSession {
  let session = sessions.get(player.id);
  if (!session) {
    session = createSession(player);
    sessions.set(player.id, session);
  }
  const region = locationToRegion(player.location, BACKROOMS_REGION_SIZE);
  session.uniqueRegions.add(`${region.rx},${region.rz}`);
  return session;
}

function activeGlobalCount(): number {
  let count = 0;
  for (const encounter of encounters.values()) if (entityValid(encounter.entity)) count += 1;
  return count;
}

function spawnEncounter(
  player: Player,
  session: PlayerSession,
  options: BackroomsLifeformDirectorOptions,
): boolean {
  const dimension = player.dimension;
  const manifestation = options.getManifestation(player);
  const otherPlayers = dimension.getPlayers().filter((other) => other.id !== player.id).map((other) => other.location);
  const snapshots = logicalSnapshots(player, options);
  const candidate = selectLifeformSpawnSite({
    player: player.location,
    forward: { x: player.getViewDirection().x, z: player.getViewDirection().z },
    manifestationSpawn: manifestation.spawn,
    otherPlayers,
    regions: snapshots,
    seed: `${world.seed}:${player.id}:${session.failedChecks}:${system.currentTick}`,
    isLoaded: (location) => {
      try { return dimension.isChunkLoaded(location); } catch { return false; }
    },
    hasClearance: (location) => hasClearance(dimension, location),
    isVoid: (location) => !hasClearance(dimension, location),
  });
  if (!candidate || !hasClearance(dimension, candidate.location)) return false;
  const spawnTarget = { ...candidate.location, y: BACKROOMS_WALK_Y };
  // Logical selection requires an occluding wall; repeat the physical check immediately before spawn.
  if (physicalLineOfSight(dimension, player.getHeadLocation(), { ...spawnTarget, y: spawnTarget.y + 1.6 })) {
    return false;
  }

  let entity: Entity | undefined;
  try {
    player.addTag(LIFEFORM_TARGET_TAG);
    entity = dimension.spawnEntity(LIFEFORM_TYPE_ID as any, spawnTarget);
    entity.setDynamicProperty(OWNER_PROPERTY, player.id);
    entity.setProperty(SLOT_PROPERTY, manifestation.slot);
    const state = createEncounterState(player.id, manifestation.slot, system.currentTick);
    const encounter: ActiveEncounter = {
      entity,
      state,
      revealed: false,
      lastEventPhase: "dormant",
      lureCount: hashParts32(world.seed, player.id, "lifeform:lure-count", system.currentTick) % 4,
      lurePlayed: 0,
      nextLureTick: system.currentTick + 10,
      staggerApplied: false,
      lastHurtSoundTick: -Infinity,
    };
    if (!triggerPhase(encounter, "dormant")) throw new Error("dormant phase event unavailable");
    encounters.set(entity.id, encounter);
    session.entityId = entity.id;
    try {
      dimension.playSound("yuehua.backrooms.lifeform.distant", entity.location, {
        volume: 0.28,
        pitch: 0.89 + (hashParts32(world.seed, player.id, "lifeform:distant", system.currentTick) % 7) / 100,
      });
    } catch { /* The warning is non-critical if the client audio event is unavailable. */ }
    return true;
  } catch (error) {
    clearTargetTag(player);
    safeRemove(entity);
    console.warn(`[Backrooms] Lifeform 出现失败：${String(error)}`);
    return false;
  }
}

function checkEligibility(player: Player, session: PlayerSession, options: BackroomsLifeformDirectorOptions): void {
  if (session.sessionEncountered || session.entityId) return;
  const policy = evaluateEncounterEligibility({
    sessionTicks: system.currentTick - session.enteredTick,
    uniqueRegions: session.uniqueRegions.size,
    failedChecks: session.failedChecks,
  });
  const roll = hashParts32(world.seed, player.id, "lifeform:check", session.failedChecks, system.currentTick)
    / 0x1_0000_0000;
  const lureBonus = session.lureEligibleUntilTick >= system.currentTick ? 1.25 : 1;
  const probability = Math.min(0.25, policy.probability * lureBonus);
  const activeGlobal = activeGlobalCount();
  const cooldownUntilMs = readCooldown(player);
  const canStart = canStartEncounter({
    eligible: policy.eligible,
    guaranteed: policy.guaranteed,
    roll,
    probability,
    sessionEncountered: session.sessionEncountered,
    manifestationActive: Boolean(session.entityId),
    activeGlobal,
    nowMs: Date.now(),
    cooldownUntilMs,
  });
  if (!canStart) {
    const probabilityMiss = policy.eligible
      && !policy.guaranteed
      && !session.sessionEncountered
      && !session.entityId
      && activeGlobal < MAX_GLOBAL_LIFEFORMS
      && cooldownUntilMs <= Date.now()
      && roll >= probability;
    if (probabilityMiss) session.failedChecks += 1;
    return;
  }

  if (!spawnEncounter(player, session, options)) session.failedChecks += 1;
}

function enterLogicalPhase(encounter: ActiveEncounter, action: Parameters<typeof reduceEncounterState>[1]): void {
  if (action.type === "mutual-sight") markEncounterRevealed(encounter);
  const next = reduceEncounterState(encounter.state, action);
  if (next.phase !== encounter.state.phase) {
    encounter.state = next;
    if (!triggerPhase(encounter, next.phase)) safeRemove(encounter.entity);
  } else {
    encounter.state = next;
  }
}

function finishEncounter(entityId: string, applyCooldown = true): void {
  const encounter = encounters.get(entityId);
  if (!encounter) return;
  encounters.delete(entityId);
  const session = sessions.get(encounter.state.ownerId);
  if (session?.entityId === entityId) session.entityId = undefined;
  const owner = playerById(encounter.state.ownerId);
  clearTargetTag(owner);
  if (applyCooldown && encounter.revealed && owner) {
    try { owner.setDynamicProperty(COOLDOWN_PROPERTY, Date.now() + ENCOUNTER_COOLDOWN_MS); } catch { /* Offline/invalid. */ }
  }
}

function auditEncounter(entityId: string, encounter: ActiveEncounter): void {
  if (!entityValid(encounter.entity)) {
    finishEncounter(entityId);
    return;
  }
  const tick = system.currentTick;
  const owner = playerById(encounter.state.ownerId);
  if (!playerAvailable(owner)) {
    enterLogicalPhase(encounter, { type: "owner-unavailable", tick });
  } else {
    try {
      const target = encounter.entity.target;
      if (target?.typeId === "minecraft:player" && target.id !== owner.id) {
        enterLogicalPhase(encounter, { type: "owner-unavailable", tick });
      }
    } catch { /* Target can invalidate between AI and director audits. */ }
  }

  if (encounter.staggerApplied && tick >= encounter.state.staggerUntilTick) {
    encounter.staggerApplied = false;
    triggerPhase(encounter, encounter.state.phase);
  }
  if (encounter.state.staggerUntilTick > tick) return;

  switch (encounter.state.phase) {
    case "dormant":
      enterLogicalPhase(encounter, { type: "tick", tick });
      break;
    case "lure":
      if (owner && encounter.lurePlayed < encounter.lureCount && tick >= encounter.nextLureTick) {
        try {
          owner.dimension.playSound("yuehua.backrooms.lifeform.lure", encounter.entity.location, {
            volume: 0.40,
            pitch: 0.96 + (hashParts32(world.seed, owner.id, "lifeform:lure", encounter.lurePlayed) % 9) / 100,
          });
        } catch { /* Entity or owner invalidated during playback. */ }
        encounter.lurePlayed += 1;
        encounter.nextLureTick = tick + 24 + encounter.lurePlayed * 9;
      }
      if (owner && ownerCanSee(owner, encounter.entity)) {
        enterLogicalPhase(encounter, { type: "mutual-sight", tick });
      } else if (tick - encounter.state.phaseStartedTick >= LURE_TICKS + encounter.lureCount * 30) {
        enterLogicalPhase(encounter, { type: "lure-complete", tick });
      }
      break;
    case "stalk":
      if (owner && ownerCanSee(owner, encounter.entity)) {
        enterLogicalPhase(encounter, { type: "mutual-sight", tick });
      }
      break;
    case "inspect":
      if (tick - encounter.state.phaseStartedTick >= INSPECT_TICKS) {
        enterLogicalPhase(encounter, { type: "phase-timeout", tick });
      }
      break;
    case "roar":
      if (tick - encounter.state.phaseStartedTick >= ROAR_TICKS) {
        enterLogicalPhase(encounter, { type: "phase-timeout", tick });
      }
      break;
    case "chase":
      if (tick - encounter.state.chaseStartedTick >= MAX_CHASE_TICKS) {
        enterLogicalPhase(encounter, { type: "chase-expired", tick });
        break;
      }
      if (owner && directLineOfSight(owner, encounter.entity)) {
        encounter.lostSightSince = undefined;
      } else {
        encounter.lostSightSince ??= tick;
        if (tick - encounter.lostSightSince >= LOST_SIGHT_TICKS) {
          encounter.searchExpiresTick = tick + SEARCH_MIN_TICKS
            + hashParts32(world.seed, entityId, "lifeform:search", tick) % (SEARCH_MAX_TICKS - SEARCH_MIN_TICKS + 1);
          enterLogicalPhase(encounter, { type: "sight-lost", tick });
        }
      }
      break;
    case "search":
      if (owner && directLineOfSight(owner, encounter.entity)) {
        encounter.lostSightSince = undefined;
        encounter.searchExpiresTick = undefined;
        enterLogicalPhase(encounter, { type: "target-seen", tick });
      } else if (tick >= (encounter.searchExpiresTick ?? tick)) {
        enterLogicalPhase(encounter, { type: "search-expired", tick });
      }
      break;
    case "retreat":
      if (!owner || !ownerCanSee(owner, encounter.entity)) {
        safeRemove(encounter.entity);
        finishEncounter(entityId);
      }
      break;
  }
}

function cleanupOrphans(dimension: Dimension): void {
  let entities: Entity[];
  try { entities = dimension.getEntities({ type: LIFEFORM_TYPE_ID }); } catch { return; }
  const slots = new Set<number>();
  for (const entity of entities) {
    if (!entityValid(entity)) continue;
    const tracked = encounters.get(entity.id);
    let owner: unknown;
    let slot: unknown;
    try {
      owner = entity.getDynamicProperty(OWNER_PROPERTY);
      slot = entity.getProperty(SLOT_PROPERTY);
    } catch {
      safeRemove(entity);
      continue;
    }
    // Manual /summon entities never receive the director owner property.  The
    // slot entity property still reads its schema default (0), so owner absence
    // is the authoritative distinction between manual and director ownership.
    if (owner === undefined) continue;
    if (!tracked
      || typeof owner !== "string"
      || owner !== tracked.state.ownerId
      || typeof slot !== "number"
      || slot !== tracked.state.manifestationSlot
      || slots.has(slot)) {
      safeRemove(entity);
      continue;
    }
    slots.add(slot);
  }
}

export function registerBackroomsLifeformDirector(
  options: BackroomsLifeformDirectorOptions,
): BackroomsLifeformDirectorHandle {
  if (registered && handle) return handle;
  registered = true;
  handle = {
    markVoiceLureEligible(player) {
      if (!playerAvailable(player)) return;
      sessionFor(player).lureEligibleUntilTick = system.currentTick + LURE_ELIGIBILITY_TICKS;
    },
  };

  world.afterEvents.playerDimensionChange.subscribe((event) => {
    if (event.toDimension.id === BACKROOMS_DIMENSION_ID) {
      clearTargetTag(event.player);
      sessions.set(event.player.id, createSession(event.player));
    }
    if (event.fromDimension.id === BACKROOMS_DIMENSION_ID) {
      const session = sessions.get(event.player.id);
      const encounter = session?.entityId ? encounters.get(session.entityId) : undefined;
      if (encounter) enterLogicalPhase(encounter, { type: "owner-unavailable", tick: system.currentTick });
      sessions.delete(event.player.id);
    }
  });
  world.afterEvents.playerSpawn.subscribe((event) => {
    system.run(() => {
      if (!playerAvailable(event.player)) return;
      clearTargetTag(event.player);
      const prior = sessions.get(event.player.id);
      if (prior?.entityId) {
        const encounter = encounters.get(prior.entityId);
        if (encounter) enterLogicalPhase(encounter, { type: "owner-unavailable", tick: system.currentTick });
      }
      sessions.set(event.player.id, createSession(event.player));
    });
  });
  world.afterEvents.entityHurt.subscribe((event) => {
    let entityId: string;
    try {
      if (event.hurtEntity.typeId !== LIFEFORM_TYPE_ID) return;
      entityId = event.hurtEntity.id;
    } catch { return; }
    const encounter = encounters.get(entityId);
    if (!encounter || !entityValid(encounter.entity)) return;
    if (system.currentTick - encounter.lastHurtSoundTick >= 6) {
      try {
        encounter.entity.dimension.playSound("yuehua.backrooms.lifeform.hurt", encounter.entity.location, {
          volume: 0.58,
          pitch: 0.94 + (hashParts32(world.seed, entityId, "lifeform:hurt", system.currentTick) % 13) / 100,
        });
        encounter.lastHurtSoundTick = system.currentTick;
      } catch { /* Entity can invalidate while the damage event is delivered. */ }
    }
    const next = reduceEncounterState(encounter.state, {
      type: "damage",
      amount: event.damage,
      tick: system.currentTick,
    });
    if (next.staggerUntilTick > encounter.state.staggerUntilTick) {
      encounter.state = next;
      encounter.staggerApplied = triggerPhase(encounter, "stagger");
    }
  });
  world.afterEvents.entityDie.subscribe((event) => {
    try {
      if (event.deadEntity.typeId === LIFEFORM_TYPE_ID) finishEncounter(event.deadEntity.id);
    } catch { /* Dead handle may already be invalid. */ }
  });
  world.afterEvents.entityRemove.subscribe((event) => {
    if (event.typeId === LIFEFORM_TYPE_ID) finishEncounter(event.removedEntityId);
  });

  system.runInterval(() => {
    let dimension: Dimension;
    try { dimension = world.getDimension(BACKROOMS_DIMENSION_ID); } catch { return; }
    const present = new Set<string>();
    for (const player of dimension.getPlayers()) {
      present.add(player.id);
      try { sessionFor(player); } catch { /* Player invalidated. */ }
    }
    for (const playerId of sessions.keys()) {
      if (!present.has(playerId) && !sessions.get(playerId)?.entityId) sessions.delete(playerId);
    }
    for (const [entityId, encounter] of encounters) auditEncounter(entityId, encounter);
    cleanupOrphans(dimension);
  }, ACTIVE_AUDIT_TICKS);

  system.runInterval(() => {
    let players: Player[];
    try { players = world.getDimension(BACKROOMS_DIMENSION_ID).getPlayers(); } catch { return; }
    for (const player of players) {
      try { checkEligibility(player, sessionFor(player), options); } catch (error) {
        console.warn(`[Backrooms] Lifeform 导演跳过一次无效检查：${String(error)}`);
      }
    }
  }, DIRECTOR_CHECK_TICKS);

  // Any Lifeform surviving a script reload has no matching runtime encounter and must not become an orphan.
  system.run(() => {
    try {
      for (const player of world.getAllPlayers()) clearTargetTag(player);
      cleanupOrphans(world.getDimension(BACKROOMS_DIMENSION_ID));
    } catch { /* Dimension not ready yet. */ }
  });
  return handle;
}

export { OWNER_PROPERTY as LIFEFORM_OWNER_DYNAMIC_PROPERTY };
