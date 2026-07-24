import { world } from "@minecraft/server";

const ISOLATED_DIMENSIONS_PROPERTY = "yuehua:isolatedDimensionIds";

function readIsolatedDimensions(): string[] {
  const stored = world.getDynamicProperty(ISOLATED_DIMENSIONS_PROPERTY);
  if (typeof stored !== "string" || !stored) return [];
  try {
    const parsed = JSON.parse(stored) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string" && value.length > 0)
      : [];
  } catch {
    return [];
  }
}

export function registerIsolatedDimension(dimensionId: string): void {
  const dimensions = new Set(readIsolatedDimensions());
  if (dimensions.has(dimensionId)) return;
  dimensions.add(dimensionId);
  world.setDynamicProperty(ISOLATED_DIMENSIONS_PROPERTY, JSON.stringify([...dimensions].sort()));
}

export function isDimensionIsolated(dimensionId: string): boolean {
  return readIsolatedDimensions().includes(dimensionId);
}
