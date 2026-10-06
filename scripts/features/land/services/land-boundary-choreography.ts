import { BoundaryBounds, BoundaryVector3 } from "./land-boundary-render-plan";

/** Project onto the actual box surface, including top/bottom crossings and teleports. */
export function boundaryWakeOrigin(bounds: BoundaryBounds, viewer: BoundaryVector3): BoundaryVector3 {
  const axes = ["x", "y", "z"] as const;
  const point = { ...viewer };
  for (const axis of axes) point[axis] = Math.min(bounds.max[axis], Math.max(bounds.min[axis], viewer[axis]));
  if (axes.some((axis) => point[axis] !== viewer[axis])) return point;
  let distance = Infinity;
  let nearest: BoundaryVector3 = point;
  for (const axis of axes)
    for (const side of [bounds.min[axis], bounds.max[axis]]) {
      const gap = Math.abs(viewer[axis] - side);
      if (gap < distance) {
        distance = gap;
        nearest = { ...point, [axis]: side };
      }
    }
  return nearest;
}

/** Stable cell variation: clusters keep their identity across ambient refreshes. */
export function boundaryCluster(seed: string, position: BoundaryVector3): number {
  let hash = 2166136261;
  for (const char of `${seed}:${position.x}:${position.y}:${position.z}`) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

export function boundaryWakeDelay(origin: BoundaryVector3, position: BoundaryVector3): number {
  const distance = Math.hypot(position.x - origin.x, position.y - origin.y, position.z - origin.z);
  return distance < 0.01 ? 0 : Math.min(1.25, 0.22 + distance / 18);
}

/** Bounded cells on all six faces, so flight through a top/bottom face also spreads locally. */
export function boundaryWakePatches(
  bounds: BoundaryBounds,
  origin: BoundaryVector3,
  seed = "wake"
): { position: BoundaryVector3; span: BoundaryVector3 }[] {
  return boundarySurfacePatches(bounds, origin, seed, 16, 36);
}

/** Irregular clusters on real faces, with no edge or corner emitters. */
export function boundarySurfacePatches(
  bounds: BoundaryBounds,
  origin: BoundaryVector3,
  seed: string,
  radius: number,
  limit: number
): {
  position: BoundaryVector3;
  span: BoundaryVector3;
}[] {
  const axes = ["x", "y", "z"] as const;
  const patches: { position: BoundaryVector3; span: BoundaryVector3 }[] = [];
  for (const normal of axes) {
    const [u, v] = axes.filter((axis) => axis !== normal);
    for (const fixed of [bounds.min[normal], bounds.max[normal]]) {
      if (Math.abs(origin[normal] - fixed) > radius) continue;
      const firstU = Math.max(0, Math.floor((origin[u] - radius - bounds.min[u]) / 4));
      const lastU = Math.min(
        Math.ceil((bounds.max[u] - bounds.min[u]) / 4),
        Math.ceil((origin[u] + radius - bounds.min[u]) / 4)
      );
      const firstV = Math.max(0, Math.floor((origin[v] - radius - bounds.min[v]) / 4));
      const lastV = Math.min(
        Math.ceil((bounds.max[v] - bounds.min[v]) / 4),
        Math.ceil((origin[v] + radius - bounds.min[v]) / 4)
      );
      for (let row = firstV; row < lastV; row++)
        for (let col = firstU; col < lastU; col++) {
          const lowU = bounds.min[u] + col * 4,
            lowV = bounds.min[v] + row * 4;
          const width = Math.min(4, bounds.max[u] - lowU),
            height = Math.min(4, bounds.max[v] - lowV);
          const position = { ...origin, [normal]: fixed, [u]: lowU + width / 2, [v]: lowV + height / 2 };
          if (boundaryCluster(`${seed}:density`, position) < 0.22) continue;
          const offsetU = boundaryCluster(`${seed}:u`, position);
          const offsetV = boundaryCluster(`${seed}:v`, position);
          position[u] += (offsetU - 0.5) * width * 0.55;
          position[v] += (offsetV - 0.5) * height * 0.55;
          if (Math.hypot(position.x - origin.x, position.y - origin.y, position.z - origin.z) > radius) continue;
          patches.push({ position, span: { x: 0.6, y: 0.6, z: 0.6, [u]: width, [v]: height } });
        }
    }
  }
  return patches
    .sort(
      (a, b) =>
        Math.hypot(a.position.x - origin.x, a.position.y - origin.y, a.position.z - origin.z) -
        Math.hypot(b.position.x - origin.x, b.position.y - origin.y, b.position.z - origin.z)
    )
    .slice(0, limit);
}
