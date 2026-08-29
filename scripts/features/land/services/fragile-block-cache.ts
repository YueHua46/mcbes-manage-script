import {
  BlockPermutation,
  BlockSignComponent,
  SignSide,
  StructureSaveMode,
  world,
  type Block,
  type Dimension,
  type DyeColor,
  type RawMessage,
  type Vector3,
} from "@minecraft/server";
import { isPistonDestroyedContainerType } from "./piston-destroyed-container";

const MAX_FRAGILE_BLOCK_CACHE_ENTRIES = 50_000;
const MAX_DESTROYED_CONTAINER_CACHE_ENTRIES = 4_096;
const ADJACENT_OFFSETS: readonly Vector3[] = [
  { x: 0, y: 0, z: 0 },
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];

interface SignSideSnapshot {
  text: RawMessage | string;
  dyeColor?: DyeColor;
}

interface SignSnapshot {
  front: SignSideSnapshot;
  back: SignSideSnapshot;
  waxed: boolean;
}

interface FragileBlockSnapshot {
  dimensionId: string;
  location: Vector3;
  typeId: string;
  states: Record<string, boolean | number | string>;
  waterlogged: boolean;
  sign?: SignSnapshot;
}

export interface PistonDestroyedContainerSnapshot {
  structureId: string;
  dimensionId: string;
  location: Vector3;
  typeId: string;
}

let destroyedContainerSnapshotSequence = 0;

function locationKey(dimensionId: string, location: Vector3): string {
  return `${dimensionId}:${Math.floor(location.x)},${Math.floor(location.y)},${Math.floor(location.z)}`;
}

function cloneRawMessage(message: RawMessage): RawMessage {
  return JSON.parse(JSON.stringify(message)) as RawMessage;
}

function captureSignSide(sign: BlockSignComponent, side: SignSide): SignSideSnapshot {
  const raw = sign.getRawText(side);
  return {
    text: raw ? cloneRawMessage(raw) : (sign.getText(side) ?? ""),
    dyeColor: sign.getTextDyeColor(side),
  };
}

function captureSign(block: Block): SignSnapshot | undefined {
  try {
    const sign = block.getComponent(BlockSignComponent.componentId) as BlockSignComponent | undefined;
    if (!sign) return undefined;
    return {
      front: captureSignSide(sign, SignSide.Front),
      back: captureSignSide(sign, SignSide.Back),
      waxed: sign.isWaxed,
    };
  } catch {
    return undefined;
  }
}

function restoreSign(block: Block, snapshot: SignSnapshot | undefined): void {
  if (!snapshot) return;
  try {
    const sign = block.getComponent(BlockSignComponent.componentId) as BlockSignComponent | undefined;
    if (!sign) return;
    sign.setText(snapshot.front.text, SignSide.Front);
    sign.setText(snapshot.back.text, SignSide.Back);
    sign.setTextDyeColor(snapshot.front.dyeColor, SignSide.Front);
    sign.setTextDyeColor(snapshot.back.dyeColor, SignSide.Back);
    sign.setWaxed(snapshot.waxed);
  } catch {
    /* ignore unsupported sign state on older runtime variants */
  }
}

/** 方块会被活塞直接破坏，或在相邻支撑方块移动时因方块更新掉落。 */
export function isFragilePistonAffectedBlock(typeId: string): boolean {
  return (
    typeId.includes("torch") ||
    typeId.includes("button") ||
    typeId.includes("pressure_plate") ||
    typeId.includes("repeater") ||
    typeId.includes("comparator") ||
    typeId.includes("redstone_wire") ||
    typeId.includes("tripwire") ||
    typeId.includes("sapling") ||
    typeId.includes("mushroom") ||
    typeId.includes("flower") ||
    typeId.includes("tulip") ||
    typeId.includes("orchid") ||
    typeId.includes("dandelion") ||
    typeId.includes("allium") ||
    typeId.includes("azure_bluet") ||
    typeId.includes("lily_of_the_valley") ||
    typeId.includes("cornflower") ||
    typeId.includes("eyeblossom") ||
    typeId.includes("bush") ||
    typeId.includes("crop") ||
    typeId.includes("wheat") ||
    typeId.includes("carrots") ||
    typeId.includes("potatoes") ||
    typeId.includes("beetroot") ||
    typeId.includes("nether_wart") ||
    typeId.includes("cocoa") ||
    typeId.includes("reeds") ||
    typeId.includes("sugar_cane") ||
    typeId.includes("bamboo") ||
    typeId.includes("cactus") ||
    typeId.includes("stem") ||
    typeId.includes("snow_layer") ||
    typeId.includes("carpet") ||
    typeId.includes("rail") ||
    typeId.includes("lantern") ||
    typeId.includes("ladder") ||
    typeId.includes("vine") ||
    typeId.includes("lichen") ||
    typeId.includes("dripleaf") ||
    typeId.includes("dripstone") ||
    typeId.includes("candle") ||
    typeId.includes("flower_pot") ||
    typeId.includes("sign") ||
    typeId === "minecraft:tallgrass" ||
    typeId === "minecraft:short_grass" ||
    typeId === "minecraft:fern" ||
    typeId === "minecraft:large_fern" ||
    typeId === "minecraft:double_plant" ||
    typeId === "minecraft:waterlily" ||
    typeId === "minecraft:seagrass" ||
    typeId === "minecraft:kelp" ||
    typeId === "minecraft:nether_sprouts" ||
    typeId === "minecraft:lever" ||
    typeId === "minecraft:web"
  );
}

class FragileBlockCache {
  private readonly entries = new Map<string, FragileBlockSnapshot>();
  private readonly destroyedContainers = new Map<string, PistonDestroyedContainerSnapshot>();

  private deleteDestroyedContainerSnapshot(snapshot: PistonDestroyedContainerSnapshot | undefined): void {
    if (!snapshot) return;
    try {
      world.structureManager.delete(snapshot.structureId);
    } catch {
      /* structure may already have been removed during reload */
    }
  }

  private removeDestroyedContainer(dimensionId: string, location: Vector3): void {
    const key = locationKey(dimensionId, location);
    const previous = this.destroyedContainers.get(key);
    this.destroyedContainers.delete(key);
    this.deleteDestroyedContainerSnapshot(previous);
  }

  private captureDestroyedContainer(block: Block): void {
    const key = locationKey(block.dimension.id, block.location);
    const location = {
      x: Math.floor(block.location.x),
      y: Math.floor(block.location.y),
      z: Math.floor(block.location.z),
    };
    const structureId = `creeper_menu:piston_boundary_container_${++destroyedContainerSnapshotSequence}`;
    try {
      world.structureManager.createFromWorld(structureId, block.dimension, location, location, {
        includeBlocks: true,
        includeEntities: false,
        saveMode: StructureSaveMode.Memory,
      });
    } catch {
      return;
    }

    const previous = this.destroyedContainers.get(key);
    this.destroyedContainers.delete(key);
    this.destroyedContainers.set(key, {
      structureId,
      dimensionId: block.dimension.id,
      location,
      typeId: block.typeId,
    });
    this.deleteDestroyedContainerSnapshot(previous);

    while (this.destroyedContainers.size > MAX_DESTROYED_CONTAINER_CACHE_ENTRIES) {
      const oldestKey = this.destroyedContainers.keys().next().value as string | undefined;
      if (!oldestKey) break;
      const oldest = this.destroyedContainers.get(oldestKey);
      this.destroyedContainers.delete(oldestKey);
      this.deleteDestroyedContainerSnapshot(oldest);
    }
  }

  captureBlock(block: Block): void {
    const key = locationKey(block.dimension.id, block.location);
    try {
      if (isPistonDestroyedContainerType(block.typeId)) {
        this.entries.delete(key);
        this.captureDestroyedContainer(block);
        return;
      }
      this.removeDestroyedContainer(block.dimension.id, block.location);
      if (!isFragilePistonAffectedBlock(block.typeId)) {
        this.entries.delete(key);
        return;
      }
      this.entries.delete(key);
      this.entries.set(key, {
        dimensionId: block.dimension.id,
        location: {
          x: Math.floor(block.location.x),
          y: Math.floor(block.location.y),
          z: Math.floor(block.location.z),
        },
        typeId: block.typeId,
        states: block.permutation.getAllStates(),
        waterlogged: block.isWaterlogged,
        sign: captureSign(block),
      });
      while (this.entries.size > MAX_FRAGILE_BLOCK_CACHE_ENTRIES) {
        const oldestKey = this.entries.keys().next().value as string | undefined;
        if (!oldestKey) break;
        this.entries.delete(oldestKey);
      }
    } catch {
      /* ignore invalid/unloaded blocks */
    }
  }

  remove(dimensionId: string, location: Vector3): void {
    this.entries.delete(locationKey(dimensionId, location));
    this.removeDestroyedContainer(dimensionId, location);
  }

  getDestroyedContainerSnapshots(
    dimension: Dimension,
    locations: readonly Vector3[]
  ): PistonDestroyedContainerSnapshot[] {
    const snapshots: PistonDestroyedContainerSnapshot[] = [];
    const visited = new Set<string>();
    for (const location of locations) {
      const key = locationKey(dimension.id, location);
      if (visited.has(key)) continue;
      visited.add(key);
      const snapshot = this.destroyedContainers.get(key);
      if (snapshot?.dimensionId === dimension.id) snapshots.push(snapshot);
    }
    return snapshots;
  }

  refreshLocations(
    dimension: Dimension,
    locations: Iterable<Vector3>,
    shouldCache?: (location: Vector3) => boolean
  ): void {
    const visited = new Set<string>();
    for (const location of locations) {
      const key = locationKey(dimension.id, location);
      if (visited.has(key)) continue;
      visited.add(key);
      try {
        if (shouldCache && !shouldCache(location)) {
          this.remove(dimension.id, location);
          continue;
        }
        const block = dimension.getBlock(location);
        if (block) this.captureBlock(block);
      } catch {
        /* ignore unloaded/out-of-world positions */
      }
    }
  }

  refreshPistonCorridor(
    dimension: Dimension,
    pistonLocation: Vector3,
    direction: Vector3,
    shouldCache?: (location: Vector3) => boolean
  ): void {
    const locations: Vector3[] = [];
    for (let distance = 1; distance <= 13; distance++) {
      const center = {
        x: pistonLocation.x + direction.x * distance,
        y: pistonLocation.y + direction.y * distance,
        z: pistonLocation.z + direction.z * distance,
      };
      for (const offset of ADJACENT_OFFSETS) {
        locations.push({ x: center.x + offset.x, y: center.y + offset.y, z: center.z + offset.z });
      }
    }
    this.refreshLocations(dimension, locations, shouldCache);
  }

  restoreAffected(dimension: Dimension, movedLocations: readonly Vector3[]): number {
    const keys = new Set<string>();
    for (const location of movedLocations) {
      for (const offset of ADJACENT_OFFSETS) {
        keys.add(
          locationKey(dimension.id, {
            x: location.x + offset.x,
            y: location.y + offset.y,
            z: location.z + offset.z,
          })
        );
      }
    }

    let restored = 0;
    for (const key of keys) {
      const snapshot = this.entries.get(key);
      if (!snapshot || snapshot.dimensionId !== dimension.id) continue;
      try {
        const block = dimension.getBlock(snapshot.location);
        if (!block) continue;
        block.setPermutation(BlockPermutation.resolve(snapshot.typeId, snapshot.states as any));
        if (snapshot.waterlogged) block.setWaterlogged(true);
        restoreSign(block, snapshot.sign);
        restored += 1;
      } catch {
        /* keep cache entry so a later retry remains possible */
      }
    }
    return restored;
  }

  get size(): number {
    return this.entries.size + this.destroyedContainers.size;
  }
}

export const fragileBlockCache = new FragileBlockCache();
export default fragileBlockCache;
