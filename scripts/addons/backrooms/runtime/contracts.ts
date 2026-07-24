import type { Dimension, Player, Vector3 } from "@minecraft/server";

/** A region coordinate. World-space origins are derived with Math.floor semantics. */
export interface BackroomsRegion {
  rx: number;
  rz: number;
}

export type BackroomsSide = "north" | "east" | "south" | "west";

export interface RelativeVolume {
  from: Vector3;
  to: Vector3;
  /** Falls back to the corresponding runtime palette entry when omitted. */
  blockId?: string;
}

export interface RelativeBlockPlacement {
  location: Vector3;
  /** Falls back to the corresponding runtime palette entry when omitted. */
  blockId?: string;
}

/**
 * Runtime-facing layout contract. Coordinates are relative to a region origin;
 * y is relative to floorY. Core layout code can adapt its grid to this shape.
 */
export interface RegionBuildPlan {
  region: BackroomsRegion;
  walls: RelativeVolume[];
  lamps?: RelativeBlockPlacement[];
  decorations?: RelativeBlockPlacement[];
  /** Volumes removed after the shell; supports relative y=-1 for rare pit clusters. */
  voids?: RelativeVolume[];
  /** Two-by-two, head-clear local landing pad committed before the ready marker. */
  safeSpawn?: Vector3;
}

/** A gate is carved only after both regions on the shared edge are ready. */
export interface RegionGate {
  side: BackroomsSide;
  offset: number;
  width: number;
  height: number;
}

export interface RegionLayoutProvider {
  createPlan(region: BackroomsRegion): RegionBuildPlan | Promise<RegionBuildPlan>;
}

export interface RegionGateProvider {
  getGates(region: BackroomsRegion): readonly RegionGate[];
}

export interface BackroomsBlockPalette {
  foundation: string;
  floor: string;
  wall: string;
  ceiling: string;
  lamp: string;
  decoration: string;
  buildingMarker: string;
  readyMarker: string;
  /** Schema-v3 per-chunk sentinel; changed from diamond to force low-arch migration. */
  readySentinelMarker: string;
}

export interface BackroomsRuntimeConfig {
  dimensionId: string;
  regionSize: number;
  floorY: number;
  ceilingY: number;
  markerY: number;
  markerOffsetX: number;
  markerOffsetZ: number;
  palette: BackroomsBlockPalette;
  fillOperationsPerTick: number;
  fillBlocksPerTick: number;
  maxConcurrentBuilds: number;
  queuePumpIntervalTicks: number;
  maxBuildAttempts: number;
  retryBaseDelayTicks: number;
  maxQueuedRegions: number;
  requestTtlTicks: number;
  ensureTimeoutTicks: number;
  readyCacheSize: number;
  frontierScanIntervalTicks: number;
  preloadRadius: number;
  forwardPreloadRegions: number;
}

export const DEFAULT_BACKROOMS_RUNTIME_CONFIG: BackroomsRuntimeConfig = {
  dimensionId: "yuehua:backrooms",
  regionSize: 64,
  floorY: 99,
  ceilingY: 104,
  markerY: 94,
  markerOffsetX: 2,
  markerOffsetZ: 2,
  palette: {
    foundation: "minecraft:smooth_stone",
    floor: "minecraft:yellow_wool",
    wall: "minecraft:yellow_concrete",
    ceiling: "minecraft:smooth_quartz",
    lamp: "minecraft:ochre_froglight",
    decoration: "minecraft:stripped_birch_wood",
    buildingMarker: "minecraft:redstone_block",
    readyMarker: "minecraft:emerald_block",
    readySentinelMarker: "minecraft:lapis_block",
  },
  fillOperationsPerTick: 8,
  fillBlocksPerTick: 8192,
  maxConcurrentBuilds: 1,
  queuePumpIntervalTicks: 2,
  maxBuildAttempts: 5,
  retryBaseDelayTicks: 20,
  maxQueuedRegions: 512,
  requestTtlTicks: 1200,
  ensureTimeoutTicks: 2400,
  readyCacheSize: 4096,
  frontierScanIntervalTicks: 10,
  preloadRadius: 1,
  forwardPreloadRegions: 1,
};

export type RegionMarkerState = "absent" | "building" | "ready" | "unknown";

export interface RegionBuildContext {
  dimension: Dimension;
  region: BackroomsRegion;
}

export interface FrontierRequestSink {
  request(region: BackroomsRegion, priority?: number): void;
}

export interface FrontierPlayerSnapshot {
  player: Player;
  location: Vector3;
}

export function regionKey(region: BackroomsRegion): string {
  return `${region.rx},${region.rz}`;
}

export function sameRegion(a: BackroomsRegion, b: BackroomsRegion): boolean {
  return a.rx === b.rx && a.rz === b.rz;
}

export function regionOrigin(region: BackroomsRegion, regionSize: number): { x: number; z: number } {
  return { x: region.rx * regionSize, z: region.rz * regionSize };
}

export function locationToRegion(location: Vector3, regionSize: number): BackroomsRegion {
  return {
    rx: Math.floor(location.x / regionSize),
    rz: Math.floor(location.z / regionSize),
  };
}

export function neighborRegion(region: BackroomsRegion, side: BackroomsSide): BackroomsRegion {
  switch (side) {
    case "north":
      return { rx: region.rx, rz: region.rz - 1 };
    case "east":
      return { rx: region.rx + 1, rz: region.rz };
    case "south":
      return { rx: region.rx, rz: region.rz + 1 };
    case "west":
      return { rx: region.rx - 1, rz: region.rz };
  }
}
