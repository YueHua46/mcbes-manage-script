import { BoundaryDetail, BoundaryEdge, BoundaryRenderPlan, BoundaryVector3 } from "./land-boundary-render-plan";

/** Adjacent refreshes overlap for a full, complementary crossfade. */
export const FRAME_REFRESH_TICKS = 40;
export const FRAME_CROSSFADE = 0.6;
export const FRAME_LIFETIME = FRAME_REFRESH_TICKS / 20 + FRAME_CROSSFADE;
export const FRAME_FLOW_SPEED = 4;
export const FRAME_PROFILES = {
  low: { distance: 80, maxSegments: 512, maxLands: 3, particles: 1080, wallDistance: 80, maxPanels: 48 },
  balanced: { distance: 128, maxSegments: 768, maxLands: 4, particles: 2160, wallDistance: 128, maxPanels: 96 },
  high: { distance: 160, maxSegments: 1024, maxLands: 6, particles: 3240, wallDistance: 160, maxPanels: 144 },
} as const;

export interface BoundaryFrameSegment {
  position: BoundaryVector3;
  axis: BoundaryEdge["axis"];
  role: BoundaryEdge["role"];
  length: number;
  distance: number;
}

export interface BoundaryCurtainPanel {
  position: BoundaryVector3;
  plane: "xy" | "yz";
  width: number;
  height: number;
  distance: number;
  u: number;
  v: number;
  verticalProgress: number;
}

/** Stable 4x4 world cells on the four real side faces. No height slice or artificial ground. */
export function planBoundaryCurtain(
  plan: BoundaryRenderPlan,
  viewer: BoundaryVector3,
  detail: BoundaryDetail
): BoundaryCurtainPanel[] {
  const { wallDistance: radius, maxPanels } = FRAME_PROFILES[detail];
  const { min, max } = plan.bounds;
  const panels: BoundaryCurtainPanel[] = [];
  for (const [axis, normal, fixed] of [
    ["x", "z", min.z],
    ["x", "z", max.z],
    ["z", "x", min.x],
    ["z", "x", max.x],
  ] as const) {
    const normalDistance = Math.abs(viewer[normal] - fixed);
    if (normalDistance >= radius) continue;
    const reach = Math.sqrt(radius ** 2 - normalDistance ** 2);
    const firstX = Math.max(0, Math.floor((viewer[axis] - reach - min[axis]) / 4));
    const lastX = Math.min(Math.ceil((max[axis] - min[axis]) / 4), Math.ceil((viewer[axis] + reach - min[axis]) / 4));
    const firstY = Math.max(0, Math.floor((viewer.y - reach - min.y) / 4));
    const lastY = Math.min(Math.ceil((max.y - min.y) / 4), Math.ceil((viewer.y + reach - min.y) / 4));
    for (let row = firstY; row < lastY; row++)
      for (let column = firstX; column < lastX; column++) {
        const from = min[axis] + column * 4,
          bottom = min.y + row * 4;
        const width = Math.min(4, max[axis] - from),
          height = Math.min(4, max.y - bottom);
        const position = { ...min, [normal]: fixed, [axis]: from + width / 2, y: bottom + height / 2 };
        const distance = boundaryPointDistance(position, viewer);
        if (distance >= radius) continue;
        panels.push({
          position,
          plane: axis === "x" ? "xy" : "yz",
          width,
          height,
          distance,
          u: 0,
          v: 1 - height / 4,
          verticalProgress: (position.y - min.y) / (max.y - min.y),
        });
      }
  }
  return panels.sort((a, b) => a.distance - b.distance).slice(0, maxPanels);
}

export function boundaryPointDistance(a: BoundaryVector3, b: BoundaryVector3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Clip before sampling: even million-block edges cost O(view distance), not O(land size). */
export function planBoundaryFrame(
  plan: BoundaryRenderPlan,
  viewer: BoundaryVector3,
  detail: BoundaryDetail
): BoundaryFrameSegment[] {
  const profile = FRAME_PROFILES[detail];
  const segments: BoundaryFrameSegment[] = [];
  for (const edge of plan.edges) {
    const axis = edge.axis;
    const otherAxes = (["x", "y", "z"] as const).filter((value) => value !== axis);
    const lateralSquared = otherAxes.reduce((sum, value) => sum + (edge.start[value] - viewer[value]) ** 2, 0);
    if (lateralSquared >= profile.distance ** 2) continue;
    const reach = Math.sqrt(profile.distance ** 2 - lateralSquared);
    const low = Math.min(edge.start[axis], edge.end[axis]);
    const high = Math.max(edge.start[axis], edge.end[axis]);
    const visibleLow = Math.max(low, viewer[axis] - reach);
    const visibleHigh = Math.min(high, viewer[axis] + reach);
    // Stable four-block cells avoid seams moving as the viewer moves.
    const first = Math.max(0, Math.floor((visibleLow - low) / 4));
    const last = Math.min(Math.ceil(edge.length / 4), Math.ceil((visibleHigh - low) / 4));
    for (let index = first; index < last; index++) {
      const from = Math.max(low + index * 4, visibleLow);
      const to = Math.min(low + (index + 1) * 4, high, visibleHigh);
      if (to <= from) continue;
      const position = { ...edge.start, [axis]: (from + to) / 2 };
      segments.push({
        position,
        axis,
        role: edge.role,
        length: to - from,
        distance: boundaryPointDistance(position, viewer),
      });
    }
  }
  return segments.sort((a, b) => a.distance - b.distance).slice(0, profile.maxSegments);
}

/** Matches the client Molang rectangular path, including negative phases and corner crossings. */
export function boundaryFlowOffset(width: number, depth: number, distance: number): { x: number; z: number } {
  const perimeter = 2 * (width + depth);
  const t = ((distance % perimeter) + perimeter) % perimeter;
  return {
    x: Math.min(t, width) - Math.max(0, Math.min(t - width - depth, width)),
    z: Math.max(0, Math.min(t - width, depth)) - Math.max(0, Math.min(t - 2 * width - depth, depth)),
  };
}

/** Spend samples across every visible edge, rather than exhausting the budget on the nearest edge. */
export function planBoundaryOutline(
  plan: BoundaryRenderPlan,
  viewer: BoundaryVector3,
  detail: BoundaryDetail,
  limit: number
): BoundaryFrameSegment[] {
  const groups = new Map<string, BoundaryFrameSegment[]>();
  for (const segment of planBoundaryFrame(plan, viewer, detail)) {
    const key = [
      segment.axis,
      ...(["x", "y", "z"] as const).filter((axis) => axis !== segment.axis).map((axis) => segment.position[axis]),
    ].join(":");
    const group = groups.get(key) ?? [];
    group.push(segment);
    groups.set(key, group);
  }
  const edges = [...groups.values()];
  const result: BoundaryFrameSegment[] = [];
  for (let index = 0; index < edges.length; index++) {
    const edge = edges[index].sort((a, b) => a.position[a.axis] - b.position[b.axis]);
    const count = Math.min(edge.length, Math.floor(limit / edges.length) + (index < limit % edges.length ? 1 : 0));
    for (let sample = 0; sample < count; sample++) {
      result.push(edge[Math.min(edge.length - 1, Math.floor(((sample + 0.5) * edge.length) / count))]);
    }
  }
  return result;
}

/** A land-relative lattice: moving the viewer only reveals/hides points, never moves retained points. */
export function planBoundaryMarkers(
  plan: BoundaryRenderPlan,
  viewer: BoundaryVector3,
  detail: BoundaryDetail,
  limit: number,
  minimumSpacing = 2
): BoundaryVector3[] {
  if (limit <= 12) return [];
  const radius = FRAME_PROFILES[detail].distance;
  const spacing = boundaryMarkerSpacing(plan, detail, limit, minimumSpacing);
  const points: BoundaryVector3[] = [];
  for (const edge of plan.edges) {
    const axis = edge.axis;
    const lateralSquared = (["x", "y", "z"] as const)
      .filter((a) => a !== axis)
      .reduce((sum, a) => sum + (edge.start[a] - viewer[a]) ** 2, 0);
    if (lateralSquared >= radius ** 2) continue;
    const reach = Math.sqrt(radius ** 2 - lateralSquared);
    const low = Math.min(edge.start[axis], edge.end[axis]);
    const high = Math.max(edge.start[axis], edge.end[axis]);
    const first = Math.max(1, Math.ceil((viewer[axis] - reach - low) / spacing));
    const last = Math.min(Math.ceil((high - low) / spacing) - 1, Math.floor((viewer[axis] + reach - low) / spacing));
    for (let index = first; index <= last; index++) points.push({ ...edge.start, [axis]: low + index * spacing });
  }
  return points;
}

/** One spacing for all twelve edges, independent of edge orientation, height and viewer location. */
export function boundaryMarkerSpacing(
  plan: BoundaryRenderPlan,
  detail: BoundaryDetail,
  limit: number,
  minimumSpacing = 2
): number {
  const radius = FRAME_PROFILES[detail].distance;
  const length = plan.edges.reduce((sum, edge) => sum + Math.min(edge.length, radius * 2), 0);
  return Math.max(minimumSpacing, minimumSpacing * Math.ceil(length / (Math.max(1, limit - 12) * minimumSpacing)));
}

/** Mutable budget is shared by every job in one player's refresh, never one budget per land. */
/** Horizontal footprint ignores claim height; terrain height is resolved separately by the renderer. */
export function planBoundaryFootprint(
  plan: BoundaryRenderPlan,
  viewer: BoundaryVector3,
  detail: BoundaryDetail,
  limit: number
): { position: BoundaryVector3; corner: boolean }[] {
  if (limit < 4) return [];
  const radius = FRAME_PROFILES[detail].distance;
  const edges = plan.edges.filter((edge) => edge.role === "bottom");
  const length = edges.reduce((sum, edge) => sum + Math.min(edge.length, radius * 2), 0);
  const spacing = Math.max(1, 2 ** Math.ceil(Math.log2(length / Math.max(1, limit - 8))));
  const visible = (p: BoundaryVector3) => Math.hypot(p.x - viewer.x, p.z - viewer.z) < radius;
  const points = plan.corners
    .filter((p) => p.y === plan.bounds.min.y && visible(p))
    .map((position) => ({ position, corner: true }));
  for (const edge of edges) {
    const axis = edge.axis;
    const lateral = axis === "x" ? "z" : "x";
    const squared = (edge.start[lateral] - viewer[lateral]) ** 2;
    if (squared >= radius ** 2) continue;
    const reach = Math.sqrt(radius ** 2 - squared);
    const low = Math.min(edge.start[axis], edge.end[axis]);
    const high = Math.max(edge.start[axis], edge.end[axis]);
    const first = Math.max(1, Math.ceil((viewer[axis] - reach - low) / spacing));
    const last = Math.min(Math.ceil((high - low) / spacing) - 1, Math.floor((viewer[axis] + reach - low) / spacing));
    for (let index = first; index <= last; index++) {
      points.push({ position: { ...edge.start, [axis]: low + index * spacing }, corner: false });
    }
  }
  return points;
}

export interface BoundaryFrameBudget {
  remaining: number;
}
export function reserveBoundaryParticles(budget: BoundaryFrameBudget, count: number): boolean {
  if (budget.remaining < count) return false;
  budget.remaining -= count;
  return true;
}
