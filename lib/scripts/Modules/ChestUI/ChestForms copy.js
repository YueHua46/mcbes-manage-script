var _ChestFormData_titleText, _ChestFormData_buttonArray;
import { ActionFormData } from "@minecraft/server-ui";
import { typeIdToID, typeIdToDataId } from "./typeIds";
import { BlockTypes, ItemTypes, system } from "@minecraft/server";
import { TextureList } from "./textureList";
import Setting from "./Setting";
/**
 * Credit:
 * Maintained by Herobrine64 & LeGend077.
 */
let number_of_1_16_100_items = 0;
system.run(() => {
    var _a;
    const experimentalItems = [];
    const MCEItems = ["yuehua:sm", "pao:claimblock1", "pao:claimblock10", "pao:claimblock100"];
    const items = ItemTypes.getAll().filter((item) => !item.id.startsWith("minecraft:") && !item.id.endsWith("spawn_egg") && !BlockTypes.get(item.id));
    number_of_1_16_100_items = items.length;
    for (const item of experimentalItems) {
        if (ItemTypes.get(item))
            number_of_1_16_100_items += 1;
    }
    for (const item of MCEItems) {
        if (ItemTypes.get(item))
            number_of_1_16_100_items -= 1;
    }
    number_of_1_16_100_items = (_a = Setting.get("NumberOf_1_16_100_Items")) !== null && _a !== void 0 ? _a : number_of_1_16_100_items;
    number_of_1_16_100_items += MCEItems.length;
});
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
    // button(
    //   slot: number,
    //   itemName?: string,
    //   itemDesc?: string[],
    //   texture?: string,
    //   stackSize: number = 1,
    //   enchanted: boolean = false
    // ): ChestFormData {
    //   // 获取自定义物品数量，用于ID计算
    //   const numberCustomItems = Setting.get("NumberOf_1_16_100_Items") ?? number_of_1_16_100_items;
    //   // 获取物品ID
    //   const ID = typeIdToDataId.get(texture || "") ?? typeIdToID.get(texture || "");
    //   // 设置按钮数据
    //   this.#buttonArray.splice(slot, 1, [
    //     // 格式化按钮文本，包含堆叠数量、物品名称和描述
    //     `stack#${Math.min(Math.max(stackSize, 1) || 1, 99)
    //       .toString()
    //       .padStart(2, "0")}§r${itemName ?? ""}§r${itemDesc?.length ? `\n§r${itemDesc.join("\n§r")}` : ""}`,
    //     // 计算物品ID或使用纹理路径
    //     ID !== undefined
    //       ? (ID + (ID < 256 ? 0 : numberCustomItems)) * 65536 + (enchanted ? 32768 : 0)
    //       : texture
    //       ? TextureList[texture] ?? texture
    //       : undefined,
    //   ]);
    //   return this;
    // }
    button(slot, itemName = "物品名称", itemDesc, texture, stackSize = 1, enchanted = false) {
        var _a, _b, _c;
        const numberCustomItems = (_a = Setting.get("NumberOf_1_16_100_Items")) !== null && _a !== void 0 ? _a : number_of_1_16_100_items;
        const ID = (_b = typeIdToDataId.get(texture)) !== null && _b !== void 0 ? _b : typeIdToID.get(texture);
        __classPrivateFieldGet(this, _ChestFormData_buttonArray, "f").splice(slot, 1, [
            `stack#${Math.min(Math.max(stackSize, 1) || 1, 99)
                .toString()
                .padStart(2, "0")}§r${itemName !== null && itemName !== void 0 ? itemName : ""}§r${(itemDesc === null || itemDesc === void 0 ? void 0 : itemDesc.length) ? `\n§r${itemDesc.join("\n§r")}` : ""}`,
            ID !== undefined
                ? Number((ID + (ID < 256 ? 0 : numberCustomItems)) * 65536 + (enchanted ? 32768 : 0))
                : (_c = TextureList[texture]) !== null && _c !== void 0 ? _c : texture,
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
    pattern(from, pattern, key) {
        var _a, _b, _c, _d, _e;
        // 遍历模式并填充对应槽位
        for (let i = 0; i < pattern.length; i++) {
            const row = pattern[i];
            for (let j = 0; j < row.length; j++) {
                const letter = row.charAt(j);
                if (key[letter]) {
                    // 计算槽位索引
                    const slot = from[1] + j + (from[0] + i) * 9;
                    const data = key[letter].data;
                    const itemName = (_a = data.itemName) !== null && _a !== void 0 ? _a : "";
                    const itemDesc = (_b = data.itemDesc) !== null && _b !== void 0 ? _b : [];
                    const texture = (_c = key[letter].iconPath) !== null && _c !== void 0 ? _c : "";
                    const stackSize = (_d = data.stackAmount) !== null && _d !== void 0 ? _d : 1;
                    const enchanted = (_e = data.enchanted) !== null && _e !== void 0 ? _e : false;
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
    show(player) {
        // 创建ActionFormData并设置标题
        const form = new ActionFormData().title(__classPrivateFieldGet(this, _ChestFormData_titleText, "f"));
        // 添加所有按钮
        __classPrivateFieldGet(this, _ChestFormData_buttonArray, "f").forEach((button) => {
            var _a;
            form.button(button[0], (_a = button[1]) === null || _a === void 0 ? void 0 : _a.toString());
        });
        // 显示表单
        return form.show(player);
    }
}
_ChestFormData_titleText = new WeakMap(), _ChestFormData_buttonArray = new WeakMap();
export default ChestFormData;
//# sourceMappingURL=ChestForms%20copy.js.map