/**
 * 方块物品栏：部分版本/方块需同时尝试 inventory 与 minecraft:inventory
 */

import type { Block, Container, Entity } from "@minecraft/server";

const BLOCK_INV_IDS = ["minecraft:inventory", "inventory"] as const;

export function getBlockInventoryContainer(block: Block): Container | undefined {
  try {
    for (const id of BLOCK_INV_IDS) {
      const comp = block.getComponent(id) as { container?: Container } | undefined;
      const c = comp?.container;
      if (c?.isValid) return c;
    }
  } catch {
    /* 区块未就绪等 */
  }
  return undefined;
}

export function getEntityInventoryContainer(entity: Entity): Container | undefined {
  try {
    for (const id of BLOCK_INV_IDS) {
      const comp = entity.getComponent(id) as { container?: Container } | undefined;
      const c = comp?.container;
      if (c?.isValid) return c;
    }
  } catch {
    /* noop */
  }
  return undefined;
}
