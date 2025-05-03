import {
  EnchantmentType,
  ItemComponentTypes,
  ItemDurabilityComponent,
  ItemLockMode,
  ItemStack,
  Player,
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
export function isAdmin(player: Player) {
  return player.isOp() || player.hasTag("admin");
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
