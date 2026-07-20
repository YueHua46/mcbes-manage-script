import { Player, system, world, type Vector3 } from "@minecraft/server";
import { hashParts32 } from "./core";
import {
  BACKROOMS_DIMENSION_ID,
  BACKROOMS_FOG_ID,
  BACKROOMS_FOG_STACK_ID,
  BACKROOMS_REGION_SIZE,
} from "./constants";
import { getBackroomsRegionVariant } from "./layout-adapter";
import { locationToRegion } from "./runtime";

const AMBIENCE_INTERVAL_TICKS = 4;
const HUM_REPLAY_TICKS = 500;
const RUN_SPEED_THRESHOLD = 4.8;
const WALK_STEP_DISTANCE = 1.8;
const RUN_STEP_DISTANCE = 2.2;
const MAX_TRACKED_MOVEMENT_PER_SCAN = 3;

const SOUNDS = {
  hum: "yuehua.backrooms.hum",
  surge: "yuehua.backrooms.ballast_surge",
  flicker: "yuehua.backrooms.tube_flicker",
  scratch: "yuehua.backrooms.wall_scratch",
  breath: "yuehua.backrooms.indistinct_breath",
  footstepDryWalk: "yuehua.backrooms.footstep_dry_walk",
  footstepDryRun: "yuehua.backrooms.footstep_dry_run",
  footstepDampWalk: "yuehua.backrooms.footstep_damp_walk",
  footstepDampRun: "yuehua.backrooms.footstep_damp_run",
} as const;

interface PlayerSoundscape {
  nextHumTick: number;
  nextSurgeTick: number;
  nextAnomalyTick: number;
  previousLocation: Vector3;
  previousTick: number;
  distanceSinceStep: number;
  lastFootstepTick: number;
  blackout: boolean;
}

const activePlayers = new Map<string, PlayerSoundscape>();
const warnedAt = new Map<string, number>();

function randomUnit(player: Player, channel: string, tick = system.currentTick): number {
  return hashParts32(world.seed, player.id, channel, tick) / 0x1_0000_0000;
}

function randomTicks(player: Player, channel: string, min: number, max: number): number {
  return min + Math.floor(randomUnit(player, channel) * (max - min + 1));
}

function warnSound(player: Player, error: unknown): void {
  const last = warnedAt.get(player.id) ?? -Infinity;
  if (system.currentTick - last < 1200) return;
  warnedAt.set(player.id, system.currentTick);
  console.warn(`[Backrooms] ${player.name} 的自定义声景无法播放：${String(error)}`);
}

function removeBackroomsFog(player: Player): void {
  try {
    player.runCommand(`fog @s remove ${BACKROOMS_FOG_STACK_ID}`);
  } catch (error) {
    console.warn(`[Backrooms] 无法移除 ${player.name} 的雾效: ${String(error)}`);
  }
}

function stopBackroomsSounds(player: Player): void {
  for (const soundId of Object.values(SOUNDS)) {
    try { player.stopSound(soundId); } catch { /* Player may already be invalid. */ }
  }
}

function createSoundscape(player: Player): PlayerSoundscape {
  return {
    nextHumTick: system.currentTick,
    nextSurgeTick: system.currentTick + randomTicks(player, "first-surge", 4800, 14400),
    nextAnomalyTick: system.currentTick + randomTicks(player, "first-anomaly", 1200, 3600),
    previousLocation: { ...player.location },
    previousTick: system.currentTick,
    distanceSinceStep: 0,
    lastFootstepTick: -1,
    blackout: false,
  };
}

function enterAmbience(player: Player): void {
  removeBackroomsFog(player);
  stopBackroomsSounds(player);
  try {
    player.runCommand(`fog @s push ${BACKROOMS_FOG_ID} ${BACKROOMS_FOG_STACK_ID}`);
    player.stopMusic();
    player.playMusic("yuehua.backrooms.music_lock", { volume: 0, fade: 0, loop: true });
    activePlayers.set(player.id, createSoundscape(player));
  } catch (error) {
    console.warn(`[Backrooms] 无法为 ${player.name} 应用环境效果: ${String(error)}`);
  }
}

function leaveAmbience(player: Player): void {
  removeBackroomsFog(player);
  stopBackroomsSounds(player);
  try { player.stopMusic(); } catch { /* Player may already be invalid. */ }
  activePlayers.delete(player.id);
  warnedAt.delete(player.id);
}

function spatialLocation(player: Player, channel: string, minRadius: number, maxRadius: number): Vector3 {
  const angle = randomUnit(player, `${channel}:angle`) * Math.PI * 2;
  const radius = minRadius + randomUnit(player, `${channel}:radius`) * (maxRadius - minRadius);
  return {
    x: player.location.x + Math.cos(angle) * radius,
    y: player.location.y + (randomUnit(player, `${channel}:height`) - 0.5) * 3,
    z: player.location.z + Math.sin(angle) * radius,
  };
}

function playSpatialAnomaly(player: Player, state: PlayerSoundscape): void {
  const roll = randomUnit(player, "anomaly-kind");
  const soundId = roll < 0.46 ? SOUNDS.scratch : roll < 0.74 ? SOUNDS.breath : SOUNDS.flicker;
  const location = spatialLocation(player, `anomaly:${soundId}`, 9, soundId === SOUNDS.scratch ? 25 : 19);
  player.dimension.playSound(soundId, location, {
    volume: soundId === SOUNDS.breath ? 0.12 : 0.18,
    pitch: 0.92 + randomUnit(player, "anomaly-pitch") * 0.16,
  });
  state.nextAnomalyTick = system.currentTick + randomTicks(player, "next-anomaly", 1800, 5200);
}

function getFootstepSurface(player: Player): "dry" | "damp" | undefined {
  const block = player.dimension.getBlock({
    x: Math.floor(player.location.x),
    y: Math.floor(player.location.y - 0.2),
    z: Math.floor(player.location.z),
  });
  if (block?.typeId === "yuehua:backrooms_carpet_damp") return "damp";
  if (block?.typeId === "yuehua:backrooms_carpet") return "dry";
  return undefined;
}

function updateFootsteps(player: Player, state: PlayerSoundscape): void {
  const elapsedTicks = Math.max(1, system.currentTick - state.previousTick);
  const dx = player.location.x - state.previousLocation.x;
  const dz = player.location.z - state.previousLocation.z;
  const horizontalDistance = Math.hypot(dx, dz);
  const horizontalSpeed = horizontalDistance * 20 / elapsedTicks;
  state.previousLocation = { ...player.location };
  state.previousTick = system.currentTick;

  if (!player.isOnGround || horizontalDistance > MAX_TRACKED_MOVEMENT_PER_SCAN) {
    state.distanceSinceStep = 0;
    return;
  }
  const surface = getFootstepSurface(player);
  if (!surface) {
    state.distanceSinceStep = 0;
    return;
  }
  if (horizontalDistance < 0.01) return;

  state.distanceSinceStep += horizontalDistance;
  const running = horizontalSpeed >= RUN_SPEED_THRESHOLD;
  const stepDistance = running ? RUN_STEP_DISTANCE : WALK_STEP_DISTANCE;
  if (state.distanceSinceStep < stepDistance || state.lastFootstepTick === system.currentTick) return;
  state.distanceSinceStep = Math.min(state.distanceSinceStep - stepDistance, stepDistance);
  state.lastFootstepTick = system.currentTick;

  const soundId = surface === "damp"
    ? running ? SOUNDS.footstepDampRun : SOUNDS.footstepDampWalk
    : running ? SOUNDS.footstepDryRun : SOUNDS.footstepDryWalk;
  const volume = surface === "damp" ? running ? 0.20 : 0.14 : running ? 0.17 : 0.12;
  player.dimension.playSound(soundId, player.location, {
    volume,
    pitch: 0.96 + randomUnit(player, `footstep:${soundId}`) * 0.08,
  });
}

function updateSoundscape(player: Player, state: PlayerSoundscape): void {
  try {
    const region = locationToRegion(player.location, BACKROOMS_REGION_SIZE);
    const blackout = getBackroomsRegionVariant(world.seed, region).blackout;
    if (blackout !== state.blackout) {
      state.blackout = blackout;
      player.stopSound(SOUNDS.hum);
      player.stopSound(SOUNDS.surge);
      state.nextHumTick = blackout ? Number.POSITIVE_INFINITY : system.currentTick;
      // The transition itself is audible; inside the blackout the expected result is near-silence.
      player.dimension.playSound(SOUNDS.flicker, player.location, { volume: 0.20, pitch: blackout ? 0.78 : 1.06 });
    }

    if (!blackout && system.currentTick >= state.nextHumTick) {
      player.playSound(SOUNDS.hum, {
        volume: 0.15 + randomUnit(player, "hum-volume") * 0.06,
        pitch: 0.985 + randomUnit(player, "hum-pitch") * 0.025,
      });
      state.nextHumTick = system.currentTick + HUM_REPLAY_TICKS;
    }

    if (!blackout && system.currentTick >= state.nextSurgeTick) {
      player.playSound(SOUNDS.surge, {
        volume: 0.20 + randomUnit(player, "surge-volume") * 0.08,
        pitch: 0.94 + randomUnit(player, "surge-pitch") * 0.12,
      });
      state.nextSurgeTick = system.currentTick + randomTicks(player, "next-surge", 6000, 16800);
    }

    if (system.currentTick >= state.nextAnomalyTick) playSpatialAnomaly(player, state);

    updateFootsteps(player, state);
  } catch (error) {
    warnSound(player, error);
  }
}

export function registerBackroomsAmbience(): void {
  world.afterEvents.playerDimensionChange.subscribe((event) => {
    system.run(() => {
      if (!event.player.isValid) return;
      if (event.toDimension.id === BACKROOMS_DIMENSION_ID) enterAmbience(event.player);
      if (event.fromDimension.id === BACKROOMS_DIMENSION_ID) leaveAmbience(event.player);
    });
  });

  world.afterEvents.playerSpawn.subscribe((event) => {
    system.run(() => {
      if (!event.player.isValid) return;
      if (event.player.dimension.id === BACKROOMS_DIMENSION_ID) enterAmbience(event.player);
      else leaveAmbience(event.player);
    });
  });

  system.runInterval(() => {
    let dimension;
    try {
      dimension = world.getDimension(BACKROOMS_DIMENSION_ID);
    } catch {
      return;
    }
    const present = new Set<string>();
    for (const player of dimension.getPlayers()) {
      present.add(player.id);
      let state = activePlayers.get(player.id);
      if (!state) {
        enterAmbience(player);
        state = activePlayers.get(player.id);
      }
      if (state) updateSoundscape(player, state);
    }
    for (const playerId of activePlayers.keys()) {
      if (!present.has(playerId)) activePlayers.delete(playerId);
    }
    for (const playerId of warnedAt.keys()) {
      if (!present.has(playerId)) warnedAt.delete(playerId);
    }
  }, AMBIENCE_INTERVAL_TICKS);
}
