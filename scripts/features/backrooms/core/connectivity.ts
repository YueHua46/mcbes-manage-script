import { BackroomsGenerationConfig } from "./config";
import {
    BackroomsCell,
    ConnectivityRepair,
    ConnectivityReport,
    LocalCoordinate,
    RegionGrid,
} from "./types";

function isWalkable(cell: BackroomsCell): boolean {
    return cell === BackroomsCell.Walkable || cell === BackroomsCell.Gate;
}

function neighbors(index: number, size: number): number[] {
    const x = index % size;
    const z = Math.floor(index / size);
    const result: number[] = [];
    if (z > 0) result.push(index - size);
    if (x + 1 < size) result.push(index + 1);
    if (z + 1 < size) result.push(index + size);
    if (x > 0) result.push(index - 1);
    return result;
}

export function findWalkableComponents(grid: RegionGrid): readonly (readonly number[])[] {
    const visited = new Uint8Array(grid.size * grid.size);
    const components: number[][] = [];
    for (let start = 0; start < visited.length; start += 1) {
        if (visited[start] !== 0 || !isWalkable(grid.getByIndex(start))) continue;
        const component: number[] = [];
        const queue = [start];
        visited[start] = 1;
        for (let cursor = 0; cursor < queue.length; cursor += 1) {
            const current = queue[cursor];
            component.push(current);
            for (const neighbor of neighbors(current, grid.size)) {
                if (visited[neighbor] === 0 && isWalkable(grid.getByIndex(neighbor))) {
                    visited[neighbor] = 1;
                    queue.push(neighbor);
                }
            }
        }
        components.push(component);
    }
    return components;
}

class MinimumHeap {
    private readonly nodes: Array<{ index: number; distance: number }> = [];

    public get length(): number { return this.nodes.length; }

    public push(index: number, distance: number): void {
        let position = this.nodes.length;
        this.nodes.push({ index, distance });
        while (position > 0) {
            const parent = Math.floor((position - 1) / 2);
            if (this.nodes[parent].distance <= distance) break;
            this.nodes[position] = this.nodes[parent];
            position = parent;
        }
        this.nodes[position] = { index, distance };
    }

    public pop(): { index: number; distance: number } | undefined {
        if (this.nodes.length === 0) return undefined;
        const root = this.nodes[0];
        const last = this.nodes.pop();
        if (this.nodes.length === 0 || last === undefined) return root;
        let position = 0;
        while (true) {
            const left = position * 2 + 1;
            if (left >= this.nodes.length) break;
            const right = left + 1;
            const child = right < this.nodes.length && this.nodes[right].distance < this.nodes[left].distance
                ? right
                : left;
            if (this.nodes[child].distance >= last.distance) break;
            this.nodes[position] = this.nodes[child];
            position = child;
        }
        this.nodes[position] = last;
        return root;
    }
}

function cheapestConnection(
    grid: RegionGrid,
    source: readonly number[],
    targetMask: Uint8Array,
    config: BackroomsGenerationConfig,
): number[] | undefined {
    const count = grid.size * grid.size;
    const distances = new Float64Array(count);
    distances.fill(Number.POSITIVE_INFINITY);
    const previous = new Int32Array(count);
    previous.fill(-1);
    const heap = new MinimumHeap();
    for (const index of source) {
        distances[index] = 0;
        heap.push(index, 0);
    }

    let destination = -1;
    while (heap.length > 0) {
        const node = heap.pop();
        if (node === undefined || node.distance !== distances[node.index]) continue;
        if (targetMask[node.index] !== 0) {
            destination = node.index;
            break;
        }
        for (const neighbor of neighbors(node.index, grid.size)) {
            const cell = grid.getByIndex(neighbor);
            if (cell === BackroomsCell.Protected) continue;
            const stepCost = isWalkable(cell) ? config.floorTraversalCost : config.wallTraversalCost;
            const distance = node.distance + stepCost;
            if (distance < distances[neighbor]) {
                distances[neighbor] = distance;
                previous[neighbor] = node.index;
                heap.push(neighbor, distance);
            }
        }
    }
    if (destination < 0) return undefined;

    const path: number[] = [];
    let current = destination;
    while (current >= 0) {
        path.push(current);
        if (distances[current] === 0) break;
        current = previous[current];
    }
    path.reverse();
    return path;
}

function carveRepairCorridor(
    grid: RegionGrid,
    path: readonly number[],
    width: number,
): number {
    const radius = Math.floor(width / 2);
    let wallsRemoved = 0;
    for (const index of path) {
        const point = grid.coordinateOf(index);
        for (let dz = -radius; dz <= radius; dz += 1) {
            for (let dx = -radius; dx <= radius; dx += 1) {
                const x = point.x + dx;
                const z = point.z + dz;
                if (!grid.contains(x, z)) continue;
                const cell = grid.get(x, z);
                if (cell === BackroomsCell.Wall) {
                    grid.set(x, z, BackroomsCell.Walkable);
                    wallsRemoved += 1;
                }
            }
        }
    }
    return wallsRemoved;
}

function coordinate(grid: RegionGrid, index: number): LocalCoordinate {
    return grid.coordinateOf(index);
}

/** Connects every walkable component without ever drilling the protected shell. */
export function ensureConnectedLayout(
    grid: RegionGrid,
    config: BackroomsGenerationConfig,
): ConnectivityReport {
    let components = findWalkableComponents(grid);
    const initialCount = components.length;
    const repairs: ConnectivityRepair[] = [];
    if (components.length === 0) {
        return {
            initiallyConnected: false,
            connected: false,
            initialComponentCount: 0,
            finalComponentCount: 0,
            repairs,
        };
    }

    while (components.length > 1) {
        // Prefer the component containing a gate; otherwise use the largest.
        const gateComponent = components.find((component) => component.some(
            (index) => grid.getByIndex(index) === BackroomsCell.Gate,
        ));
        const source = gateComponent !== undefined
            ? gateComponent
            : components.reduce((largest, item) => item.length > largest.length ? item : largest);
        const sourceSet = new Uint8Array(grid.size * grid.size);
        for (const index of source) sourceSet[index] = 1;
        const targetMask = new Uint8Array(grid.size * grid.size);
        for (const component of components) {
            if (component !== source) for (const index of component) targetMask[index] = 1;
        }
        const path = cheapestConnection(grid, source, targetMask, config);
        if (path === undefined || path.length === 0) break;
        const wallsRemoved = carveRepairCorridor(grid, path, config.repairCorridorWidth);
        repairs.push({
            from: coordinate(grid, path[0]),
            to: coordinate(grid, path[path.length - 1]),
            pathLength: path.length,
            wallsRemoved,
        });
        const next = findWalkableComponents(grid);
        if (next.length >= components.length) break;
        components = next;
    }

    return {
        initiallyConnected: initialCount === 1,
        connected: components.length === 1,
        initialComponentCount: initialCount,
        finalComponentCount: components.length,
        repairs,
    };
}
