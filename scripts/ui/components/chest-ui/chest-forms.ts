/**
 * ChestFormData & FurnaceFormData - 箱子/熔炉UI系统
 * 完全移植自 Chest-UI/BP/scripts/extensions/forms.js
 */

import { ActionFormData, ActionFormResponse } from "@minecraft/server-ui";
import { Player, RawMessage } from "@minecraft/server";
import { typeIdToDataId, typeIdToID } from "./type-ids";
import {
  custom_content,
  custom_content_keys,
  inventory_enabled,
  number_of_custom_items,
  CHEST_UI_SIZES,
  ChestUISize,
} from "./constants";
import { getTotalCustomItemOffset } from "./item-id-config";

/**
 * 增强的响应接口，包含物品栏槽位映射
 */
export interface ChestFormResponse extends ActionFormResponse {
  /**
   * 如果点击了物品栏物品，则为物品栏槽位号，否则为null
   * 用于检测物品栏点击并适当处理
   */
  inventorySlot: number | null;
}

/**
 * 按钮数据类型
 */
type ButtonData = [RawMessage | string, string | number | undefined];

/**
 * 模式键数据
 */
export interface PatternKeyData {
  itemName?: string | RawMessage;
  itemDesc?: (string | RawMessage)[];
  stackAmount?: number;
  durability?: number;
  enchanted?: boolean;
  texture: string;
}

/**
 * 检查是否为纹理路径（如 textures/icons/back）
 * 纹理路径可以直接传递给 UI，无需查找 ID 映射
 */
function isTexturePath(texture: string): boolean {
  return texture.startsWith("textures/");
}

/**
 * 获取显示纹理
 * - 对于纹理路径（textures/xxx），直接返回
 * - 对于自定义物品（custom_content 中定义的），使用其配置的纹理
 * - 对于物品ID（minecraft:xxx），检查是否已注册，未注册则回退
 */
function getDisplayTexture(texture: string): string {
  // 如果是纹理路径，直接使用
  if (isTexturePath(texture)) {
    return texture;
  }

  // 检查是否是自定义物品
  const targetTexture = custom_content_keys.has(texture) ? custom_content[texture]?.texture : texture;

  // 如果解析后的纹理是纹理路径，直接返回
  if (isTexturePath(targetTexture)) {
    return targetTexture;
  }

  // 检查纹理是否在物品ID映射中已注册
  const isRegistered = typeIdToDataId.has(targetTexture) || typeIdToID.has(targetTexture);

  // 如果未注册，使用 info_update2 作为回退
  if (!isRegistered) {
    return "minecraft:info_update2";
  }

  return targetTexture;
}

/**
 * ChestFormData类 - 用于创建箱子样式的表单UI
 */
export class ChestFormData {
  private titleText: { rawtext: { text?: string; translate?: string }[] };
  private buttonArray: ButtonData[];
  public slotCount: number;

  /**
   * @param size 要显示的箱子尺寸
   */
  constructor(size: ChestUISize = "small") {
    const sizing = CHEST_UI_SIZES.get(size) ?? ["§c§h§e§s§t§2§7§r", 27];
    this.titleText = { rawtext: [{ text: `${sizing[0]}` }] };
    // 使用空字符串使按钮不可见且不可点击，同时保持网格位置
    const emptyButton: ButtonData = ["", undefined];
    this.buttonArray = Array(sizing[1])
      .fill(null)
      .map(() => [...emptyButton] as ButtonData);
    this.slotCount = sizing[1];
  }

  /**
   * 设置箱子UI的标题
   * @param text 标题文本
   */
  title(text: string | RawMessage): ChestFormData {
    if (typeof text === "string") {
      this.titleText.rawtext.push({ text: text });
    } else if (typeof text === "object") {
      if ("rawtext" in text && text.rawtext) {
        this.titleText.rawtext.push(...(text.rawtext as { text?: string; translate?: string }[]));
      } else if ("translate" in text) {
        this.titleText.rawtext.push({ translate: text.translate });
      } else {
        this.titleText.rawtext.push(text as { text?: string });
      }
    }
    return this;
  }

  /**
   * 在指定槽位添加按钮
   * @param slot 物品显示槽位，从0开始。小箱子最大26，大箱子最大53
   * @param itemName 物品显示名称
   * @param itemDesc 物品描述（lore），显示在名称下方
   * @param texture 物品/方块类型ID或纹理路径。必须包含前缀如"minecraft:"
   * @param stackSize 堆叠数量，限制在1-99之间
   * @param durability 耐久度，限制在0-99之间
   * @param enchanted 是否显示附魔光效
   */
  button(
    slot: number,
    itemName?: string | RawMessage,
    itemDesc?: (string | RawMessage)[],
    texture?: string,
    stackSize: number = 1,
    durability: number = 0,
    enchanted: boolean = false
  ): ChestFormData {
    if (!texture) return this;

    const displayTexture = getDisplayTexture(texture);
    const targetTexture = custom_content_keys.has(displayTexture)
      ? custom_content[displayTexture]?.texture
      : displayTexture;
    const ID = typeIdToDataId.get(targetTexture) ?? typeIdToID.get(targetTexture);

    const buttonRawtext: { rawtext: { text?: string; translate?: string }[] } = {
      rawtext: [
        {
          text: `stack#${String(Math.min(Math.max(stackSize, 1), 99)).padStart(2, "0")}dur#${String(Math.min(Math.max(durability, 0), 99)).padStart(2, "0")}§r`,
        },
      ],
    };

    if (typeof itemName === "string") {
      buttonRawtext.rawtext.push({ text: itemName ? `${itemName}§r` : "§r" });
    } else if (typeof itemName === "object") {
      if ("rawtext" in itemName && itemName.rawtext) {
        buttonRawtext.rawtext.push(...(itemName.rawtext as { text?: string }[]), { text: "§r" });
      } else if ("translate" in itemName) {
        buttonRawtext.rawtext.push({ translate: itemName.translate } as { translate: string }, { text: "§r" });
      } else {
        return this;
      }
    } else {
      return this;
    }

    if (Array.isArray(itemDesc) && itemDesc.length > 0) {
      for (const obj of itemDesc) {
        if (typeof obj === "string") {
          buttonRawtext.rawtext.push({ text: `\n${obj}` });
        } else if (typeof obj === "object" && "rawtext" in obj && obj.rawtext) {
          buttonRawtext.rawtext.push({ text: "\n" }, ...(obj.rawtext as { text?: string }[]));
        }
      }
    }

    // 发送数值ID编码以兼容 1.21.130+
    if (ID === undefined) {
      this.buttonArray.splice(Math.max(0, Math.min(slot, this.slotCount - 1)), 1, [
        buttonRawtext as unknown as RawMessage,
        targetTexture,
      ]);
    } else {
      const totalOffset = getTotalCustomItemOffset() || number_of_custom_items;
      const safeID = ID + (ID < 256 ? 0 : totalOffset);
      this.buttonArray.splice(Math.max(0, Math.min(slot, this.slotCount - 1)), 1, [
        buttonRawtext as unknown as RawMessage,
        safeID * 65536 + (enchanted ? 32768 : 0),
      ]);
    }
    return this;
  }

  /**
   * 使用模式填充多个槽位
   * @param pattern 模式数组，未在key中定义的字符保持空白
   * @param key 模式中每个字符对应的数据
   */
  pattern(pattern: string[], key: { [char: string]: PatternKeyData }): ChestFormData {
    const totalOffset = getTotalCustomItemOffset() || number_of_custom_items;

    for (let i = 0; i < pattern.length; i++) {
      const row = pattern[i];
      for (let j = 0; j < row.length; j++) {
        const letter = row.charAt(j);
        const data = key[letter];
        if (!data) continue;

        const slot = j + i * 9;
        const displayTexture = getDisplayTexture(data.texture);
        const targetTexture = custom_content_keys.has(displayTexture)
          ? custom_content[displayTexture]?.texture
          : displayTexture;
        const ID = typeIdToDataId.get(targetTexture) ?? typeIdToID.get(targetTexture);
        const { stackAmount = 1, durability = 0, itemName, itemDesc, enchanted = false } = data;
        const stackSize = String(Math.min(Math.max(stackAmount, 1), 99)).padStart(2, "0");
        const durValue = String(Math.min(Math.max(durability, 0), 99)).padStart(2, "0");

        const buttonRawtext: { rawtext: { text?: string; translate?: string }[] } = {
          rawtext: [{ text: `stack#${stackSize}dur#${durValue}§r` }],
        };

        if (typeof itemName === "string") {
          buttonRawtext.rawtext.push({ text: `${itemName}§r` });
        } else if (itemName && typeof itemName === "object" && "rawtext" in itemName) {
          buttonRawtext.rawtext.push(...(itemName.rawtext as { text?: string }[]), { text: "§r" });
        } else if (itemName && typeof itemName === "object" && "translate" in itemName) {
          buttonRawtext.rawtext.push({ translate: itemName.translate } as { translate: string }, { text: "§r" });
        } else {
          continue;
        }

        if (Array.isArray(itemDesc) && itemDesc.length > 0) {
          for (const obj of itemDesc) {
            if (typeof obj === "string") {
              buttonRawtext.rawtext.push({ text: `\n${obj}` });
            } else if (obj && typeof obj === "object" && "rawtext" in obj) {
              buttonRawtext.rawtext.push({ text: "\n" }, ...(obj.rawtext as { text?: string }[]));
            }
          }
        }

        if (ID === undefined) {
          this.buttonArray.splice(Math.max(0, Math.min(slot, this.slotCount - 1)), 1, [
            buttonRawtext as unknown as RawMessage,
            targetTexture,
          ]);
        } else {
          const safeID = ID + (ID < 256 ? 0 : totalOffset);
          this.buttonArray.splice(Math.max(0, Math.min(slot, this.slotCount - 1)), 1, [
            buttonRawtext as unknown as RawMessage,
            safeID * 65536 + (enchanted ? 32768 : 0),
          ]);
        }
      }
    }
    return this;
  }

  /**
   * 显示表单给玩家
   * @param player 要显示表单的玩家
   */
  show(player: Player): Promise<ChestFormResponse> {
    const form = new ActionFormData().title(this.titleText);
    this.buttonArray.forEach((button) => {
      form.button(button[0] as RawMessage, button[1]?.toString());
    });

    if (!inventory_enabled) {
      return form.show(player) as Promise<ChestFormResponse>;
    }

    const totalOffset = getTotalCustomItemOffset() || number_of_custom_items;
    const container = player?.getComponent("inventory")?.container;

    if (!container) {
      return form.show(player) as Promise<ChestFormResponse>;
    }

    // 追踪物品栏槽位映射：按钮索引 -> 物品栏槽位
    const inventorySlotMap = new Map<number, number>();
    let buttonIndex = this.slotCount; // 从箱子按钮之后开始

    for (let i = 0; i < container.size; i++) {
      const item = container.getItem(i);

      // 将此按钮索引映射到实际物品栏槽位（包括空槽位）
      inventorySlotMap.set(buttonIndex, i);
      buttonIndex++;

      // 如果是空槽位，使用空字符串使其不可点击
      if (!item) {
        form.button("", undefined);
        continue;
      }

      const typeId = item.typeId;
      const displayTexture = getDisplayTexture(typeId);
      const targetTexture = custom_content_keys.has(displayTexture)
        ? custom_content[displayTexture]?.texture
        : displayTexture;
      const ID = typeIdToDataId.get(targetTexture) ?? typeIdToID.get(targetTexture);
      const durabilityComponent = item.getComponent("durability");
      const durDamage = durabilityComponent
        ? Math.round(
            ((durabilityComponent.maxDurability - durabilityComponent.damage) / durabilityComponent.maxDurability) * 99
          )
        : 0;
      const amount = item.amount;
      const formattedItemName = typeId
        .replace(/.*(?<=:)/, "")
        .replace(/_/g, " ")
        .replace(/(^\w|\s\w)/g, (m) => m.toUpperCase());

      const buttonRawtext = {
        rawtext: [
          {
            text: `stack#${String(amount).padStart(2, "0")}dur#${String(durDamage).padStart(2, "0")}§r${formattedItemName}`,
          },
        ],
      };

      const loreText = item.getLore().join("\n");
      if (loreText) buttonRawtext.rawtext.push({ text: loreText });

      const finalID = ID === undefined ? targetTexture : (ID + (ID < 256 ? 0 : totalOffset)) * 65536;
      form.button(buttonRawtext, finalID.toString());
    }

    // 返回带有物品栏槽位映射的包装响应
    return form.show(player).then((response) => {
      const enhancedResponse = response as ChestFormResponse;
      if (!response.canceled && response.selection !== undefined) {
        // 如果点击的按钮是物品栏物品，添加 inventorySlot 属性
        enhancedResponse.inventorySlot = inventorySlotMap.get(response.selection) ?? null;
      } else {
        enhancedResponse.inventorySlot = null;
      }
      return enhancedResponse;
    });
  }
}

/**
 * FurnaceFormData类 - 用于创建熔炉样式的表单UI
 */
export class FurnaceFormData {
  private titleText: { rawtext: { text?: string; translate?: string }[] };
  private buttonArray: ButtonData[];
  public slotCount: number;

  /**
   * @param isLit 熔炉是否显示为点燃状态
   */
  constructor(isLit: boolean = false) {
    this.titleText = {
      rawtext: [{ text: isLit ? "§f§u§r§n§a§c§e§l§i§t§r" : "§f§u§r§n§a§c§e§r" }],
    };
    this.buttonArray = Array(3)
      .fill(null)
      .map(() => ["", undefined] as ButtonData);
    this.slotCount = 3;
  }

  /**
   * 设置熔炉UI的标题
   * @param text 标题文本
   */
  title(text: string | RawMessage): FurnaceFormData {
    if (typeof text === "string") {
      this.titleText.rawtext.push({ text });
    } else if (typeof text === "object") {
      if ("rawtext" in text && text.rawtext) {
        this.titleText.rawtext.push(...(text.rawtext as { text?: string; translate?: string }[]));
      } else if ("translate" in text) {
        this.titleText.rawtext.push({ translate: text.translate });
      } else {
        this.titleText.rawtext.push({ text: "" });
      }
    } else {
      this.titleText.rawtext.push({ text: "" });
    }
    return this;
  }

  /**
   * 在指定槽位添加按钮
   * @param slot 槽位（0=输入, 1=燃料, 2=输出）
   * @param itemName 物品显示名称
   * @param itemDesc 物品描述
   * @param texture 纹理路径或类型ID
   * @param stackSize 堆叠数量
   * @param durability 耐久度
   * @param enchanted 是否附魔
   */
  button(
    slot: number,
    itemName?: string | RawMessage,
    itemDesc?: (string | RawMessage)[],
    texture?: string,
    stackSize: number = 1,
    durability: number = 0,
    enchanted: boolean = false
  ): FurnaceFormData {
    if (!texture) return this;

    const displayTexture = getDisplayTexture(texture);
    const targetTexture = custom_content_keys.has(displayTexture)
      ? custom_content[displayTexture]?.texture
      : displayTexture;
    const ID = typeIdToDataId.get(targetTexture) ?? typeIdToID.get(targetTexture);

    const buttonRawtext: { rawtext: { text?: string; translate?: string }[] } = {
      rawtext: [
        {
          text: `stack#${String(Math.min(Math.max(stackSize, 1), 99)).padStart(2, "0")}dur#${String(Math.min(Math.max(durability, 0), 99)).padStart(2, "0")}§r`,
        },
      ],
    };

    if (typeof itemName === "string") {
      buttonRawtext.rawtext.push({ text: itemName ? `${itemName}§r` : "§r" });
    } else if (typeof itemName === "object") {
      if ("rawtext" in itemName && itemName.rawtext) {
        buttonRawtext.rawtext.push(...(itemName.rawtext as { text?: string }[]), { text: "§r" });
      } else if ("translate" in itemName) {
        buttonRawtext.rawtext.push({ translate: itemName.translate } as { translate: string }, { text: "§r" });
      } else {
        return this;
      }
    } else {
      return this;
    }

    if (Array.isArray(itemDesc) && itemDesc.length) {
      itemDesc.forEach((obj) => {
        if (typeof obj === "string") {
          buttonRawtext.rawtext.push({ text: `\n${obj}` });
        } else if (typeof obj === "object" && "rawtext" in obj && obj.rawtext) {
          buttonRawtext.rawtext.push({ text: "\n" }, ...(obj.rawtext as { text?: string }[]));
        }
      });
    }

    if (ID === undefined) {
      this.buttonArray.splice(Math.max(0, Math.min(slot, this.slotCount - 1)), 1, [
        buttonRawtext as unknown as RawMessage,
        targetTexture,
      ]);
    } else {
      const totalOffset = getTotalCustomItemOffset() || number_of_custom_items;
      const safeID = ID + (ID < 256 ? 0 : totalOffset);
      this.buttonArray.splice(Math.max(0, Math.min(slot, this.slotCount - 1)), 1, [
        buttonRawtext as unknown as RawMessage,
        safeID * 65536 + (enchanted ? 32768 : 0),
      ]);
    }
    return this;
  }

  /**
   * 显示表单给玩家
   * @param player 要显示表单的玩家
   */
  show(player: Player): Promise<ChestFormResponse> {
    const form = new ActionFormData().title(this.titleText);
    this.buttonArray.forEach((button) => {
      form.button(button[0] as RawMessage, button[1]?.toString());
    });

    if (!inventory_enabled) {
      return form.show(player) as Promise<ChestFormResponse>;
    }

    const totalOffset = getTotalCustomItemOffset() || number_of_custom_items;
    const container = player?.getComponent("inventory")?.container;

    if (!container) {
      return form.show(player) as Promise<ChestFormResponse>;
    }

    // 追踪物品栏槽位映射
    const inventorySlotMap = new Map<number, number>();
    let buttonIndex = this.slotCount;

    for (let i = 0; i < container.size; i++) {
      const item = container.getItem(i);

      inventorySlotMap.set(buttonIndex, i);
      buttonIndex++;

      if (!item) {
        form.button("", undefined);
        continue;
      }

      const typeId = item.typeId;
      const displayTexture = getDisplayTexture(typeId);
      const targetTexture = custom_content_keys.has(displayTexture)
        ? custom_content[displayTexture]?.texture
        : displayTexture;
      const ID = typeIdToDataId.get(targetTexture) ?? typeIdToID.get(targetTexture);
      const durabilityComponent = item.getComponent("durability");
      const durDamage = durabilityComponent
        ? Math.round(
            ((durabilityComponent.maxDurability - durabilityComponent.damage) / durabilityComponent.maxDurability) * 99
          )
        : 0;
      const amount = item.amount;
      const formattedItemName = typeId
        .replace(/.*(?<=:)/, "")
        .replace(/_/g, " ")
        .replace(/(^\w|\s\w)/g, (m) => m.toUpperCase());

      const buttonRawtext = {
        rawtext: [
          {
            text: `stack#${String(amount).padStart(2, "0")}dur#${String(durDamage).padStart(2, "0")}§r${formattedItemName}`,
          },
        ],
      };

      const loreText = item.getLore().join("\n");
      if (loreText) buttonRawtext.rawtext.push({ text: loreText });

      const finalID = ID === undefined ? targetTexture : (ID + (ID < 256 ? 0 : totalOffset)) * 65536;
      form.button(buttonRawtext, finalID.toString());
    }

    return form.show(player).then((response) => {
      const enhancedResponse = response as ChestFormResponse;
      if (!response.canceled && response.selection !== undefined) {
        enhancedResponse.inventorySlot = inventorySlotMap.get(response.selection) ?? null;
      } else {
        enhancedResponse.inventorySlot = null;
      }
      return enhancedResponse;
    });
  }
}

// 默认导出 ChestFormData 以保持向后兼容
export default ChestFormData;
