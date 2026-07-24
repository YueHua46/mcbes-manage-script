import { CardinalDirection, LocalCoordinate, RegionCoordinate } from "./types";

export const CARDINAL_DIRECTIONS: readonly CardinalDirection[] = Object.freeze([
    "north", "east", "south", "west",
]);

export function worldToRegionCoordinate(x: number, z: number, regionSize: number): RegionCoordinate {
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
        throw new RangeError("World coordinates must be finite");
    }
    if (!Number.isInteger(regionSize) || regionSize <= 0) {
        throw new RangeError("regionSize must be a positive integer");
    }
    return {
        rx: Math.floor(x / regionSize),
        rz: Math.floor(z / regionSize),
    };
}

export function regionOrigin(coordinate: RegionCoordinate, regionSize: number): LocalCoordinate {
    return {
        x: coordinate.rx * regionSize,
        z: coordinate.rz * regionSize,
    };
}

export function worldToLocalCoordinate(x: number, z: number, regionSize: number): LocalCoordinate {
    const region = worldToRegionCoordinate(x, z, regionSize);
    return {
        x: x - region.rx * regionSize,
        z: z - region.rz * regionSize,
    };
}

export function regionKey(coordinate: RegionCoordinate): string {
    return `${coordinate.rx},${coordinate.rz}`;
}

export function sameRegion(a: RegionCoordinate | undefined, b: RegionCoordinate | undefined): boolean {
    return a !== undefined && b !== undefined && a.rx === b.rx && a.rz === b.rz;
}

export function offsetRegion(
    coordinate: RegionCoordinate,
    direction: CardinalDirection,
): RegionCoordinate {
    switch (direction) {
        case "north": return { rx: coordinate.rx, rz: coordinate.rz - 1 };
        case "east": return { rx: coordinate.rx + 1, rz: coordinate.rz };
        case "south": return { rx: coordinate.rx, rz: coordinate.rz + 1 };
        case "west": return { rx: coordinate.rx - 1, rz: coordinate.rz };
    }
}

export function oppositeDirection(direction: CardinalDirection): CardinalDirection {
    switch (direction) {
        case "north": return "south";
        case "east": return "west";
        case "south": return "north";
        case "west": return "east";
    }
}

export function directionBetween(
    from: RegionCoordinate,
    to: RegionCoordinate,
): CardinalDirection | undefined {
    const dx = to.rx - from.rx;
    const dz = to.rz - from.rz;
    if (dx === 0 && dz === -1) return "north";
    if (dx === 1 && dz === 0) return "east";
    if (dx === 0 && dz === 1) return "south";
    if (dx === -1 && dz === 0) return "west";
    return undefined;
}

export function manhattanDistanceFromOrigin(coordinate: RegionCoordinate): number {
    return Math.abs(coordinate.rx) + Math.abs(coordinate.rz);
}
