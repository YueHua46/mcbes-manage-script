/**
 * 防刷物品：收纳袋与容器类型判定
 */

import type { Block } from "@minecraft/server";
import { getBlockInventoryContainer } from "./block-inventory-access";

/** 允许放入收纳袋的方块容器 type.id */
const ALLOWED_BLOCK_CONTAINER_IDS = new Set<string>([
  "minecraft:chest",
  "minecraft:trapped_chest",
  "minecraft:barrel",
  "minecraft:ender_chest",
]);

export function isBundleTypeId(typeId: string): boolean {
  if (!typeId) return false;
  if (typeId === "minecraft:bundle") return true;
  return typeId.startsWith("minecraft:") && typeId.endsWith("_bundle");
}

export function isAllowedBlockContainerTypeId(typeId: string): boolean {
  if (!typeId) return false;
  if (ALLOWED_BLOCK_CONTAINER_IDS.has(typeId)) return true;
  if (typeId.includes("shulker_box")) return true;
  if (typeId.endsWith("copper_chest")) return true;
  return false;
}

/**
 * 非常规容器方块 typeId 兜底（与行为日志「其它容器」一致；hopper 等为官方 typeId）
 */
export const RESTRICTED_CONTAINER_BLOCK_TYPE_IDS = new Set<string>([
  "minecraft:hopper",
  "minecraft:dropper",
  "minecraft:dispenser",
  "minecraft:furnace",
  "minecraft:blast_furnace",
  "minecraft:smoker",
  "minecraft:brewing_stand",
  "minecraft:crafter",
]);

/** 方块带物品栏且收纳袋规则下视为「非常规」需管控 */
export function isRestrictedBlockInventory(block: Block): boolean {
  const typeId = block.typeId;
  if (isAllowedBlockContainerTypeId(typeId)) return false;
  if (getBlockInventoryContainer(block)) return true;
  return RESTRICTED_CONTAINER_BLOCK_TYPE_IDS.has(typeId);
}

/** 收纳袋可放的实体容器 */
const ALLOWED_ENTITY_CONTAINER_IDS = new Set<string>([
  "minecraft:chest_minecart",
  "minecraft:chest_boat",
]);

/** 首期实体侧仅拦截漏斗矿车（与漏斗方块同类风险） */
export function isRestrictedEntityContainer(typeId: string): boolean {
  if (!typeId) return false;
  if (ALLOWED_ENTITY_CONTAINER_IDS.has(typeId)) return false;
  return typeId === "minecraft:hopper_minecart";
}
