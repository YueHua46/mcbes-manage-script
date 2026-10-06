import type { BoundaryVector3 } from "./land-boundary-render-plan";

export interface BoundaryLandColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

interface ColorLand {
  name: string;
  owner: string;
  dimension: string;
  vectors: { start: BoundaryVector3; end: BoundaryVector3 };
}

/** Soft light colors with actual hue separation, rather than eight similar shades of blue. */
export const BOUNDARY_COLOR_PALETTE: readonly BoundaryLandColor[] = [
  { red: 0.25, green: 0.86, blue: 1, alpha: 0.6 },
  { red: 0.72, green: 0.4, blue: 1, alpha: 0.6 },
  { red: 1, green: 0.42, blue: 0.65, alpha: 0.6 },
  { red: 1, green: 0.72, blue: 0.32, alpha: 0.6 },
  { red: 0.28, green: 1, blue: 0.65, alpha: 0.6 },
  { red: 0.28, green: 0.5, blue: 1, alpha: 0.6 },
  { red: 1, green: 0.5, blue: 0.36, alpha: 0.6 },
  { red: 0.55, green: 1, blue: 0.92, alpha: 0.6 },
];

export const BOUNDARY_COLOR_NEIGHBOR_DISTANCE = 24;
const keyOf = (land: ColorLand) => `${land.name}:${land.owner}`;
const hash = (key: string): number => {
  let value = 2166136261;
  for (let i = 0; i < key.length; i++) value = Math.imul(value ^ key.charCodeAt(i), 16777619);
  return value >>> 0;
};
const contrast = (a: BoundaryLandColor, b: BoundaryLandColor) =>
  (a.red - b.red) ** 2 + (a.green - b.green) ** 2 + (a.blue - b.blue) ** 2;

/** World-wide assignment: independent of player position, visible subset and database iteration order. */
export class BoundaryColorResolver {
  private source?: () => Record<string, ColorLand>;
  private signature = "";
  private colors = new Map<string, BoundaryLandColor>();

  setSource(source: () => Record<string, ColorLand>): void {
    this.source = source;
    this.signature = "";
    this.colors.clear();
  }

  get(seed: string): BoundaryLandColor | undefined {
    if (!this.source) return undefined;
    const lands = Object.values(this.source()).sort((a, b) => {
      const left = keyOf(a),
        right = keyOf(b);
      return left < right ? -1 : left > right ? 1 : 0;
    });
    const signature = JSON.stringify(
      lands.map((land) => [keyOf(land), land.dimension, land.vectors.start, land.vectors.end])
    );
    if (signature !== this.signature) {
      this.colors = this.assign(lands);
      this.signature = signature;
    }
    const color = this.colors.get(seed);
    return color ? { ...color } : undefined;
  }

  private assign(lands: ColorLand[]): Map<string, BoundaryLandColor> {
    const nodes = lands.map((land, index) => ({
      land,
      index,
      minX: Math.min(land.vectors.start.x, land.vectors.end.x),
      maxX: Math.max(land.vectors.start.x, land.vectors.end.x) + 1,
      minZ: Math.min(land.vectors.start.z, land.vectors.end.z),
      maxZ: Math.max(land.vectors.start.z, land.vectors.end.z) + 1,
    }));
    const neighbors = nodes.map(() => new Set<number>());
    const sweep = [...nodes].sort((a, b) => a.minX - b.minX || a.index - b.index);
    for (let i = 0; i < sweep.length; i++) {
      const a = sweep[i];
      for (let j = i + 1; j < sweep.length; j++) {
        const b = sweep[j];
        const dx = Math.max(0, b.minX - a.maxX);
        if (dx > BOUNDARY_COLOR_NEIGHBOR_DISTANCE) break;
        if (a.land.dimension !== b.land.dimension) continue;
        const dz = Math.max(0, a.minZ - b.maxZ, b.minZ - a.maxZ);
        // Horizontal adjacency also distinguishes stacked or deeply buried claims.
        if (Math.hypot(dx, dz) <= BOUNDARY_COLOR_NEIGHBOR_DISTANCE) {
          neighbors[a.index].add(b.index);
          neighbors[b.index].add(a.index);
        }
      }
    }
    const result = new Map<string, BoundaryLandColor>();
    const selected = new Map<number, BoundaryLandColor>();
    for (const node of nodes) {
      const near = [...neighbors[node.index]].flatMap((index) => {
        const color = selected.get(index);
        return color ? [color] : [];
      });
      const preferred = hash(keyOf(node.land)) % BOUNDARY_COLOR_PALETTE.length;
      let best = BOUNDARY_COLOR_PALETTE[preferred];
      let bestContrast = -1;
      for (let offset = 0; offset < BOUNDARY_COLOR_PALETTE.length; offset++) {
        const candidate = BOUNDARY_COLOR_PALETTE[(preferred + offset) % BOUNDARY_COLOR_PALETTE.length];
        const score = near.length ? Math.min(...near.map((color) => contrast(candidate, color))) : 0;
        if (score > bestContrast) {
          bestContrast = score;
          best = candidate;
        }
      }
      selected.set(node.index, best);
      result.set(keyOf(node.land), best);
    }
    return result;
  }
}

export const landBoundaryColors = new BoundaryColorResolver();
