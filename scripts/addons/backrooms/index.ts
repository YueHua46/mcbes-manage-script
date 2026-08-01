import { CustomDimensionAlreadyRegisteredError, system, world, type Player, type Vector3 } from "@minecraft/server";
import { registerIsolatedDimension } from "../../shared/dimension-isolation";
import { registerBackroomsAmbience } from "./ambience";
import { registerBackroomsAnomalies } from "./anomalies";
import { registerBackroomsChatIsolation } from "./chat";
import { BACKROOMS_DIMENSION_ID, BACKROOMS_RECOVERY_Y, BACKROOMS_WALK_Y } from "./constants";
import { BackroomsLayoutAdapter } from "./layout-adapter";
import { findSafeLandingCell } from "./core";
import { registerBackroomsLifeformDirector } from "./lifeform";
import { registerBackroomsLifeformVocals } from "./lifeform/vocals";
import { getBackroomsManifestation } from "./manifestation";
import { registerBackroomsProtection } from "./protection";
import { registerBackroomsVoices } from "./voices";
import {
  BackroomsGenerationQueue,
  BackroomsPlayerFrontier,
  BackroomsRegionBuilder,
  BackroomsRegionMarkerStore,
  DEFAULT_BACKROOMS_RUNTIME_CONFIG,
  type BackroomsRuntimeConfig,
} from "./runtime";

const runtimeConfig: BackroomsRuntimeConfig = {
  ...DEFAULT_BACKROOMS_RUNTIME_CONFIG,
  palette: {
    ...DEFAULT_BACKROOMS_RUNTIME_CONFIG.palette,
    floor: "yuehua:backrooms_carpet",
    wall: "yuehua:backrooms_wallpaper",
    ceiling: "yuehua:backrooms_ceiling_tile",
    lamp: "yuehua:backrooms_fluorescent_on",
    decoration: "yuehua:backrooms_carpet_damp",
  },
};

let queue: BackroomsGenerationQueue | undefined;
let frontier: BackroomsPlayerFrontier | undefined;
let eventsRegistered = false;
let recoveryMonitorStarted = false;
const recoveringPlayers = new Set<string>();
let layouts: BackroomsLayoutAdapter | undefined;

system.beforeEvents.startup.subscribe((event) => {
  try {
    event.dimensionRegistry.registerCustomDimension(BACKROOMS_DIMENSION_ID);
  } catch (error) {
    if (!(error instanceof CustomDimensionAlreadyRegisteredError)) throw error;
  }
});

function removeStaleTickingAreas(): void {
  try {
    for (const area of world.tickingAreaManager.getAllTickingAreas()) {
      if (area.identifier.startsWith("br_")) world.tickingAreaManager.removeTickingArea(area);
    }
  } catch (error) {
    console.warn(`[Backrooms] 清理旧常加载区失败：${String(error)}`);
  }
}

function startRuntime(): void {
  if (queue) return;
  removeStaleTickingAreas();
  if (world.tickingAreaManager.maxChunkCount < 16) {
    console.error(
      `[Backrooms] 生成器需要至少 16 个脚本常加载区块，当前上限为 ${world.tickingAreaManager.maxChunkCount}`
    );
    return;
  }
  console.info(
    `[Backrooms] 常加载区块 ${world.tickingAreaManager.chunkCount}/${world.tickingAreaManager.maxChunkCount}`
  );
  layouts = new BackroomsLayoutAdapter(world.seed);
  const lifeformDirector = registerBackroomsLifeformDirector({
    getLayout: (region) => layouts?.getLayout(region),
    getManifestation: getBackroomsManifestation,
  });
  registerBackroomsVoices({
    onLureEligible: (player) => lifeformDirector.markVoiceLureEligible(player),
  });
  const markers = new BackroomsRegionMarkerStore(runtimeConfig);
  const builder = new BackroomsRegionBuilder(runtimeConfig, markers, layouts);
  queue = new BackroomsGenerationQueue(runtimeConfig, layouts, builder);
  frontier = new BackroomsPlayerFrontier(runtimeConfig, queue);
  queue.start();
  frontier.start();
  startRecoveryMonitor();
  console.info("[Backrooms] 确定性无限区域生成器已启动");
}

function startRecoveryMonitor(): void {
  if (recoveryMonitorStarted) return;
  recoveryMonitorStarted = true;
  system.runInterval(() => {
    const dimension = world.getDimension(BACKROOMS_DIMENSION_ID);
    for (const player of dimension.getPlayers()) {
      if (player.location.y >= BACKROOMS_RECOVERY_Y || recoveringPlayers.has(player.id)) continue;
      recoveringPlayers.add(player.id);
      void teleportPlayerToBackrooms(player)
        .then(() => player.sendMessage("§8你坠落了很久，却再次落回潮湿的黄色地毯。"))
        .catch((error) => console.warn(`[Backrooms] 坠落救援失败：${String(error)}`))
        .finally(() => recoveringPlayers.delete(player.id));
    }
  }, 5);
}

function registerRuntimeEvents(): void {
  if (eventsRegistered) return;
  eventsRegistered = true;
  registerBackroomsProtection();
  registerBackroomsChatIsolation();
  registerBackroomsAmbience();
  registerBackroomsLifeformVocals();
  registerBackroomsAnomalies();
}

registerRuntimeEvents();

world.afterEvents.worldLoad.subscribe(() => {
  system.run(() => {
    registerIsolatedDimension(BACKROOMS_DIMENSION_ID);
    startRuntime();
  });
});

export async function ensureBackroomsRegionReady(region: { rx: number; rz: number }): Promise<void> {
  if (!queue) startRuntime();
  if (!queue) throw new Error("Backrooms 生成器尚未启动");
  await queue.ensureRegionReady(region);
}

/** Resolves an arbitrary requested coordinate to a generated, head-clear 2x2 pad. */
export async function ensureBackroomsLocationReady(location: Vector3): Promise<Vector3> {
  if (!layouts) startRuntime();
  if (!layouts) throw new Error("Backrooms 布局器尚未启动");
  const region = {
    rx: Math.floor(location.x / runtimeConfig.regionSize),
    rz: Math.floor(location.z / runtimeConfig.regionSize),
  };
  await ensureBackroomsRegionReady(region);
  const layout = layouts.getLayout(region);
  const localX = location.x - region.rx * runtimeConfig.regionSize;
  const localZ = location.z - region.rz * runtimeConfig.regionSize;
  const landing = findSafeLandingCell(layout, { x: localX, z: localZ });
  return {
    x: region.rx * runtimeConfig.regionSize + landing.x + 0.5,
    y: BACKROOMS_WALK_Y,
    z: region.rz * runtimeConfig.regionSize + landing.z + 0.5,
  };
}

export async function teleportPlayerToBackrooms(player: Player): Promise<Vector3> {
  const manifestation = getBackroomsManifestation(player);
  await ensureBackroomsRegionReady({ rx: manifestation.regionX, rz: manifestation.regionZ });
  const dimension = world.getDimension(BACKROOMS_DIMENSION_ID);
  player.teleport(manifestation.spawn, { dimension, keepVelocity: false });
  return manifestation.spawn;
}

export { BACKROOMS_ALIAS, BACKROOMS_DIMENSION_ID, BACKROOMS_DISPLAY_NAME } from "./constants";
export * from "./core";
