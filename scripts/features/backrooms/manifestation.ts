import type { Player, Vector3 } from "@minecraft/server";
import { world } from "@minecraft/server";
import { findSafeLandingCell, generateRegionPlan } from "./core";
import {
  BACKROOMS_MANIFESTATION_STRIDE_REGIONS,
  BACKROOMS_REGION_SIZE,
  BACKROOMS_WALK_Y,
} from "./constants";

const PLAYER_SLOT_PROPERTY = "yuehua:backroomsManifestationSlot";
const NEXT_SLOT_PROPERTY = "yuehua:backroomsNextManifestationSlot";
const MAX_SLOT = 40_000;

export interface BackroomsManifestation {
  slot: number;
  regionX: number;
  regionZ: number;
  spawn: Vector3;
}

/**
 * 把非负序号稳定映射到以 (0,0) 为中心的方形螺旋。
 * slot=0 位于原点；后续玩家依次向外分配，避免依赖玩家名哈希产生碰撞。
 */
export function squareSpiralCoordinate(slot: number): { x: number; z: number } {
  if (!Number.isInteger(slot) || slot < 0) throw new RangeError(`非法 manifestation slot: ${slot}`);
  if (slot === 0) return { x: 0, z: 0 };

  const layer = Math.ceil((Math.sqrt(slot + 1) - 1) / 2);
  const sideLength = layer * 2;
  const maximum = (layer * 2 + 1) ** 2 - 1;
  const offset = maximum - slot;
  const side = Math.floor(offset / sideLength);
  const position = offset % sideLength;

  switch (side) {
    case 0:
      return { x: layer - position, z: layer };
    case 1:
      return { x: -layer, z: layer - position };
    case 2:
      return { x: -layer + position, z: -layer };
    default:
      return { x: layer, z: -layer + position };
  }
}

function allocateSlot(player: Player): number {
  const existing = player.getDynamicProperty(PLAYER_SLOT_PROPERTY);
  if (typeof existing === "number" && Number.isInteger(existing) && existing >= 0 && existing <= MAX_SLOT) {
    return existing;
  }

  const rawNext = world.getDynamicProperty(NEXT_SLOT_PROPERTY);
  const slot = typeof rawNext === "number" && Number.isInteger(rawNext) && rawNext >= 0 ? rawNext : 0;
  if (slot > MAX_SLOT) throw new Error("Backrooms manifestation 数量已达到安全坐标上限");
  player.setDynamicProperty(PLAYER_SLOT_PROPERTY, slot);
  world.setDynamicProperty(NEXT_SLOT_PROPERTY, slot + 1);
  return slot;
}

export function getBackroomsManifestation(player: Player): BackroomsManifestation {
  const slot = allocateSlot(player);
  const spiral = squareSpiralCoordinate(slot);
  const regionX = spiral.x * BACKROOMS_MANIFESTATION_STRIDE_REGIONS;
  const regionZ = spiral.z * BACKROOMS_MANIFESTATION_STRIDE_REGIONS;
  const landing = findSafeLandingCell(generateRegionPlan(world.seed ?? 0, regionX, regionZ));
  return {
    slot,
    regionX,
    regionZ,
    spawn: {
      x: regionX * BACKROOMS_REGION_SIZE + landing.x + 0.5,
      y: BACKROOMS_WALK_Y,
      z: regionZ * BACKROOMS_REGION_SIZE + landing.z + 0.5,
    },
  };
}
