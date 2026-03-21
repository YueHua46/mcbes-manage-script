/**
 * ChestFormData & FurnaceFormData - 箱子/熔炉 UI
 * 基于 Herobrine643928/Chest-UI 最新逻辑，物品 ID 使用本项目 runtime_map（type-ids）
 */

import { ActionFormData, ActionFormResponse } from "@minecraft/server-ui";
import { Player, RawMessage } from "@minecraft/server";
import { typeIdToDataId, typeIdToID } from "./type-ids";
import {
  custom_content,
  custom_content_keys,
  inventory_enabled,
  CHEST_UI_SIZES,
  ChestUISize,
} from "./constants";

/**
 * 增强的响应接口，包含物品栏槽位映射（本项目扩展）
 */
export interface ChestFormResponse extends ActionFormResponse {
  /** 若点击的是物品栏槽位，则为槽位索引，否则为 null */
  inventorySlot: number | null;
}

/**
 * show() 的选项：appendViewerInventory 为 true 时，在下方追加当前查看者（player）的背包 UI
 * 同时会在标题后追加 §inv§1，RP 根据该标记决定是否渲染「下方背包」区域，实现两套 ChestUI：带/不带下方物品栏
 */
export interface ChestFormShowOptions {
  appendViewerInventory?: boolean;
}

type ButtonData = [RawMessage | string, string | number | undefined];

/**
 * pattern() 中每个字符对应的数据
 */
export interface PatternKeyData {
  itemName?: string | RawMessage;
  itemDesc?: (string | RawMessage)[];
  stackAmount?: number;
  durability?: number;
  enchanted?: boolean;
  texture: string;
}

function isTexturePath(texture: string): boolean {
  return texture.startsWith("textures/");
}

/**
 * 解析显示用纹理：纹理路径直接返回；typeId 走 custom_content 或映射，未注册则回退
 */
function getDisplayTexture(texture: string): string {
  if (isTexturePath(texture)) return texture;
  const targetTexture = custom_content_keys.has(texture) ? custom_content[texture]?.texture : texture;
  if (isTexturePath(targetTexture)) return targetTexture;
  const isRegistered = typeIdToDataId.has(targetTexture) || typeIdToID.has(targetTexture);
  if (!isRegistered) return "minecraft:info_update2";
  return targetTexture;
}

/**
 * 根据 texture 解析出用于按钮的 targetTexture 与 ID（使用 runtime_map / typeIdToDataId）
 */
function resolveTextureAndId(texture: string): { targetTexture: string; ID: number | undefined } {
  const targetTexture = custom_content_keys.has(texture) ? custom_content[texture]?.texture : texture;
  const ID = typeIdToDataId.get(targetTexture) ?? typeIdToID.get(targetTexture);
  return { targetTexture, ID };
}

/**
 * 计算传给 ActionForm 的按钮 icon：ID 由外部脚本提供，此处直接使用
 */
function toButtonIcon(
  targetTexture: string,
  ID: number | undefined,
  enchanted: boolean
): string | number {
  if (ID === undefined) return targetTexture;
  return ID * 65536 + (enchanted ? 32768 : 0);
}

export class ChestFormData {
  private titleText: { rawtext: { text?: string; translate?: string }[] };
  private buttonArray: ButtonData[];
  public slotCount: number;

  constructor(size: ChestUISize = "small") {
    const sizing = CHEST_UI_SIZES.get(size) ?? ["§c§h§e§s§t§2§7§r", 27];
    this.titleText = { rawtext: [{ text: `${sizing[0]}` }] };
    const emptyButton: ButtonData = ["", undefined];
    this.buttonArray = Array(sizing[1])
      .fill(null)
      .map(() => [...emptyButton] as ButtonData);
    this.slotCount = sizing[1];
  }

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
    const { targetTexture, ID } = resolveTextureAndId(displayTexture);

    const buttonRawtext: { rawtext: RawMessage[] } = {
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
        } else if (typeof obj === "object" && obj !== null && "rawtext" in obj && obj.rawtext) {
          buttonRawtext.rawtext.push({ text: "\n" });
          for (const frag of obj.rawtext as RawMessage[]) {
            const f = frag as { text?: string; translate?: string; with?: string[] | RawMessage };
            if (f.translate !== undefined) {
              buttonRawtext.rawtext.push(
                f.with !== undefined ? { translate: f.translate, with: f.with as string[] } : { translate: f.translate }
              );
            } else if (f.text !== undefined) {
              buttonRawtext.rawtext.push({ text: f.text });
            }
          }
        } else if (typeof obj === "object" && obj !== null && "translate" in obj && (obj as RawMessage).translate) {
          const m = obj as RawMessage;
          buttonRawtext.rawtext.push({ text: "\n" });
          if (m.with !== undefined) {
            buttonRawtext.rawtext.push({ translate: m.translate!, with: m.with as string[] });
          } else {
            buttonRawtext.rawtext.push({ translate: m.translate! });
          }
        }
      }
    }

    const icon = toButtonIcon(targetTexture, ID, enchanted);
    this.buttonArray.splice(Math.max(0, Math.min(slot, this.slotCount - 1)), 1, [
      buttonRawtext as unknown as RawMessage,
      icon.toString(),
    ]);
    return this;
  }

  pattern(pattern: string[], key: { [char: string]: PatternKeyData }): ChestFormData {
    for (let i = 0; i < pattern.length; i++) {
      const row = pattern[i];
      for (let j = 0; j < row.length; j++) {
        const letter = row.charAt(j);
        const data = key[letter];
        if (!data) continue;

        const slot = j + i * 9;
        const displayTexture = getDisplayTexture(data.texture);
        const { targetTexture, ID } = resolveTextureAndId(displayTexture);
        const { stackAmount = 1, durability = 0, itemName, itemDesc, enchanted = false } = data;
        const stackSize = String(Math.min(Math.max(stackAmount, 1), 99)).padStart(2, "0");
        const durValue = String(Math.min(Math.max(durability, 0), 99)).padStart(2, "0");

        const buttonRawtext: { rawtext: RawMessage[] } = {
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
            } else if (obj && typeof obj === "object" && "rawtext" in obj && obj.rawtext) {
              buttonRawtext.rawtext.push({ text: "\n" });
              for (const frag of obj.rawtext as RawMessage[]) {
                const f = frag as { text?: string; translate?: string; with?: string[] | RawMessage };
                if (f.translate !== undefined) {
                  buttonRawtext.rawtext.push(
                    f.with !== undefined ? { translate: f.translate, with: f.with as string[] } : { translate: f.translate }
                  );
                } else if (f.text !== undefined) {
                  buttonRawtext.rawtext.push({ text: f.text });
                }
              }
            } else if (obj && typeof obj === "object" && "translate" in obj && (obj as RawMessage).translate) {
              const m = obj as RawMessage;
              buttonRawtext.rawtext.push({ text: "\n" });
              if (m.with !== undefined) {
                buttonRawtext.rawtext.push({ translate: m.translate!, with: m.with as string[] });
              } else {
                buttonRawtext.rawtext.push({ translate: m.translate! });
              }
            }
          }
        }

        const icon = toButtonIcon(targetTexture, ID, enchanted);
        this.buttonArray.splice(Math.max(0, Math.min(slot, this.slotCount - 1)), 1, [
          buttonRawtext as unknown as RawMessage,
          icon.toString(),
        ]);
      }
    }
    return this;
  }

  show(player: Player, options?: ChestFormShowOptions): Promise<ChestFormResponse> {
    const appendInventory = inventory_enabled || options?.appendViewerInventory === true;
    const titleForForm = appendInventory
      ? { rawtext: [this.titleText.rawtext[0], { text: "§inv§1" }, ...this.titleText.rawtext.slice(1)] }
      : this.titleText;
    const form = new ActionFormData().title(titleForForm as typeof this.titleText);
    this.buttonArray.forEach((button) => {
      form.button(button[0] as RawMessage, button[1]?.toString());
    });

    if (!appendInventory) {
      return form.show(player) as Promise<ChestFormResponse>;
    }

    const container = player?.getComponent("inventory")?.container;
    if (!container) {
      return form.show(player) as Promise<ChestFormResponse>;
    }

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
      const { targetTexture, ID } = resolveTextureAndId(displayTexture);
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

      const finalID = ID === undefined ? targetTexture : ID * 65536;
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

export class FurnaceFormData {
  private titleText: { rawtext: { text?: string; translate?: string }[] };
  private buttonArray: ButtonData[];
  public slotCount: number;

  constructor(isLit: boolean = false) {
    this.titleText = {
      rawtext: [{ text: isLit ? "§f§u§r§n§a§c§e§l§i§t§r" : "§f§u§r§n§a§c§e§r" }],
    };
    this.buttonArray = Array(3)
      .fill(null)
      .map(() => ["", undefined] as ButtonData);
    this.slotCount = 3;
  }

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
    const { targetTexture, ID } = resolveTextureAndId(displayTexture);

    const buttonRawtext: { rawtext: RawMessage[] } = {
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
        } else if (typeof obj === "object" && obj !== null && "rawtext" in obj && obj.rawtext) {
          buttonRawtext.rawtext.push({ text: "\n" });
          for (const frag of obj.rawtext as RawMessage[]) {
            const f = frag as { text?: string; translate?: string; with?: string[] | RawMessage };
            if (f.translate !== undefined) {
              buttonRawtext.rawtext.push(
                f.with !== undefined ? { translate: f.translate, with: f.with as string[] } : { translate: f.translate }
              );
            } else if (f.text !== undefined) {
              buttonRawtext.rawtext.push({ text: f.text });
            }
          }
        } else if (typeof obj === "object" && obj !== null && "translate" in obj && (obj as RawMessage).translate) {
          const m = obj as RawMessage;
          buttonRawtext.rawtext.push({ text: "\n" });
          if (m.with !== undefined) {
            buttonRawtext.rawtext.push({ translate: m.translate!, with: m.with as string[] });
          } else {
            buttonRawtext.rawtext.push({ translate: m.translate! });
          }
        }
      });
    }

    const icon = toButtonIcon(targetTexture, ID, enchanted);
    this.buttonArray.splice(Math.max(0, Math.min(slot, this.slotCount - 1)), 1, [
      buttonRawtext as unknown as RawMessage,
      icon.toString(),
    ]);
    return this;
  }

  show(player: Player): Promise<ChestFormResponse> {
    const form = new ActionFormData().title(this.titleText);
    this.buttonArray.forEach((button) => {
      form.button(button[0] as RawMessage, button[1]?.toString());
    });

    if (!inventory_enabled) {
      return form.show(player) as Promise<ChestFormResponse>;
    }

    const container = player?.getComponent("inventory")?.container;
    if (!container) {
      return form.show(player) as Promise<ChestFormResponse>;
    }

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
      const { targetTexture, ID } = resolveTextureAndId(displayTexture);
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

      const finalID = ID === undefined ? targetTexture : ID * 65536;
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

export default ChestFormData;
