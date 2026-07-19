import type { Vector3 } from "../../../core/types";

export interface PistonBlockMove {
  source: Vector3;
  destination: Vector3;
}

/**
 * 找出第一项非法的活塞移动。
 *
 * 规则：只要一次移动触及受保护领地，活塞本体、移动前位置和移动后位置
 * 都必须属于同一块受保护领地。完全位于野外的移动不受限制。
 */
export function findDeniedPistonMove<T>(
  pistonLocation: Vector3,
  moves: readonly PistonBlockMove[],
  resolveProtectedLand: (location: Vector3) => T | null,
  getLandKey: (land: T) => string
): { move: PistonBlockMove; protectedLand: T } | null {
  const pistonLand = resolveProtectedLand(pistonLocation);
  const pistonLandKey = pistonLand ? getLandKey(pistonLand) : null;

  for (const move of moves) {
    const sourceLand = resolveProtectedLand(move.source);
    const destinationLand = resolveProtectedLand(move.destination);
    if (!sourceLand && !destinationLand) continue;

    const protectedLand = sourceLand ?? destinationLand!;
    const sourceKey = sourceLand ? getLandKey(sourceLand) : null;
    const destinationKey = destinationLand ? getLandKey(destinationLand) : null;
    if (!pistonLandKey || sourceKey !== pistonLandKey || destinationKey !== pistonLandKey) {
      return { move, protectedLand };
    }
  }

  return null;
}
