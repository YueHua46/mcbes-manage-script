/**
 * 下蹲一键连锁播种（多作物 profile，不含可可豆）
 */

import { world, system, Player, Vector3, type Block } from "@minecraft/server";
import setting from "../system/services/setting";
import { CropProfile, getProfileBySeed } from "./crop-profiles";
import {
  BLOCKS_PER_JOB_SLICE,
  canPlaceCropAt,
  collectPlantableChain,
  getPlayerOrAbort,
  locKey,
  releaseCropJob,
  resolvePlantOrigin,
  tryAcquireCropJob,
  tryConsumeSeed,
  tryPlantProfile,
} from "./crop-common";

type PlantTask = {
  profileId: string;
  location: Vector3;
  seedTypeId: string;
};

type PlantJobContext = {
  playerId: string;
  dimensionId: string;
  profile: CropProfile;
  tasks: PlantTask[];
};

function isPlantEnabled(): boolean {
  return setting.getState("enableCropPlantOneClick") === true;
}

function buildPlantChainTasks(
  player: Player,
  origin: Vector3,
  profile: CropProfile
): PlantTask[] {
  const dimension = player.dimension;
  const exclude = new Set<string>([locKey(origin)]);
  const chain = collectPlantableChain(dimension, origin, profile, exclude);

  return chain
    .filter((location) => canPlaceCropAt(player, location, dimension.id))
    .map((location) => ({
      profileId: profile.id,
      location,
      seedTypeId: profile.seedTypeId,
    }));
}

function *cropPlantJob(ctx: PlantJobContext): Generator<void, void, void> {
  let sliceCount = 0;

  try {
    for (const task of ctx.tasks) {
      const player = getPlayerOrAbort(ctx.playerId);
      if (!player) return;

      if (!canPlaceCropAt(player, task.location, ctx.dimensionId)) continue;
      if (!tryConsumeSeed(player, task.seedTypeId)) break;

      tryPlantProfile(player.dimension, task.location, ctx.profile);

      sliceCount++;
      if (sliceCount >= BLOCKS_PER_JOB_SLICE) {
        sliceCount = 0;
        yield;
      }
    }
  } finally {
    releaseCropJob(ctx.playerId);
  }
}

function schedulePlantJob(player: Player, profile: CropProfile, tasks: PlantTask[]): void {
  if (tasks.length === 0) return;
  if (!tryAcquireCropJob(player.id)) return;

  system.runJob(
    cropPlantJob({
      playerId: player.id,
      dimensionId: player.dimension.id,
      profile,
      tasks,
    })
  );
}

function onPlayerPlantCrop(player: Player, origin: Vector3, profile: CropProfile): void {
  if (!player.isSneaking) return;
  schedulePlantJob(player, profile, buildPlantChainTasks(player, origin, profile));
}

function registerPlantEvents(): void {
  const itemStartUseOn = world.afterEvents.itemStartUseOn;
  if (typeof itemStartUseOn?.subscribe !== "function") return;

  itemStartUseOn.subscribe((event) => {
    try {
      if (!isPlantEnabled()) return;
      if (!event.source.isSneaking) return;

      const itemId = event.itemStack?.typeId;
      if (!itemId) return;

      const profile = getProfileBySeed(itemId);
      if (!profile || profile.plantEnabled === false) return;

      const origin = resolvePlantOrigin(event.block, event.blockFace, profile);
      if (!origin) return;

      onPlayerPlantCrop(event.source, origin, profile);
    } catch {
      // 忽略瞬时错误
    }
  });
}

registerPlantEvents();

export {};
