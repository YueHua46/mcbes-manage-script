import { CustomDimensionAlreadyRegisteredError, system, world } from "@minecraft/server";
import dimensionRegistry from "./dimension-registry";

export const CUSTOM_DIMENSION_POOL = Array.from({ length: 5 }, (_, index) => {
  const number = index + 1;
  return {
    alias: `custom${number}`,
    dimensionId: `yuehua:custom_${number}`,
    displayName: `自定义维度 ${number}`,
  };
});

system.beforeEvents.startup.subscribe((event) => {
  for (const item of CUSTOM_DIMENSION_POOL) {
    try {
      event.dimensionRegistry.registerCustomDimension(item.dimensionId);
    } catch (error) {
      if (!(error instanceof CustomDimensionAlreadyRegisteredError)) throw error;
    }
  }
});

world.afterEvents.worldLoad.subscribe(() => {
  system.run(() => {
    for (const item of CUSTOM_DIMENSION_POOL) {
      dimensionRegistry.ensureRegisteredDimension(
        item.alias,
        item.dimensionId,
        item.displayName,
        "苦力怕菜单"
      );
    }
  });
});

export function getPoolDimensionByAlias(alias: string) {
  const normalized = dimensionRegistry.normalizeAlias(alias);
  return CUSTOM_DIMENSION_POOL.find((item) => item.alias === normalized);
}
