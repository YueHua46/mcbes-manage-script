import type { Vector3 } from "../../../core/types";

export type PistonMovementPhase = "expanding" | "retracting";

// Bedrock facing_direction 的水平编号与常见的 north/south 枚举顺序相反。
// 该映射由 BDS pistonActivate 实测坐标验证，保留在纯逻辑层便于回归测试。
export const PISTON_FACING_DIRECTIONS: Readonly<Record<number, Vector3>> = {
  0: { x: 0, y: -1, z: 0 },
  1: { x: 0, y: 1, z: 0 },
  2: { x: 0, y: 0, z: 1 },
  3: { x: 0, y: 0, z: -1 },
  4: { x: 1, y: 0, z: 0 },
  5: { x: -1, y: 0, z: 0 },
};

export interface PistonMovementObservation {
  pistonLocation: Vector3;
  facingDirection: Vector3;
  phase: PistonMovementPhase;
  pistonTypeId: string;
  attachedLocations: readonly Vector3[];
  minY: number;
  maxY: number;
}

export interface PistonMovePlan {
  phase: PistonMovementPhase;
  moves: readonly PistonBlockMove[];
  terminalLocations: readonly Vector3[];
  signature: string;
}

export interface PistonBlockMove {
  source: Vector3;
  destination: Vector3;
}

export type PistonMovePlanFailureReason =
  | "invalid-facing-direction"
  | "too-many-attached-blocks"
  | "normal-piston-retraction-has-attached-blocks"
  | "coordinate-out-of-height-range"
  | "movement-touches-piston-base"
  | "movement-behind-piston"
  | "duplicate-source"
  | "duplicate-destination";

export interface PistonMovePlanFailureDiagnostic {
  attachedIndex?: number;
  attachedLocation?: Vector3;
  inferredSource?: Vector3;
  inferredDestination?: Vector3;
  sourceProjection?: number;
  destinationProjection?: number;
}

export type PistonMovePlanResult =
  | { ok: true; plan: PistonMovePlan }
  | {
      ok: false;
      reason: PistonMovePlanFailureReason;
      diagnostic: PistonMovePlanFailureDiagnostic;
    };

export interface PistonRollbackTransaction {
  key: string;
  signature: string;
  phase: PistonMovementPhase;
  startedTick: number;
  status: "observed" | "waiting" | "committing" | "completed" | "aborted";
  mutated: boolean;
}

function floorVector(location: Vector3): Vector3 {
  return {
    x: Math.floor(location.x),
    y: Math.floor(location.y),
    z: Math.floor(location.z),
  };
}

function addVector(left: Vector3, right: Vector3): Vector3 {
  return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z };
}

function subtractVector(left: Vector3, right: Vector3): Vector3 {
  return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}

function dot(left: Vector3, right: Vector3): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function locationKey(location: Vector3): string {
  return `${location.x},${location.y},${location.z}`;
}

function isCardinalUnit(direction: Vector3): boolean {
  return Math.abs(direction.x) + Math.abs(direction.y) + Math.abs(direction.z) === 1;
}

function isStickyPiston(typeId: string): boolean {
  return typeId === "minecraft:sticky_piston";
}

/**
 * 把 piston after-event 的“附着坐标”转换为确定的移动前后坐标。
 *
 * BDS 实测语义：伸出事件返回移动后的目标位置并额外包含活塞头，收回事件返回
 * 被拉方块移动前的来源位置。因此伸出需要过滤活塞头并向后推导来源，收回则
 * 从来源向活塞方向的反向推导目标。
 * 这里只做几何推导和防御性验证，不读取 Minecraft 运行时状态。
 */
export function planPistonMovement(observation: PistonMovementObservation): PistonMovePlanResult {
  const pistonLocation = floorVector(observation.pistonLocation);
  const facingDirection = floorVector(observation.facingDirection);
  if (!isCardinalUnit(facingDirection)) {
    return { ok: false, reason: "invalid-facing-direction", diagnostic: {} };
  }
  const pistonHead = addVector(pistonLocation, facingDirection);
  const attachedEntries = observation.attachedLocations
    .map((location, attachedIndex) => ({ attachedIndex, location: floorVector(location) }))
    .filter((entry) => observation.phase !== "expanding" || locationKey(entry.location) !== locationKey(pistonHead));
  if (attachedEntries.length > 12 || observation.attachedLocations.length > 13) {
    return { ok: false, reason: "too-many-attached-blocks", diagnostic: {} };
  }
  if (observation.phase === "retracting" && !isStickyPiston(observation.pistonTypeId) && attachedEntries.length > 0) {
    return { ok: false, reason: "normal-piston-retraction-has-attached-blocks", diagnostic: {} };
  }

  const sourceKeys = new Set<string>();
  const destinationKeys = new Set<string>();
  const moves: PistonBlockMove[] = [];
  for (const { attachedIndex, location: attachedLocation } of attachedEntries) {
    const source =
      observation.phase === "expanding" ? subtractVector(attachedLocation, facingDirection) : attachedLocation;
    const destination =
      observation.phase === "expanding" ? attachedLocation : subtractVector(attachedLocation, facingDirection);
    const diagnostic: PistonMovePlanFailureDiagnostic = {
      attachedIndex,
      attachedLocation,
      inferredSource: source,
      inferredDestination: destination,
      sourceProjection: dot(subtractVector(source, pistonLocation), facingDirection),
      destinationProjection: dot(subtractVector(destination, pistonLocation), facingDirection),
    };

    if (
      source.y < observation.minY ||
      source.y > observation.maxY ||
      destination.y < observation.minY ||
      destination.y > observation.maxY
    ) {
      return { ok: false, reason: "coordinate-out-of-height-range", diagnostic };
    }
    const sourceKey = locationKey(source);
    const destinationKey = locationKey(destination);
    const pistonKey = locationKey(pistonLocation);
    if (sourceKey === pistonKey || destinationKey === pistonKey) {
      return { ok: false, reason: "movement-touches-piston-base", diagnostic };
    }
    if ((diagnostic.sourceProjection ?? 0) < 1 || (diagnostic.destinationProjection ?? 0) < 1) {
      return { ok: false, reason: "movement-behind-piston", diagnostic };
    }
    if (sourceKeys.has(sourceKey)) return { ok: false, reason: "duplicate-source", diagnostic };
    if (destinationKeys.has(destinationKey)) return { ok: false, reason: "duplicate-destination", diagnostic };
    sourceKeys.add(sourceKey);
    destinationKeys.add(destinationKey);
    moves.push({ source, destination });
  }

  moves.sort((left, right) => {
    const leftKey = `${locationKey(left.source)}>${locationKey(left.destination)}`;
    const rightKey = `${locationKey(right.source)}>${locationKey(right.destination)}`;
    return leftKey.localeCompare(rightKey);
  });

  const pistonHeadKey = locationKey(pistonHead);
  const terminalLocations = moves
    .filter((move) => {
      const destinationKey = locationKey(move.destination);
      if (sourceKeys.has(destinationKey)) return false;
      return observation.phase !== "retracting" || destinationKey !== pistonHeadKey;
    })
    .map((move) => move.destination);
  const signature = `${observation.phase}:${moves
    .map((move) => `${locationKey(move.source)}>${locationKey(move.destination)}`)
    .join("|")}`;

  return {
    ok: true,
    plan: {
      phase: observation.phase,
      moves,
      terminalLocations,
      signature,
    },
  };
}
