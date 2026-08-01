import {
  BlockVolume,
  ListBlockVolume,
  system,
  type BlockVolumeBase,
  type Dimension,
  type Vector3,
  world,
} from "@minecraft/server";
import {
  type BackroomsRegion,
  type BackroomsRuntimeConfig,
  type RegionBuildPlan,
  type RegionGate,
  type RegionGateProvider,
  type RelativeVolume,
  neighborRegion,
  regionKey,
  regionOrigin,
  sameRegion,
} from "./contracts";
import { BackroomsRegionMarkerStore } from "./region-marker";

export class BackroomsTickingAreaCapacityError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "BackroomsTickingAreaCapacityError";
  }
}

export type RegionBuildResult = "already-ready" | "built" | "rebuilt";

let tickingAreaSequence = 0;

function normalizedVolume(from: Vector3, to: Vector3): BlockVolume {
  return new BlockVolume(
    { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), z: Math.min(from.z, to.z) },
    { x: Math.max(from.x, to.x), y: Math.max(from.y, to.y), z: Math.max(from.z, to.z) }
  );
}

function clampInteger(value: number, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} 必须是 ${min}..${max} 的整数，实际为 ${value}`);
  }
  return value;
}

export class BackroomsRegionBuilder {
  private fillOperations = 0;
  private filledBlocks = 0;

  public constructor(
    private readonly config: BackroomsRuntimeConfig,
    private readonly markers: BackroomsRegionMarkerStore,
    private readonly gateProvider?: RegionGateProvider
  ) {
    if (config.ceilingY - config.floorY < 3) throw new Error("Backrooms ceilingY 必须至少比 floorY 高 3 格");
    if (config.markerY >= config.floorY - 1) throw new Error("Backrooms markerY 必须位于安全基层下方");
    if (config.regionSize < 16 || config.regionSize % 16 !== 0) {
      throw new Error("Backrooms regionSize 必须是不小于 16 的区块整数倍");
    }
  }

  public async build(region: BackroomsRegion, plan: RegionBuildPlan): Promise<RegionBuildResult> {
    if (!sameRegion(region, plan.region)) {
      throw new Error(`布局区域 ${regionKey(plan.region)} 与构建区域 ${regionKey(region)} 不一致`);
    }

    const dimension = world.getDimension(this.config.dimensionId);
    const tickingAreaId = await this.createRegionTickingArea(dimension, region, "build");
    let initialState: ReturnType<BackroomsRegionMarkerStore["read"]> = "unknown";

    try {
      initialState = this.markers.read(dimension, region);
      if (initialState === "unknown") throw new Error(`区域 ${regionKey(region)} 已加载但 marker 仍不可读取`);
      if (initialState === "ready") return "already-ready";

      // A building marker is a write-ahead record from an interrupted build.
      this.markers.write(dimension, region, "building");
      this.fillOperations = 0;
      this.filledBlocks = 0;
      // A fresh void region needs no 28k-block air clear. Interrupted transactions do.
      if (initialState === "building") await this.clearGenerationVolume(dimension, region);
      await this.buildShell(dimension, region);
      await this.placeVolumes(dimension, region, plan.walls, this.config.palette.wall, "墙体");
      await this.placeBlocks(dimension, region, plan.lamps ?? [], this.config.palette.lamp, "灯具");
      await this.placeBlocks(dimension, region, plan.decorations ?? [], this.config.palette.decoration, "装饰");
      await this.placeVoids(dimension, region, plan.voids ?? []);
      if (plan.safeSpawn) await this.commitSafeSpawn(dimension, region, plan.safeSpawn);

      // Commit last. A crash before this line leaves "building" and is rebuilt on the next request.
      this.markers.write(dimension, region, "ready");
      return initialState === "building" ? "rebuilt" : "built";
    } finally {
      this.removeTickingArea(tickingAreaId);
    }
  }

  /**
   * Opens only shared edges whose neighbor is already known ready. Each region owns
   * its boundary wall, so both one-block walls are carved in one small ticking area.
   */
  public async connectReadyNeighbors(
    region: BackroomsRegion,
    isKnownReady: (region: BackroomsRegion) => boolean
  ): Promise<void> {
    if (!this.gateProvider) return;
    const dimension = world.getDimension(this.config.dimensionId);

    for (const gate of this.gateProvider.getGates(region)) {
      const neighbor = neighborRegion(region, gate.side);
      this.validateGate(gate);
      const tickingAreaId = await this.createBoundaryTickingArea(dimension, region, gate, "gate");
      try {
        // ready LRU 只是优化；重启或缓存淘汰后必须以地下 marker 为最终事实来源。
        if (!isKnownReady(neighbor) && this.markers.read(dimension, neighbor) !== "ready") continue;
        await this.carveSharedGate(dimension, region, gate);
      } finally {
        this.removeTickingArea(tickingAreaId);
      }
    }
  }

  private async clearGenerationVolume(dimension: Dimension, region: BackroomsRegion): Promise<void> {
    const origin = regionOrigin(region, this.config.regionSize);
    await this.fill(
      dimension,
      new BlockVolume(
        { x: origin.x, y: this.config.floorY - 1, z: origin.z },
        {
          x: origin.x + this.config.regionSize - 1,
          y: this.config.ceilingY,
          z: origin.z + this.config.regionSize - 1,
        }
      ),
      "minecraft:air"
    );
  }

  private async buildShell(dimension: Dimension, region: BackroomsRegion): Promise<void> {
    const origin = regionOrigin(region, this.config.regionSize);
    const maxX = origin.x + this.config.regionSize - 1;
    const maxZ = origin.z + this.config.regionSize - 1;
    const wallBottom = this.config.floorY + 1;
    const wallTop = this.config.ceilingY - 1;

    // A complete safe shell exists before any partitions or decorations are attempted.
    await this.fill(
      dimension,
      new BlockVolume(
        { x: origin.x, y: this.config.floorY - 1, z: origin.z },
        { x: maxX, y: this.config.floorY - 1, z: maxZ }
      ),
      this.config.palette.foundation
    );
    await this.fill(
      dimension,
      new BlockVolume({ x: origin.x, y: this.config.floorY, z: origin.z }, { x: maxX, y: this.config.floorY, z: maxZ }),
      this.config.palette.floor
    );
    await this.fill(
      dimension,
      new BlockVolume(
        { x: origin.x, y: this.config.ceilingY, z: origin.z },
        { x: maxX, y: this.config.ceilingY, z: maxZ }
      ),
      this.config.palette.ceiling
    );
    await this.fill(
      dimension,
      new BlockVolume({ x: origin.x, y: wallBottom, z: origin.z }, { x: maxX, y: wallTop, z: origin.z }),
      this.config.palette.wall
    );
    await this.fill(
      dimension,
      new BlockVolume({ x: origin.x, y: wallBottom, z: maxZ }, { x: maxX, y: wallTop, z: maxZ }),
      this.config.palette.wall
    );
    await this.fill(
      dimension,
      new BlockVolume({ x: origin.x, y: wallBottom, z: origin.z }, { x: origin.x, y: wallTop, z: maxZ }),
      this.config.palette.wall
    );
    await this.fill(
      dimension,
      new BlockVolume({ x: maxX, y: wallBottom, z: origin.z }, { x: maxX, y: wallTop, z: maxZ }),
      this.config.palette.wall
    );
  }

  private async placeVolumes(
    dimension: Dimension,
    region: BackroomsRegion,
    volumes: readonly RelativeVolume[],
    fallbackBlockId: string,
    label: string
  ): Promise<void> {
    const origin = regionOrigin(region, this.config.regionSize);
    const grouped = new Map<string, Vector3[]>();
    for (const item of volumes) {
      this.validateRelativeLocation(item.from, label);
      this.validateRelativeLocation(item.to, label);
      const volume = normalizedVolume(
        { x: origin.x + item.from.x, y: this.config.floorY + item.from.y, z: origin.z + item.from.z },
        { x: origin.x + item.to.x, y: this.config.floorY + item.to.y, z: origin.z + item.to.z }
      );
      const blockId = item.blockId ?? fallbackBlockId;
      const locations = grouped.get(blockId) ?? [];
      for (const location of volume.getBlockLocationIterator()) locations.push(location);
      grouped.set(blockId, locations);
    }
    for (const [blockId, locations] of grouped) {
      if (locations.length) await this.fill(dimension, new ListBlockVolume(locations), blockId);
    }
  }

  private async placeBlocks(
    dimension: Dimension,
    region: BackroomsRegion,
    placements: readonly { location: Vector3; blockId?: string }[],
    fallbackBlockId: string,
    label: string
  ): Promise<void> {
    const origin = regionOrigin(region, this.config.regionSize);
    const grouped = new Map<string, Vector3[]>();
    for (const placement of placements) {
      this.validateRelativeLocation(placement.location, label);
      const location = {
        x: origin.x + placement.location.x,
        y: this.config.floorY + placement.location.y,
        z: origin.z + placement.location.z,
      };
      const blockId = placement.blockId ?? fallbackBlockId;
      const locations = grouped.get(blockId) ?? [];
      locations.push(location);
      grouped.set(blockId, locations);
    }
    for (const [blockId, locations] of grouped) {
      if (locations.length) await this.fill(dimension, new ListBlockVolume(locations), blockId);
    }
  }

  private async commitSafeSpawn(dimension: Dimension, region: BackroomsRegion, spawn: Vector3): Promise<void> {
    this.validateRelativeLocation(spawn, "safeSpawn");
    if (spawn.x >= this.config.regionSize - 1 || spawn.z >= this.config.regionSize - 1) {
      throw new Error("safeSpawn 的 2x2 落点越过区域边界");
    }
    const origin = regionOrigin(region, this.config.regionSize);
    await this.fill(
      dimension,
      new BlockVolume(
        { x: origin.x + spawn.x, y: this.config.floorY, z: origin.z + spawn.z },
        { x: origin.x + spawn.x + 1, y: this.config.floorY, z: origin.z + spawn.z + 1 }
      ),
      this.config.palette.floor
    );
    await this.fill(
      dimension,
      new BlockVolume(
        { x: origin.x + spawn.x, y: this.config.floorY + 1, z: origin.z + spawn.z },
        { x: origin.x + spawn.x + 1, y: this.config.floorY + 3, z: origin.z + spawn.z + 1 }
      ),
      "minecraft:air"
    );
  }

  private async placeVoids(
    dimension: Dimension,
    region: BackroomsRegion,
    volumes: readonly RelativeVolume[]
  ): Promise<void> {
    const origin = regionOrigin(region, this.config.regionSize);
    const locations: Vector3[] = [];
    for (const item of volumes) {
      clampInteger(item.from.x, 1, this.config.regionSize - 2, "void.x");
      clampInteger(item.to.x, 1, this.config.regionSize - 2, "void.x");
      clampInteger(item.from.z, 1, this.config.regionSize - 2, "void.z");
      clampInteger(item.to.z, 1, this.config.regionSize - 2, "void.z");
      clampInteger(item.from.y, -1, 0, "void.y");
      clampInteger(item.to.y, -1, 0, "void.y");
      const volume = normalizedVolume(
        { x: origin.x + item.from.x, y: this.config.floorY + item.from.y, z: origin.z + item.from.z },
        { x: origin.x + item.to.x, y: this.config.floorY + item.to.y, z: origin.z + item.to.z }
      );
      for (const location of volume.getBlockLocationIterator()) locations.push(location);
    }
    if (locations.length) await this.fill(dimension, new ListBlockVolume(locations), "minecraft:air");
  }

  private validateRelativeLocation(location: Vector3, label: string): void {
    clampInteger(location.x, 0, this.config.regionSize - 1, `${label}.x`);
    clampInteger(location.z, 0, this.config.regionSize - 1, `${label}.z`);
    clampInteger(location.y, 0, this.config.ceilingY - this.config.floorY, `${label}.y`);
  }

  private validateGate(gate: RegionGate): void {
    clampInteger(gate.offset, 1, this.config.regionSize - 2, "gate.offset");
    clampInteger(gate.width, 1, this.config.regionSize - 2, "gate.width");
    clampInteger(gate.height, 2, this.config.ceilingY - this.config.floorY - 1, "gate.height");
    if (gate.offset + gate.width > this.config.regionSize - 1) {
      throw new Error(`边界门洞越界：offset=${gate.offset}, width=${gate.width}`);
    }
  }

  private async carveSharedGate(dimension: Dimension, region: BackroomsRegion, gate: RegionGate): Promise<void> {
    const origin = regionOrigin(region, this.config.regionSize);
    const y1 = this.config.floorY + 1;
    const y2 = y1 + gate.height - 1;
    let from: Vector3;
    let to: Vector3;

    switch (gate.side) {
      case "north":
        from = { x: origin.x + gate.offset, y: y1, z: origin.z - 1 };
        to = { x: from.x + gate.width - 1, y: y2, z: origin.z };
        break;
      case "south":
        from = { x: origin.x + gate.offset, y: y1, z: origin.z + this.config.regionSize - 1 };
        to = { x: from.x + gate.width - 1, y: y2, z: origin.z + this.config.regionSize };
        break;
      case "west":
        from = { x: origin.x - 1, y: y1, z: origin.z + gate.offset };
        to = { x: origin.x, y: y2, z: from.z + gate.width - 1 };
        break;
      case "east":
        from = { x: origin.x + this.config.regionSize - 1, y: y1, z: origin.z + gate.offset };
        to = { x: origin.x + this.config.regionSize, y: y2, z: from.z + gate.width - 1 };
        break;
    }

    await this.fill(dimension, normalizedVolume(from, to), "minecraft:air");
  }

  private async fill(dimension: Dimension, volume: BlockVolumeBase, blockId: string): Promise<void> {
    const capacity = volume.getCapacity();
    if (capacity > this.config.fillBlocksPerTick) {
      let batch: Vector3[] = [];
      for (const location of volume.getBlockLocationIterator()) {
        batch.push(location);
        if (batch.length === this.config.fillBlocksPerTick) {
          await this.fill(dimension, new ListBlockVolume(batch), blockId);
          batch = [];
        }
      }
      if (batch.length) await this.fill(dimension, new ListBlockVolume(batch), blockId);
      return;
    }

    if (
      this.fillOperations >= this.config.fillOperationsPerTick ||
      this.filledBlocks + capacity > this.config.fillBlocksPerTick
    ) {
      this.fillOperations = 0;
      this.filledBlocks = 0;
      await system.waitTicks(1);
    }
    dimension.fillBlocks(volume, blockId);
    this.fillOperations++;
    this.filledBlocks += capacity;
  }

  private async createRegionTickingArea(
    dimension: Dimension,
    region: BackroomsRegion,
    purpose: string
  ): Promise<string> {
    const origin = regionOrigin(region, this.config.regionSize);
    return this.createTickingArea(
      dimension,
      { x: origin.x, z: origin.z },
      { x: origin.x + this.config.regionSize - 1, z: origin.z + this.config.regionSize - 1 },
      region,
      purpose
    );
  }

  private async createBoundaryTickingArea(
    dimension: Dimension,
    region: BackroomsRegion,
    gate: RegionGate,
    purpose: string
  ): Promise<string> {
    const origin = regionOrigin(region, this.config.regionSize);
    let from: { x: number; z: number };
    let to: { x: number; z: number };
    if (gate.side === "north" || gate.side === "south") {
      const boundaryZ = gate.side === "north" ? origin.z : origin.z + this.config.regionSize - 1;
      from = { x: origin.x, z: boundaryZ - 1 };
      to = { x: origin.x + this.config.regionSize - 1, z: boundaryZ + 1 };
    } else {
      const boundaryX = gate.side === "west" ? origin.x : origin.x + this.config.regionSize - 1;
      from = { x: boundaryX - 1, z: origin.z };
      to = { x: boundaryX + 1, z: origin.z + this.config.regionSize - 1 };
    }
    return this.createTickingArea(dimension, from, to, region, purpose);
  }

  private async createTickingArea(
    dimension: Dimension,
    from: { x: number; z: number },
    to: { x: number; z: number },
    region: BackroomsRegion,
    purpose: string
  ): Promise<string> {
    const manager = world.tickingAreaManager;
    const options = {
      dimension,
      from: { x: from.x, y: dimension.heightRange.min, z: from.z },
      to: { x: to.x, y: dimension.heightRange.max - 1, z: to.z },
    };
    if (!manager.hasCapacity(options)) {
      throw new BackroomsTickingAreaCapacityError(`区域 ${regionKey(region)} 的临时常加载区容量不足`);
    }

    tickingAreaSequence = (tickingAreaSequence + 1) % 1_000_000;
    const identifier = `br_${purpose}_${region.rx}_${region.rz}_${system.currentTick}_${tickingAreaSequence}`;
    await manager.createTickingArea(identifier, options);
    return identifier;
  }

  private removeTickingArea(identifier: string): void {
    try {
      const manager = world.tickingAreaManager;
      if (manager.hasTickingArea(identifier)) manager.removeTickingArea(identifier);
    } catch (error) {
      console.warn(`[Backrooms] 临时常加载区 ${identifier} 清理失败：${String(error)}`);
    }
  }
}
