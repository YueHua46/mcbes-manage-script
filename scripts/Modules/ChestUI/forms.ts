import { Container, Player, RawText } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { typeIdToDataId, typeIdToID } from "./typeIds.js";

/**
 *将库存插槽打开/关闭的逻辑。如果您在RP/ui/_global_variables.json side中使用了禁用的库存，则仅将其设置为false！
 *禁用此功能也可能会减少打开滞后的形式。
 */
const inventory_enabled = true;
/**
 *定义表单的自定义块和项目ID。
 *您可以引用一个香草纹理图标，该图标与其他项目相同。
 *...或引用纹理路径，它可以消除附魔的闪烁和3D块渲染能力。
 */
const custom_content = {
  /*
	'custom:block': {
		texture: 'minecraft:gold_block',
		type: 'block'
	},
	'custom:item': {
		texture: 'textures/items/paper',
		type: 'item'
	},
	*/
};
//块被排除在计数之外，因为它们不会移动原生ID。
const number_of_custom_items = Object.values(custom_content).filter((v: any) => v.type === "item").length;
const custom_content_keys = new Set(Object.keys(custom_content));
//添加UI中定义的自定义尺寸
const sizes = new Map([
  ["single", ["§c§h§e§s§t§2§7§r", 27]],
  ["small", ["§c§h§e§s§t§2§7§r", 27]],
  ["double", ["§c§h§e§s§t§5§4§r", 54]],
  ["large", ["§c§h§e§s§t§5§4§r", 54]],
  ["1", ["§c§h§e§s§t§0§1§r", 1]],
  ["5", ["§c§h§e§s§t§0§5§r", 5]],
  ["9", ["§c§h§e§s§t§0§9§r", 9]],
  ["18", ["§c§h§e§s§t§1§8§r", 18]],
  ["27", ["§c§h§e§s§t§2§7§r", 27]],
  ["36", ["§c§h§e§s§t§3§6§r", 36]],
  ["45", ["§c§h§e§s§t§4§5§r", 45]],
  ["54", ["§c§h§e§s§t§5§4§r", 54]],
  [1, ["§c§h§e§s§t§0§1§r", 1]],
  [5, ["§c§h§e§s§t§0§5§r", 5]],
  [9, ["§c§h§e§s§t§0§9§r", 9]],
  [18, ["§c§h§e§s§t§1§8§r", 18]],
  [27, ["§c§h§e§s§t§2§7§r", 27]],
  [36, ["§c§h§e§s§t§3§6§r", 36]],
  [45, ["§c§h§e§s§t§4§5§r", 45]],
  [54, ["§c§h§e§s§t§5§4§r", 54]],
] as any);
class ChestFormData {
  #titleText;
  #buttonArray;
  slotCount;
  constructor(size = "small") {
    const sizing = sizes.get(size) ?? (["§c§h§e§s§t§2§7§r", 27] as any);
    /** @internal */
    this.#titleText = { rawtext: [{ text: `${sizing[0]}` }] };
    /** @internal */
    this.#buttonArray = Array(sizing[1]).fill(["", undefined]);
    this.slotCount = sizing[1];
  }
  title(text: any) {
    if (typeof text === "string") {
      this.#titleText.rawtext.push({ text: text });
    } else if (typeof text === "object") {
      if (text.rawtext) {
        this.#titleText.rawtext.push(...text.rawtext);
      } else {
        this.#titleText.rawtext.push(text);
      }
    }
    return this;
  }
  button(slot: any, itemName: any, itemDesc: any, texture: any, stackSize = 1, durability = 0, enchanted = false) {
    const targetTexture = custom_content_keys.has(texture) ? (custom_content as any)[texture]?.texture : texture;
    const ID = typeIdToDataId.get(targetTexture) ?? typeIdToID.get(targetTexture);
    let buttonRawtext = {
      rawtext: [
        {
          text: `stack#${String(Math.min(Math.max(stackSize, 1), 99)).padStart(2, "0")}dur#${String(
            Math.min(Math.max(durability, 0), 99)
          ).padStart(2, "0")}§r`,
        },
      ],
    };
    if (typeof itemName === "string") {
      buttonRawtext.rawtext.push({ text: itemName ? `${itemName}§r` : "§r" });
    } else if (typeof itemName === "object" && itemName.rawtext) {
      buttonRawtext.rawtext.push(...itemName.rawtext, { text: "§r" });
    } else return;
    if (Array.isArray(itemDesc) && itemDesc.length > 0) {
      for (const obj of itemDesc) {
        if (typeof obj === "string") {
          buttonRawtext.rawtext.push({ text: `\n${obj}` });
        } else if (typeof obj === "object" && obj.rawtext) {
          buttonRawtext.rawtext.push({ text: `\n` }, ...obj.rawtext);
        }
      }
    }
    this.#buttonArray.splice(Math.max(0, Math.min(slot, this.slotCount - 1)), 1, [
      buttonRawtext,
      ID === undefined
        ? targetTexture
        : (ID + (ID < 256 ? 0 : number_of_custom_items)) * 65536 + (enchanted ? 32768 : 0),
    ]);
    return this;
  }
  pattern(pattern: any, key: any) {
    for (let i = 0; i < pattern.length; i++) {
      const row = pattern[i];
      for (let j = 0; j < row.length; j++) {
        const letter = row.charAt(j);
        const data = key[letter];
        if (!data) continue;
        const slot = j + i * 9;
        const targetTexture = custom_content_keys.has(data.texture)
          ? (custom_content as any)[data.texture]?.texture
          : data.texture;
        const ID = typeIdToDataId.get(targetTexture) ?? typeIdToID.get(targetTexture);
        const { stackAmount = 1, durability = 0, itemName, itemDesc, enchanted = false } = data;
        const stackSize = String(Math.min(Math.max(stackAmount, 1), 99)).padStart(2, "0");
        const durValue = String(Math.min(Math.max(durability, 0), 99)).padStart(2, "0");
        let buttonRawtext = {
          rawtext: [{ text: `stack#${stackSize}dur#${durValue}§r` }],
        };
        if (typeof itemName === "string") {
          buttonRawtext.rawtext.push({ text: `${itemName}§r` });
        } else if (itemName?.rawtext) {
          buttonRawtext.rawtext.push(...itemName.rawtext, { text: "§r" });
        } else continue;
        if (Array.isArray(itemDesc) && itemDesc.length > 0) {
          for (const obj of itemDesc) {
            if (typeof obj === "string") {
              buttonRawtext.rawtext.push({ text: `\n${obj}` });
            } else if (obj?.rawtext) {
              buttonRawtext.rawtext.push({ text: `\n`, ...obj.rawtext });
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
  show(player: Player) {
    const form = new ActionFormData().title(this.#titleText);
    this.#buttonArray.forEach((button) => {
      form.button(button[0], button[1]?.toString());
    });
    if (!inventory_enabled) return form.show(player);
    /** @type {Container} */
    const container = player.getComponent("inventory")?.container;
    if (!container) return form.show(player);
    for (let i = 0; i < container.size; i++) {
      const item = container.getItem(i);
      if (!item) continue;
      const typeId = item.typeId;
      const targetTexture = custom_content_keys.has(typeId) ? (custom_content as any)[typeId]?.texture : typeId;
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
            text: `stack#${String(amount).padStart(2, "0")}dur#${String(durDamage).padStart(
              2,
              "0"
            )}§r${formattedItemName}`,
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

class FurnaceFormData {
  #titleText: RawText;
  #buttonArray;
  slotCount;
  constructor(isLit = false) {
    /** @internal */
    this.#titleText = { rawtext: [{ text: isLit ? "§f§u§r§n§a§c§e§l§i§t§r" : "§f§u§r§n§a§c§e§r" }] };
    /** @internal */
    this.#buttonArray = Array(3).fill(["", undefined]);
    this.slotCount = 3;
  }
  title(text: RawText | string) {
    if (typeof text === "string") {
      this.#titleText.rawtext?.push({ text });
    } else if (typeof text === "object" && text.rawtext) {
      this.#titleText.rawtext?.push(...text.rawtext);
    } else {
      this.#titleText.rawtext?.push({ text: "" });
    }
    return this;
  }
  button(slot: any, itemName: any, itemDesc: any, texture: any, stackSize = 1, durability = 0, enchanted = false) {
    const targetTexture = custom_content_keys.has(texture) ? (custom_content as any)[texture]?.texture : texture;
    const ID = typeIdToDataId.get(targetTexture) ?? typeIdToID.get(targetTexture);
    let buttonRawtext = {
      rawtext: [
        {
          text: `stack#${String(Math.min(Math.max(stackSize, 1), 99)).padStart(2, "0")}dur#${String(
            Math.min(Math.max(durability, 0), 99)
          ).padStart(2, "0")}§r`,
        },
      ],
    };

    if (typeof itemName === "string") {
      buttonRawtext.rawtext.push({ text: itemName ? `${itemName}§r` : "§r" });
    } else if (typeof itemName === "object" && itemName.rawtext) {
      buttonRawtext.rawtext.push(...itemName.rawtext, { text: "§r" });
    } else return;
    if (Array.isArray(itemDesc) && itemDesc.length) {
      itemDesc.forEach((obj) => {
        if (typeof obj === "string") {
          buttonRawtext.rawtext.push({ text: `\n${obj}` });
        } else if (typeof obj === "object" && obj.rawtext) {
          buttonRawtext.rawtext.push({ text: `\n` }, ...obj.rawtext);
        }
      });
    }
    this.#buttonArray.splice(Math.max(0, Math.min(slot, this.slotCount - 1)), 1, [
      buttonRawtext,
      ID === undefined
        ? targetTexture
        : (ID + (ID < 256 ? 0 : number_of_custom_items)) * 65536 + (enchanted ? 32768 : 0),
    ]);
    return this;
  }
  show(player: Player) {
    const form = new ActionFormData().title(this.#titleText);
    this.#buttonArray.forEach((button) => {
      form.button(button[0], button[1]?.toString());
    });
    if (!inventory_enabled) return form.show(player);
    /** @type {Container} */
    const container = player.getComponent("inventory")?.container;
    if (!container) return form.show(player);
    for (let i = 0; i < container.size; i++) {
      const item = container.getItem(i);
      if (!item) continue;
      const typeId = item.typeId;
      const targetTexture = custom_content_keys.has(typeId) ? (custom_content as any)[typeId]?.texture : typeId;
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
            text: `stack#${String(amount).padStart(2, "0")}dur#${String(durDamage).padStart(
              2,
              "0"
            )}§r${formattedItemName}`,
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

export { ChestFormData, FurnaceFormData };
