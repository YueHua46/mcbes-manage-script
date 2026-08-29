import type { Vector3 } from "../../../core/types";

export interface BlockBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/**
 * 只枚举长方体边界向内 depth 格的壳层，分成互不重叠的 X/Y/Z 板以避免遍历内部体积。
 */
export function* iterateBoundaryShell(bounds: BlockBounds, depth: number): Generator<Vector3, void, void> {
  const shellDepth = Math.max(0, Math.floor(depth));
  const lowXEnd = Math.min(bounds.maxX, bounds.minX + shellDepth);
  const highXStart = Math.max(lowXEnd + 1, bounds.maxX - shellDepth);

  for (let x = bounds.minX; x <= lowXEnd; x++) {
    for (let y = bounds.minY; y <= bounds.maxY; y++) {
      for (let z = bounds.minZ; z <= bounds.maxZ; z++) yield { x, y, z };
    }
  }
  for (let x = highXStart; x <= bounds.maxX; x++) {
    for (let y = bounds.minY; y <= bounds.maxY; y++) {
      for (let z = bounds.minZ; z <= bounds.maxZ; z++) yield { x, y, z };
    }
  }

  const middleXStart = lowXEnd + 1;
  const middleXEnd = highXStart - 1;
  if (middleXStart > middleXEnd) return;
  const lowYEnd = Math.min(bounds.maxY, bounds.minY + shellDepth);
  const highYStart = Math.max(lowYEnd + 1, bounds.maxY - shellDepth);
  for (let x = middleXStart; x <= middleXEnd; x++) {
    for (let y = bounds.minY; y <= lowYEnd; y++) {
      for (let z = bounds.minZ; z <= bounds.maxZ; z++) yield { x, y, z };
    }
    for (let y = highYStart; y <= bounds.maxY; y++) {
      for (let z = bounds.minZ; z <= bounds.maxZ; z++) yield { x, y, z };
    }
  }

  const middleYStart = lowYEnd + 1;
  const middleYEnd = highYStart - 1;
  if (middleYStart > middleYEnd) return;
  const lowZEnd = Math.min(bounds.maxZ, bounds.minZ + shellDepth);
  const highZStart = Math.max(lowZEnd + 1, bounds.maxZ - shellDepth);
  for (let x = middleXStart; x <= middleXEnd; x++) {
    for (let y = middleYStart; y <= middleYEnd; y++) {
      for (let z = bounds.minZ; z <= lowZEnd; z++) yield { x, y, z };
      for (let z = highZStart; z <= bounds.maxZ; z++) yield { x, y, z };
    }
  }
}
