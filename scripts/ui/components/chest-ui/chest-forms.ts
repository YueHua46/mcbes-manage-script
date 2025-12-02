/**
 * ChestFormData - 箱子UI系统
 * 完整迁移自 Modules/ChestUI/ChestForms.ts (317行)
 */

import { ActionFormData } from "@minecraft/server-ui";
// 临时保留对typeIds的引用，因为这个文件有2255行的映射数据
import { typeIdToID, typeIdToDataId } from "./type-ids";
import { BlockTypes, ItemTypes, Player, RawMessage, system } from "@minecraft/server";
import config from "./configuration";
import { TextureList } from "./texture-list";
import Setting from "./setting";

// 初始化自定义物品内容
system.run(() => {
  const custom_content = {};
  const allItems = ItemTypes.getAll();
  const customCandidates = allItems.filter((item) => {
    if (item.id.startsWith("minecraft:")) return false;
    if (BlockTypes.get(item.id)) return false;
    if (item.id.endsWith("_spawn_egg")) return false;
    return typeIdToDataId.get(item.id) === undefined && typeIdToID.get(item.id) === undefined;
  });

  for (const item of customCandidates) {
    (custom_content as { [key: string]: { texture: string; type: string } })[item.id] = {
      texture: `textures/items/${item.id.split(":")[1]}`,
      type: "item",
    };
  }

  const number_of_custom_items = customCandidates.length;
  const custom_content_keys = new Set(Object.keys(custom_content));
  config.set("custom_content", custom_content);
  config.set("number_of_custom_items", number_of_custom_items);
  config.set("custom_content_keys", custom_content_keys);
});

const inventory_enabled = true;

const sizes = new Map([
  ["single", [`§c§h§e§s§t§s§m§a§l§l§r`, 27]],
  ["double", [`§c§h§e§s§t§l§a§r§g§e§r`, 54]],
  ["small", [`§c§h§e§s§t§s§m§a§l§l§r`, 27]],
  ["large", [`§c§h§e§s§t§l§a§r§g§e§r`, 54]],
  ["pao_chest", [`§p§a§o§c§h§e§s§t§r`, 54]],
  ["shop", [`§s§h§o§p§c§h§e§s§t§r`, 54]],
]);

type Sizes = "single" | "double" | "small" | "large" | "pao_chest" | "shop";

/**
 * ChestFormData类 - 用于创建和显示箱子界面UI
 */
export default class ChestFormData {
  #titleText: string;
  #buttonArray: any[];
  slotCount: number;

  constructor(size: Sizes = "small") {
    const sizing = sizes.get(size) ?? ["§c§h§e§s§t§2§7§r", 27];
    this.#titleText = sizing[0] as string;
    this.#buttonArray = [];
    for (let i = 0; i < (sizing[1] as number); i++) this.#buttonArray.push(["", undefined]);
    this.slotCount = sizing[1] as number;
  }

  /**
   * 设置箱子界面的标题
   */
  title(text: string): ChestFormData {
    this.#titleText += text;
    return this;
  }

  /**
   * 在指定槽位添加一个物品按钮
   */
  button(
    slot: number,
    itemName: string | RawMessage = "物品名称",
    itemDesc: string[],
    texture: string,
    stackSize = 1,
    durability = 0,
    enchanted = false
  ): ChestFormData {
    const custom_content = config.get("custom_content");
    const number_of_custom_items = config.get("number_of_custom_items");
    const custom_content_keys = config.get("custom_content_keys");

    const targetTexture = custom_content_keys.has(texture)
      ? (custom_content as { [key: string]: { texture: string } })[texture]?.texture
      : texture;
    const ID = typeIdToDataId.get(targetTexture) ?? typeIdToID.get(targetTexture);

    let buttonRawtext: RawMessage = {
      rawtext: [
        {
          text: `stack#${String(Math.min(Math.max(stackSize, 1), 99)).padStart(2, "0")}§r`,
        },
      ],
    };

    if (typeof itemName === "string") {
      buttonRawtext.rawtext!.push({ text: itemName ? `${itemName}§r` : "§r" });
    } else if (typeof itemName === "object") {
      if ("rawtext" in itemName) {
        buttonRawtext.rawtext!.push(...(itemName as { rawtext: { text: string }[] }).rawtext, { text: "§r" });
      } else if ("translate" in itemName) {
        buttonRawtext.rawtext!.push({ translate: (itemName as { translate: string }).translate }, { text: "§r" });
      } else {
        return this;
      }
    } else return this;

    if (Array.isArray(itemDesc) && itemDesc.length > 0) {
      for (const obj of itemDesc) {
        if (typeof obj === "string") {
          buttonRawtext.rawtext!.push({ text: `\n${obj}` });
        } else if (typeof obj === "object" && "rawtext" in obj) {
          buttonRawtext.rawtext!.push({ text: `\n` }, ...(obj as { rawtext: { text: string }[] }).rawtext);
        }
      }
    }

    this.#buttonArray.splice(slot, 1, [
      buttonRawtext as RawMessage,
      ID === undefined
        ? targetTexture
        : (ID + (ID < 256 ? 0 : number_of_custom_items)) * 65536 + (enchanted ? 32768 : 0),
    ]);
    return this;
  }

  /**
   * 使用模式填充多个槽位
   */
  pattern(pattern: any[], key: any): ChestFormData {
    const custom_content = config.get("custom_content");
    const number_of_custom_items = config.get("number_of_custom_items");
    const custom_content_keys = config.get("custom_content_keys");

    for (let i = 0; i < pattern.length; i++) {
      const row = pattern[i];
      for (let j = 0; j < row.length; j++) {
        const letter = row.charAt(j);
        const data = key[letter];
        if (!data) continue;
        const slot = j + i * 9;
        const targetTexture = custom_content_keys.has(data.texture)
          ? (custom_content as { [key: string]: { texture: string } })[data.texture]?.texture
          : data.texture;
        const ID = typeIdToDataId.get(targetTexture) ?? typeIdToID.get(targetTexture);
        const { stackAmount = 1, durability = 0, itemName, itemDesc, enchanted = false } = data;
        const stackSize = String(Math.min(Math.max(stackAmount, 1), 99)).padStart(2, "0");

        let buttonRawtext: RawMessage = {
          rawtext: [{ text: `stack#${stackSize}§r` }],
        };

        if (typeof itemName === "string") {
          buttonRawtext.rawtext!.push({ text: `${itemName}§r` });
        } else if (itemName?.rawtext) {
          buttonRawtext.rawtext!.push(...itemName.rawtext, { text: "§r" });
        } else if (itemName?.translate) {
          buttonRawtext.rawtext!.push({ translate: itemName.translate }, { text: "§r" });
        } else continue;

        if (Array.isArray(itemDesc) && itemDesc.length > 0) {
          for (const obj of itemDesc) {
            if (typeof obj === "string") {
              buttonRawtext.rawtext!.push({ text: `\n${obj}` });
            } else if (obj?.rawtext) {
              buttonRawtext.rawtext!.push({ text: `\n`, ...obj.rawtext });
            }
          }
        }

        this.#buttonArray.splice(Math.max(0, Math.min(slot, this.slotCount - 1)), 1, [
          buttonRawtext,
          ID === undefined
            ? targetTexture
            : (ID + (ID < 256 ? 0 : number_of_custom_items)) * 65536 + (enchanted ? 32768 : 0),
        ]);
      }
    }
    return this;
  }

  /**
   * 显示箱子表单给玩家
   */
  show(player: Player) {
    const custom_content = config.get("custom_content");
    const number_of_custom_items = config.get("number_of_custom_items");
    const custom_content_keys = config.get("custom_content_keys");

    const form = new ActionFormData().title(this.#titleText);
    this.#buttonArray.forEach((button) => {
      form.button(button[0], button[1]?.toString());
    });

    if (!inventory_enabled) return form.show(player);

    const container = player?.getComponent("inventory")?.container;
    if (!container) return form.show(player);

    for (let i = 0; i < container.size; i++) {
      const item = container.getItem(i);
      if (!item) continue;

      const typeId = item.typeId;
      const targetTexture = custom_content_keys.has(typeId)
        ? (custom_content as { [key: string]: { texture: string } })[typeId]?.texture
        : typeId;
      const ID = typeIdToDataId.get(targetTexture) ?? typeIdToID.get(targetTexture);
      const durability = item.getComponent("durability");
      const durDamage = durability
        ? Math.round(((durability.maxDurability - durability.damage) / durability.maxDurability) * 99)
        : 0;
      const amount = item.amount;
      const formattedItemName = typeId
        .replace(/.*(?<=:)/, "")
        .replace(/_/g, " ")
        .replace(/(^\w|\s\w)/g, (m) => m.toUpperCase());

      let buttonRawtext = {
        rawtext: [
          {
            text: `stack#${String(amount).padStart(2, "0")}dur#${String(durDamage).padStart(2, "0")}§r${formattedItemName}`,
          },
        ],
      };

      const loreText = item.getLore().join("\n");
      if (loreText) buttonRawtext.rawtext.push({ text: loreText });

      const finalID = ID === undefined ? targetTexture : (ID + (ID < 256 ? 0 : number_of_custom_items)) * 65536;
      form.button(buttonRawtext, finalID.toString());
    }

    return form.show(player);
  }
}
