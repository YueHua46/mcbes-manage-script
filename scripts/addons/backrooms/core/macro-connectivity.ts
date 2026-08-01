import { BackroomsGenerationConfig, DEFAULT_BACKROOMS_CONFIG } from "./config";
import { CARDINAL_DIRECTIONS, directionBetween, offsetRegion, sameRegion } from "./coordinates";
import { hashParts32 } from "./hash";
import { BackroomsSeed, CardinalDirection, RegionCoordinate, RegionEdgeGate } from "./types";

interface CanonicalEdge {
  readonly orientation: "x" | "z";
  readonly x: number;
  readonly z: number;
}

function canonicalEdge(a: RegionCoordinate, b: RegionCoordinate): CanonicalEdge {
  const direction = directionBetween(a, b);
  if (direction === undefined) {
    throw new RangeError(`Regions (${a.rx},${a.rz}) and (${b.rx},${b.rz}) are not adjacent`);
  }
  if (direction === "east" || direction === "west") {
    return { orientation: "x", x: Math.max(a.rx, b.rx), z: a.rz };
  }
  return { orientation: "z", x: a.rx, z: Math.max(a.rz, b.rz) };
}

function edgeHash(
  seed: BackroomsSeed,
  config: BackroomsGenerationConfig,
  channel: string,
  a: RegionCoordinate,
  b: RegionCoordinate
): number {
  const edge = canonicalEdge(a, b);
  return hashParts32("backrooms-edge", config.algorithmVersion, channel, seed, edge.orientation, edge.x, edge.z);
}

/**
 * Returns a neighbor whose Manhattan distance to the origin is exactly one
 * lower. Repeated parent traversal therefore always terminates at (0, 0).
 */
export function getRegionParent(
  seed: BackroomsSeed,
  coordinate: RegionCoordinate,
  config: BackroomsGenerationConfig = DEFAULT_BACKROOMS_CONFIG
): RegionCoordinate | undefined {
  if (coordinate.rx === 0 && coordinate.rz === 0) return undefined;

  const candidates: RegionCoordinate[] = [];
  if (coordinate.rx !== 0) {
    candidates.push({ rx: coordinate.rx - Math.sign(coordinate.rx), rz: coordinate.rz });
  }
  if (coordinate.rz !== 0) {
    candidates.push({ rx: coordinate.rx, rz: coordinate.rz - Math.sign(coordinate.rz) });
  }
  if (candidates.length === 1) return candidates[0];

  const choice =
    hashParts32("backrooms-parent", config.algorithmVersion, seed, coordinate.rx, coordinate.rz) % candidates.length;
  return candidates[choice];
}

export function isMandatoryRegionConnection(
  seed: BackroomsSeed,
  a: RegionCoordinate,
  b: RegionCoordinate,
  config: BackroomsGenerationConfig = DEFAULT_BACKROOMS_CONFIG
): boolean {
  if (directionBetween(a, b) === undefined) return false;
  return sameRegion(getRegionParent(seed, a, config), b) || sameRegion(getRegionParent(seed, b, config), a);
}

export function hasRegionConnection(
  seed: BackroomsSeed,
  a: RegionCoordinate,
  b: RegionCoordinate,
  config: BackroomsGenerationConfig = DEFAULT_BACKROOMS_CONFIG
): boolean {
  if (directionBetween(a, b) === undefined) return false;
  if (isMandatoryRegionConnection(seed, a, b, config)) return true;
  const value = edgeHash(seed, config, "loop", a, b) / 0x100000000;
  return value < config.loopConnectionRate;
}

export function getEdgeGate(
  seed: BackroomsSeed,
  coordinate: RegionCoordinate,
  direction: CardinalDirection,
  config: BackroomsGenerationConfig = DEFAULT_BACKROOMS_CONFIG
): RegionEdgeGate | undefined {
  const neighbor = offsetRegion(coordinate, direction);
  if (!hasRegionConnection(seed, coordinate, neighbor, config)) return undefined;

  const widthHash = edgeHash(seed, config, "gate-width", coordinate, neighbor);
  const wideOpening = edgeHash(seed, config, "gate-wide-opening", coordinate, neighbor) / 0x100000000 < 0.07;
  const width = wideOpening ? 9 + (widthHash % 7) : config.gateWidths[widthHash % config.gateWidths.length];
  const minimum = config.edgeMargin;
  const maximum = config.regionSize - config.edgeMargin - width;
  const offsetSpan = maximum - minimum + 1;
  const offset = minimum + (edgeHash(seed, config, "gate-offset", coordinate, neighbor) % offsetSpan);

  return {
    direction,
    offset,
    width,
    neighbor,
    mandatory: isMandatoryRegionConnection(seed, coordinate, neighbor, config),
  };
}

/** Returns every shared opening on an edge, including occasional secondary seams. */
export function getEdgeGates(
  seed: BackroomsSeed,
  coordinate: RegionCoordinate,
  direction: CardinalDirection,
  config: BackroomsGenerationConfig = DEFAULT_BACKROOMS_CONFIG
): readonly RegionEdgeGate[] {
  const primary = getEdgeGate(seed, coordinate, direction, config);
  if (!primary) return [];
  const neighbor = primary.neighbor;
  const secondaryRoll = edgeHash(seed, config, "gate-secondary-roll", coordinate, neighbor) / 0x100000000;
  if (secondaryRoll >= 0.28) return [primary];

  const width = 3 + (edgeHash(seed, config, "gate-secondary-width", coordinate, neighbor) % 4);
  const minimum = config.edgeMargin;
  const maximum = config.regionSize - config.edgeMargin - width;
  const span = maximum - minimum + 1;
  let offset = minimum + (edgeHash(seed, config, "gate-secondary-offset", coordinate, neighbor) % span);
  const primaryEnd = primary.offset + primary.width - 1;
  const secondaryEnd = offset + width - 1;
  if (!(secondaryEnd < primary.offset - 3 || offset > primaryEnd + 3)) {
    const before = primary.offset - width - 4;
    const after = primaryEnd + 4;
    if (before >= minimum) offset = before;
    else if (after <= maximum) offset = after;
    else return [primary];
  }
  return [
    primary,
    {
      direction,
      offset,
      width,
      neighbor,
      mandatory: false,
    },
  ];
}

export function getRegionGates(
  seed: BackroomsSeed,
  coordinate: RegionCoordinate,
  config: BackroomsGenerationConfig = DEFAULT_BACKROOMS_CONFIG
): readonly RegionEdgeGate[] {
  const gates: RegionEdgeGate[] = [];
  for (const direction of CARDINAL_DIRECTIONS) {
    gates.push(...getEdgeGates(seed, coordinate, direction, config));
  }
  return gates;
}
