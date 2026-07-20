import {
    BackroomsGenerationConfig,
    createBackroomsConfig,
} from "./config";
import { generateBspLayout } from "./bsp-layout";
import { ensureConnectedLayout } from "./connectivity";
import { deriveSeed32, DeterministicRandom, hashParts32, hashUint32Sequence } from "./hash";
import { getRegionGates } from "./macro-connectivity";
import {
    BackroomsCell,
    BackroomsSeed,
    HorizontalCellRun,
    Rect,
    RegionCoordinate,
    RegionEdgeGate,
    RegionGrid,
    RegionLayout,
    RegionLayoutStatistics,
    SafeLandingCell,
} from "./types";

function carveGate(grid: RegionGrid, gate: RegionEdgeGate, borderThickness: number): void {
    for (let across = gate.offset; across < gate.offset + gate.width; across += 1) {
        for (let layer = 0; layer < borderThickness; layer += 1) {
            switch (gate.direction) {
                case "north": grid.set(across, layer, BackroomsCell.Gate); break;
                case "east": grid.set(grid.size - 1 - layer, across, BackroomsCell.Gate); break;
                case "south": grid.set(across, grid.size - 1 - layer, BackroomsCell.Gate); break;
                case "west": grid.set(layer, across, BackroomsCell.Gate); break;
            }
        }
    }
}

export function collectWallRuns(grid: RegionGrid): readonly HorizontalCellRun[] {
    const result: HorizontalCellRun[] = [];
    const consumed = new Uint8Array(grid.size * grid.size);
    for (let z = 1; z < grid.size - 1; z += 1) {
        for (let x = 1; x < grid.size - 1; x += 1) {
            const index = z * grid.size + x;
            if (consumed[index] || grid.get(x, z) !== BackroomsCell.Wall) continue;

            let maxX = x;
            while (maxX + 1 < grid.size - 1
                && !consumed[z * grid.size + maxX + 1]
                && grid.get(maxX + 1, z) === BackroomsCell.Wall) maxX += 1;

            let maxZ = z;
            row: while (maxZ + 1 < grid.size - 1) {
                for (let checkX = x; checkX <= maxX; checkX += 1) {
                    const checkIndex = (maxZ + 1) * grid.size + checkX;
                    if (consumed[checkIndex] || grid.get(checkX, maxZ + 1) !== BackroomsCell.Wall) break row;
                }
                maxZ += 1;
            }

            for (let markZ = z; markZ <= maxZ; markZ += 1) {
                for (let markX = x; markX <= maxX; markX += 1) consumed[markZ * grid.size + markX] = 1;
            }
            result.push({ minX: x, minZ: z, maxX, maxZ, cell: BackroomsCell.Wall });
        }
    }
    return result;
}

/** Selects the center-nearest walkable 2x2 pad; stable for a given layout. */
export function findSafeLandingCell(layout: RegionLayout, target?: { x: number; z: number }): SafeLandingCell {
    const targetX = target?.x ?? (layout.size - 1) / 2;
    const targetZ = target?.z ?? (layout.size - 1) / 2;
    let best: { x: number; z: number; score: number } | undefined;
    for (let z = 2; z < layout.size - 3; z += 1) {
        for (let x = 2; x < layout.size - 3; x += 1) {
            if (layout.grid.get(x, z) !== BackroomsCell.Walkable
                || layout.grid.get(x + 1, z) !== BackroomsCell.Walkable
                || layout.grid.get(x, z + 1) !== BackroomsCell.Walkable
                || layout.grid.get(x + 1, z + 1) !== BackroomsCell.Walkable) continue;
            const score = (x + 0.5 - targetX) ** 2 + (z + 0.5 - targetZ) ** 2;
            if (!best || score < best.score) best = { x, z, score };
        }
    }
    if (!best) throw new Error(`Region ${layout.coordinate.rx},${layout.coordinate.rz} has no safe 2x2 landing pad`);
    return { x: best.x, z: best.z, width: 2, depth: 2 };
}

function countCells(grid: RegionGrid): RegionLayoutStatistics {
    let wallCells = 0;
    let walkableCells = 0;
    let gateCells = 0;
    grid.forEach((cell) => {
        if (cell === BackroomsCell.Wall || cell === BackroomsCell.Protected) wallCells += 1;
        else if (cell === BackroomsCell.Gate) gateCells += 1;
        else walkableCells += 1;
    });
    return { wallCells, walkableCells, gateCells, roomCount: 0, partitionCount: 0 };
}

export function generateRegionLayout(
    worldSeed: BackroomsSeed,
    coordinate: RegionCoordinate,
    overrides: Partial<BackroomsGenerationConfig> = {},
): RegionLayout {
    if (!Number.isInteger(coordinate.rx) || !Number.isInteger(coordinate.rz)) {
        throw new RangeError("Region coordinates must be integers");
    }
    const config = createBackroomsConfig(overrides);
    const grid = new RegionGrid(config.regionSize, BackroomsCell.Protected);
    const interior: Rect = {
        x: config.borderThickness,
        z: config.borderThickness,
        width: config.regionSize - config.borderThickness * 2,
        depth: config.regionSize - config.borderThickness * 2,
    };
    grid.fillRect(interior, BackroomsCell.Walkable);

    const gates = getRegionGates(worldSeed, coordinate, config);
    for (const gate of gates) carveGate(grid, gate, config.borderThickness);

    const layoutRandom = new DeterministicRandom(deriveSeed32(
        worldSeed,
        config.algorithmVersion,
        "bsp-layout",
        coordinate.rx,
        coordinate.rz,
    ));
    const bsp = generateBspLayout(grid, interior, layoutRandom, config);
    const connectivity = ensureConnectedLayout(grid, config);
    if (!connectivity.connected) {
        throw new Error(`Unable to connect backrooms region ${coordinate.rx},${coordinate.rz}`);
    }

    const counts = countCells(grid);
    const statistics: RegionLayoutStatistics = {
        ...counts,
        roomCount: bsp.rooms.length,
        partitionCount: bsp.partitions.length,
    };
    const fingerprint = hashParts32(
        "backrooms-layout-fingerprint",
        config.algorithmVersion,
        coordinate.rx,
        coordinate.rz,
        hashUint32Sequence(grid.toUint8Array()),
    );

    const stableCoordinate = { rx: coordinate.rx, rz: coordinate.rz };
    const wallRuns = collectWallRuns(grid);
    return {
        coordinate: stableCoordinate,
        region: stableCoordinate,
        size: config.regionSize,
        grid,
        gates,
        rooms: bsp.rooms,
        partitions: bsp.partitions,
        connectivity,
        fingerprint,
        statistics,
        wallRuns,
        walls: wallRuns,
    };
}

/** Convenience signature for runtime consumers. */
export function generateRegionPlan(
    worldSeed: BackroomsSeed,
    rx: number,
    rz: number,
    overrides: Partial<BackroomsGenerationConfig> = {},
): RegionLayout {
    return generateRegionLayout(worldSeed, { rx, rz }, overrides);
}
