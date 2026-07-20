import {
  BackroomsCell,
  DeterministicRandom,
  deriveSeed32,
  generateRegionPlan,
  findSafeLandingCell,
  getRegionGates,
  type BackroomsSeed,
  type RegionLayout,
} from "./core";
import type {
  BackroomsRegion,
  RegionBuildPlan,
  RegionGate,
  RegionGateProvider,
  RegionLayoutProvider,
  RelativeBlockPlacement,
} from "./runtime";

const LAYOUT_CACHE_LIMIT = 256;

export interface LampRowPlan {
  baseStep: number;
  groupLength: number;
  gapLength: number;
  offset: number;
  slots: boolean[];
}

interface IntegerRandom {
  integer(min: number, max: number): number;
}

export function isValidLampRowPlan(plan: LampRowPlan): boolean {
  if (!Number.isInteger(plan.baseStep) || plan.baseStep < 6 || plan.baseStep > 9) return false;
  if (!Number.isInteger(plan.groupLength) || plan.groupLength < 2 || plan.groupLength > 4) return false;
  if (!Number.isInteger(plan.gapLength) || plan.gapLength < 1 || plan.gapLength > 2) return false;
  const cycle = plan.groupLength + plan.gapLength;
  if (!Number.isInteger(plan.offset) || plan.offset < 0 || plan.offset >= cycle) return false;
  return plan.slots.every((active, index) => (
    active === ((index + plan.offset) % cycle < plan.groupLength)
  ));
}

/** Pure deterministic row policy shared by tests and physical fixture placement. */
export function planLampRowSlots(random: IntegerRandom, slotCount: number): LampRowPlan {
  if (!Number.isInteger(slotCount) || slotCount < 0) {
    throw new RangeError(`slotCount must be a non-negative integer, received ${slotCount}`);
  }
  const baseStep = random.integer(6, 9);
  const groupLength = random.integer(2, 4);
  const gapLength = random.integer(1, 2);
  const cycle = groupLength + gapLength;
  const offset = random.integer(0, cycle - 1);
  const slots = Array.from(
    { length: slotCount },
    (_, index) => (index + offset) % cycle < groupLength,
  );
  return { baseStep, groupLength, gapLength, offset, slots };
}

export interface BackroomsRegionVariant {
  blackout: boolean;
  redRoom: boolean;
  holeCluster: boolean;
}

export function getBackroomsRegionVariant(
  worldSeed: BackroomsSeed,
  region: BackroomsRegion,
): BackroomsRegionVariant {
  return {
    blackout: new DeterministicRandom(
      deriveSeed32(worldSeed, 1, "variant:blackout", region.rx, region.rz),
    ).chance(0.003),
    redRoom: new DeterministicRandom(
      deriveSeed32(worldSeed, 1, "variant:red-room", region.rx, region.rz),
    ).chance(0.0001),
    holeCluster: new DeterministicRandom(
      deriveSeed32(worldSeed, 1, "variant:hole-cluster", region.rx, region.rz),
    ).chance(0.002),
  };
}

export class BackroomsLayoutAdapter implements RegionLayoutProvider, RegionGateProvider {
  private readonly cache = new Map<string, RegionLayout>();

  public constructor(private readonly worldSeed: BackroomsSeed) {}

  public createPlan(region: BackroomsRegion): RegionBuildPlan {
    const layout = this.getLayout(region);
    const landing = findSafeLandingCell(layout);
    const random = new DeterministicRandom(deriveSeed32(this.worldSeed, 1, "decor", region.rx, region.rz));
    const { blackout, redRoom, holeCluster } = getBackroomsRegionVariant(this.worldSeed, region);
    const wallBlock = redRoom ? "minecraft:red_terracotta" : undefined;
    const ceilingRandom = new DeterministicRandom(
      deriveSeed32(this.worldSeed, 1, "ceiling-height", region.rx, region.rz),
    );
    const lowRooms = new Set<number>();
    layout.rooms.forEach((_, index) => {
      if (ceilingRandom.chance(0.74)) lowRooms.add(index);
    });

    const walls: RegionBuildPlan["walls"] = layout.wallRuns.map((run) => ({
      from: { x: run.minX, y: 1, z: run.minZ },
      to: { x: run.maxX, y: 4, z: run.maxZ },
      blockId: wallBlock ?? (random.chance(0.08) ? "yuehua:backrooms_wallpaper_stained" : undefined),
    }));
    layout.rooms.forEach((room, index) => {
      if (!lowRooms.has(index)) return;
      walls.push({
        from: { x: room.rect.x, y: 4, z: room.rect.z },
        to: {
          x: room.rect.x + room.rect.width - 1,
          y: 4,
          z: room.rect.z + room.rect.depth - 1,
        },
        blockId: "yuehua:backrooms_ceiling_tile",
      });
    });
    walls.push(...this.createArches(layout, random, wallBlock));

    return {
      region: { ...region },
      walls,
      lamps: this.createLamps(
        layout,
        new DeterministicRandom(
          deriveSeed32(this.worldSeed, 1, "lighting-rows", region.rx, region.rz),
        ),
        blackout,
        lowRooms,
      ),
      decorations: this.createFloorStains(layout, random),
      voids: holeCluster ? this.createHoleCluster(layout, random, landing) : [],
      safeSpawn: { x: landing.x, y: 1, z: landing.z },
    };
  }

  public getGates(region: BackroomsRegion): readonly RegionGate[] {
    return getRegionGates(this.worldSeed, region).map((gate) => ({
      side: gate.direction,
      offset: gate.offset,
      width: gate.width,
      height: 4,
    }));
  }

  public getLayout(region: BackroomsRegion): RegionLayout {
    const key = `${region.rx},${region.rz}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const layout = generateRegionPlan(this.worldSeed, region.rx, region.rz);
    this.cache.set(key, layout);
    while (this.cache.size > LAYOUT_CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.cache.delete(oldest);
    }
    return layout;
  }

  private createLamps(
    layout: RegionLayout,
    random: DeterministicRandom,
    blackout: boolean,
    lowRooms: ReadonlySet<number>,
  ): RelativeBlockPlacement[] {
    const lamps: RelativeBlockPlacement[] = [];

    for (let roomIndex = 0; roomIndex < layout.rooms.length; roomIndex++) {
      const room = layout.rooms[roomIndex];
      const horizontal = room.rect.width === room.rect.depth
        ? random.chance(0.5)
        : room.rect.width > room.rect.depth;
      const longStart = horizontal ? room.rect.x : room.rect.z;
      const longLength = horizontal ? room.rect.width : room.rect.depth;
      const crossStart = horizontal ? room.rect.z : room.rect.x;
      const crossLength = horizontal ? room.rect.depth : room.rect.width;
      const minimumFixtureStart = longStart + 1;
      const maximumFixtureStart = longStart + longLength - 3;
      const roomDark = !blackout && random.chance(0.02);
      if (roomDark || maximumFixtureStart < minimumFixtureStart) continue;
      const roomLampStart = lamps.length;

      const minimumRow = crossStart + 1;
      const maximumRow = crossStart + crossLength - 2;
      const rowStep = random.integer(10, 12);
      const rowOffset = random.integer(0, Math.min(rowStep - 1, maximumRow - minimumRow));
      for (
        let rowCoordinate = minimumRow + rowOffset;
        rowCoordinate <= maximumRow;
        rowCoordinate += rowStep
      ) {
        const omitRow = random.chance(blackout ? 0.65 : 0.02);
        if (omitRow) continue;
        const slotCapacity = Math.floor((maximumFixtureStart - minimumFixtureStart) / 6) + 1;
        const rowPlan = planLampRowSlots(random, slotCapacity);
        const step = rowPlan.baseStep;
        const availableOffset = Math.min(step - 1, maximumFixtureStart - minimumFixtureStart);
        const firstStart = minimumFixtureStart + random.integer(0, Math.max(0, availableOffset));

        let fixtureIndex = 0;
        for (let fixtureStart = firstStart; fixtureStart <= maximumFixtureStart; fixtureStart += step) {
          const activeSlot = rowPlan.slots[fixtureIndex] ?? false;
          fixtureIndex++;
          if (!activeSlot || (blackout && random.chance(0.60))) continue;
          const firstX = horizontal ? fixtureStart : rowCoordinate;
          const firstZ = horizontal ? rowCoordinate : fixtureStart;
          const secondX = firstX + (horizontal ? 1 : 0);
          const secondZ = firstZ + (horizontal ? 0 : 1);
          if (!this.isLampCell(layout, firstX, firstZ) || !this.isLampCell(layout, secondX, secondZ)) {
            continue;
          }

          const lampY = lowRooms.has(roomIndex) ? 4 : 5;
          const blockId = blackout || random.chance(0.035)
            ? "yuehua:backrooms_fluorescent_dead"
            : undefined;
          lamps.push(
            { location: { x: firstX, y: lampY, z: firstZ }, blockId },
            { location: { x: secondX, y: lampY, z: secondZ }, blockId },
          );
        }
      }

      if (!blackout) {
        const roomLamps = lamps.slice(roomLampStart);
        if (roomLamps.length > 0 && roomLamps.every((lamp) => lamp.blockId)) {
          // Preserve failed fixtures without allowing failure/omission rolls to
          // accidentally turn an otherwise normal room into a second dark-room channel.
          roomLamps[0].blockId = undefined;
          roomLamps[1].blockId = undefined;
        } else if (roomLamps.length === 0) {
          const fallbackRow = crossStart + Math.floor(crossLength / 2);
          const fallbackStart = longStart + Math.floor((longLength - 2) / 2);
          const firstX = horizontal ? fallbackStart : fallbackRow;
          const firstZ = horizontal ? fallbackRow : fallbackStart;
          const secondX = firstX + (horizontal ? 1 : 0);
          const secondZ = firstZ + (horizontal ? 0 : 1);
          if (this.isLampCell(layout, firstX, firstZ) && this.isLampCell(layout, secondX, secondZ)) {
            const lampY = lowRooms.has(roomIndex) ? 4 : 5;
            lamps.push(
              { location: { x: firstX, y: lampY, z: firstZ } },
              { location: { x: secondX, y: lampY, z: secondZ } },
            );
          }
        }
      }
    }

    if (blackout && lamps.length === 0) {
      for (let roomIndex = 0; roomIndex < layout.rooms.length; roomIndex++) {
        const room = layout.rooms[roomIndex];
        const horizontal = room.rect.width >= room.rect.depth;
        const firstX = room.rect.x + Math.floor((room.rect.width - (horizontal ? 2 : 1)) / 2);
        const firstZ = room.rect.z + Math.floor((room.rect.depth - (horizontal ? 1 : 2)) / 2);
        const secondX = firstX + (horizontal ? 1 : 0);
        const secondZ = firstZ + (horizontal ? 0 : 1);
        if (!this.isLampCell(layout, firstX, firstZ) || !this.isLampCell(layout, secondX, secondZ)) {
          continue;
        }
        const lampY = lowRooms.has(roomIndex) ? 4 : 5;
        lamps.push(
          {
            location: { x: firstX, y: lampY, z: firstZ },
            blockId: "yuehua:backrooms_fluorescent_dead",
          },
          {
            location: { x: secondX, y: lampY, z: secondZ },
            blockId: "yuehua:backrooms_fluorescent_dead",
          },
        );
        break;
      }
    }
    return lamps;
  }

  private isLampCell(layout: RegionLayout, x: number, z: number): boolean {
    const cell = layout.grid.get(x, z);
    return cell === BackroomsCell.Walkable || cell === BackroomsCell.Gate;
  }

  private createFloorStains(layout: RegionLayout, random: DeterministicRandom): RelativeBlockPlacement[] {
    const stains: RelativeBlockPlacement[] = [];
    const target = random.integer(2, 9);
    for (let index = 0; index < target; index++) {
      const x = random.integer(2, layout.size - 3);
      const z = random.integer(2, layout.size - 3);
      if (layout.grid.get(x, z) !== BackroomsCell.Walkable) continue;
      stains.push({
        location: { x, y: 0, z },
        blockId: "yuehua:backrooms_carpet_damp",
      });
    }
    return stains;
  }

  private createArches(
    layout: RegionLayout,
    random: DeterministicRandom,
    blockId: string | undefined,
  ): RegionBuildPlan["walls"] {
    const arches: RegionBuildPlan["walls"] = [];
    for (const partition of layout.partitions) {
      for (const opening of partition.openings) {
        if (opening.width < 3 || !random.chance(0.12)) continue;
        if (partition.orientation === "vertical") {
          arches.push({
            from: { x: partition.position, y: 4, z: opening.offset },
            to: { x: partition.position, y: 4, z: opening.offset + opening.width - 1 },
            blockId,
          });
        } else {
          arches.push({
            from: { x: opening.offset, y: 4, z: partition.position },
            to: { x: opening.offset + opening.width - 1, y: 4, z: partition.position },
            blockId,
          });
        }
      }
    }
    return arches;
  }

  private createHoleCluster(
    layout: RegionLayout,
    random: DeterministicRandom,
    landing: { x: number; z: number },
  ): NonNullable<RegionBuildPlan["voids"]> {
    const rooms = layout.rooms.filter((room) => room.rect.width >= 14 && room.rect.depth >= 14);
    if (!rooms.length) return [];
    const room = random.pick(rooms);
    const startX = random.integer(room.rect.x + 3, room.rect.x + room.rect.width - 10);
    const startZ = random.integer(room.rect.z + 3, room.rect.z + room.rect.depth - 10);
    const holes: NonNullable<RegionBuildPlan["voids"]> = [];
    for (let dz = 0; dz < 3; dz++) {
      for (let dx = 0; dx < 3; dx++) {
        const x = startX + dx * 3;
        const z = startZ + dz * 3;
        if (layout.grid.get(x, z) !== BackroomsCell.Walkable) continue;
        if (Math.abs(x - landing.x) <= 2 && Math.abs(z - landing.z) <= 2) continue;
        if ((x % 16 === 8 && z % 16 === 8) || (x === 2 && z === 2)) continue;
        holes.push({ from: { x, y: -1, z }, to: { x, y: 0, z } });
      }
    }
    return holes;
  }

}
