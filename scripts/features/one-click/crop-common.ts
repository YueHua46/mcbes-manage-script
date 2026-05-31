/**
 * 一键作物功能（收割 / 播种）共享逻辑
 */

import {
  world,
  GameMode,
  BlockPermutation,
  Dimension,
  Player,
  Vector3,
  ItemStack,
  type Block,
} from "@minecraft/server";
import { getRadiusRange } from "@mcbe-mods/utils";
import landManager from "../land/services/land-manager";
import { isAdmin } from "../../shared/utils/common";
import { CropProfile, getProfileByBlock } from "./crop-profiles";

export { getProfileByBlock, getProfileBySeed, getClipInteractProfiles } from "./crop-profiles";

/** 单次 runJob 时间片内最多处理的格子数 */
export const BLOCKS_PER_JOB_SLICE = 12;
/** 单次连锁最多处理的格子数（不含玩家直接操作的那一格） */
export const MAX_CHAIN_BLOCKS = 384;

const WATER_IDS = new Set(["minecraft:water", "minecraft:flowing_water"]);

const activePlayerJobs = new Set<string>();

export function locKey(v: Vector3): string {
  return `${Math.floor(v.x)},${Math.floor(v.y)},${Math.floor(v.z)}`;
}

export function columnKey(v: Vector3): string {
  return `${Math.floor(v.x)},${Math.floor(v.z)}`;
}

export function isSurvivalPlayer(player: Player): boolean {
  try {
    return player.getGameMode() === GameMode.Survival;
  } catch {
    return player.dimension.getPlayers({ gameMode: GameMode.Survival }).some((p) => p.id === player.id);
  }
}

export function canBreakCropAt(player: Player, location: Vector3, dimensionId: string): boolean {
  const { isInside, insideLand } = landManager.testLand(location, dimensionId);
  if (!isInside || !insideLand) return true;
  if (insideLand.owner === player.name) return true;
  if (isAdmin(player)) return true;
  if (landManager.isPlayerTrustedOnLand(insideLand, player.name)) return true;
  return insideLand.public_auth.break === true;
}

export function canPlaceCropAt(player: Player, location: Vector3, dimensionId: string): boolean {
  const { isInside, insideLand } = landManager.testLand(location, dimensionId);
  if (!isInside || !insideLand) return true;
  if (insideLand.owner === player.name) return true;
  if (isAdmin(player)) return true;
  if (landManager.isPlayerTrustedOnLand(insideLand, player.name)) return true;
  return insideLand.public_auth.place === true;
}

export function tryAcquireCropJob(playerId: string): boolean {
  if (activePlayerJobs.has(playerId)) return false;
  activePlayerJobs.add(playerId);
  return true;
}

export function releaseCropJob(playerId: string): void {
  activePlayerJobs.delete(playerId);
}

export function getPlayerOrAbort(playerId: string): Player | undefined {
  return world.getPlayers().find((p) => p.id === playerId && p.isValid);
}

export function tryConsumeSeed(player: Player, seedTypeId: string): boolean {
  if (!isSurvivalPlayer(player)) return true;

  const container = player.getComponent("inventory")?.container;
  if (!container) return false;

  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    if (!item || item.typeId !== seedTypeId) continue;

    if (item.amount <= 1) {
      container.setItem(i);
    } else {
      const remaining = item.clone();
      remaining.amount -= 1;
      container.setItem(i, remaining);
    }
    return true;
  }
  return false;
}

function isWaterBlockId(typeId: string | undefined): boolean {
  return typeId !== undefined && WATER_IDS.has(typeId);
}

export function hasWaterAdjacentToSubstrate(dimension: Dimension, plantLoc: Vector3): boolean {
  const below = dimension.getBlock({ x: plantLoc.x, y: plantLoc.y - 1, z: plantLoc.z });
  if (!below) return false;
  const b = below.location;
  const neighbors = [
    { x: b.x + 1, y: b.y, z: b.z },
    { x: b.x - 1, y: b.y, z: b.z },
    { x: b.x, y: b.y, z: b.z + 1 },
    { x: b.x, y: b.y, z: b.z - 1 },
  ];
  return neighbors.some((n) => isWaterBlockId(dimension.getBlock(n)?.typeId));
}

function isSolidBlock(block: Block | undefined): boolean {
  if (!block || block.isAir) return false;
  if (isWaterBlockId(block.typeId)) return false;
  return true;
}

export function isBlockInWater(dimension: Dimension, location: Vector3): boolean {
  const block = dimension.getBlock(location);
  if (!block) return false;
  if (isWaterBlockId(block.typeId)) return true;
  if (!block.isAir) return false;
  const above = dimension.getBlock({ x: location.x, y: location.y + 1, z: location.z });
  const below = dimension.getBlock({ x: location.x, y: location.y - 1, z: location.z });
  return isWaterBlockId(above?.typeId) || isWaterBlockId(below?.typeId);
}

function getMaturityPermutation(dimension: Dimension, location: Vector3, block: Block, profile: CropProfile): BlockPermutation {
  if (profile.plant.mode !== "farmland-double") return block.permutation;
  if (block.permutation.getState("upper_block_bit") !== true) return block.permutation;
  const lower = dimension.getBlock({ x: location.x, y: location.y - 1, z: location.z });
  return lower?.permutation ?? block.permutation;
}

export function isHarvestableMature(block: Block, profile: CropProfile): boolean {
  const berryIds = profile.harvest.berryBlockIds;
  if (berryIds?.includes(block.typeId)) return true;

  if (!profile.blockTypeIds.includes(block.typeId)) return false;

  const maturity = profile.harvest.maturity;
  if (!maturity) return true;

  const perm = getMaturityPermutation(block.dimension, block.location, block, profile);
  const value = perm.getState(maturity.stateKey);
  return typeof value === "number" && value >= maturity.min;
}

export function isPlantableForProfile(dimension: Dimension, location: Vector3, profile: CropProfile): boolean {
  const block = dimension.getBlock(location);
  if (!block?.isAir) return false;

  switch (profile.plant.mode) {
    case "farmland-air":
      return block.below()?.typeId === "minecraft:farmland";

    case "substrate-air": {
      const substrate = block.below()?.typeId;
      return substrate !== undefined && (profile.plant.substrates?.includes(substrate) ?? false);
    }

    case "water-adjacent-air": {
      const substrate = block.below()?.typeId;
      if (!substrate || !profile.plant.substrates?.includes(substrate)) return false;
      return hasWaterAdjacentToSubstrate(dimension, location);
    }

    case "farmland-double": {
      if (block.below()?.typeId !== "minecraft:farmland") return false;
      const upper = dimension.getBlock({ x: location.x, y: location.y + 1, z: location.z });
      return upper?.isAir === true;
    }

    case "underwater-air": {
      if (!isBlockInWater(dimension, location)) return false;
      const substrate = block.below()?.typeId;
      return substrate !== undefined && (profile.plant.substrates?.includes(substrate) ?? false);
    }

    case "bamboo-sapling": {
      const substrate = block.below()?.typeId;
      if (!substrate || !profile.plant.substrates?.includes(substrate)) return false;
      return true;
    }

    case "ceiling-vine": {
      const above = dimension.getBlock({ x: location.x, y: location.y + 1, z: location.z });
      return block.isAir && isSolidBlock(above);
    }

    default:
      return false;
  }
}

export function setBlockPermutationSafe(block: Block, perm: BlockPermutation): boolean {
  try {
    const trySet = (block as Block & { trySetPermutation?: (p: BlockPermutation) => boolean }).trySetPermutation;
    if (typeof trySet === "function") {
      return trySet.call(block, perm);
    }
    block.setPermutation(perm);
    return true;
  } catch {
    return false;
  }
}

export function tryPlantProfile(dimension: Dimension, location: Vector3, profile: CropProfile): boolean {
  const block = dimension.getBlock(location);
  if (!block || !isPlantableForProfile(dimension, location, profile)) return false;

  if (profile.plant.mode === "farmland-double") {
    const upper = dimension.getBlock({ x: location.x, y: location.y + 1, z: location.z });
    if (!upper?.isAir) return false;
    const lowerOk = setBlockPermutationSafe(
      block,
      BlockPermutation.resolve(profile.plantBlockId, { growth: 0, upper_block_bit: false })
    );
    if (!lowerOk) return false;
    return setBlockPermutationSafe(
      upper,
      BlockPermutation.resolve(profile.plantBlockId, { growth: 0, upper_block_bit: true })
    );
  }

  const states: Record<string, number | boolean> = {};
  if (profile.plantBlockId === "minecraft:reeds") {
    states.age = 0;
  } else if (profile.plantBlockId === "minecraft:kelp") {
    states.kelp_age = 0;
  } else if (profile.plantBlockId === "minecraft:nether_wart") {
    states.age = 0;
  } else if (
    profile.plantBlockId.includes("stem") ||
    profile.plantBlockId.includes("crop") ||
    profile.plantBlockId.includes("berries")
  ) {
    states.growth = 0;
  }

  return setBlockPermutationSafe(block, BlockPermutation.resolve(profile.plantBlockId, states));
}

export function spawnCropLoot(
  dimension: Dimension,
  location: Vector3,
  permutation: BlockPermutation,
  tool?: ItemStack
): void {
  try {
    const lootMgr = world.getLootTableManager?.();
    const drops = lootMgr?.generateLootFromBlockPermutation(permutation, tool);
    if (drops?.length) {
      for (const stack of drops) {
        dimension.spawnItem(stack, {
          x: location.x + 0.5,
          y: location.y + 0.5,
          z: location.z + 0.5,
        });
      }
      return;
    }
  } catch {
    // fallback
  }

  const profile = getProfileByBlock(permutation.type.id);
  if (!profile) return;
  dimension.spawnItem(new ItemStack(profile.seedTypeId, 1), location);
}

/** 根据 itemStartUseOn 的点击面，计算放置目标坐标 */
export function getTargetLocationFromUseOn(block: Block, blockFace: string | number): Vector3 {
  const loc = block.location;
  const face = String(blockFace).toLowerCase();
  if (face === "up" || blockFace === 1) return { x: loc.x, y: loc.y + 1, z: loc.z };
  if (face === "down" || blockFace === 0) return { x: loc.x, y: loc.y - 1, z: loc.z };
  if (face === "north" || blockFace === 2) return { x: loc.x, y: loc.y, z: loc.z - 1 };
  if (face === "south" || blockFace === 3) return { x: loc.x, y: loc.y, z: loc.z + 1 };
  if (face === "west" || blockFace === 4) return { x: loc.x - 1, y: loc.y, z: loc.z };
  if (face === "east" || blockFace === 5) return { x: loc.x + 1, y: loc.y, z: loc.z };
  return { x: loc.x, y: loc.y + 1, z: loc.z };
}

export function resolvePlantOrigin(block: Block, blockFace: string | number, profile: CropProfile): Vector3 | undefined {
  const target = getTargetLocationFromUseOn(block, blockFace);

  if (profile.plant.mode === "ceiling-vine") {
    const face = String(blockFace).toLowerCase();
    if (face !== "down" && blockFace !== 0) return undefined;
    return target;
  }

  if (profile.plant.mode === "farmland-air" && block.typeId === "minecraft:farmland") {
    return { x: block.location.x, y: block.location.y + 1, z: block.location.z };
  }

  if (isPlantableForProfile(block.dimension, target, profile)) return target;

  if (block.isAir && isPlantableForProfile(block.dimension, block.location, profile)) {
    return block.location;
  }

  return undefined;
}

export function collectHorizontalChain(
  dimension: Dimension,
  origin: Vector3,
  excludeKeys: Set<string>,
  matches: (block: Block) => boolean
): Vector3[] {
  const visited = new Set<string>(excludeKeys);
  const result: Vector3[] = [];
  const queue: Vector3[] = [];

  for (const adj of getRadiusRange(origin)) {
    queue.push(adj);
  }

  while (queue.length > 0) {
    if (result.length >= MAX_CHAIN_BLOCKS) break;

    const loc = queue.shift()!;
    const key = locKey(loc);
    if (visited.has(key)) continue;
    visited.add(key);

    const block = dimension.getBlock(loc);
    if (!block || !matches(block)) continue;

    result.push({ x: loc.x, y: loc.y, z: loc.z });

    for (const adj of getRadiusRange(loc)) {
      queue.push(adj);
    }
  }

  return result;
}

export function collectPlantableChain(
  dimension: Dimension,
  origin: Vector3,
  profile: CropProfile,
  excludeKeys: Set<string>
): Vector3[] {
  return collectHorizontalChain(dimension, origin, excludeKeys, (block) =>
    isPlantableForProfile(dimension, block.location, profile)
  );
}

export function collectMatureHarvestChain(
  dimension: Dimension,
  origin: Vector3,
  profile: CropProfile,
  excludeKeys: Set<string>
): Vector3[] {
  return collectHorizontalChain(dimension, origin, excludeKeys, (block) => isHarvestableMature(block, profile));
}

/** 甘蔗：连通 reeds，保留每列最底下一格（不含玩家已破坏的原点） */
export function collectSugarCaneHarvest(
  dimension: Dimension,
  origin: Vector3,
  excludeKeys: Set<string>
): Vector3[] {
  const visited = new Set<string>(excludeKeys);
  const allReeds: Vector3[] = [];
  const queue: Vector3[] = [];

  for (const adj of getRadiusRange(origin)) {
    queue.push(adj);
  }

  while (queue.length > 0) {
    if (allReeds.length >= MAX_CHAIN_BLOCKS * 4) break;
    const loc = queue.shift()!;
    const key = locKey(loc);
    if (visited.has(key)) continue;
    visited.add(key);

    const block = dimension.getBlock(loc);
    if (block?.typeId !== "minecraft:reeds") continue;

    allReeds.push({ x: loc.x, y: loc.y, z: loc.z });

    for (const adj of getRadiusRange(loc)) {
      queue.push(adj);
    }
  }

  const minYByColumn = new Map<string, number>();
  for (const loc of allReeds) {
    const ck = columnKey(loc);
    const prev = minYByColumn.get(ck);
    if (prev === undefined || loc.y < prev) minYByColumn.set(ck, loc.y);
  }

  const toBreak: Vector3[] = [];
  for (const loc of allReeds) {
    const minY = minYByColumn.get(columnKey(loc));
    if (minY !== undefined && loc.y > minY) {
      toBreak.push(loc);
    }
  }

  return toBreak.slice(0, MAX_CHAIN_BLOCKS);
}

/** 竹子 / 海带：连通同类，保留每列最底下一格（不含玩家已破坏的原点） */
export function collectColumnHarvestAboveBase(
  dimension: Dimension,
  origin: Vector3,
  blockTypeId: string,
  excludeKeys: Set<string>
): Vector3[] {
  const visited = new Set<string>(excludeKeys);
  const all: Vector3[] = [];
  const queue: Vector3[] = [];

  for (const adj of getRadiusRange(origin)) {
    queue.push(adj);
  }
  queue.push(
    { x: origin.x, y: origin.y + 1, z: origin.z },
    { x: origin.x, y: origin.y - 1, z: origin.z }
  );

  while (queue.length > 0) {
    if (all.length >= MAX_CHAIN_BLOCKS * 8) break;
    const loc = queue.shift()!;
    const key = locKey(loc);
    if (visited.has(key)) continue;
    visited.add(key);

    const block = dimension.getBlock(loc);
    if (block?.typeId !== blockTypeId) continue;

    all.push({ x: loc.x, y: loc.y, z: loc.z });

    const vertical = [
      { x: loc.x, y: loc.y + 1, z: loc.z },
      { x: loc.x, y: loc.y - 1, z: loc.z },
    ];
    for (const adj of [...getRadiusRange(loc), ...vertical]) {
      queue.push(adj);
    }
  }

  const minYByColumn = new Map<string, number>();
  for (const loc of all) {
    const ck = columnKey(loc);
    const prev = minYByColumn.get(ck);
    if (prev === undefined || loc.y < prev) minYByColumn.set(ck, loc.y);
  }

  const toBreak: Vector3[] = [];
  for (const loc of all) {
    const minY = minYByColumn.get(columnKey(loc));
    if (minY !== undefined && loc.y > minY) {
      toBreak.push(loc);
    }
  }

  return toBreak.slice(0, MAX_CHAIN_BLOCKS);
}

export function clearDoubleCropAt(dimension: Dimension, location: Vector3, blockTypeId: string): void {
  const block = dimension.getBlock(location);
  if (!block) return;

  let lowerLoc = location;
  if (block.permutation.getState("upper_block_bit") === true) {
    lowerLoc = { x: location.x, y: location.y - 1, z: location.z };
  }

  const lower = dimension.getBlock(lowerLoc);
  const upper = dimension.getBlock({ x: lowerLoc.x, y: lowerLoc.y + 1, z: lowerLoc.z });

  if (lower?.typeId === blockTypeId) lower.setType("air");
  if (upper?.typeId === blockTypeId) upper.setType("air");
}

export function isDoubleCropBlock(block: Block, profile: CropProfile): boolean {
  return profile.plant.mode === "farmland-double" && profile.blockTypeIds.includes(block.typeId);
}
