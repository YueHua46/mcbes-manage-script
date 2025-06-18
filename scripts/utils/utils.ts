import {
  CommandPermissionLevel,
  Enchantment,
  EnchantmentType,
  ItemComponentTypes,
  ItemDurabilityComponent,
  ItemLockMode,
  ItemStack,
  Player,
  PlayerPermissionLevel,
  // PlayerPermissionLevel,
  RawMessage,
  system,
  world,
} from "@minecraft/server";
import { glyphMap } from "../glyphMap";

export function oneSecondRunInterval(callback: () => void) {
  system.runInterval(callback, 20);
}

export function SystemLog(message: string | string[]) {
  return console.warn(`[System] ${Array.isArray(message) ? message.join(" ") : message}`);
}

export function debounce(fn: Function, delay: number, player: Player) {
  const key = "debounce";
  const lastTime = Number(player.getDynamicProperty(key));
  if (lastTime && Date.now() - lastTime < delay) return;
  player.setDynamicProperty(key, Date.now());
  fn();
}

export function isNumber(str: string | number): boolean {
  return !isNaN(Number(str));
}

export function getNowDate() {
  // 创建一个Date对象
  const date = new Date();

  // 增加8小时
  date.setHours(date.getHours() + 8);

  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${year}/${month}/${day} ${hours}:${minutes}`;
}

export function getDiamensionName(dimention: string) {
  switch (dimention) {
    case "minecraft:overworld":
      return "主世界";
    case "minecraft:the_nether":
      return "地狱";
    case "minecraft:the_end":
      return "末地";
    default:
      return dimention;
  }
}

// 判断用户是否为管理员
export function isAdmin(player: Player): boolean {
  if (
    player.commandPermissionLevel === CommandPermissionLevel.Admin ||
    player.hasTag("admin") ||
    player.playerPermissionLevel === PlayerPermissionLevel.Operator
  ) {
    return true;
  } else {
    return false;
  }
}

export function toNumber(str: string) {
  return Number(str.replace(/[^\d.-]/g, ""));
}

// 通过emojiPath获得对应的emoji值
export function emojiPathToEmoji(str: string) {
  const splitLen = str.split("/").length;
  const emojiKey = str.split("/")[splitLen - 1];
  return glyphMap[emojiKey as keyof typeof glyphMap] ?? "";
}

// 通过emoji key，获得emojiPath
export function emojiKeyToEmojiPath(emojiKey: keyof typeof glyphMap) {
  return `textures/packs/${emojiKey}`;
}

// 通过emoji Path，获得emoji key
export function emojiPathToEmojiKey(str: string) {
  const splitLen = str.split("/").length;
  const emojiKey = str.split("/")[splitLen - 1];
  return emojiKey as keyof typeof glyphMap;
}

/**
 * 判断给定 ItemStack 是否存在任何附魔
 * @param itemStack 要检测的物品
 * @returns 存在任意附魔则返回 true，否则返回 false
 */
export function hasAnyEnchantment(itemStack: ItemStack): boolean {
  // 获取附魔组件
  const enchantable = itemStack.getComponent(ItemComponentTypes.Enchantable);
  if (!enchantable) {
    // 物品不可附魔
    return false;
  }

  // 获取所有附魔列表
  let enchants: Enchantment[];
  try {
    enchants = enchantable.getEnchantments();
  } catch (err) {
    // 读取失败（极少见），视为无附魔
    return false;
  }

  // 列表长度 > 0 则说明存在附魔
  return enchants.length > 0;
}

// 获得对应物品的中文displayName
export function getItemDisplayName(itemStack: ItemStack): RawMessage {
  const translateKey = itemStack.localizationKey;
  const displayName: RawMessage = {
    translate: translateKey,
  };
  return displayName;
}

// 获得对应物品的耐久度百分比
export function getItemDurabilityPercent(itemStack: ItemStack): string {
  const durability = getItemDurability(itemStack);
  return `${Math.round(durability)}%`;
}

// 获得对应物品的所有描述信息Lore
// export function getItemLore(itemStack: ItemStack): string[] {
//   const lore: string[] = [];
//   const lores = itemStack.getLore();
//   if (displayName) {
//     for (const line of displayName) {
//       lore.push(line);
//     }
//   }
//   return lore;
// }

/**
 * 获得物品的耐久度
 * @param itemStack 要检测的物品
 * @returns 物品的耐久度
 */
export function getItemDurability(itemStack: ItemStack): number {
  // 获取耐久组件
  const durability = itemStack.getComponent(ItemComponentTypes.Durability);
  if (!durability) {
    // 物品没有耐久组件，返回 0
    return 0;
  }

  // 计算耐久度
  const maxDurability = durability.maxDurability;
  const currentDamage = durability.damage;
  // 计算剩余耐久度百分比
  const durabilityPercent = ((maxDurability - currentDamage) / maxDurability) * 100;
  return durabilityPercent;
}

export type SerializableStack = {
  typeId: string;
  amount: number;
  nameTag?: string;
  keepOnDeath: boolean;
  lockMode: ItemLockMode;
  lore: string[];
  tags: string[];
  // 耐用性
  dComp:
    | {
        damage: number;
        maxDurability: number;
      }
    | undefined;
  // 附魔
  enchantments?: { id: string; level: number }[];
};

function extractDurability(stack: ItemStack) {
  const dComp = stack.getComponent(ItemComponentTypes.Durability);
  if (dComp) {
    return { damage: dComp.damage, maxDurability: dComp.maxDurability };
  }
  return undefined;
}

function extractEnchantments(stack: ItemStack) {
  const eComp = stack.getComponent(ItemComponentTypes.Enchantable);
  if (!eComp) return [];
  return eComp.getEnchantments().map((e) => ({
    id: e.type.id, // 附魔标识，如 "minecraft:sharpness" :contentReference[oaicite:4]{index=4}
    level: e.level, // 附魔等级 :contentReference[oaicite:5]{index=5}
  }));
}

// 构造可序列化的堆栈物品
export function extractStackData(stack: ItemStack): SerializableStack {
  const dComp = extractDurability(stack);
  const eComp = extractEnchantments(stack);
  const data: SerializableStack = {
    typeId: stack.typeId, // 物品标识 (e.g. "minecraft:diamond_sword") :contentReference[oaicite:3]{index=3}
    amount: stack.amount, // 数量 :contentReference[oaicite:4]{index=4}
    nameTag: stack.nameTag, // 自定义名称 :contentReference[oaicite:5]{index=5}
    keepOnDeath: stack.keepOnDeath, // 保留模式 :contentReference[oaicite:6]{index=6}
    lockMode: stack.lockMode as ItemLockMode, // 锁模式 :contentReference[oaicite:7]{index=7}
    lore: stack.getLore(), // lore 数组 :contentReference[oaicite:8]{index=8}
    tags: stack.getTags(), // 自定义标签 :contentReference[oaicite:9]{index=9}
    dComp: dComp, // 耐用性
    enchantments: eComp, // 附魔
  };
  return data;
}
// 生成堆栈物品
export function generateStackData(stackData: SerializableStack): ItemStack {
  const itemStack = new ItemStack(stackData.typeId, stackData.amount);
  itemStack.nameTag = stackData.nameTag;
  itemStack.keepOnDeath = stackData.keepOnDeath;
  itemStack.lockMode = stackData.lockMode;
  itemStack.setLore(stackData.lore);
  if (stackData.dComp) {
    const dComp = itemStack.getComponent(ItemComponentTypes.Durability) as ItemDurabilityComponent;
    dComp.damage = stackData.dComp.damage;
  }
  if (stackData.enchantments) {
    const eComp = itemStack.getComponent(ItemComponentTypes.Enchantable);
    if (eComp) {
      for (const enchantment of stackData.enchantments) {
        eComp.addEnchantment({
          type: new EnchantmentType(enchantment.id),
          level: enchantment.level,
        });
      }
    }
  }
  return itemStack;
}
