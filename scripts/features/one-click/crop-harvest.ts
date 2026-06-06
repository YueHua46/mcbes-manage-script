/**
 * 下蹲连锁收割（多作物 profile，不含可可豆）
 */

import { world, system, Player, Vector3, ItemStack, BlockPermutation, Dimension, type Block } from "@minecraft/server";
import setting from "../system/services/setting";
import { CropProfile, CROP_PROFILES, getProfileByBlock, getClipInteractProfiles } from "./crop-profiles";
import {
  BLOCKS_PER_JOB_SLICE,
  canBreakCropAt,
  clearDoubleCropAt,
  collectColumnHarvestAboveBase,
  collectMatureHarvestChain,
  collectSugarCaneHarvest,
  getPlayerOrAbort,
  isDoubleCropBlock,
  isHarvestableMature,
  locKey,
  releaseCropJob,
  spawnCropLoot,
  tryAcquireCropJob,
} from "./crop-common";

type HarvestTask = {
  profileId: string;
  location: Vector3;
  blockTypeId: string;
  permutation: BlockPermutation;
  mode: "break" | "clip";
  tool?: ItemStack;
};

type HarvestJobContext = {
  playerId: string;
  dimensionId: string;
  tasks: HarvestTask[];
};

function isHarvestEnabled(): boolean {
  return setting.getState("enableCropHarvestOneClick") === true;
}

function getProfileById(id: string): CropProfile | undefined {
  return CROP_PROFILES.find((p) => p.id === id);
}

function processHarvestTask(ctx: HarvestJobContext, player: Player, task: HarvestTask): void {
  const profile = getProfileById(task.profileId);
  if (!profile) return;
  if (!canBreakCropAt(player, task.location, ctx.dimensionId)) return;

  const dimension = player.dimension;
  const block = dimension.getBlock(task.location);
  if (!block) return;

  if (isDoubleCropBlock(block, profile)) {
    spawnCropLoot(dimension, task.location, task.permutation, task.tool);
    clearDoubleCropAt(dimension, task.location, profile.blockTypeIds[0]);
    return;
  }

  if (profile.harvest.mode === "berry-blocks") {
    spawnCropLoot(dimension, task.location, task.permutation, task.tool);
    block.setType("minecraft:cave_vines");
    return;
  }

  spawnCropLoot(dimension, task.location, task.permutation, task.tool);

  if (task.mode === "clip" && profile.harvest.clipReset) {
    const { stateKey, value } = profile.harvest.clipReset;
    block.setPermutation(task.permutation.withState(stateKey, value));
    return;
  }

  block.setType("air");
}

function *cropHarvestJob(ctx: HarvestJobContext): Generator<void, void, void> {
  let sliceCount = 0;

  try {
    for (const task of ctx.tasks) {
      const player = getPlayerOrAbort(ctx.playerId);
      if (!player) return;

      const profile = getProfileById(task.profileId);
      if (!profile) continue;

      processHarvestTask(ctx, player, task);

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

function scheduleHarvestJob(player: Player, tasks: HarvestTask[]): void {
  if (tasks.length === 0) return;
  if (!tryAcquireCropJob(player.id)) return;

  system.runJob(
    cropHarvestJob({
      playerId: player.id,
      dimensionId: player.dimension.id,
      tasks,
    })
  );
}

function makeBreakTask(
  profile: CropProfile,
  location: Vector3,
  block: Block,
  tool?: ItemStack
): HarvestTask {
  return {
    profileId: profile.id,
    location,
    blockTypeId: block.typeId,
    permutation: block.permutation,
    mode: profile.harvest.mode === "clip-mature" ? "clip" : "break",
    tool,
  };
}

function buildStandardChainTasks(
  player: Player,
  dimension: Dimension,
  origin: Vector3,
  profile: CropProfile,
  tool?: ItemStack
): HarvestTask[] {
  const exclude = new Set<string>([locKey(origin)]);

  if (profile.harvest.mode === "sugar-cane-column") {
    return collectSugarCaneHarvest(dimension, origin, exclude)
      .filter((loc) => canBreakCropAt(player, loc, dimension.id))
      .map((loc) => {
        const block = dimension.getBlock(loc)!;
        return makeBreakTask(profile, loc, block, tool);
      });
  }

  if (profile.harvest.mode === "column-above-base") {
    const blockTypeId = profile.blockTypeIds[0];
    return collectColumnHarvestAboveBase(dimension, origin, blockTypeId, exclude)
      .filter((loc) => canBreakCropAt(player, loc, dimension.id))
      .map((loc) => {
        const block = dimension.getBlock(loc)!;
        return makeBreakTask(profile, loc, block, tool);
      });
  }

  if (profile.harvest.mode === "berry-blocks") {
    return collectMatureHarvestChain(dimension, origin, profile, exclude)
      .filter((loc) => canBreakCropAt(player, loc, dimension.id))
      .map((loc) => {
        const block = dimension.getBlock(loc)!;
        return makeBreakTask(profile, loc, block, tool);
      });
  }

  return collectMatureHarvestChain(dimension, origin, profile, exclude)
    .filter((loc) => canBreakCropAt(player, loc, dimension.id))
    .map((loc) => {
      const block = dimension.getBlock(loc)!;
      if (!isHarvestableMature(block, profile)) {
        return undefined;
      }
      return makeBreakTask(profile, loc, block, tool);
    })
    .filter((t): t is HarvestTask => t !== undefined);
}

function onPlayerBreakCrop(
  player: Player,
  dimension: Dimension,
  origin: Vector3,
  profile: CropProfile,
  brokenPerm: BlockPermutation,
  tool?: ItemStack
): void {
  if (!player.isSneaking) return;

  if (profile.harvest.maturity) {
    const perm =
      profile.plant.mode === "farmland-double" && brokenPerm.getState("upper_block_bit") === true
        ? dimension.getBlock({ x: origin.x, y: origin.y - 1, z: origin.z })?.permutation ?? brokenPerm
        : brokenPerm;
    const value = perm.getState(profile.harvest.maturity.stateKey);
    if (typeof value !== "number" || value < profile.harvest.maturity.min) return;
  }

  scheduleHarvestJob(player, buildStandardChainTasks(player, dimension, origin, profile, tool));
}

function onPlayerClipCrop(player: Player, block: Block, profile: CropProfile, tool?: ItemStack): void {
  if (!player.isSneaking) return;
  // afterEvents 触发时原版已剪收第一格（growth 已重置），不能再对点击格做成熟判定
  const tasks = buildStandardChainTasks(player, block.dimension, block.location, profile, tool);
  scheduleHarvestJob(player, tasks);
}

world.afterEvents.playerBreakBlock.subscribe((event) => {
  try {
    if (!isHarvestEnabled()) return;

    const { player, dimension, block } = event;
    const brokenId = event.brokenBlockPermutation.type.id;
    const profile = getProfileByBlock(brokenId);
    if (!profile) return;

    onPlayerBreakCrop(player, dimension, block.location, profile, event.brokenBlockPermutation, event.itemStackBeforeBreak);
  } catch {
    // 忽略瞬时错误
  }
});

world.afterEvents.playerInteractWithBlock.subscribe((event) => {
  try {
    if (!isHarvestEnabled()) return;
    if (!event.isFirstEvent) return;
    if (!event.player.isSneaking) return;

    const profile = getClipInteractProfiles().find((p) => p.blockTypeIds.includes(event.block.typeId));
    if (!profile) return;

    onPlayerClipCrop(event.player, event.block, profile, event.beforeItemStack);
  } catch {
    // 忽略瞬时错误
  }
});

export {};
