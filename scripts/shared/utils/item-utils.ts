/**
 * 物品工具函数
 * 从旧utils中提取的物品相关函数
 */

import { ItemStack, RawMessage } from "@minecraft/server";

/**
 * 获取物品显示名称
 */
// 获得对应物品的中文displayName
export function getItemDisplayName(itemStack: ItemStack): RawMessage {
  const translateKey = itemStack.localizationKey;
  const displayName: RawMessage = {
    translate: translateKey,
  };
  return displayName;
}

/**
 * 获取物品耐久度百分比
 */
// 获得对应物品的耐久度百分比
export function getItemDurabilityPercent(itemStack: ItemStack): string {
  const durability = getItemDurability(itemStack);
  return `${Math.round(durability)}%`;
}

/**
 * 获取物品耐久度数值
 */
export function getItemDurability(itemStack: ItemStack): number {
  const durability = itemStack.getComponent("durability");
  if (!durability) return 0;

  return Math.round(((durability.maxDurability - durability.damage) / durability.maxDurability) * 99);
}

/**
 * 检查物品是否有附魔
 */
export function hasAnyEnchantment(item: ItemStack): boolean {
  const enchantable = item.getComponent("enchantable");
  if (!enchantable) return false;

  try {
    const enchantments = enchantable.getEnchantments();
    return enchantments.length > 0;
  } catch {
    return false;
  }
}

