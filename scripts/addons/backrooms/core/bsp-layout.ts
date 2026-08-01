import { BackroomsGenerationConfig } from "./config";
import { DeterministicRandom } from "./hash";
import {
  BackroomsCell,
  PartitionOrientation,
  PartitionWall,
  Rect,
  RegionGrid,
  RoomKind,
  RoomLeaf,
  WallOpening,
} from "./types";

export interface BspLayoutResult {
  readonly rooms: readonly RoomLeaf[];
  readonly partitions: readonly PartitionWall[];
}

function chooseRoomKind(rect: Rect, random: DeterministicRandom, config: BackroomsGenerationConfig): RoomKind {
  if (random.chance(config.tightRoomRate) && Math.min(rect.width, rect.depth) <= config.targetRoomSpan) {
    return "tight";
  }
  if (random.chance(config.columnHallRate) && rect.width >= 10 && rect.depth >= 10) {
    return "column-hall";
  }
  if (rect.width >= config.targetRoomSpan && rect.depth >= config.targetRoomSpan) {
    return "open-hall";
  }
  return "standard";
}

function shouldStop(
  rect: Rect,
  depth: number,
  random: DeterministicRandom,
  config: BackroomsGenerationConfig
): boolean {
  if (depth >= config.maximumBspDepth) return true;
  const canSplitVertical = rect.width >= config.minimumRoomSpan * 2 + 1;
  const canSplitHorizontal = rect.depth >= config.minimumRoomSpan * 2 + 1;
  if (!canSplitVertical && !canSplitHorizontal) return true;

  if (
    depth > 0 &&
    rect.width >= config.targetRoomSpan &&
    rect.depth >= config.targetRoomSpan &&
    random.chance(config.openHallStopRate)
  ) {
    return true;
  }

  const longest = Math.max(rect.width, rect.depth);
  if (longest <= config.targetRoomSpan) return random.chance(0.72);
  if (longest <= config.targetRoomSpan + 4) return random.chance(0.35);
  return false;
}

function chooseOrientation(
  rect: Rect,
  random: DeterministicRandom,
  config: BackroomsGenerationConfig
): PartitionOrientation {
  const canVertical = rect.width >= config.minimumRoomSpan * 2 + 1;
  const canHorizontal = rect.depth >= config.minimumRoomSpan * 2 + 1;
  if (!canHorizontal) return "vertical";
  if (!canVertical) return "horizontal";
  if (rect.width / rect.depth >= 1.25) return "vertical";
  if (rect.depth / rect.width >= 1.25) return "horizontal";
  return random.chance(0.5) ? "vertical" : "horizontal";
}

function normalOpeningWidth(available: number, random: DeterministicRandom): number {
  const desired = random.pick([2, 3, 3, 3, 3, 4, 4, 5, 6]);
  return Math.min(desired, Math.max(2, available - 2));
}

function createOpenings(
  start: number,
  length: number,
  random: DeterministicRandom,
  config: BackroomsGenerationConfig
): WallOpening[] {
  if (random.chance(config.mostlyOpenPartitionRate) && length >= 9) {
    const leftPier = random.integer(1, Math.min(3, Math.floor((length - 3) / 2)));
    const rightPier = random.integer(1, Math.min(3, length - leftPier - 3));
    return [{ offset: start + leftPier, width: length - leftPier - rightPier }];
  }

  if (random.chance(config.doubleOpeningRate) && length >= 12) {
    const width = Math.min(3, Math.floor((length - 5) / 2));
    const firstMaximum = start + Math.floor(length / 2) - width - 1;
    const first = random.integer(start + 1, firstMaximum);
    const secondMinimum = first + width + 2;
    const secondMaximum = start + length - width - 1;
    const second = random.integer(secondMinimum, secondMaximum);
    return [
      { offset: first, width },
      { offset: second, width },
    ];
  }

  const width = normalOpeningWidth(length, random);
  const offset = random.integer(start + 1, start + length - width - 1);
  return [{ offset, width }];
}

function placePartition(
  grid: RegionGrid,
  rect: Rect,
  orientation: PartitionOrientation,
  random: DeterministicRandom,
  config: BackroomsGenerationConfig
): { wall: PartitionWall; first: Rect; second: Rect } {
  const minimum = config.minimumRoomSpan;
  if (orientation === "vertical") {
    const position = random.integer(rect.x + minimum, rect.x + rect.width - minimum - 1);
    const openings = createOpenings(rect.z, rect.depth, random, config);
    for (let z = rect.z; z < rect.z + rect.depth; z += 1) {
      grid.set(position, z, BackroomsCell.Wall);
    }
    for (const opening of openings) {
      for (let z = opening.offset; z < opening.offset + opening.width; z += 1) {
        grid.set(position, z, BackroomsCell.Walkable);
      }
    }
    return {
      wall: { orientation, position, start: rect.z, length: rect.depth, openings },
      first: { x: rect.x, z: rect.z, width: position - rect.x, depth: rect.depth },
      second: {
        x: position + 1,
        z: rect.z,
        width: rect.x + rect.width - position - 1,
        depth: rect.depth,
      },
    };
  }

  const position = random.integer(rect.z + minimum, rect.z + rect.depth - minimum - 1);
  const openings = createOpenings(rect.x, rect.width, random, config);
  for (let x = rect.x; x < rect.x + rect.width; x += 1) {
    grid.set(x, position, BackroomsCell.Wall);
  }
  for (const opening of openings) {
    for (let x = opening.offset; x < opening.offset + opening.width; x += 1) {
      grid.set(x, position, BackroomsCell.Walkable);
    }
  }
  return {
    wall: { orientation, position, start: rect.x, length: rect.width, openings },
    first: { x: rect.x, z: rect.z, width: rect.width, depth: position - rect.z },
    second: {
      x: rect.x,
      z: position + 1,
      width: rect.width,
      depth: rect.z + rect.depth - position - 1,
    },
  };
}

function addColumns(grid: RegionGrid, room: RoomLeaf, random: DeterministicRandom): void {
  const rect = room.rect;
  if (rect.width < 9 || rect.depth < 9) return;
  const spacing = random.integer(5, 8);
  const startX = rect.x + random.integer(2, Math.min(4, rect.width - 3));
  const startZ = rect.z + random.integer(2, Math.min(4, rect.depth - 3));
  for (let z = startZ; z < rect.z + rect.depth - 2; z += spacing) {
    for (let x = startX; x < rect.x + rect.width - 2; x += spacing) {
      if (random.chance(0.72) && grid.get(x, z) === BackroomsCell.Walkable) {
        grid.set(x, z, BackroomsCell.Wall);
      }
    }
  }
}

function addPartialWall(
  grid: RegionGrid,
  room: RoomLeaf,
  random: DeterministicRandom,
  partitions: PartitionWall[]
): void {
  const rect = room.rect;
  const vertical = rect.depth >= 8 && (rect.width < 8 || random.chance(0.5));
  if (vertical) {
    const x = random.integer(rect.x + 2, rect.x + rect.width - 3);
    const maximumLength = Math.max(2, Math.floor(rect.depth * 0.55));
    const length = random.integer(2, maximumLength);
    const fromStart = random.chance(0.5);
    const start = fromStart ? rect.z : rect.z + rect.depth - length;
    for (let z = start; z < start + length; z += 1) {
      if (grid.get(x, z) === BackroomsCell.Walkable) grid.set(x, z, BackroomsCell.Wall);
    }
    partitions.push({ orientation: "vertical", position: x, start, length, openings: [] });
  } else if (rect.width >= 8) {
    const z = random.integer(rect.z + 2, rect.z + rect.depth - 3);
    const maximumLength = Math.max(2, Math.floor(rect.width * 0.55));
    const length = random.integer(2, maximumLength);
    const fromStart = random.chance(0.5);
    const start = fromStart ? rect.x : rect.x + rect.width - length;
    for (let x = start; x < start + length; x += 1) {
      if (grid.get(x, z) === BackroomsCell.Walkable) grid.set(x, z, BackroomsCell.Wall);
    }
    partitions.push({ orientation: "horizontal", position: z, start, length, openings: [] });
  }
}

function addTightDivider(
  grid: RegionGrid,
  room: RoomLeaf,
  random: DeterministicRandom,
  partitions: PartitionWall[]
): void {
  const rect = room.rect;
  if (rect.width >= rect.depth && rect.width >= 8) {
    const x = random.integer(rect.x + 3, rect.x + rect.width - 4);
    const opening = random.integer(rect.z + 1, rect.z + rect.depth - 3);
    for (let z = rect.z; z < rect.z + rect.depth; z += 1) grid.set(x, z, BackroomsCell.Wall);
    grid.set(x, opening, BackroomsCell.Walkable);
    grid.set(x, opening + 1, BackroomsCell.Walkable);
    partitions.push({
      orientation: "vertical",
      position: x,
      start: rect.z,
      length: rect.depth,
      openings: [{ offset: opening, width: 2 }],
    });
  } else if (rect.depth >= 8) {
    const z = random.integer(rect.z + 3, rect.z + rect.depth - 4);
    const opening = random.integer(rect.x + 1, rect.x + rect.width - 3);
    for (let x = rect.x; x < rect.x + rect.width; x += 1) grid.set(x, z, BackroomsCell.Wall);
    grid.set(opening, z, BackroomsCell.Walkable);
    grid.set(opening + 1, z, BackroomsCell.Walkable);
    partitions.push({
      orientation: "horizontal",
      position: z,
      start: rect.x,
      length: rect.width,
      openings: [{ offset: opening, width: 2 }],
    });
  }
}

export function generateBspLayout(
  grid: RegionGrid,
  interior: Rect,
  random: DeterministicRandom,
  config: BackroomsGenerationConfig
): BspLayoutResult {
  const rooms: RoomLeaf[] = [];
  const partitions: PartitionWall[] = [];

  const visit = (rect: Rect, depth: number): void => {
    if (shouldStop(rect, depth, random, config)) {
      rooms.push({ rect, depth, kind: chooseRoomKind(rect, random, config) });
      return;
    }
    const orientation = chooseOrientation(rect, random, config);
    const split = placePartition(grid, rect, orientation, random, config);
    partitions.push(split.wall);
    // Random traversal order prevents a visible directional bias while the
    // RNG stream remains deterministic for a coordinate.
    if (random.chance(0.5)) {
      visit(split.first, depth + 1);
      visit(split.second, depth + 1);
    } else {
      visit(split.second, depth + 1);
      visit(split.first, depth + 1);
    }
  };

  visit(interior, 0);

  for (const room of rooms) {
    if (room.kind === "column-hall") addColumns(grid, room, random);
    if (room.kind === "tight") addTightDivider(grid, room, random, partitions);
    if (random.chance(config.partialWallRate)) addPartialWall(grid, room, random, partitions);
  }

  return { rooms, partitions };
}
