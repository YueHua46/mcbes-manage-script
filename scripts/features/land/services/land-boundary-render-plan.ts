export type BoundaryDetail = "low" | "balanced" | "high";
export type BoundaryAxis = "x" | "y" | "z";
export type BoundaryEdgeRole = "bottom" | "top" | "vertical";
export type BoundaryRuneVariant = 1 | 2 | 3 | 4 | 5;

export interface BoundaryVector3 {
  x: number;
  y: number;
  z: number;
}

export interface BoundaryRenderProfile {
  runeSpacing: number;
  maxRunes: number;
}

export const BOUNDARY_RENDER_PROFILES: Record<BoundaryDetail, BoundaryRenderProfile> = {
  low: {
    runeSpacing: 12,
    maxRunes: 40,
  },
  balanced: {
    runeSpacing: 10,
    maxRunes: 64,
  },
  high: {
    runeSpacing: 8,
    maxRunes: 88,
  },
};

export interface BoundaryBounds {
  min: BoundaryVector3;
  max: BoundaryVector3;
  size: BoundaryVector3;
  center: BoundaryVector3;
}

export interface BoundaryEdge {
  axis: BoundaryAxis;
  role: BoundaryEdgeRole;
  start: BoundaryVector3;
  end: BoundaryVector3;
  length: number;
}

export interface BoundaryRunePoint {
  position: BoundaryVector3;
  edgeIndex: number;
  edgeRole: BoundaryEdgeRole;
  edgeProgress: number;
  roleProgress: number;
  runeVariant: BoundaryRuneVariant;
  pulsePhase: number;
}

export interface BoundaryRenderPlan {
  bounds: BoundaryBounds;
  edges: BoundaryEdge[];
  runes: BoundaryRunePoint[];
  corners: BoundaryVector3[];
  horizontalPerimeter: number;
}

export interface BoundaryCandidate<T> {
  value: T;
  start: BoundaryVector3;
  end: BoundaryVector3;
  dimension: string;
  priority?: boolean;
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function getBoundaryBounds(start: BoundaryVector3, end: BoundaryVector3): BoundaryBounds {
  const min = {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    z: Math.min(start.z, end.z),
  };
  // 领地端点是包含式方块坐标，因此最大外表面位于 max + 1。
  const max = {
    x: Math.max(start.x, end.x) + 1,
    y: Math.max(start.y, end.y) + 1,
    z: Math.max(start.z, end.z) + 1,
  };
  const size = { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z };
  return {
    min,
    max,
    size,
    center: {
      x: min.x + size.x / 2,
      y: min.y + size.y / 2,
      z: min.z + size.z / 2,
    },
  };
}

export function getBoundaryEdges(bounds: BoundaryBounds): BoundaryEdge[] {
  const { min, max, size } = bounds;
  return [
    {
      axis: "x",
      role: "bottom",
      start: { x: min.x, y: min.y, z: min.z },
      end: { x: max.x, y: min.y, z: min.z },
      length: size.x,
    },
    {
      axis: "z",
      role: "bottom",
      start: { x: max.x, y: min.y, z: min.z },
      end: { x: max.x, y: min.y, z: max.z },
      length: size.z,
    },
    {
      axis: "x",
      role: "bottom",
      start: { x: max.x, y: min.y, z: max.z },
      end: { x: min.x, y: min.y, z: max.z },
      length: size.x,
    },
    {
      axis: "z",
      role: "bottom",
      start: { x: min.x, y: min.y, z: max.z },
      end: { x: min.x, y: min.y, z: min.z },
      length: size.z,
    },
    {
      axis: "x",
      role: "top",
      start: { x: min.x, y: max.y, z: min.z },
      end: { x: max.x, y: max.y, z: min.z },
      length: size.x,
    },
    {
      axis: "z",
      role: "top",
      start: { x: max.x, y: max.y, z: min.z },
      end: { x: max.x, y: max.y, z: max.z },
      length: size.z,
    },
    {
      axis: "x",
      role: "top",
      start: { x: max.x, y: max.y, z: max.z },
      end: { x: min.x, y: max.y, z: max.z },
      length: size.x,
    },
    {
      axis: "z",
      role: "top",
      start: { x: min.x, y: max.y, z: max.z },
      end: { x: min.x, y: max.y, z: min.z },
      length: size.z,
    },
    {
      axis: "y",
      role: "vertical",
      start: { x: min.x, y: min.y, z: min.z },
      end: { x: min.x, y: max.y, z: min.z },
      length: size.y,
    },
    {
      axis: "y",
      role: "vertical",
      start: { x: max.x, y: min.y, z: min.z },
      end: { x: max.x, y: max.y, z: min.z },
      length: size.y,
    },
    {
      axis: "y",
      role: "vertical",
      start: { x: max.x, y: min.y, z: max.z },
      end: { x: max.x, y: max.y, z: max.z },
      length: size.y,
    },
    {
      axis: "y",
      role: "vertical",
      start: { x: min.x, y: min.y, z: max.z },
      end: { x: min.x, y: max.y, z: max.z },
      length: size.y,
    },
  ];
}

export function getBoundaryCorners(bounds: BoundaryBounds): BoundaryVector3[] {
  const { min, max } = bounds;
  return [
    { x: min.x, y: min.y, z: min.z },
    { x: max.x, y: min.y, z: min.z },
    { x: max.x, y: min.y, z: max.z },
    { x: min.x, y: min.y, z: max.z },
    { x: min.x, y: max.y, z: min.z },
    { x: max.x, y: max.y, z: min.z },
    { x: max.x, y: max.y, z: max.z },
    { x: min.x, y: max.y, z: max.z },
  ];
}

function allocateRuneCounts(edges: BoundaryEdge[], profile: BoundaryRenderProfile): number[] {
  const desired = edges.map((edge) => Math.max(0, Math.floor(edge.length / profile.runeSpacing)));
  const capacity = Math.max(0, profile.maxRunes - 8);
  const desiredTotal = desired.reduce((sum, count) => sum + count, 0);
  if (desiredTotal <= capacity) return desired;
  if (capacity === 0 || desiredTotal === 0) return edges.map(() => 0);

  const counts = edges.map(() => 0);
  const shares = desired.map((count, index) => ({ index, raw: (count / desiredTotal) * capacity }));
  let remaining = capacity;
  for (const share of shares) {
    const granted = Math.min(desired[share.index], Math.floor(share.raw));
    counts[share.index] = granted;
    remaining -= granted;
  }
  shares.sort((a, b) => b.raw - Math.floor(b.raw) - (a.raw - Math.floor(a.raw)) || a.index - b.index);
  while (remaining > 0) {
    let grantedAny = false;
    for (const share of shares) {
      if (remaining === 0) break;
      if (counts[share.index] >= desired[share.index]) continue;
      counts[share.index] += 1;
      remaining -= 1;
      grantedAny = true;
    }
    if (!grantedAny) break;
  }
  return counts;
}

function pointOnEdge(edge: BoundaryEdge, progress: number): BoundaryVector3 {
  return {
    x: edge.start.x + (edge.end.x - edge.start.x) * progress,
    y: edge.start.y + (edge.end.y - edge.start.y) * progress,
    z: edge.start.z + (edge.end.z - edge.start.z) * progress,
  };
}

export function createBoundaryRenderPlan(
  start: BoundaryVector3,
  end: BoundaryVector3,
  detail: BoundaryDetail,
  seed = ""
): BoundaryRenderPlan {
  const bounds = getBoundaryBounds(start, end);
  const edges = getBoundaryEdges(bounds);
  const counts = allocateRuneCounts(edges, BOUNDARY_RENDER_PROFILES[detail]);
  const seedHash = hashString(seed);
  const runesByEdge = edges.map((edge, edgeIndex) => {
    const edgeRunes: BoundaryRunePoint[] = [];
    for (let index = 1; index <= counts[edgeIndex]; index++) {
      const edgeProgress = index / (counts[edgeIndex] + 1);
      const roleProgress = edge.role === "vertical" ? edgeProgress : ((edgeIndex % 4) + edgeProgress) / 4;
      const runeVariant = ((seedHash + edgeIndex * 2 + index) % 5) + 1;
      edgeRunes.push({
        position: pointOnEdge(edge, edgeProgress),
        edgeIndex,
        edgeRole: edge.role,
        edgeProgress,
        roleProgress,
        runeVariant: runeVariant as BoundaryRuneVariant,
        // 同一层使用沿周长/高度推进的统一波相，而不是每枚符文独立乱闪。
        pulsePhase: (seedHash + Math.round(roleProgress * 360)) % 360,
      });
    }
    return edgeRunes;
  });
  // Interleave all twelve edges so a job paints the full volume progressively
  // instead of completing one edge while the other eleven remain invisible.
  const runes: BoundaryRunePoint[] = [];
  const longestEdge = Math.max(0, ...runesByEdge.map((edgeRunes) => edgeRunes.length));
  for (let runeIndex = 0; runeIndex < longestEdge; runeIndex++) {
    for (const edgeRunes of runesByEdge) {
      const rune = edgeRunes[runeIndex];
      if (rune) runes.push(rune);
    }
  }
  return {
    bounds,
    edges,
    runes,
    corners: getBoundaryCorners(bounds),
    horizontalPerimeter: 2 * (bounds.size.x + bounds.size.z),
  };
}

export function getBoundaryHorizontalLoopPoint(
  plan: BoundaryRenderPlan,
  layer: "bottom" | "top",
  progress: number
): BoundaryVector3 {
  const y = layer === "bottom" ? plan.bounds.min.y : plan.bounds.max.y;
  let distance = (((progress % 1) + 1) % 1) * plan.horizontalPerimeter;
  const { min, max, size } = plan.bounds;
  if (distance <= size.x) return { x: min.x + distance, y, z: min.z };
  distance -= size.x;
  if (distance <= size.z) return { x: max.x, y, z: min.z + distance };
  distance -= size.z;
  if (distance <= size.x) return { x: max.x - distance, y, z: max.z };
  distance -= size.x;
  return { x: min.x, y, z: max.z - distance };
}

export function getBoundaryVerticalPoint(
  plan: BoundaryRenderPlan,
  cornerIndex: number,
  progress: number
): BoundaryVector3 {
  const index = ((Math.trunc(cornerIndex) % 4) + 4) % 4;
  const bottom = plan.corners[index];
  const top = plan.corners[index + 4];
  const t = Math.min(1, Math.max(0, progress));
  return pointOnEdge({ axis: "y", role: "vertical", start: bottom, end: top, length: plan.bounds.size.y }, t);
}

export function distanceSquaredToBoundaryFootprint(
  start: BoundaryVector3,
  end: BoundaryVector3,
  point: BoundaryVector3
): number {
  const bounds = getBoundaryBounds(start, end);
  const dx = point.x < bounds.min.x ? bounds.min.x - point.x : point.x > bounds.max.x ? point.x - bounds.max.x : 0;
  const dz = point.z < bounds.min.z ? bounds.min.z - point.z : point.z > bounds.max.z ? point.z - bounds.max.z : 0;
  return dx * dx + dz * dz;
}

export function selectNearestBoundaryCandidates<T>(
  candidates: BoundaryCandidate<T>[],
  dimension: string,
  point: BoundaryVector3,
  renderDistance: number,
  maxCount = Number.POSITIVE_INFINITY
): T[] {
  const maxDistanceSquared = renderDistance * renderDistance;
  return candidates
    .filter((candidate) => candidate.dimension === dimension)
    .map((candidate, index) => ({
      candidate,
      index,
      distanceSquared: distanceSquaredToBoundaryFootprint(candidate.start, candidate.end, point),
    }))
    .filter(({ candidate, distanceSquared }) => candidate.priority || distanceSquared <= maxDistanceSquared)
    .sort(
      (a, b) =>
        Number(Boolean(b.candidate.priority)) - Number(Boolean(a.candidate.priority)) ||
        a.distanceSquared - b.distanceSquared ||
        a.index - b.index
    )
    .slice(0, Math.max(0, maxCount))
    .map(({ candidate }) => candidate.value);
}
