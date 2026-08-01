import type { HorizontalPoint, SpawnCandidate, SpawnRegionSnapshot, SpawnSiteContext } from "./contracts";

const MIN_EUCLIDEAN = 36;
const MAX_EUCLIDEAN = 56;
const MIN_PATH = 44;
const MAX_PATH = 96;
const MAX_CANDIDATES = 48;

interface CellLookup {
  snapshot: SpawnRegionSnapshot;
  localX: number;
  localZ: number;
}

function horizontalDistance(a: HorizontalPoint, b: HorizontalPoint): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function snapshotsByKey(context: SpawnSiteContext): Map<string, SpawnRegionSnapshot> {
  return new Map(context.regions.map((snapshot) => [`${snapshot.region.rx},${snapshot.region.rz}`, snapshot]));
}

function lookupCell(
  context: SpawnSiteContext,
  snapshots: Map<string, SpawnRegionSnapshot>,
  worldX: number,
  worldZ: number
): CellLookup | undefined {
  for (const snapshot of context.regions) {
    const originX = snapshot.region.rx * snapshot.size;
    const originZ = snapshot.region.rz * snapshot.size;
    const localX = worldX - originX;
    const localZ = worldZ - originZ;
    if (localX < 0 || localZ < 0 || localX >= snapshot.size || localZ >= snapshot.size) continue;
    return snapshots.get(`${snapshot.region.rx},${snapshot.region.rz}`) ? { snapshot, localX, localZ } : undefined;
  }
  return undefined;
}

function isWalkable(value: number | undefined): boolean {
  return value === 1 || value === 2;
}

function isWalkableWorld(
  context: SpawnSiteContext,
  snapshots: Map<string, SpawnRegionSnapshot>,
  worldX: number,
  worldZ: number
): boolean {
  const lookup = lookupCell(context, snapshots, worldX, worldZ);
  return Boolean(lookup?.snapshot.loaded && isWalkable(lookup.snapshot.getCell(lookup.localX, lookup.localZ)));
}

/** Logical-grid ray test; physical raycasts are repeated immediately before spawning. */
export function hasLogicalLineOfSight(context: SpawnSiteContext, target: { x: number; y: number; z: number }): boolean {
  const snapshots = snapshotsByKey(context);
  const startX = context.player.x;
  const startZ = context.player.z;
  const dx = target.x - startX;
  const dz = target.z - startZ;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) * 2));
  for (let index = 1; index < steps; index += 1) {
    const x = Math.floor(startX + (dx * index) / steps);
    const z = Math.floor(startZ + (dz * index) / steps);
    if (!isWalkableWorld(context, snapshots, x, z)) return false;
  }
  return true;
}

function hash32(...parts: Array<number | string>): number {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    const text = String(part);
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function candidateScore(
  context: SpawnSiteContext,
  lookup: CellLookup,
  location: { x: number; y: number; z: number },
  pathDistance: number
): number {
  const offsetX = location.x - context.player.x;
  const offsetZ = location.z - context.player.z;
  const length = Math.max(0.001, Math.hypot(offsetX, offsetZ));
  const forwardLength = Math.max(0.001, Math.hypot(context.forward.x, context.forward.z));
  const alignment = (offsetX * context.forward.x + offsetZ * context.forward.z) / (length * forwardLength);
  const sidePreference = 1 - Math.abs(alignment);
  const darkness = lookup.snapshot.blackout ? 2 : 0;
  const pathPreference = 1 - Math.abs(pathDistance - 64) / 52;
  const jitter = hash32(context.seed, location.x, location.z) / 0x1_0000_0000;
  return alignment * 1.4 + sidePreference * 0.5 + darkness + pathPreference + jitter * 0.15;
}

export function collectSpawnCandidates(context: SpawnSiteContext): SpawnCandidate[] {
  const snapshots = snapshotsByKey(context);
  const startX = Math.floor(context.player.x);
  const startZ = Math.floor(context.player.z);
  if (!isWalkableWorld(context, snapshots, startX, startZ)) return [];

  const queue: Array<{ x: number; z: number; distance: number }> = [{ x: startX, z: startZ, distance: 0 }];
  const visited = new Set<string>([`${startX},${startZ}`]);
  const candidates: SpawnCandidate[] = [];
  let cursor = 0;

  while (cursor < queue.length && candidates.length < MAX_CANDIDATES) {
    const current = queue[cursor++];
    if (current.distance > MAX_PATH) continue;

    if (current.distance >= MIN_PATH) {
      const location = { x: current.x + 0.5, y: context.player.y, z: current.z + 0.5 };
      const euclideanDistance = horizontalDistance(context.player, location);
      const lookup = lookupCell(context, snapshots, current.x, current.z);
      const farFromSpawn = horizontalDistance(context.manifestationSpawn, location) >= 24;
      const farFromPlayers = context.otherPlayers.every((player) => horizontalDistance(player, location) >= 32);
      if (
        lookup?.snapshot.loaded &&
        euclideanDistance >= MIN_EUCLIDEAN &&
        euclideanDistance <= MAX_EUCLIDEAN &&
        farFromSpawn &&
        farFromPlayers &&
        context.isLoaded(location) &&
        context.hasClearance(location) &&
        !context.isVoid(location) &&
        !hasLogicalLineOfSight(context, location)
      ) {
        candidates.push({
          key: `${current.x},${current.z}`,
          location,
          euclideanDistance,
          pathDistance: current.distance,
          lineOfSight: false,
          score: candidateScore(context, lookup, location, current.distance),
        });
      }
    }

    if (current.distance === MAX_PATH) continue;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const x = current.x + dx;
      const z = current.z + dz;
      const key = `${x},${z}`;
      if (visited.has(key) || !isWalkableWorld(context, snapshots, x, z)) continue;
      visited.add(key);
      queue.push({ x, z, distance: current.distance + 1 });
    }
  }
  return candidates;
}

export function selectLifeformSpawnSite(context: SpawnSiteContext): SpawnCandidate | undefined {
  const ranked = collectSpawnCandidates(context)
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
    .slice(0, 5);
  if (!ranked.length) return undefined;
  const weights = ranked.map((_, index) => ranked.length - index);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = hash32(context.seed, "lifeform-spawn-choice", ranked.map((item) => item.key).join("|")) % total;
  for (let index = 0; index < ranked.length; index += 1) {
    if (roll < weights[index]) return ranked[index];
    roll -= weights[index];
  }
  return ranked[0];
}
