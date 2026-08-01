import { system, world, type Player, type Vector3 } from "@minecraft/server";
import { BackroomsCell, generateRegionPlan, hashParts32 } from "./core";
import { BACKROOMS_DIMENSION_ID, BACKROOMS_REGION_SIZE, BACKROOMS_WALK_Y } from "./constants";
import {
  voiceApproachOutcome,
  voiceFirstDelayTicks,
  voiceRepeatDelayTicks,
  type VoiceApproachOutcome,
} from "./lifeform/config";

const VOICE_AUDIT_TICKS = 10;
const VOICE_MAX_LIFETIME_TICKS = 45 * 20;
const VOICE_RETRY_TICKS = 20 * 20;
const CORNER_EVENT_RETRY_TICKS = 20 * 20;

const VOICE_SOUNDS = ["yuehua.backrooms.voice_discussion", "yuehua.backrooms.voice_call"] as const;

type CornerEventKey = "isAnybody" | "creepyAmbient" | "radioRecording";

interface CornerEventPolicy {
  key: CornerEventKey;
  soundId: string;
  repeats: number;
  repeatDelayTicks: number;
  durationTicks: number;
  firstDelay: { min: number; max: number };
  repeatDelay: { min: number; max: number };
  minRadius: number;
  maxRadius: number;
  volume: number;
}

const CORNER_EVENTS: readonly CornerEventPolicy[] = [
  {
    key: "isAnybody",
    soundId: "yuehua.backrooms.corner_is_anybody",
    repeats: 3,
    repeatDelayTicks: 130,
    durationTicks: 118,
    firstDelay: { min: 60 * 20, max: 3 * 60 * 20 },
    repeatDelay: { min: 6 * 60 * 20, max: 12 * 60 * 20 },
    minRadius: 8,
    maxRadius: 18,
    volume: 0.72,
  },
  {
    key: "creepyAmbient",
    soundId: "yuehua.backrooms.corner_creepy_ambient",
    repeats: 1,
    repeatDelayTicks: 0,
    durationTicks: 435,
    firstDelay: { min: 3 * 60 * 20, max: 6 * 60 * 20 },
    repeatDelay: { min: 10 * 60 * 20, max: 18 * 60 * 20 },
    minRadius: 8,
    maxRadius: 18,
    volume: 0.62,
  },
  {
    key: "radioRecording",
    soundId: "yuehua.backrooms.corner_radio_recording",
    repeats: 1,
    repeatDelayTicks: 0,
    durationTicks: 223,
    firstDelay: { min: 2 * 60 * 20, max: 5 * 60 * 20 },
    repeatDelay: { min: 8 * 60 * 20, max: 15 * 60 * 20 },
    minRadius: 8,
    maxRadius: 18,
    volume: 0.68,
  },
] as const;

interface ActiveVoice {
  location: Vector3;
  approachDistance: number;
  outcome: VoiceApproachOutcome;
  expiresTick: number;
  relocations: number;
}

interface VoiceSession {
  enteredTick: number;
  nextVoiceTick: number;
  sequence: number;
  nextCornerTicks: Map<CornerEventKey, number>;
  cornerSequences: Map<CornerEventKey, number>;
  cornerBusyUntilTick: number;
  active?: ActiveVoice;
}

export interface BackroomsVoiceOptions {
  /** A voice only grants a short-lived lure opportunity; it never guarantees a Lifeform. */
  onLureEligible?(player: Player): void;
}

const sessions = new Map<string, VoiceSession>();
let registered = false;

function unit(playerId: string, channel: string, sequence: number): number {
  return hashParts32(world.seed, playerId, channel, sequence) / 0x1_0000_0000;
}

function rangedInt(playerId: string, channel: string, sequence: number, min: number, max: number): number {
  return min + Math.floor(unit(playerId, channel, sequence) * (max - min + 1));
}

function scheduleFirst(player: Player): VoiceSession {
  const delay = voiceFirstDelayTicks();
  const nextCornerTicks = new Map<CornerEventKey, number>();
  const cornerSequences = new Map<CornerEventKey, number>();
  for (const policy of CORNER_EVENTS) {
    nextCornerTicks.set(
      policy.key,
      system.currentTick +
        rangedInt(player.id, `corner:${policy.key}:first`, 0, policy.firstDelay.min, policy.firstDelay.max)
    );
    cornerSequences.set(policy.key, 0);
  }
  return {
    enteredTick: system.currentTick,
    nextVoiceTick: system.currentTick + rangedInt(player.id, "voice:first", 0, delay.min, delay.max),
    sequence: 0,
    nextCornerTicks,
    cornerSequences,
    cornerBusyUntilTick: 0,
  };
}

function scheduleRepeat(player: Player, session: VoiceSession): void {
  const delay = voiceRepeatDelayTicks();
  session.nextVoiceTick =
    system.currentTick + rangedInt(player.id, "voice:repeat", session.sequence, delay.min, delay.max);
}

function logicalCell(worldX: number, worldZ: number): BackroomsCell {
  const rx = Math.floor(worldX / BACKROOMS_REGION_SIZE);
  const rz = Math.floor(worldZ / BACKROOMS_REGION_SIZE);
  const localX = worldX - rx * BACKROOMS_REGION_SIZE;
  const localZ = worldZ - rz * BACKROOMS_REGION_SIZE;
  return generateRegionPlan(world.seed, rx, rz).grid.get(localX, localZ);
}

function isLogicalWalkable(worldX: number, worldZ: number): boolean {
  const cell = logicalCell(worldX, worldZ);
  return cell === BackroomsCell.Walkable || cell === BackroomsCell.Gate;
}

function isLogicalCorner(worldX: number, worldZ: number): boolean {
  if (!isLogicalWalkable(worldX, worldZ)) return false;
  const north = !isLogicalWalkable(worldX, worldZ - 1);
  const east = !isLogicalWalkable(worldX + 1, worldZ);
  const south = !isLogicalWalkable(worldX, worldZ + 1);
  const west = !isLogicalWalkable(worldX - 1, worldZ);
  return (north && east) || (east && south) || (south && west) || (west && north);
}

function isWallOccluded(from: Vector3, to: Vector3): boolean {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) * 2));
  for (let step = 1; step < steps; step += 1) {
    const x = Math.floor(from.x + (dx * step) / steps);
    const z = Math.floor(from.z + (dz * step) / steps);
    if (!isLogicalWalkable(x, z)) return true;
  }
  return false;
}

function findVoiceLocation(player: Player, sequence: number, relocation = 0): Vector3 | undefined {
  let cornerFallback: Vector3 | undefined;
  let walkableFallback: Vector3 | undefined;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const salt = sequence * 37 + relocation * 101 + attempt;
    const angle = unit(player.id, "voice:angle", salt) * Math.PI * 2;
    const radius = 8 + unit(player.id, "voice:radius", salt) * 10;
    const location = {
      x: Math.floor(player.location.x + Math.cos(angle) * radius) + 0.5,
      y: BACKROOMS_WALK_Y + 1,
      z: Math.floor(player.location.z + Math.sin(angle) * radius) + 0.5,
    };
    try {
      if (!player.dimension.isChunkLoaded(location)) continue;
      if (!isLogicalWalkable(Math.floor(location.x), Math.floor(location.z))) continue;
      walkableFallback ??= location;
      if (!isLogicalCorner(Math.floor(location.x), Math.floor(location.z))) continue;
      cornerFallback ??= location;
      if (isWallOccluded(player.location, location)) return location;
    } catch {
      // A frontier chunk may unload between the loaded check and layout lookup.
    }
  }
  return cornerFallback ?? walkableFallback;
}

function findCornerLocation(player: Player, policy: CornerEventPolicy, sequence: number): Vector3 | undefined {
  let walkableFallback: Vector3 | undefined;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const salt = sequence * 53 + attempt;
    const angle = unit(player.id, `corner:${policy.key}:angle`, salt) * Math.PI * 2;
    const radius =
      policy.minRadius + unit(player.id, `corner:${policy.key}:radius`, salt) * (policy.maxRadius - policy.minRadius);
    const location = {
      x: Math.floor(player.location.x + Math.cos(angle) * radius) + 0.5,
      y: BACKROOMS_WALK_Y + 1,
      z: Math.floor(player.location.z + Math.sin(angle) * radius) + 0.5,
    };
    try {
      if (!player.dimension.isChunkLoaded(location)) continue;
      if (!isLogicalWalkable(Math.floor(location.x), Math.floor(location.z))) continue;
      walkableFallback ??= location;
      if (isLogicalCorner(Math.floor(location.x), Math.floor(location.z))) return location;
    } catch {
      // The player's nearby frontier can unload between the checks.
    }
  }
  return walkableFallback;
}

function playerStillInBackrooms(player: Player): boolean {
  try {
    return player.isValid && player.dimension.id === BACKROOMS_DIMENSION_ID;
  } catch {
    return false;
  }
}

function scheduleCornerRepeat(player: Player, session: VoiceSession, policy: CornerEventPolicy): void {
  const sequence = session.cornerSequences.get(policy.key) ?? 0;
  session.nextCornerTicks.set(
    policy.key,
    system.currentTick +
      rangedInt(player.id, `corner:${policy.key}:repeat`, sequence, policy.repeatDelay.min, policy.repeatDelay.max)
  );
}

function playCornerEvent(player: Player, session: VoiceSession, policy: CornerEventPolicy): boolean {
  const sequence = (session.cornerSequences.get(policy.key) ?? 0) + 1;
  session.cornerSequences.set(policy.key, sequence);
  const location = findCornerLocation(player, policy, sequence);
  if (!location) {
    session.nextCornerTicks.set(policy.key, system.currentTick + CORNER_EVENT_RETRY_TICKS);
    return false;
  }

  const play = (): void => {
    if (sessions.get(player.id) !== session) return;
    if (!playerStillInBackrooms(player)) return;
    try {
      if (!player.dimension.isChunkLoaded(location)) return;
      player.dimension.playSound(policy.soundId, location, { volume: policy.volume, pitch: 1 });
    } catch {
      /* The player or source chunk can invalidate during a delayed repeat. */
    }
  };
  play();
  for (let repeat = 1; repeat < policy.repeats; repeat += 1) {
    system.runTimeout(play, policy.repeatDelayTicks * repeat);
  }
  session.cornerBusyUntilTick =
    system.currentTick + policy.repeatDelayTicks * Math.max(0, policy.repeats - 1) + policy.durationTicks;
  scheduleCornerRepeat(player, session, policy);
  return true;
}

function auditCornerEvents(player: Player, session: VoiceSession): void {
  if (system.currentTick < session.cornerBusyUntilTick || session.active) return;
  const due = CORNER_EVENTS.filter(
    (policy) => system.currentTick >= (session.nextCornerTicks.get(policy.key) ?? Infinity)
  ).sort(
    (left, right) =>
      (session.nextCornerTicks.get(left.key) ?? Infinity) - (session.nextCornerTicks.get(right.key) ?? Infinity)
  );
  if (due[0]) playCornerEvent(player, session, due[0]);
}

function playVoice(player: Player, session: VoiceSession, relocation = 0): boolean {
  const location = findVoiceLocation(player, session.sequence, relocation);
  if (!location) return false;
  const sound = VOICE_SOUNDS[rangedInt(player.id, "voice:type", session.sequence + relocation, 0, 1)];
  try {
    player.dimension.playSound(sound, location, {
      volume: sound.endsWith("discussion") ? 0.68 : 0.62,
      pitch: 0.96 + unit(player.id, "voice:pitch", session.sequence + relocation) * 0.08,
    });
  } catch {
    return false;
  }
  const approachDistance = 7 + unit(player.id, "voice:approach", session.sequence) * 3;
  session.active = {
    location,
    approachDistance,
    outcome: voiceApproachOutcome(unit(player.id, "voice:outcome", session.sequence)),
    expiresTick: system.currentTick + VOICE_MAX_LIFETIME_TICKS,
    relocations: relocation,
  };
  return true;
}

function horizontalDistance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function resolveApproach(player: Player, session: VoiceSession, options: BackroomsVoiceOptions): void {
  const active = session.active;
  if (!active) return;
  if (system.currentTick >= active.expiresTick) {
    session.active = undefined;
    scheduleRepeat(player, session);
    return;
  }
  if (horizontalDistance(player.location, active.location) > active.approachDistance) return;

  session.active = undefined;
  if (active.outcome === "relocate" && active.relocations === 0) {
    if (playVoice(player, session, 1)) return;
  } else if (active.outcome === "lure-eligible") {
    try {
      options.onLureEligible?.(player);
    } catch {
      /* Do not break the voice scheduler. */
    }
  }
  scheduleRepeat(player, session);
}

function auditPlayer(player: Player, options: BackroomsVoiceOptions): void {
  let session = sessions.get(player.id);
  if (!session) {
    session = scheduleFirst(player);
    sessions.set(player.id, session);
  }
  resolveApproach(player, session, options);
  auditCornerEvents(player, session);
  if (session.active || system.currentTick < session.cornerBusyUntilTick || system.currentTick < session.nextVoiceTick)
    return;
  session.sequence += 1;
  if (!playVoice(player, session)) session.nextVoiceTick = system.currentTick + VOICE_RETRY_TICKS;
}

export function registerBackroomsVoices(options: BackroomsVoiceOptions = {}): void {
  if (registered) return;
  registered = true;

  world.afterEvents.playerDimensionChange.subscribe((event) => {
    if (event.toDimension.id === BACKROOMS_DIMENSION_ID) sessions.set(event.player.id, scheduleFirst(event.player));
    if (event.fromDimension.id === BACKROOMS_DIMENSION_ID) sessions.delete(event.player.id);
  });
  world.afterEvents.playerSpawn.subscribe((event) => {
    system.run(() => {
      try {
        if (!event.player.isValid || event.player.dimension.id !== BACKROOMS_DIMENSION_ID) {
          sessions.delete(event.player.id);
          return;
        }
        sessions.set(event.player.id, scheduleFirst(event.player));
      } catch {
        sessions.delete(event.player.id);
      }
    });
  });

  system.runInterval(() => {
    let players: Player[];
    try {
      players = world.getDimension(BACKROOMS_DIMENSION_ID).getPlayers();
    } catch {
      return;
    }
    const present = new Set(players.map((player) => player.id));
    for (const player of players) {
      try {
        if (player.isValid) auditPlayer(player, options);
      } catch {
        /* Player/chunk invalidated mid-audit. */
      }
    }
    for (const playerId of sessions.keys()) if (!present.has(playerId)) sessions.delete(playerId);
  }, VOICE_AUDIT_TICKS);
}
