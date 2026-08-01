export type BackroomsSeed = number | string;

export interface RegionCoordinate {
  readonly rx: number;
  readonly rz: number;
}

export interface LocalCoordinate {
  readonly x: number;
  readonly z: number;
}

export type CardinalDirection = "north" | "east" | "south" | "west";

export interface Rect {
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
}

export type PartitionOrientation = "vertical" | "horizontal";

export interface WallOpening {
  /** Offset on the partition's varying axis, in local region coordinates. */
  readonly offset: number;
  readonly width: number;
}

export interface PartitionWall {
  readonly orientation: PartitionOrientation;
  /** X for a vertical wall, Z for a horizontal wall. */
  readonly position: number;
  readonly start: number;
  readonly length: number;
  readonly openings: readonly WallOpening[];
}

export type RoomKind = "standard" | "open-hall" | "column-hall" | "tight";

export interface RoomLeaf {
  readonly rect: Rect;
  readonly depth: number;
  readonly kind: RoomKind;
}

export interface RegionEdgeGate {
  readonly direction: CardinalDirection;
  /** Offset along X for north/south, or Z for east/west. */
  readonly offset: number;
  readonly width: number;
  readonly neighbor: RegionCoordinate;
  /** True for a parent-tree edge; false for an optional loop edge. */
  readonly mandatory: boolean;
}

export enum BackroomsCell {
  Wall = 0,
  Walkable = 1,
  Gate = 2,
  /** A wall that connectivity repair must not drill through. */
  Protected = 3,
}

export interface ConnectivityRepair {
  readonly from: LocalCoordinate;
  readonly to: LocalCoordinate;
  readonly pathLength: number;
  readonly wallsRemoved: number;
}

export interface ConnectivityReport {
  readonly initiallyConnected: boolean;
  readonly connected: boolean;
  readonly initialComponentCount: number;
  readonly finalComponentCount: number;
  readonly repairs: readonly ConnectivityRepair[];
}

export interface RegionLayoutStatistics {
  readonly wallCells: number;
  readonly walkableCells: number;
  readonly gateCells: number;
  readonly roomCount: number;
  readonly partitionCount: number;
}

export interface HorizontalCellRun {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
  readonly cell: BackroomsCell;
}

export interface RegionLayout {
  readonly coordinate: RegionCoordinate;
  /** Runtime-friendly alias of coordinate. */
  readonly region: RegionCoordinate;
  readonly size: number;
  readonly grid: RegionGrid;
  readonly gates: readonly RegionEdgeGate[];
  readonly rooms: readonly RoomLeaf[];
  readonly partitions: readonly PartitionWall[];
  readonly connectivity: ConnectivityReport;
  /** Stable unsigned 32-bit signature of the logical layout. */
  readonly fingerprint: number;
  readonly statistics: RegionLayoutStatistics;
  /** Row-compressed wall/protected volumes, suitable for runtime fill calls. */
  readonly wallRuns: readonly HorizontalCellRun[];
  /** Runtime-friendly alias of wallRuns. */
  readonly walls: readonly HorizontalCellRun[];
}

export interface SafeLandingCell extends LocalCoordinate {
  /** The landing pad occupies (x,z) through (x+1,z+1). */
  readonly width: 2;
  readonly depth: 2;
}

/**
 * Mutable compact grid used while planning a region. Runtime code may read it,
 * but should treat a returned RegionLayout as immutable.
 */
export class RegionGrid {
  public readonly size: number;
  private readonly cells: Uint8Array;

  public constructor(size: number, initial: BackroomsCell = BackroomsCell.Wall) {
    if (!Number.isInteger(size) || size < 3) {
      throw new RangeError(`RegionGrid size must be an integer >= 3, received ${size}`);
    }
    this.size = size;
    this.cells = new Uint8Array(size * size);
    this.cells.fill(initial);
  }

  public contains(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.size && z < this.size;
  }

  public indexOf(x: number, z: number): number {
    if (!this.contains(x, z)) {
      throw new RangeError(`Grid coordinate (${x}, ${z}) is outside 0..${this.size - 1}`);
    }
    return z * this.size + x;
  }

  public coordinateOf(index: number): LocalCoordinate {
    if (!Number.isInteger(index) || index < 0 || index >= this.cells.length) {
      throw new RangeError(`Grid index ${index} is outside the grid`);
    }
    return { x: index % this.size, z: Math.floor(index / this.size) };
  }

  public get(x: number, z: number): BackroomsCell {
    return this.cells[this.indexOf(x, z)] as BackroomsCell;
  }

  public getByIndex(index: number): BackroomsCell {
    if (index < 0 || index >= this.cells.length) {
      throw new RangeError(`Grid index ${index} is outside the grid`);
    }
    return this.cells[index] as BackroomsCell;
  }

  public set(x: number, z: number, value: BackroomsCell): void {
    this.cells[this.indexOf(x, z)] = value;
  }

  public setByIndex(index: number, value: BackroomsCell): void {
    if (index < 0 || index >= this.cells.length) {
      throw new RangeError(`Grid index ${index} is outside the grid`);
    }
    this.cells[index] = value;
  }

  public fillRect(rect: Rect, value: BackroomsCell): void {
    const maxX = rect.x + rect.width;
    const maxZ = rect.z + rect.depth;
    if (rect.width < 0 || rect.depth < 0 || !this.contains(rect.x, rect.z) || maxX > this.size || maxZ > this.size) {
      throw new RangeError(`Rectangle is outside the ${this.size}x${this.size} grid`);
    }
    for (let z = rect.z; z < maxZ; z += 1) {
      for (let x = rect.x; x < maxX; x += 1) {
        this.set(x, z, value);
      }
    }
  }

  public forEach(visitor: (cell: BackroomsCell, x: number, z: number, index: number) => void): void {
    for (let index = 0; index < this.cells.length; index += 1) {
      const coordinate = this.coordinateOf(index);
      visitor(this.cells[index] as BackroomsCell, coordinate.x, coordinate.z, index);
    }
  }

  public clone(): RegionGrid {
    const result = new RegionGrid(this.size);
    for (let index = 0; index < this.cells.length; index += 1) {
      result.cells[index] = this.cells[index];
    }
    return result;
  }

  public toUint8Array(): Uint8Array {
    return this.cells.slice();
  }
}
