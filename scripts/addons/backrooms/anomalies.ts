import { BlockVolume, Player, system, world, type Vector3 } from "@minecraft/server";
import {
  BackroomsCell,
  DeterministicRandom,
  deriveSeed32,
  generateRegionPlan,
  hashParts32,
} from "./core";
import {
  BACKROOMS_DIMENSION_ID,
  BACKROOMS_FLOOR_Y,
  BACKROOMS_REGION_SIZE,
} from "./constants";
import { locationToRegion, regionKey, regionOrigin, type BackroomsRegion } from "./runtime";
import { isBackroomsAdmin } from "./permissions";

const RETURN_PROPERTY = "yuehua:backroomsReturn";
const EXIT_PROPERTY = "yuehua:backroomsExit";
const EXPLORED_PROPERTY = "yuehua:backroomsExplored";
const LAST_REGION_PROPERTY = "yuehua:backroomsLastRegion";
const VISITED_FILTER_PROPERTY = "yuehua:backroomsVisitedFilter";
const EXIT_ELIGIBLE_AFTER = 12;
const EXIT_GUARANTEE_AFTER = 80;
const SHIFT_RATE = 0.04;
const EXIT_SCAN_TICKS = 10;

interface StoredReturnPoint {
  dimensionId: string;
  location: Vector3;
}

interface StoredExit {
  rx: number;
  rz: number;
  x: number;
  y: number;
  z: number;
  createdAt: number;
  originalBlockId: string;
}

const flickerUntil = new Map<string, number>();
const authorizedExitUntil = new Map<string, number>();
const forcedReentryUntil = new Map<string, number>();

function safeParse<T>(value: unknown): T | undefined {
  if (typeof value !== "string" || !value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function storeReturnPoint(player: Player, dimensionId: string, location: Vector3): void {
  const point: StoredReturnPoint = {
    dimensionId,
    location: { x: location.x, y: location.y, z: location.z },
  };
  player.setDynamicProperty(RETURN_PROPERTY, JSON.stringify(point));
  player.setDynamicProperty(EXIT_PROPERTY, undefined);
  player.setDynamicProperty(EXPLORED_PROPERTY, 0);
  player.setDynamicProperty(LAST_REGION_PROPERTY, undefined);
  player.setDynamicProperty(VISITED_FILTER_PROPERTY, undefined);
}

function authorizeExit(player: Player, lifetimeTicks = 40): void {
  authorizedExitUntil.set(player.id, system.currentTick + lifetimeTicks);
}

function consumeExitAuthorization(player: Player): boolean {
  const value = authorizedExitUntil.get(player.id);
  authorizedExitUntil.delete(player.id);
  return value !== undefined && value >= system.currentTick;
}

function markRegionVisited(player: Player, region: BackroomsRegion): boolean {
  const parsed = safeParse<number[]>(player.getDynamicProperty(VISITED_FILTER_PROPERTY));
  const words = Array.isArray(parsed) && parsed.length === 16
    ? parsed.map((value) => Number.isSafeInteger(value) ? value >>> 0 : 0)
    : new Array<number>(16).fill(0);
  const first = hashParts32("visited-a", region.rx, region.rz) % 512;
  const second = hashParts32("visited-b", region.rx, region.rz) % 512;
  const hasFirst = (words[first >>> 5] & (1 << (first & 31))) !== 0;
  const hasSecond = (words[second >>> 5] & (1 << (second & 31))) !== 0;
  words[first >>> 5] = (words[first >>> 5] | (1 << (first & 31))) >>> 0;
  words[second >>> 5] = (words[second >>> 5] | (1 << (second & 31))) >>> 0;
  player.setDynamicProperty(VISITED_FILTER_PROPERTY, JSON.stringify(words));
  return !(hasFirst && hasSecond);
}

function readExit(player: Player): StoredExit | undefined {
  const exit = safeParse<StoredExit>(player.getDynamicProperty(EXIT_PROPERTY));
  if (!exit || !Number.isFinite(exit.x) || !Number.isFinite(exit.y) || !Number.isFinite(exit.z)) return undefined;
  return exit;
}

function distanceSquared(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function horizontalDistanceSquared(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function wallCandidate(
  player: Player,
  region: BackroomsRegion,
): { x: number; z: number } | undefined {
  const layout = generateRegionPlan(world.seed, region.rx, region.rz);
  const origin = regionOrigin(region, BACKROOMS_REGION_SIZE);
  const candidates: Array<{ x: number; z: number }> = [];
  for (let z = 3; z < layout.size - 3; z++) {
    for (let x = 3; x < layout.size - 3; x++) {
      if (layout.grid.get(x, z) !== BackroomsCell.Wall) continue;
      const vertical =
        layout.grid.get(x, z - 1) === BackroomsCell.Wall &&
        layout.grid.get(x, z + 1) === BackroomsCell.Wall &&
        layout.grid.get(x - 1, z) === BackroomsCell.Walkable &&
        layout.grid.get(x + 1, z) === BackroomsCell.Walkable;
      const horizontal =
        layout.grid.get(x - 1, z) === BackroomsCell.Wall &&
        layout.grid.get(x + 1, z) === BackroomsCell.Wall &&
        layout.grid.get(x, z - 1) === BackroomsCell.Walkable &&
        layout.grid.get(x, z + 1) === BackroomsCell.Walkable;
      if (!vertical && !horizontal) continue;
      const absolute = { x: origin.x + x + 0.5, y: BACKROOMS_FLOOR_Y + 1.5, z: origin.z + z + 0.5 };
      if (distanceSquared(player.location, absolute) >= 12 * 12) candidates.push({ x, z });
    }
  }
  if (!candidates.length) return undefined;
  const random = new DeterministicRandom(deriveSeed32(world.seed, 1, `exit:${player.id}`, region.rx, region.rz));
  return random.pick(candidates);
}

function maybeCreateExit(player: Player, region: BackroomsRegion, explored: number): StoredExit | undefined {
  if (explored < EXIT_ELIGIBLE_AFTER) return undefined;
  const chance = Math.min(0.03, 0.003 + (explored - EXIT_ELIGIBLE_AFTER) * 0.0012);
  const roll = hashParts32(world.seed, "backrooms-exit", player.id, region.rx, region.rz, explored) / 0x100000000;
  if (explored < EXIT_GUARANTEE_AFTER && roll >= chance) return undefined;
  const candidate = wallCandidate(player, region);
  if (!candidate) return undefined;
  const origin = regionOrigin(region, BACKROOMS_REGION_SIZE);
  const exit: StoredExit = {
    rx: region.rx,
    rz: region.rz,
    x: origin.x + candidate.x,
    y: BACKROOMS_FLOOR_Y + 1,
    z: origin.z + candidate.z,
    createdAt: Date.now(),
    originalBlockId: world.getDimension(BACKROOMS_DIMENSION_ID)
      .getBlock({ x: origin.x + candidate.x, y: BACKROOMS_FLOOR_Y + 1, z: origin.z + candidate.z })
      ?.typeId ?? "yuehua:backrooms_wallpaper",
  };
  player.setDynamicProperty(EXIT_PROPERTY, JSON.stringify(exit));
  player.sendMessage("§7远处有一小段墙纸正在以错误的频率闪烁。 ");
  return exit;
}

function setExitWall(exit: StoredExit, lit: boolean): void {
  const dimension = world.getDimension(BACKROOMS_DIMENSION_ID);
  dimension.fillBlocks(
    new BlockVolume(
      { x: exit.x, y: exit.y, z: exit.z },
      { x: exit.x, y: exit.y + 3, z: exit.z },
    ),
    lit ? "yuehua:backrooms_fluorescent_on" : exit.originalBlockId,
  );
}

export function returnPlayerFromBackrooms(player: Player): boolean {
  if (player.dimension.id !== BACKROOMS_DIMENSION_ID) return false;
  const fallback = world.getDefaultSpawnLocation();
  const stored = safeParse<StoredReturnPoint>(player.getDynamicProperty(RETURN_PROPERTY));
  const exit = readExit(player);
  let dimensionId = stored?.dimensionId ?? "minecraft:overworld";
  let destination = stored?.location ?? fallback;
  try {
    const destinationDimension = world.getDimension(dimensionId);
    if (exit) setExitWall(exit, false);
    player.setDynamicProperty(EXIT_PROPERTY, undefined);
    authorizeExit(player);
    player.teleport(destination, { dimension: destinationDimension, keepVelocity: false });
  } catch {
    dimensionId = "minecraft:overworld";
    destination = fallback;
    authorizeExit(player);
    player.teleport(destination, { dimension: world.getDimension(dimensionId), keepVelocity: false });
  }
  return true;
}

function returnThroughExit(player: Player, _exit: StoredExit): void {
  returnPlayerFromBackrooms(player);
}

function maybePeripheralShift(previous: BackroomsRegion, player: Player): void {
  const roll = hashParts32(world.seed, "backrooms-shift", previous.rx, previous.rz) / 0x100000000;
  if (roll >= SHIFT_RATE) return;
  const dimension = world.getDimension(BACKROOMS_DIMENSION_ID);
  if (dimension.getPlayers().some((other) => locationToRegion(other.location, BACKROOMS_REGION_SIZE).rx === previous.rx
    && locationToRegion(other.location, BACKROOMS_REGION_SIZE).rz === previous.rz)) return;

  const layout = generateRegionPlan(world.seed, previous.rx, previous.rz);
  const candidates: Array<{ x: number; z: number; vertical: boolean }> = [];
  for (let z = 4; z < layout.size - 4; z++) {
    for (let x = 4; x < layout.size - 4; x++) {
      if (layout.grid.get(x, z) !== BackroomsCell.Wall) continue;
      const vertical =
        layout.grid.get(x, z - 1) === BackroomsCell.Wall &&
        layout.grid.get(x, z + 1) === BackroomsCell.Wall &&
        layout.grid.get(x - 1, z) === BackroomsCell.Walkable &&
        layout.grid.get(x + 1, z) === BackroomsCell.Walkable;
      const horizontal =
        layout.grid.get(x - 1, z) === BackroomsCell.Wall &&
        layout.grid.get(x + 1, z) === BackroomsCell.Wall &&
        layout.grid.get(x, z - 1) === BackroomsCell.Walkable &&
        layout.grid.get(x, z + 1) === BackroomsCell.Walkable;
      if (vertical || horizontal) {
        const absolute = { x: previous.rx * BACKROOMS_REGION_SIZE + x, y: player.location.y, z: previous.rz * BACKROOMS_REGION_SIZE + z };
        if (horizontalDistanceSquared(player.location, absolute) >= 48 * 48) candidates.push({ x, z, vertical });
      }
    }
  }
  if (!candidates.length) return;
  const random = new DeterministicRandom(deriveSeed32(world.seed, 1, "peripheral-shift", previous.rx, previous.rz));
  const chosen = random.pick(candidates);
  const origin = regionOrigin(previous, BACKROOMS_REGION_SIZE);
  const from = chosen.vertical
    ? { x: origin.x + chosen.x, y: BACKROOMS_FLOOR_Y + 1, z: origin.z + chosen.z - 1 }
    : { x: origin.x + chosen.x - 1, y: BACKROOMS_FLOOR_Y + 1, z: origin.z + chosen.z };
  const to = chosen.vertical
    ? { x: origin.x + chosen.x, y: BACKROOMS_FLOOR_Y + 4, z: origin.z + chosen.z + 1 }
    : { x: origin.x + chosen.x + 1, y: BACKROOMS_FLOOR_Y + 4, z: origin.z + chosen.z };
  try {
    dimension.fillBlocks(new BlockVolume(from, to), "minecraft:air");
  } catch {
    // 玩家离开后区块可能立刻卸载；下一次离开同一区域时会重试。
  }
}

function updateExploration(player: Player): StoredExit | undefined {
  const region = locationToRegion(player.location, BACKROOMS_REGION_SIZE);
  const currentKey = regionKey(region);
  const previousKey = player.getDynamicProperty(LAST_REGION_PROPERTY);
  if (previousKey === currentKey) return readExit(player);

  if (typeof previousKey === "string") {
    const [rx, rz] = previousKey.split(",").map(Number);
    if (Number.isSafeInteger(rx) && Number.isSafeInteger(rz)) maybePeripheralShift({ rx, rz }, player);
  }
  player.setDynamicProperty(LAST_REGION_PROPERTY, currentKey);
  if (!markRegionVisited(player, region)) return readExit(player);
  const previousCount = player.getDynamicProperty(EXPLORED_PROPERTY);
  const explored = Math.min(10_000, (typeof previousCount === "number" ? previousCount : 0) + 1);
  player.setDynamicProperty(EXPLORED_PROPERTY, explored);
  return readExit(player) ?? maybeCreateExit(player, region, explored);
}

function tickPlayer(player: Player): void {
  const exit = updateExploration(player);
  if (!exit) return;
  const center = { x: exit.x + 0.5, y: exit.y + 1.5, z: exit.z + 0.5 };
  if (horizontalDistanceSquared(player.location, center) <= 1.35 ** 2) {
    returnThroughExit(player, exit);
    return;
  }

  const key = player.id;
  const until = flickerUntil.get(key) ?? 0;
  if (system.currentTick >= until) {
    const lit = (hashParts32(player.id, system.currentTick >> 4) & 3) !== 0;
    try {
      setExitWall(exit, lit);
      flickerUntil.set(key, system.currentTick + (lit ? 4 : 26 + (hashParts32(exit.x, exit.z, system.currentTick) % 45)));
    } catch {
      // 离玩家较远的候选墙可能暂时卸载；靠近后会自然恢复闪烁。
    }
  }
}

export function registerBackroomsAnomalies(): void {
  world.afterEvents.playerDimensionChange.subscribe((event) => {
    if (event.toDimension.id === BACKROOMS_DIMENSION_ID && event.fromDimension.id !== BACKROOMS_DIMENSION_ID) {
      const forcedUntil = forcedReentryUntil.get(event.player.id);
      forcedReentryUntil.delete(event.player.id);
      const forcedReentry = forcedUntil !== undefined && forcedUntil >= system.currentTick;
      if (!forcedReentry) storeReturnPoint(event.player, event.fromDimension.id, event.fromLocation);
    }
    if (event.fromDimension.id === BACKROOMS_DIMENSION_ID && event.toDimension.id !== BACKROOMS_DIMENSION_ID) {
      const authorized = consumeExitAuthorization(event.player);
      if (authorized || isBackroomsAdmin(event.player)) {
        const exit = readExit(event.player);
        if (exit) {
          try { setExitWall(exit, false); } catch { /* Destination chunk may be unloading. */ }
        }
        event.player.setDynamicProperty(EXIT_PROPERTY, undefined);
        return;
      }
      system.run(() => {
        if (!event.player.isValid) return;
        forcedReentryUntil.set(event.player.id, system.currentTick + 40);
        try {
          event.player.teleport(event.fromLocation, {
            dimension: world.getDimension(BACKROOMS_DIMENSION_ID),
            keepVelocity: false,
          });
          event.player.sendMessage("§8你没有找到出口；周围仍然是同一片黄墙。 ");
        } catch (error) {
          forcedReentryUntil.delete(event.player.id);
          console.warn(`[Backrooms] 非法离开回弹失败：${String(error)}`);
        }
      });
    }
  });

  world.afterEvents.entityDie.subscribe((event) => {
    if (event.deadEntity instanceof Player && event.deadEntity.dimension.id === BACKROOMS_DIMENSION_ID) {
      const exit = readExit(event.deadEntity);
      if (exit) {
        try { setExitWall(exit, false); } catch { /* Best-effort restoration on death. */ }
      }
      event.deadEntity.setDynamicProperty(EXIT_PROPERTY, undefined);
      authorizeExit(event.deadEntity);
    }
  });

  world.afterEvents.playerSpawn.subscribe((event) => {
    if (event.player.dimension.id !== BACKROOMS_DIMENSION_ID) return;
    const exit = readExit(event.player);
    if (exit) {
      try { setExitWall(exit, false); } catch { /* Region will be retried by the anomaly tick. */ }
    }
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
      tickPlayer(player);
    }
    for (const playerId of flickerUntil.keys()) {
      if (!present.has(playerId)) flickerUntil.delete(playerId);
    }
    for (const [playerId, until] of authorizedExitUntil) {
      if (until < system.currentTick) authorizedExitUntil.delete(playerId);
    }
    for (const [playerId, until] of forcedReentryUntil) {
      if (until < system.currentTick) forcedReentryUntil.delete(playerId);
    }
  }, EXIT_SCAN_TICKS);
}
