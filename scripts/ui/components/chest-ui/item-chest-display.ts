/**
 * Chest UI 物品展示：药水/附魔说明（RawMessage translate）；纹理键仅做 type-ids 变体映射。
 */

import type { Enchantment } from "@minecraft/server";
import { ItemEnchantableComponent, ItemPotionComponent, ItemStack, RawMessage } from "@minecraft/server";
import { typeIdToDataId } from "./type-ids";

/** minecraft:xxx 附魔 ID → Bedrock en_US.lang 键（与官方资源包一致，中文客户端会显示中文名） */
const MINECRAFT_ENCHANT_TO_LANG_KEY: Record<string, string> = {
  "minecraft:protection": "enchantment.protect.all",
  "minecraft:fire_protection": "enchantment.protect.fire",
  "minecraft:feather_falling": "enchantment.protect.fall",
  "minecraft:blast_protection": "enchantment.protect.explosion",
  "minecraft:projectile_protection": "enchantment.protect.projectile",
  "minecraft:respiration": "enchantment.oxygen",
  "minecraft:depth_strider": "enchantment.waterWalker",
  "minecraft:aqua_affinity": "enchantment.waterWorker",
  "minecraft:thorns": "enchantment.thorns",
  "minecraft:sharpness": "enchantment.damage.all",
  "minecraft:smite": "enchantment.damage.undead",
  "minecraft:bane_of_arthropods": "enchantment.damage.arthropods",
  "minecraft:knockback": "enchantment.knockback",
  "minecraft:fire_aspect": "enchantment.fire",
  "minecraft:looting": "enchantment.lootBonus",
  "minecraft:silk_touch": "enchantment.untouching",
  "minecraft:efficiency": "enchantment.digging",
  "minecraft:unbreaking": "enchantment.durability",
  "minecraft:fortune": "enchantment.lootBonusDigger",
  "minecraft:power": "enchantment.arrowDamage",
  "minecraft:punch": "enchantment.arrowKnockback",
  "minecraft:flame": "enchantment.arrowFire",
  "minecraft:infinity": "enchantment.arrowInfinite",
  "minecraft:luck_of_the_sea": "enchantment.lootBonusFishing",
  "minecraft:lure": "enchantment.fishingSpeed",
  "minecraft:frost_walker": "enchantment.frostwalker",
  "minecraft:mending": "enchantment.mending",
  "minecraft:binding_curse": "enchantment.curse.binding",
  "minecraft:vanishing_curse": "enchantment.curse.vanishing",
  "minecraft:impaling": "enchantment.tridentImpaling",
  "minecraft:riptide": "enchantment.tridentRiptide",
  "minecraft:loyalty": "enchantment.tridentLoyalty",
  "minecraft:channeling": "enchantment.tridentChanneling",
  "minecraft:multishot": "enchantment.crossbowMultishot",
  "minecraft:quick_charge": "enchantment.crossbowQuickCharge",
  "minecraft:piercing": "enchantment.crossbowPiercing",
  "minecraft:soul_speed": "enchantment.soul_speed",
  "minecraft:swift_sneak": "enchantment.swift_sneak",
  "minecraft:breach": "enchantment.heavy_weapon.breach",
  "minecraft:density": "enchantment.heavy_weapon.density",
  "minecraft:wind_burst": "enchantment.heavy_weapon.windburst",
};

/** 状态效果 ID → potion.xxx 语言键（效果简短名，与官方 lang 一致） */
const EFFECT_ID_TO_POTION_LANG: Record<string, string> = {
  "minecraft:night_vision": "potion.nightVision",
  "minecraft:jump_boost": "potion.jump",
  "minecraft:fire_resistance": "potion.fireResistance",
  "minecraft:speed": "potion.moveSpeed",
  "minecraft:slowness": "potion.moveSlowdown",
  "minecraft:water_breathing": "potion.waterBreathing",
  "minecraft:instant_health": "potion.heal",
  "minecraft:instant_damage": "potion.harm",
  "minecraft:poison": "potion.poison",
  "minecraft:regeneration": "potion.regeneration",
  "minecraft:strength": "potion.damageBoost",
  "minecraft:weakness": "potion.weakness",
  "minecraft:wither": "potion.wither",
  "minecraft:turtle_master": "potion.turtleMaster",
  "minecraft:slow_falling": "potion.slowFalling",
  "minecraft:invisibility": "potion.invisibility",
  "minecraft:haste": "potion.digSpeed",
  "minecraft:mining_fatigue": "potion.digSlowDown",
  "minecraft:levitation": "potion.levitation",
  "minecraft:absorption": "potion.absorption",
  "minecraft:blindness": "potion.blindness",
  "minecraft:health_boost": "potion.healthBoost",
  "minecraft:hunger": "potion.hunger",
  "minecraft:saturation": "potion.saturation",
  "minecraft:conduit_power": "potion.conduitPower",
};

/**
 * 基岩脚本里 EnchantmentType.id / PotionEffectType.id 有时不带 `minecraft:` 前缀，
 * 语言表与变体映射均使用带命名空间形式，查表前需统一。
 */
function normalizeMinecraftId(id: string): string {
  if (!id) return id;
  return id.includes(":") ? id : `minecraft:${id}`;
}

/**
 * 延长版/强化版药水 API 可能返回 `long_fire_resistance`、`strong_harming` 等，
 * 与基础效果共用客户端语言键与 type-ids 变体名。
 */
function resolvePotionEffectBaseId(effectId: string): string {
  const n = normalizeMinecraftId(effectId);
  const part = n.replace(/^minecraft:/, "");
  const basePart = part.replace(/^(long_|strong_)/, "");
  return `minecraft:${basePart}`;
}

const EFFECT_ID_TO_VARIANT: Record<string, string> = {
  "minecraft:night_vision": "night_vision",
  "minecraft:jump_boost": "leaping",
  "minecraft:fire_resistance": "fire_resistance",
  "minecraft:speed": "swiftness",
  "minecraft:slowness": "slowness",
  "minecraft:water_breathing": "water_breathing",
  "minecraft:instant_health": "healing",
  "minecraft:instant_damage": "harming",
  "minecraft:poison": "poison",
  "minecraft:regeneration": "regeneration",
  "minecraft:strength": "strength",
  "minecraft:weakness": "weakness",
  "minecraft:wither": "decay",
  "minecraft:turtle_master": "turtle_master",
  "minecraft:slow_falling": "slow_falling",
};

function getPotionTypeSuffix(itemTypeId: string): "_potion" | "_splash_potion" | "_lingering_potion" | null {
  if (itemTypeId === "minecraft:potion") return "_potion";
  if (itemTypeId === "minecraft:splash_potion") return "_splash_potion";
  if (itemTypeId === "minecraft:lingering_potion") return "_lingering_potion";
  return null;
}

/**
 * 解析用于 Chest 按钮的纹理键：药水尽量映射到 type-ids 已注册变体，否则用原 typeId（图标以游戏/UI 表现为准，不单独处理）。
 */
export function getChestItemTextureKey(item: ItemStack): string {
  const base = item.typeId;
  const potionComp = item.getComponent(ItemPotionComponent.componentId) as ItemPotionComponent | undefined;
  if (!potionComp) return base;

  const suffix = getPotionTypeSuffix(base);
  if (!suffix) return base;

  try {
    const effectId = resolvePotionEffectBaseId(potionComp.potionEffectType.id);
    const variant = EFFECT_ID_TO_VARIANT[effectId];
    if (variant) {
      const candidate = `minecraft:${variant}${suffix}`;
      if (typeIdToDataId.has(candidate)) return candidate;
    }
  } catch {
    // ignore
  }

  return base;
}

function enchantmentToRawMessage(ench: Enchantment): RawMessage {
  const id = normalizeMinecraftId(ench.type.id);
  const level = ench.level;
  const langKey = MINECRAFT_ENCHANT_TO_LANG_KEY[id];
  const levelFrag: RawMessage =
    level >= 1 && level <= 10 ? { translate: `enchantment.level.${level}` } : { text: String(level) };

  if (langKey) {
    return {
      rawtext: [{ translate: langKey }, { text: " " }, levelFrag],
    };
  }

  const short = id.replace(/^minecraft:/, "");
  return {
    rawtext: [{ text: `§7§o${short} ${level}` }],
  };
}

function formatEnchantmentLines(item: ItemStack): RawMessage[] {
  const ench = item.getComponent(ItemEnchantableComponent.componentId) as ItemEnchantableComponent | undefined;
  if (!ench) return [];
  try {
    return ench.getEnchantments().map((e) => enchantmentToRawMessage(e));
  } catch {
    return [];
  }
}

function formatPotionLines(item: ItemStack): RawMessage[] {
  const potionComp = item.getComponent(ItemPotionComponent.componentId) as ItemPotionComponent | undefined;
  if (!potionComp) return [];
  try {
    const effectId = resolvePotionEffectBaseId(potionComp.potionEffectType.id);
    const potionKey = EFFECT_ID_TO_POTION_LANG[effectId];
    const lines: RawMessage[] = [];

    if (potionKey) {
      lines.push({ rawtext: [{ translate: potionKey }] });
    } else {
      lines.push({
        rawtext: [{ text: `§7效果: §f${effectId.replace(/^minecraft:/, "")}` }],
      });
    }

    const ticks = potionComp.potionEffectType.durationTicks;
    if (ticks !== undefined && ticks > 0) {
      const sec = Math.round(ticks / 20);
      lines.push({ rawtext: [{ text: `§7时长: §f${sec} 秒` }] });
    }
    return lines;
  } catch {
    return [];
  }
}

/**
 * 附魔、药水效果等说明行（translate + 文本；不含数量与耐久）
 */
export function getChestItemTooltipExtraLines(item: ItemStack): (string | RawMessage)[] {
  return [...formatEnchantmentLines(item), ...formatPotionLines(item)];
}

/**
 * Chest 按钮上耐久条：仅在有损耗时显示（未使用 damage===0 时不显示绿条）
 */
export function getChestItemDurabilityBarValue(item: ItemStack): number {
  const dur = item.getComponent("durability");
  if (!dur || dur.damage === 0) return 0;
  return Math.round(((dur.maxDurability - dur.damage) / dur.maxDurability) * 99);
}

/**
 * 上架选择等：数量、仅损耗时显示耐久百分比、附魔/药水 RawMessage
 */
export function buildChestItemListLores(item: ItemStack): (string | RawMessage)[] {
  const lines: (string | RawMessage)[] = [`§e数量: §f${item.amount}`];
  const dur = item.getComponent("durability");
  if (dur && dur.damage > 0) {
    const pct = Math.round(((dur.maxDurability - dur.damage) / dur.maxDurability) * 100);
    lines.push(`§e耐久: §f${pct}%`);
  }
  lines.push(...getChestItemTooltipExtraLines(item));
  return lines;
}
