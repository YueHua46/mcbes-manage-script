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
  GUARANTEE_TRAVEL_DISTANCE,
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
const LIFEFORM_TARGET_TAG_PREFIX = "yuehua.backrooms_lifeform_target_";
const LIFEFORM_DEBUG_TAG = "yuehua.backrooms_lifeform_debug";
const TARGET_SLOT_COUNT = 4;
const DEBUG_REPEAT_TICKS = 60 * 20;
const INSPECT_TICKS = 48;
const ROAR_TICKS = 29;
const LURE_TICKS = 40;
const LURE_ELIGIBILITY_TICKS = 60 * 20;

interface PlayerSession {
  enteredTick: number;
  uniqueRegions: Set<string>;
  failedChecks: number;
  sessionEncountered: boolean;
  entityId?: string;
  lureEligibleUntilTick: number;
  travelDistance: number;
  lastTravelLocation: Vector3;
  lastDebugKey?: string;
  lastDebugTick: number;
}

interface ActiveEncounter {
  entity: Entity;
  state: EncounterState;
  targetSlot: number;
  targetPlayerId?: string;
  targetAssignedTick: number;
  confirmedTargetPlayerId?: string;
  lastTargetWaitLogTick: number;
  lastTargetRepairTick: number;
  retiredTargetIds: Set<string>;
  revealed: boolean;
  lastEventPhase: EncounterPhase;
  lureCount: number;
  lurePlayed: number;
  nextLureTick: number;
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

function targetTag(slot: number): string {
  return `${LIFEFORM_TARGET_TAG_PREFIX}${slot}`;
}

function formatLocation(location: Vector3): string {
  return `${location.x.toFixed(1)}, ${location.y.toFixed(1)}, ${location.z.toFixed(1)}`;
}

function formatEntityLocation(entity: Entity): string {
  try { return formatLocation(entity.location); } catch { return "未知"; }
}

function sendLifeformDebug(message: string, player?: Player): void {
  console.info(`[Backrooms][Bacteria] ${message}`);
  if (!playerAvailable(player)) return;
  try {
    if (player.hasTag(LIFEFORM_DEBUG_TAG)) player.sendMessage(`§8[细菌调试] §7${message}`);
  } catch { /* Debug output must never affect encounter state. */ }
}

function reportSessionDebug(
  player: Player,
  session: PlayerSession,
  key: string,
  message: string,
  force = false,
): void {
  const tick = system.currentTick;
  if (!force && session.lastDebugKey === key && tick - session.lastDebugTick < DEBUG_REPEAT_TICKS) return;
  session.lastDebugKey = key;
  session.lastDebugTick = tick;
  sendLifeformDebug(message, player);
}

function availableTargetSlot(): number | undefined {
  const used = new Set<number>();
  for (const encounter of encounters.values()) {
    if (entityValid(encounter.entity)) used.add(encounter.targetSlot);
  }
  for (let slot = 0; slot < TARGET_SLOT_COUNT; slot += 1) {
    if (!used.has(slot)) return slot;
  }
  return undefined;
}

function nearestAvailableTarget(encounter: ActiveEncounter): Player | undefined {
  if (!entityValid(encounter.entity)) return undefined;
  let players: Player[];
  try { players = encounter.entity.dimension.getPlayers(); } catch { return undefined; }
  const origin = encounter.entity.location;
  let nearest: Player | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const player of players) {
    if (!playerAvailable(player) || encounter.retiredTargetIds.has(player.id)) continue;
    const dx = player.location.x - origin.x;
    const dy = player.location.y - origin.y;
    const dz = player.location.z - origin.z;
    const distance = dx * dx + dy * dy + dz * dz;
    if (distance < nearestDistance) {
      nearest = player;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function clearTargetTag(player: Player | undefined, slot: number): void {
  if (!player) return;
  try { player.removeTag(targetTag(slot)); } catch { /* Player is invalid/offline. */ }
}

function clearTargetTagIfUnused(playerId: string | undefined, slot: number): void {
  if (!playerId) return;
  for (const encounter of encounters.values()) {
    if (encounter.targetSlot === slot
      && encounter.targetPlayerId === playerId
      && entityValid(encounter.entity)) return;
  }
  clearTargetTag(playerById(playerId), slot);
}

function clearUnusedTargetTags(player: Player): void {
  for (let slot = 0; slot < TARGET_SLOT_COUNT; slot += 1) {
    clearTargetTagIfUnused(player.id, slot);
  }
}

function assignEncounterTarget(encounter: ActiveEncounter, player: Player): boolean {
  const previousTargetId = encounter.targetPlayerId;
  try {
    player.addTag(targetTag(encounter.targetSlot));
    encounter.entity.triggerEvent(`yuehua:target_slot_${encounter.targetSlot}`);
  } catch {
    clearTargetTag(player, encounter.targetSlot);
    return false;
  }
  encounter.targetPlayerId = player.id;
  encounter.targetAssignedTick = system.currentTick;
  encounter.confirmedTargetPlayerId = undefined;
  encounter.lastTargetRepairTick = -Infinity;
  try { Reflect.set(encounter.entity, "target", player); } catch { /* Target group remains the compatibility path. */ }
  if (previousTargetId !== player.id) clearTargetTagIfUnused(previousTargetId, encounter.targetSlot);
  if (encounter.state.phase === "search" || encounter.state.phase === "retreat") {
    enterLogicalPhase(encounter, { type: "target-reassigned", tick: system.currentTick });
  }
  return true;
}

function handoffEncounterTarget(encounter: ActiveEncounter, unavailablePlayerId: string, retired: boolean): void {
  if (retired) encounter.retiredTargetIds.add(unavailablePlayerId);
  if (encounter.targetPlayerId === unavailablePlayerId) encounter.targetPlayerId = undefined;
  clearTargetTagIfUnused(unavailablePlayerId, encounter.targetSlot);
  const replacement = nearestAvailableTarget(encounter);
  if (replacement && assignEncounterTarget(encounter, replacement)) {
    sendLifeformDebug(
      `目标 ${unavailablePlayerId} 已失效，实体 ${encounter.entity.id} 切换到 ${replacement.name}，槽位 ${encounter.targetSlot}。`,
      replacement,
    );
  } else {
    sendLifeformDebug(
      `目标 ${unavailablePlayerId} 已失效，实体 ${encounter.entity.id} 当前无人可追，将在 ${formatLocation(encounter.entity.location)} 游走等待。`,
    );
  }
}

function handoffEncountersFromPlayer(playerId: string, retired: boolean): void {
  for (const encounter of encounters.values()) {
    if (encounter.targetPlayerId === playerId) handoffEncounterTarget(encounter, playerId, retired);
  }
}

function restoreRespawnedTarget(playerId: string): void {
  for (const encounter of encounters.values()) {
    encounter.retiredTargetIds.delete(playerId);
    if (encounter.targetPlayerId) continue;
    const replacement = nearestAvailableTarget(encounter);
    if (replacement && assignEncounterTarget(encounter, replacement)) {
      sendLifeformDebug(`实体 ${encounter.entity.id} 从无人游走恢复锁定 ${replacement.name}。`, replacement);
    }
  }
}

function auditNativeTarget(encounter: ActiveEncounter, target: Player, tick: number): void {
  let nativeTarget: Entity | undefined;
  try { nativeTarget = encounter.entity.target; } catch { return; }
  if (nativeTarget?.id === target.id) {
    if (encounter.confirmedTargetPlayerId !== target.id) {
      encounter.confirmedTargetPlayerId = target.id;
      const distance = Math.hypot(
        target.location.x - encounter.entity.location.x,
        target.location.y - encounter.entity.location.y,
        target.location.z - encounter.entity.location.z,
      );
      sendLifeformDebug(
        `锁敌确认：实体 ${encounter.entity.id} 已由原生 AI 锁定 ${target.name}，当前距离 ${distance.toFixed(1)}，阶段 ${encounter.state.phase}。`,
        target,
      );
    }
    return;
  }
  // The native selector can occasionally drop a distant player even with
  // must_see/must_reach disabled. Set the beta AI target directly, then
  // periodically rebuild the slot selector as a compatibility fallback.
  try { Reflect.set(encounter.entity, "target", target); } catch { /* Event reset below remains available. */ }
  if (tick - encounter.lastTargetRepairTick >= ACTIVE_AUDIT_TICKS) {
    try { encounter.entity.triggerEvent(`yuehua:target_slot_${encounter.targetSlot}`); } catch { /* Retry next audit. */ }
    encounter.lastTargetRepairTick = tick;
  }
  if (tick - encounter.targetAssignedTick < 20 || tick - encounter.lastTargetWaitLogTick < DEBUG_REPEAT_TICKS) return;
  encounter.lastTargetWaitLogTick = tick;
  const observed = nativeTarget ? `${nativeTarget.typeId}/${nativeTarget.id}` : "无";
  sendLifeformDebug(
    `锁敌等待：实体 ${encounter.entity.id} 尚未由原生 AI 确认目标 ${target.name}，当前引擎目标 ${observed}，位置 ${formatLocation(encounter.entity.location)}。`,
    target,
  );
}

function readCooldown(player: Player): number {
  try {
    const value = player.getDynamicProperty(COOLDOWN_PROPERTY);
    if (typeof value !== "number" || !Number.isFinite(value)) return 0;
    const maximumAllowed = Date.now() + ENCOUNTER_COOLDOWN_MS;
    if (value <= maximumAllowed) return value;
    player.setDynamicProperty(COOLDOWN_PROPERTY, maximumAllowed);
    sendLifeformDebug(
      `${player.name} 的旧版超长冷却已压缩到最多 ${ENCOUNTER_COOLDOWN_MS / 60_000} 分钟。`,
      player,
    );
    return maximumAllowed;
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
    travelDistance: 0,
    lastTravelLocation: { ...player.location },
    lastDebugTick: -Infinity,
  };
}

function safeRemove(entity: Entity | undefined): void {
  if (!entityValid(entity)) return;
  try { entity.triggerEvent("yuehua:despawn"); } catch {
    try { if (entity.isValid) entity.remove(); } catch { /* Already invalid. */ }
  }
}

function triggerPhase(encounter: ActiveEncounter, phase: EncounterPhase): boolean {
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
  const dx = player.location.x - session.lastTravelLocation.x;
  const dz = player.location.z - session.lastTravelLocation.z;
  session.travelDistance += Math.hypot(dx, dz);
  session.lastTravelLocation = { ...player.location };
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
  if (!candidate) {
    reportSessionDebug(
      player,
      session,
      "spawn-site-unavailable",
      `${player.name} 的生成尝试失败：附近没有同时满足已加载、36-56 格、墙后遮挡和三格净空的出生点。`,
    );
    return false;
  }
  if (!hasClearance(dimension, candidate.location)) {
    reportSessionDebug(
      player,
      session,
      "spawn-site-invalidated",
      `${player.name} 的候选出生点 ${formatLocation(candidate.location)} 在生成前失效。`,
    );
    return false;
  }
  const spawnTarget = { ...candidate.location, y: BACKROOMS_WALK_Y };
  // Logical selection requires an occluding wall; repeat the physical check immediately before spawn.
  if (physicalLineOfSight(dimension, player.getHeadLocation(), { ...spawnTarget, y: spawnTarget.y + 1.6 })) {
    reportSessionDebug(
      player,
      session,
      "spawn-site-visible",
      `${player.name} 的候选出生点 ${formatLocation(spawnTarget)} 因物理视线可见被取消。`,
    );
    return false;
  }
  const targetSlot = availableTargetSlot();
  if (targetSlot === undefined) {
    reportSessionDebug(player, session, "target-slots-full", `${player.name} 的生成尝试被取消：4 个细菌目标槽均已占用。`);
    return false;
  }

  let entity: Entity | undefined;
  let encounter: ActiveEncounter | undefined;
  try {
    entity = dimension.spawnEntity(LIFEFORM_TYPE_ID as any, spawnTarget);
    entity.setDynamicProperty(OWNER_PROPERTY, player.id);
    entity.setProperty(SLOT_PROPERTY, manifestation.slot);
    const state = createEncounterState(player.id, manifestation.slot, system.currentTick);
    encounter = {
      entity,
      state,
      targetSlot,
      targetAssignedTick: system.currentTick,
      lastTargetWaitLogTick: -Infinity,
      lastTargetRepairTick: -Infinity,
      retiredTargetIds: new Set(),
      revealed: false,
      lastEventPhase: "dormant",
      lureCount: hashParts32(world.seed, player.id, "lifeform:lure-count", system.currentTick) % 4,
      lurePlayed: 0,
      nextLureTick: system.currentTick + 10,
      lastHurtSoundTick: -Infinity,
    };
    // Remove the default manual target component before installing the
    // director-owned slot target. Reversing this order removes both in Bedrock.
    if (!triggerPhase(encounter, "dormant")) throw new Error("dormant phase event unavailable");
    const target = nearestAvailableTarget(encounter);
    if (!target) throw new Error("no valid player target available");
    if (!assignEncounterTarget(encounter, target)) throw new Error("target slot event unavailable");
    encounters.set(entity.id, encounter);
    session.entityId = entity.id;
    const targetDistance = Math.hypot(
      target.location.x - entity.location.x,
      target.location.y - entity.location.y,
      target.location.z - entity.location.z,
    );
    reportSessionDebug(
      player,
      session,
      "spawn-success",
      `生成成功：实体 ${entity.id} 位于 ${formatLocation(entity.location)}，目标 ${target.name}，直线距离 ${targetDistance.toFixed(1)}，路径距离 ${candidate.pathDistance}，槽位 ${targetSlot}。`,
      true,
    );
    try {
      dimension.playSound("yuehua.backrooms.lifeform.roar", entity.location, {
        volume: 1.35,
        pitch: 0.92 + (hashParts32(world.seed, player.id, "lifeform:spawn-roar", system.currentTick) % 9) / 100,
      });
    } catch (error) {
      sendLifeformDebug(`实体 ${entity.id} 已生成，但出生咆哮播放失败：${String(error)}`, target);
    }
    return true;
  } catch (error) {
    if (encounter) clearTargetTagIfUnused(encounter.targetPlayerId, encounter.targetSlot);
    safeRemove(entity);
    console.warn(`[Backrooms] Lifeform 出现失败：${String(error)}`);
    reportSessionDebug(player, session, `spawn-error:${String(error)}`, `${player.name} 的生成尝试异常：${String(error)}`);
    return false;
  }
}

function checkEligibility(player: Player, session: PlayerSession, options: BackroomsLifeformDirectorOptions): void {
  if (session.entityId) {
    const encounter = encounters.get(session.entityId);
    if (encounter && entityValid(encounter.entity)) {
      const target = encounter.targetPlayerId ? playerById(encounter.targetPlayerId) : undefined;
      reportSessionDebug(
        player,
        session,
        `active:${encounter.entity.id}`,
        `已有细菌实体 ${encounter.entity.id}，位置 ${formatLocation(encounter.entity.location)}，阶段 ${encounter.state.phase}，目标 ${target?.name ?? "无"}。`,
      );
    }
    return;
  }
  if (session.sessionEncountered) return;
  const policy = evaluateEncounterEligibility({
    sessionTicks: system.currentTick - session.enteredTick,
    uniqueRegions: session.uniqueRegions.size,
    failedChecks: session.failedChecks,
    travelDistance: session.travelDistance,
  });
  const roll = hashParts32(world.seed, player.id, "lifeform:check", session.failedChecks, system.currentTick)
    / 0x1_0000_0000;
  const lureBonus = session.lureEligibleUntilTick >= system.currentTick ? 1.25 : 1;
  const probability = Math.min(0.25, policy.probability * lureBonus);
  const activeGlobal = activeGlobalCount();
  const cooldownUntilMs = readCooldown(player);
  const travelGuaranteed = session.travelDistance >= GUARANTEE_TRAVEL_DISTANCE;
  const canStart = canStartEncounter({
    eligible: policy.eligible,
    guaranteed: policy.guaranteed,
    roll,
    probability,
    sessionEncountered: session.sessionEncountered,
    manifestationActive: Boolean(session.entityId),
    activeGlobal,
    nowMs: Date.now(),
    // Walking the full 500-block budget is an explicit activity guarantee and
    // may start an encounter before the ordinary five-minute cooldown expires.
    cooldownUntilMs: travelGuaranteed ? 0 : cooldownUntilMs,
  });
  if (!canStart) {
    if (policy.guaranteed && !travelGuaranteed && cooldownUntilMs > Date.now()) {
      reportSessionDebug(
        player,
        session,
        "cooldown",
        `${player.name} 已达到保底（累计移动 ${session.travelDistance.toFixed(1)}/${GUARANTEE_TRAVEL_DISTANCE} 格），但遭遇仍在冷却中，剩余 ${Math.ceil((cooldownUntilMs - Date.now()) / 1000)} 秒。`,
      );
    } else if (policy.guaranteed && activeGlobal >= MAX_GLOBAL_LIFEFORMS) {
      reportSessionDebug(player, session, "global-limit", `${player.name} 已达到时间保底，但全局已有 ${activeGlobal} 只细菌。`);
    }
    const probabilityMiss = policy.eligible
      && !policy.guaranteed
      && !session.sessionEncountered
      && !session.entityId
      && activeGlobal < MAX_GLOBAL_LIFEFORMS
      && (travelGuaranteed || cooldownUntilMs <= Date.now())
      && roll >= probability;
    if (probabilityMiss) {
      session.failedChecks += 1;
      reportSessionDebug(
        player,
        session,
        "probability-miss",
        `${player.name} 本轮遭遇判定未命中，概率 ${(probability * 100).toFixed(0)}%，累计未命中 ${session.failedChecks} 次。`,
      );
    }
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
  const targetPlayerId = encounter.targetPlayerId;
  encounters.delete(entityId);
  const session = sessions.get(encounter.state.ownerId);
  if (session?.entityId === entityId) session.entityId = undefined;
  const owner = playerById(encounter.state.ownerId);
  sendLifeformDebug(
    `实体 ${entityId} 已结束，最后位置 ${formatEntityLocation(encounter.entity)}，最后目标 ${targetPlayerId ?? "无"}。`,
    owner,
  );
  clearTargetTagIfUnused(targetPlayerId, encounter.targetSlot);
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
  let target = encounter.targetPlayerId ? playerById(encounter.targetPlayerId) : undefined;
  if (!playerAvailable(target)) {
    if (encounter.targetPlayerId) {
      handoffEncounterTarget(encounter, encounter.targetPlayerId, false);
    } else {
      const replacement = nearestAvailableTarget(encounter);
      if (replacement && assignEncounterTarget(encounter, replacement)) {
        sendLifeformDebug(`实体 ${encounter.entity.id} 从无人游走切换到新目标 ${replacement.name}。`, replacement);
      }
    }
    target = encounter.targetPlayerId ? playerById(encounter.targetPlayerId) : undefined;
  }
  if (target) auditNativeTarget(encounter, target, tick);

  switch (encounter.state.phase) {
    case "dormant":
      enterLogicalPhase(encounter, { type: "tick", tick });
      break;
    case "lure":
      if (target && encounter.lurePlayed < encounter.lureCount && tick >= encounter.nextLureTick) {
        try {
          target.dimension.playSound("yuehua.backrooms.lifeform.lure", encounter.entity.location, {
            volume: 0.40,
            pitch: 0.96 + (hashParts32(world.seed, target.id, "lifeform:lure", encounter.lurePlayed) % 9) / 100,
          });
        } catch { /* Entity or owner invalidated during playback. */ }
        encounter.lurePlayed += 1;
        encounter.nextLureTick = tick + 24 + encounter.lurePlayed * 9;
      }
      if (target && ownerCanSee(target, encounter.entity)) {
        enterLogicalPhase(encounter, { type: "mutual-sight", tick });
      } else if (tick - encounter.state.phaseStartedTick >= LURE_TICKS + encounter.lureCount * 30) {
        enterLogicalPhase(encounter, { type: "lure-complete", tick });
      }
      break;
    case "stalk":
      if (target && ownerCanSee(target, encounter.entity)) {
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
      // Native targeting remains attached for the entity's whole lifetime, so
      // walls and elapsed chase time never make a living target eligible for replacement.
      break;
    case "search":
      if (target && directLineOfSight(target, encounter.entity)) {
        enterLogicalPhase(encounter, { type: "target-seen", tick });
      }
      break;
    case "retreat":
      if (target) enterLogicalPhase(encounter, { type: "target-reassigned", tick });
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
      clearUnusedTargetTags(event.player);
      if (!sessions.get(event.player.id)?.entityId) {
        sessions.set(event.player.id, createSession(event.player));
      }
    }
    if (event.fromDimension.id === BACKROOMS_DIMENSION_ID) {
      handoffEncountersFromPlayer(event.player.id, false);
      if (!sessions.get(event.player.id)?.entityId) sessions.delete(event.player.id);
    }
  });
  world.afterEvents.playerSpawn.subscribe((event) => {
    system.run(() => {
      if (!event.initialSpawn) {
        handoffEncountersFromPlayer(event.player.id, true);
        restoreRespawnedTarget(event.player.id);
      }
      if (!playerAvailable(event.player)) return;
      clearUnusedTargetTags(event.player);
      if (!sessions.get(event.player.id)?.entityId) {
        sessions.set(event.player.id, createSession(event.player));
      }
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
  });
  world.afterEvents.entityDie.subscribe((event) => {
    try {
      if (event.deadEntity.typeId === "minecraft:player") {
        handoffEncountersFromPlayer(event.deadEntity.id, true);
      } else if (event.deadEntity.typeId === LIFEFORM_TYPE_ID) {
        finishEncounter(event.deadEntity.id);
      }
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
      for (const player of world.getAllPlayers()) {
        for (let slot = 0; slot < TARGET_SLOT_COUNT; slot += 1) clearTargetTag(player, slot);
      }
      cleanupOrphans(world.getDimension(BACKROOMS_DIMENSION_ID));
    } catch { /* Dimension not ready yet. */ }
  });
  return handle;
}

export { OWNER_PROPERTY as LIFEFORM_OWNER_DYNAMIC_PROPERTY };
