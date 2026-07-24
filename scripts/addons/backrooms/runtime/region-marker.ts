import { BlockVolume, ListBlockVolume, type Dimension, type Vector3 } from "@minecraft/server";
import {
  type BackroomsRegion,
  type BackroomsRuntimeConfig,
  type RegionMarkerState,
  regionOrigin,
} from "./contracts";

/** Persistent, world-local transaction marker stored below the generated floor. */
export class BackroomsRegionMarkerStore {
  public constructor(private readonly config: BackroomsRuntimeConfig) {}

  public getLocation(region: BackroomsRegion): Vector3 {
    const origin = regionOrigin(region, this.config.regionSize);
    return {
      x: origin.x + this.config.markerOffsetX,
      y: this.config.markerY,
      z: origin.z + this.config.markerOffsetZ,
    };
  }

  /** Returns unknown when its chunk is not loaded; callers must not treat that as absent. */
  public read(dimension: Dimension, region: BackroomsRegion): RegionMarkerState {
    try {
      const block = dimension.getBlock(this.getLocation(region));
      if (!block) return "unknown";
      if (block.typeId === this.config.palette.buildingMarker) return "building";
      if (block.typeId === this.config.palette.readyMarker) {
        // Schema v3 uses lapis sentinels instead of the v2 diamond field.
        // An older ready region therefore becomes "building", which deliberately
        // enters the builder's full clear-and-reshell recovery path.
        for (const location of this.getSentinelLocations(region)) {
          if (dimension.getBlock(location)?.typeId !== this.config.palette.readySentinelMarker) {
            return "building";
          }
        }
        return "ready";
      }
      return "absent";
    } catch {
      return "unknown";
    }
  }

  public write(dimension: Dimension, region: BackroomsRegion, state: "building" | "ready"): void {
    const location = this.getLocation(region);
    const blockId = state === "building" ? this.config.palette.buildingMarker : this.config.palette.readyMarker;
    if (state === "ready") {
      dimension.fillBlocks(
        new ListBlockVolume(this.getSentinelLocations(region)),
        this.config.palette.readySentinelMarker,
      );
    }
    // Global commit is deliberately last. Emerald + lapis sentinels is marker schema v3.
    dimension.fillBlocks(new BlockVolume(location, location), blockId);
  }

  private getSentinelLocations(region: BackroomsRegion): Vector3[] {
    const origin = regionOrigin(region, this.config.regionSize);
    const result: Vector3[] = [];
    for (let z = 8; z < this.config.regionSize; z += 16) {
      for (let x = 8; x < this.config.regionSize; x += 16) {
        result.push({ x: origin.x + x, y: this.config.markerY, z: origin.z + z });
      }
    }
    return result;
  }
}
