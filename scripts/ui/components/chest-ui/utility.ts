/**
 * ChestUI工具函数
 * 迁移自 Modules/ChestUI/Utility.ts (82行)
 */

import { ItemStack, RawMessage } from "@minecraft/server";

export interface Utility {
  ExtractNameFromString: (string: string, index: number) => Promise<{ name: string; string: string } | null>;
  capitalized: (string: string) => string;
  MathSum: (array: number[]) => number;
  CalculateAverage: (array: number[]) => number;
  getItemDisplayName: (itemStack: ItemStack) => RawMessage;
  getItemDurabilityPercent: (itemStack: ItemStack) => string;
  getItemDurability: (itemStack: ItemStack) => number;
  hasAnyEnchantment: (itemStack: ItemStack) => boolean;
}

const Utility: Utility = {
  ExtractNameFromString: async (string: string, index: number) => {
    return new Promise((resolve, reject) => {
      let splitText = string.split(" ");
      let result: { name: string; string: string } = {
        name: "",
        string: "",
      };
    });
  },
  capitalized: (string: string) => {
    return string
      .split("_")
      .map((v) => v[0].toUpperCase() + v.slice(1).toLowerCase())
      .join(" ");
  },
  MathSum: (array: number[]) => {
    return array.reduce((a, b) => a + b, 0);
  },
  CalculateAverage: (array: number[]) => {
    if (array.length === 0) return 0;
    return Utility.MathSum(array) / array.length;
  },
  getItemDisplayName: (itemStack: ItemStack): RawMessage => {
    const translateKey = itemStack.localizationKey;
    const displayName: RawMessage = {
      translate: translateKey,
    };
    return displayName;
  },
  getItemDurabilityPercent: (itemStack: ItemStack) => {
    const durability = itemStack.getComponent("durability");
    if (!durability) return "100";
    return String(Math.round(((durability.maxDurability - durability.damage) / durability.maxDurability) * 100));
  },
  getItemDurability: (itemStack: ItemStack) => {
    const durability = itemStack.getComponent("durability");
    if (!durability) return 0;
    return Math.round(((durability.maxDurability - durability.damage) / durability.maxDurability) * 99);
  },
  hasAnyEnchantment: (itemStack: ItemStack) => {
    const enchantable = itemStack.getComponent("enchantable");
    if (!enchantable) return false;
    return enchantable.getEnchantments().length > 0;
  },
};

/**
 * 提取名称从字符串
 */
// Utility.ExtractNameFromString = async (string: string, index: number) => {
//   return new Promise((resolve, reject) => {
//     let splitText = string.split(" ");
//     let result = {
//       name: "",
//       string: "",
//     };

//     if (splitText[index].startsWith(`"`)) {
//       result.name += splitText[index];
//       let trimed = 1;
//       if (!splitText[index].endsWith(`"`)) {
//         for (let i = index + 1; i <= splitText.length - 1; i++) {
//           result.name += " " + splitText[i];
//           trimed += 1;
//           if (splitText[i].endsWith(`"`)) break;
//         }
//       }
//       if (!result.name.endsWith(`"`)) {
//         resolve(null);
//       }
//       result.name = (result.name as any).replaceAll(`"`, "");
//       splitText.splice(index, trimed);
//       result.string = splitText.join(" ");
//     } else {
//       result.name = splitText[index];
//       splitText.splice(index, 1);
//       result.string = splitText.join(" ");
//     }
//     resolve(result);
//   });
// };

/**
 * 获取物品名称
 */
/**
 * 首字母大写
 */
// Utility.capitalized = (string: string): string => {
//   return string
//     .split("_")
//     .map((v) => v[0].toUpperCase() + v.slice(1).toLowerCase())
//     .join(" ");
// };

// /**
//  * 计算数组总和
//  */
// Utility.MathSum = (array: number[]): number => {
//   return array.reduce((a, b) => a + b, 0);
// };

// /**
//  * 计算数组平均值
//  */
// Utility.CalculateAverage = (array: number[]): number => {
//   if (array.length === 0) return 0;
//   return Utility.MathSum(array) / array.length;
// };

// /**
//  * 获取物品耐久度百分比
//  */
// Utility.getItemDurabilityPercent = (item: ItemStack): string => {
//   const durability = item.getComponent("durability");
//   if (!durability) return "100";

//   const percent = Math.round(((durability.maxDurability - durability.damage) / durability.maxDurability) * 100);
//   return String(percent);
// };

// /**
//  * 获取物品耐久度
//  */
// Utility.getItemDurability = (item: ItemStack): number => {
//   const durability = item.getComponent("durability");
//   if (!durability) return 0;

//   return Math.round(((durability.maxDurability - durability.damage) / durability.maxDurability) * 99);
// };

// /**
//  * 检查是否有附魔
//  */
// Utility.hasAnyEnchantment = (item: ItemStack): boolean => {
//   const enchantable = item.getComponent("enchantable");
//   if (!enchantable) return false;

//   try {
//     const enchantments = enchantable.getEnchantments();
//     return enchantments.length > 0;
//   } catch {
//     return false;
//   }
// };

export default Utility;
