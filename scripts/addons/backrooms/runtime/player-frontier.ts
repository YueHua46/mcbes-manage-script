import { system, world, type Vector3 } from "@minecraft/server";
import {
  type BackroomsRegion,
  type BackroomsRuntimeConfig,
  type FrontierRequestSink,
  locationToRegion,
  regionKey,
} from "./contracts";

/** Turns nearby players into bounded, direction-aware generation requests. */
export class BackroomsPlayerFrontier {
  private readonly previousLocations = new Map<string, Vector3>();
  private intervalId: number | undefined;

  public constructor(
    private readonly config: BackroomsRuntimeConfig,
    private readonly requests: FrontierRequestSink
  ) {}

  public start(): void {
    if (this.intervalId !== undefined) return;
    this.intervalId = system.runInterval(() => this.scan(), this.config.frontierScanIntervalTicks);
  }

  public stop(): void {
    if (this.intervalId === undefined) return;
    system.clearRun(this.intervalId);
    this.intervalId = undefined;
    this.previousLocations.clear();
  }

  public scan(): void {
    const dimension = world.getDimension(this.config.dimensionId);
    const players = dimension.getPlayers();
    const present = new Set<string>();

    for (const player of players) {
      present.add(player.id);
      const location = player.location;
      const center = locationToRegion(location, this.config.regionSize);
      const requested = new Set<string>();

      for (let dz = -this.config.preloadRadius; dz <= this.config.preloadRadius; dz++) {
        for (let dx = -this.config.preloadRadius; dx <= this.config.preloadRadius; dx++) {
          const region = { rx: center.rx + dx, rz: center.rz + dz };
          const distance = Math.max(Math.abs(dx), Math.abs(dz));
          this.requestOnce(requested, region, distance * 100);
        }
      }

      const previous = this.previousLocations.get(player.id);
      if (previous) {
        const dx = location.x - previous.x;
        const dz = location.z - previous.z;
        const length = Math.hypot(dx, dz);
        if (length >= 0.25) {
          const stepX = Math.abs(dx / length) >= 0.35 ? Math.sign(dx) : 0;
          const stepZ = Math.abs(dz / length) >= 0.35 ? Math.sign(dz) : 0;
          for (let step = 1; step <= this.config.forwardPreloadRegions; step++) {
            this.requestOnce(requested, { rx: center.rx + stepX * step, rz: center.rz + stepZ * step }, 50 + step * 10);
          }
        }
      }
      this.previousLocations.set(player.id, { ...location });
    }

    for (const playerId of this.previousLocations.keys()) {
      if (!present.has(playerId)) this.previousLocations.delete(playerId);
    }
  }

  private requestOnce(requested: Set<string>, region: BackroomsRegion, priority: number): void {
    const key = regionKey(region);
    if (requested.has(key)) return;
    requested.add(key);
    this.requests.request(region, priority);
  }
}
