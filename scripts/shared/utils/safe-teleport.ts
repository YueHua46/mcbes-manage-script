import type { Dimension, Vector3 } from "@minecraft/server";

const UNSAFE_GROUND_BLOCK_KEYWORDS = ["water", "lava", "fire", "cactus", "magma", "powder_snow"];

export function isUnsafeTeleportGround(typeId: string): boolean {
  return UNSAFE_GROUND_BLOCK_KEYWORDS.some((keyword) => typeId.includes(keyword));
}

export function isSafeTeleportLocation(dimension: Dimension, location: Vector3): boolean {
  const x = Math.floor(location.x);
  const y = Math.floor(location.y);
  const z = Math.floor(location.z);

  const ground = dimension.getBlock({ x, y: y - 1, z });
  if (!ground || ground.isAir || ground.isLiquid || isUnsafeTeleportGround(ground.typeId)) return false;

  const feet = dimension.getBlock({ x, y, z });
  const head = dimension.getBlock({ x, y: y + 1, z });
  return feet?.isAir === true && head?.isAir === true;
}
