import { ActionFormData } from "@minecraft/server-ui";
import { typeIdToID, typeIdToDataId } from "./typeIds";
import { BlockTypes, ItemStack, ItemTypes, system, world } from "@minecraft/server";
import Config from "./Configuration";
import { TextureList } from "./textureList";
import Setting from "./Setting";

/**
 * Credit:
 * Maintained by Herobrine64 & LeGend077.
 */

// 定义实验性物品列表，这些物品可能需要特殊处理
const experimentalItems: string[] = [];

// 定义自定义物品列表，这些是服务器特有的物品（领地方块）
const MCEItems: string[] = ["pao:claimblock1", "pao:claimblock10", "pao:claimblock100"];

// 获取所有非原版、非生成蛋、非方块的自定义物品
let items = [];

system.run(() => {
  items = ItemTypes.getAll().filter(
    (item) => !item.id.startsWith("minecraft:") && !item.id.endsWith("spawn_egg") && !BlockTypes.get(item.id)
  );
});

// 计算自定义物品的总数量，用于物品ID偏移计算
// 这个变量对于确保自定义物品在箱子UI中正确显示非常重要
let number_of_1_16_100_items = items.length;

system.run(() => {
  // 添加实验性物品到计数中
  for (const item of experimentalItems) {
    if (ItemTypes.get(item)) number_of_1_16_100_items += 1;
  }

  // 从计数中排除特定的自定义物品（因为它们已经在MCEItems中）
  for (const item of MCEItems) {
    if (ItemTypes.get(item)) number_of_1_16_100_items -= 1;
  }
});

system.run(() => {
  // 从设置中获取物品数量，如果存在，否则使用计算值
  number_of_1_16_100_items = Setting.get("NumberOf_1_16_100_Items") ?? number_of_1_16_100_items;
});
// 添加自定义物品数量
number_of_1_16_100_items += MCEItems.length;

// 定义不同箱子大小的映射，包括标题前缀和槽位数量
const sizes = new Map([
  ["single", [`§c§h§e§s§t§s§m§a§l§l§r`, 27]],
  ["double", [`§c§h§e§s§t§l§a§r§g§e§r`, 54]],
  ["small", [`§c§h§e§s§t§s§m§a§l§l§r`, 27]],
  ["large", [`§c§h§e§s§t§l§a§r§g§e§r`, 54]],
  ["pao_chest", [`§p§a§o§c§h§e§s§t§r`, 54]],
  ["shop", [`§s§h§o§p§c§h§e§s§t§r`, 54]],
]);

/**
 * ChestFormData 类 - 用于创建和显示箱子界面UI
 * 这个类允许创建类似箱子界面的表单，可以放置物品按钮
 */

type Sizes = "single" | "double" | "small" | "large" | "pao_chest" | "shop";
export default class ChestFormData {
  #titleText: string;
  #buttonArray: [string, number | string | undefined][];
  slotCount: number;

  /**
   * 创建一个新的箱子表单
   * @param size 箱子大小，默认为"small"(27格)
   */
  constructor(size: Sizes = "small") {
    const sizing = sizes.get(size) ?? ["§c§h§e§s§t§2§7§r", 27];
    /** @internal */
    this.#titleText = sizing[0] as string;
    /** @internal */
    this.#buttonArray = [];
    for (let i = 0; i < (sizing[1] as number); i++) this.#buttonArray.push(["", undefined]);
    this.slotCount = sizing[1] as number;
  }

  /**
   * 设置箱子界面的标题
   * @param text 标题文本
   * @returns 当前ChestFormData实例，用于链式调用
   */
  title(text: string): ChestFormData {
    this.#titleText += text;
    return this;
  }

  /**
   * 在指定槽位添加一个物品按钮
   * @param slot 槽位索引
   * @param itemName 物品名称
   * @param itemDesc 物品描述（lore）
   * @param texture 物品纹理/ID
   * @param stackSize 堆叠数量
   * @param enchanted 是否有附魔效果
   * @returns 当前ChestFormData实例，用于链式调用
   */
  button(
    slot: number,
    itemName?: string,
    itemDesc?: string[],
    texture?: string,
    stackSize: number = 1,
    enchanted: boolean = false
  ): ChestFormData {
    // 获取自定义物品数量，用于ID计算
    const numberCustomItems = Setting.get("NumberOf_1_16_100_Items") ?? number_of_1_16_100_items;
    // 获取物品ID
    const ID = typeIdToDataId.get(texture || "") ?? typeIdToID.get(texture || "");

    // 设置按钮数据
    this.#buttonArray.splice(slot, 1, [
      // 格式化按钮文本，包含堆叠数量、物品名称和描述
      `stack#${Math.min(Math.max(stackSize, 1) || 1, 99)
        .toString()
        .padStart(2, "0")}§r${itemName ?? ""}§r${itemDesc?.length ? `\n§r${itemDesc.join("\n§r")}` : ""}`,
      // 计算物品ID或使用纹理路径
      ID !== undefined
        ? (ID + (ID < 256 ? 0 : numberCustomItems)) * 65536 + (enchanted ? 32768 : 0)
        : texture
        ? TextureList[texture] ?? texture
        : undefined,
    ]);
    return this;
  }

  /**
   * 使用模式填充多个槽位
   * @param from 起始坐标 [行, 列]
   * @param pattern 模式字符串数组
   * @param key 模式字符到物品数据的映射
   * @returns 当前ChestFormData实例，用于链式调用
   */
  pattern(
    from: [number, number],
    pattern: string[],
    key: {
      [key: string]: {
        data: {
          itemName?: string;
          itemDesc?: string[];
          stackAmount?: number;
          enchanted?: boolean;
        };
        iconPath: string;
      };
    }
  ): ChestFormData {
    // 遍历模式并填充对应槽位
    for (let i = 0; i < pattern.length; i++) {
      const row = pattern[i];
      for (let j = 0; j < row.length; j++) {
        const letter = row.charAt(j);
        if (key[letter]) {
          // 计算槽位索引
          const slot = from[1] + j + (from[0] + i) * 9;
          const data = key[letter].data;
          const itemName = data.itemName ?? "";
          const itemDesc = data.itemDesc ?? [];
          const texture = key[letter].iconPath ?? "";
          const stackSize = data.stackAmount ?? 1;
          const enchanted = data.enchanted ?? false;
          // 添加按钮
          this.button(slot, itemName, itemDesc, texture, stackSize, enchanted);
        }
      }
    }
    return this;
  }

  /**
   * 显示箱子表单给玩家
   * @param player 目标玩家
   * @returns 表单响应Promise
   */
  show(player: any) {
    // 创建ActionFormData并设置标题
    const form = new ActionFormData().title(this.#titleText);
    // 添加所有按钮
    this.#buttonArray.forEach((button) => {
      form.button(button[0], button[1]?.toString());
    });
    // 显示表单
    return form.show(player);
  }
}
