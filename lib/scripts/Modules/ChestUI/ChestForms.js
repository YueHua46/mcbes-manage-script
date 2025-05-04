var _ChestFormData_titleText, _ChestFormData_buttonArray;
import { ActionFormData } from "@minecraft/server-ui";
import { typeIdToID, typeIdToDataId } from "./typeIds";
import { BlockTypes, ItemTypes, system } from "@minecraft/server";
import config from "./Configuration";
/**
 * Credit:
 * Maintained by Herobrine64 & LeGend077.
 */
// let number_of_1_16_100_items = 0;
// system.run(() => {
//   const experimentalItems: any[] = [];
//   const MCEItems = ["yuehua:sm", "pao:claimblock1", "pao:claimblock10", "pao:claimblock100"];
//   const items = ItemTypes.getAll().filter(
//     (item) => !item.id.startsWith("minecraft:") && !item.id.endsWith("spawn_egg") && !BlockTypes.get(item.id)
//   );
//   number_of_1_16_100_items = items.length;
//   for (const item of experimentalItems) {
//     if (ItemTypes.get(item)) number_of_1_16_100_items += 1;
//   }
//   for (const item of MCEItems) {
//     if (ItemTypes.get(item)) number_of_1_16_100_items -= 1;
//   }
//   number_of_1_16_100_items = Setting.get("NumberOf_1_16_100_Items") ?? number_of_1_16_100_items;
//   number_of_1_16_100_items += MCEItems.length;
// });
system.run(() => {
    // 自动生成 custom_content：筛选所有非原版、非方块、非生成蛋、无旧版/新版映射的自定义物品
    const custom_content = {};
    const allItems = ItemTypes.getAll(); // 获取所有注册物品 ([learn.microsoft.com](https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/itemtypes?view=minecraft-bedrock-stable&utm_source=chatgpt.com))
    const customCandidates = allItems.filter((item) => {
        if (item.id.startsWith("minecraft:"))
            return false; // 排除原版 ([jaylydev.github.io](https://jaylydev.github.io/scriptapi-docs/latest/classes/_minecraft_server.ItemTypes-1.html?utm_source=chatgpt.com))
        if (BlockTypes.get(item.id))
            return false; // 排除方块 ([learn.microsoft.com](https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/blocktypes?view=minecraft-bedrock-stable&utm_source=chatgpt.com))
        if (item.id.endsWith("_spawn_egg"))
            return false; // 排除生成蛋
        // 排除在映射表中的旧版 ID 与新版 DataId
        return typeIdToDataId.get(item.id) === undefined && typeIdToID.get(item.id) === undefined;
    });
    for (const item of customCandidates) {
        custom_content[item.id] = {
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
/**
 *将库存插槽打开/关闭的逻辑。如果您在RP/ui/_global_variables.json side中使用了禁用的库存，则仅将其设置为false！
 *禁用此功能也可能会减少打开滞后的形式。
 */
const inventory_enabled = true;
/**
 *定义表单的自定义块和项目ID。
 *您可以引用一个原版纹理图标，该图标与其他项目相同。
 *...或引用纹理路径，它可以消除附魔的闪烁和3D块渲染能力。
 */
// const custom_content = {
//   "yuehua:sm": {
//     texture: "textures/items/sm",
//     type: "item",
//   },
//   "pao:claimblock1": {
//     texture: "pao:claimblock1",
//     type: "item",
//   },
//   "pao:claimblock10": {
//     texture: "pao:claimblock10",
//     type: "item",
//   },
//   "pao:claimblock100": {
//     texture: "pao:claimblock100",
//     type: "item",
//   },
// };
//块被排除在计数之外，因为它们不会移动原版ID。
// const number_of_custom_items = Object.values(custom_content).filter((v) => v.type === "item").length;
// const custom_content_keys = new Set(Object.keys(custom_content));
const sizes = new Map([
    ["single", [`§c§h§e§s§t§s§m§a§l§l§r`, 27]],
    ["double", [`§c§h§e§s§t§l§a§r§g§e§r`, 54]],
    ["small", [`§c§h§e§s§t§s§m§a§l§l§r`, 27]],
    ["large", [`§c§h§e§s§t§l§a§r§g§e§r`, 54]],
    ["pao_chest", [`§p§a§o§c§h§e§s§t§r`, 54]],
    ["shop", [`§s§h§o§p§c§h§e§s§t§r`, 54]],
]);
class ChestFormData {
    /**
     * 创建一个新的箱子表单
     * @param size 箱子大小，默认为"small"(27格)
     */
    constructor(size = "small") {
        var _a;
        _ChestFormData_titleText.set(this, void 0);
        _ChestFormData_buttonArray.set(this, void 0);
        const sizing = (_a = sizes.get(size)) !== null && _a !== void 0 ? _a : ["§c§h§e§s§t§2§7§r", 27];
        /** @internal */
        __classPrivateFieldSet(this, _ChestFormData_titleText, sizing[0], "f");
        /** @internal */
        __classPrivateFieldSet(this, _ChestFormData_buttonArray, [], "f");
        for (let i = 0; i < sizing[1]; i++)
            __classPrivateFieldGet(this, _ChestFormData_buttonArray, "f").push(["", undefined]);
        this.slotCount = sizing[1];
    }
    /**
     * 设置箱子界面的标题
     * @param text 标题文本
     * @returns 当前ChestFormData实例，用于链式调用
     */
    title(text) {
        __classPrivateFieldSet(this, _ChestFormData_titleText, __classPrivateFieldGet(this, _ChestFormData_titleText, "f") + text, "f");
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
    button(slot, itemName = "物品名称", itemDesc, texture, stackSize = 1, durability = 0, enchanted = false) {
        var _a, _b;
        const custom_content = config.get("custom_content");
        const number_of_custom_items = config.get("number_of_custom_items");
        const custom_content_keys = config.get("custom_content_keys");
        const targetTexture = custom_content_keys.has(texture)
            ? (_a = custom_content[texture]) === null || _a === void 0 ? void 0 : _a.texture
            : texture;
        const ID = (_b = typeIdToDataId.get(targetTexture)) !== null && _b !== void 0 ? _b : typeIdToID.get(targetTexture);
        let buttonRawtext = {
            rawtext: [
                {
                    text: `stack#${String(Math.min(Math.max(stackSize, 1), 99)).padStart(2, "0")}§r`,
                },
            ],
        };
        // 添加物品名称
        if (typeof itemName === "string") {
            buttonRawtext.rawtext.push({ text: itemName ? `${itemName}§r` : "§r" });
        }
        else if (typeof itemName === "object") {
            if ("rawtext" in itemName) {
                buttonRawtext.rawtext.push(...itemName.rawtext, { text: "§r" });
            }
            else if ("translate" in itemName) {
                // 处理带有 translate 属性的 RawMessage
                buttonRawtext.rawtext.push({ translate: itemName.translate }, { text: "§r" });
            }
            else {
                return;
            }
        }
        else
            return;
        // 添加物品描述（lore）
        if (Array.isArray(itemDesc) && itemDesc.length > 0) {
            for (const obj of itemDesc) {
                if (typeof obj === "string") {
                    buttonRawtext.rawtext.push({ text: `\n${obj}` });
                }
                else if (typeof obj === "object" && "rawtext" in obj) {
                    buttonRawtext.rawtext.push({ text: `\n` }, ...obj.rawtext);
                }
            }
        }
        __classPrivateFieldGet(this, _ChestFormData_buttonArray, "f").splice(slot, 1, [
            buttonRawtext, // 直接传对象
            ID === undefined
                ? targetTexture
                : (ID + (ID < 256 ? 0 : number_of_custom_items)) * 65536 + (enchanted ? 32768 : 0),
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
    pattern(pattern, key) {
        var _a, _b;
        const custom_content = config.get("custom_content");
        const number_of_custom_items = config.get("number_of_custom_items");
        const custom_content_keys = config.get("custom_content_keys");
        for (let i = 0; i < pattern.length; i++) {
            const row = pattern[i];
            for (let j = 0; j < row.length; j++) {
                const letter = row.charAt(j);
                const data = key[letter];
                if (!data)
                    continue;
                const slot = j + i * 9;
                const targetTexture = custom_content_keys.has(data.texture)
                    ? (_a = custom_content[data.texture]) === null || _a === void 0 ? void 0 : _a.texture
                    : data.texture;
                const ID = (_b = typeIdToDataId.get(targetTexture)) !== null && _b !== void 0 ? _b : typeIdToID.get(targetTexture);
                const { stackAmount = 1, durability = 0, itemName, itemDesc, enchanted = false } = data;
                const stackSize = String(Math.min(Math.max(stackAmount, 1), 99)).padStart(2, "0");
                const durValue = String(Math.min(Math.max(durability, 0), 99)).padStart(2, "0");
                let buttonRawtext = {
                    rawtext: [{ text: `stack#${stackSize}§r` }],
                };
                if (typeof itemName === "string") {
                    buttonRawtext.rawtext.push({ text: `${itemName}§r` });
                }
                else if (itemName === null || itemName === void 0 ? void 0 : itemName.rawtext) {
                    buttonRawtext.rawtext.push(...itemName.rawtext, { text: "§r" });
                }
                else if (itemName === null || itemName === void 0 ? void 0 : itemName.translate) {
                    buttonRawtext.rawtext.push({ translate: itemName.translate }, { text: "§r" });
                }
                else
                    continue;
                if (Array.isArray(itemDesc) && itemDesc.length > 0) {
                    for (const obj of itemDesc) {
                        if (typeof obj === "string") {
                            buttonRawtext.rawtext.push({ text: `\n${obj}` });
                        }
                        else if (obj === null || obj === void 0 ? void 0 : obj.rawtext) {
                            buttonRawtext.rawtext.push(Object.assign({ text: `\n` }, obj.rawtext));
                        }
                    }
                }
                __classPrivateFieldGet(this, _ChestFormData_buttonArray, "f").splice(Math.max(0, Math.min(slot, this.slotCount - 1)), 1, [
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
     * @param player 目标玩家
     * @returns 表单响应Promise
     */
    // show(player: any) {
    //   // 创建ActionFormData并设置标题
    //   const form = new ActionFormData().title(this.#titleText);
    //   // 添加所有按钮
    //   this.#buttonArray.forEach((button) => {
    //     form.button(button[0], button[1]?.toString());
    //   });
    //   // 显示表单
    //   return form.show(player);
    // }
    show(player) {
        var _a, _b, _c;
        const custom_content = config.get("custom_content");
        const number_of_custom_items = config.get("number_of_custom_items");
        const custom_content_keys = config.get("custom_content_keys");
        const form = new ActionFormData().title(__classPrivateFieldGet(this, _ChestFormData_titleText, "f"));
        __classPrivateFieldGet(this, _ChestFormData_buttonArray, "f").forEach((button) => {
            var _a;
            form.button(button[0], (_a = button[1]) === null || _a === void 0 ? void 0 : _a.toString());
        });
        if (!inventory_enabled)
            return form.show(player);
        const container = (_a = player === null || player === void 0 ? void 0 : player.getComponent("inventory")) === null || _a === void 0 ? void 0 : _a.container;
        if (!container)
            return form.show(player);
        for (let i = 0; i < container.size; i++) {
            const item = container.getItem(i);
            if (!item)
                continue;
            const typeId = item.typeId;
            const targetTexture = custom_content_keys.has(typeId)
                ? (_b = custom_content[typeId]) === null || _b === void 0 ? void 0 : _b.texture
                : typeId;
            const ID = (_c = typeIdToDataId.get(targetTexture)) !== null && _c !== void 0 ? _c : typeIdToID.get(targetTexture);
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
            if (loreText)
                buttonRawtext.rawtext.push({ text: loreText });
            const finalID = ID === undefined ? targetTexture : (ID + (ID < 256 ? 0 : number_of_custom_items)) * 65536;
            form.button(buttonRawtext, finalID.toString());
        }
        return form.show(player);
    }
}
_ChestFormData_titleText = new WeakMap(), _ChestFormData_buttonArray = new WeakMap();
export default ChestFormData;
//# sourceMappingURL=ChestForms.js.map