import { Player, system, world, type Vector3 } from "@minecraft/server";
import { hashParts32 } from "./core";
import { BACKROOMS_DIMENSION_ID, BACKROOMS_FOG_ID, BACKROOMS_FOG_STACK_ID, BACKROOMS_REGION_SIZE } from "./constants";
import { getBackroomsRegionVariant } from "./layout-adapter";
import { locationToRegion } from "./runtime";

const AMBIENCE_INTERVAL_TICKS = 4;

const SOUNDS = {
  surge: "yuehua.backrooms.ballast_surge",
  flicker: "yuehua.backrooms.tube_flicker",
  scratch: "yuehua.backrooms.wall_scratch",
  breath: "yuehua.backrooms.indistinct_breath",
} as const;
const RETIRED_SOUND_IDS = ["yuehua.backrooms.hum"] as const;

interface PlayerSoundscape {
  nextSurgeTick: number;
  nextAnomalyTick: number;
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
  for (const soundId of [...Object.values(SOUNDS), ...RETIRED_SOUND_IDS]) {
    try {
      player.stopSound(soundId);
    } catch {
      /* Player may already be invalid. */
    }
  }
}

function createSoundscape(player: Player): PlayerSoundscape {
  return {
    nextSurgeTick: system.currentTick + randomTicks(player, "first-surge", 4800, 14400),
    nextAnomalyTick: system.currentTick + randomTicks(player, "first-anomaly", 1200, 3600),
    blackout: false,
  };
}

function startBackroomsMusic(player: Player): void {
  system.runTimeout(() => {
    if (!player.isValid || player.dimension.id !== BACKROOMS_DIMENSION_ID || !activePlayers.has(player.id)) return;
    try {
      player.playMusic("music.game.yuehua_backrooms", { volume: 1, fade: 0, loop: true });
    } catch (error) {
      warnSound(player, error);
    }
  }, 2);
}

function enterAmbience(player: Player): void {
  removeBackroomsFog(player);
  stopBackroomsSounds(player);
  try {
    player.runCommand(`fog @s push ${BACKROOMS_FOG_ID} ${BACKROOMS_FOG_STACK_ID}`);
    activePlayers.set(player.id, createSoundscape(player));
    player.stopMusic();
    startBackroomsMusic(player);
  } catch (error) {
    console.warn(`[Backrooms] 无法为 ${player.name} 应用环境效果: ${String(error)}`);
  }
}

function leaveAmbience(player: Player): void {
  removeBackroomsFog(player);
  stopBackroomsSounds(player);
  try {
    player.stopMusic();
  } catch {
    /* Player may already be invalid. */
  }
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

function updateSoundscape(player: Player, state: PlayerSoundscape): void {
  try {
    const region = locationToRegion(player.location, BACKROOMS_REGION_SIZE);
    const blackout = getBackroomsRegionVariant(world.seed, region).blackout;
    if (blackout !== state.blackout) {
      state.blackout = blackout;
      player.stopSound(SOUNDS.surge);
      // The music ambience continues; only local electrical details drop out in a blackout.
      player.dimension.playSound(SOUNDS.flicker, player.location, { volume: 0.2, pitch: blackout ? 0.78 : 1.06 });
    }

    if (!blackout && system.currentTick >= state.nextSurgeTick) {
      player.playSound(SOUNDS.surge, {
        volume: 0.2 + randomUnit(player, "surge-volume") * 0.08,
        pitch: 0.94 + randomUnit(player, "surge-pitch") * 0.12,
      });
      state.nextSurgeTick = system.currentTick + randomTicks(player, "next-surge", 6000, 16800);
    }

    if (system.currentTick >= state.nextAnomalyTick) playSpatialAnomaly(player, state);
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
