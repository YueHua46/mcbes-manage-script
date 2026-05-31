/**

 * Chest UI 物品展示：药水/附魔说明（RawMessage translate）；纹理键为贴图路径。

 */



import type { Enchantment } from "@minecraft/server";

import { ItemEnchantableComponent, ItemPotionComponent, ItemStack, RawMessage } from "@minecraft/server";

import {

  extractItemIconKey,

  getRememberedItemIconKey,

  rememberItemIconKeyFromStack,

} from "../../../features/system/services/item-icon-key-cache";

import {

  resolveChestUiItemDisplayTexture,

  resolveIconKeyToDisplayTexture,

} from "../../../features/system/services/chest-ui-icon-paths";

import { resolveOwnPluginItemIconTexture } from "./own-plugin-item-icons";

import { resolveVanillaItemIconTexture } from "../../../features/system/services/vanilla-item-icon-paths";



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



function normalizeMinecraftId(id: string): string {

  if (!id) return id;

  return id.includes(":") ? id : `minecraft:${id}`;

}



function resolvePotionEffectBaseId(effectId: string): string {

  const n = normalizeMinecraftId(effectId);

  const part = n.replace(/^minecraft:/, "");

  const basePart = part.replace(/^(long_|strong_)/, "");

  return `minecraft:${basePart}`;

}



/**

 * 解析用于 Chest 按钮的贴图路径。

 * 有 ItemStack 时优先用 minecraft:icon 短 key（并写入运行时缓存供纯 typeId 场景复用）。

 */

export function getChestItemTextureKey(item: ItemStack): string {

  rememberItemIconKeyFromStack(item);



  const ownPluginTexture = resolveOwnPluginItemIconTexture(item.typeId);

  if (ownPluginTexture) return ownPluginTexture;



  const vanillaTexture = resolveVanillaItemIconTexture(item.typeId);

  if (vanillaTexture) return vanillaTexture;



  const iconKey = getRememberedItemIconKey(item.typeId) ?? extractItemIconKey(item);

  if (iconKey) {

    const fromIconKey = resolveIconKeyToDisplayTexture(iconKey, item.typeId);

    if (fromIconKey) return fromIconKey;

  }



  return resolveChestUiItemDisplayTexture(item.typeId);

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


