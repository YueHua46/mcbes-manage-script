import economic from "../Economic";
import { openDialogForm } from "../../Forms/Dialog";
import { color } from "@mcbe-mods/utils";
import ItemDatabase from "../ItemDatabase";
import { colorCodes } from "../../../utils/color";
/**
 * 玩家商店模块 - 使用实体容器存储物品
 */
class AuctionHouse {
    constructor(dbName = "AuctionHouse2.0") {
        // system.run(() => {
        // @ts-ignore - 兼容旧逻辑的多余参数
        this.shopDB = new ItemDatabase(dbName);
        // });
    }
    /**
     * 上架物品
     * @param player 玩家
     * @param item 物品
     * @param price 价格
     * @param amount 数量
     * @param description 描述
     * @param callback 回调函数
     */
    listItem(player_1, item_1, price_1) {
        return __awaiter(this, arguments, void 0, function* (player, item, price, amount = 1, name, description, callback) {
            var _a;
            // 检查物品是否有效
            if (!item)
                return "物品不存在";
            // 从玩家背包中移除对应数量的物品
            const inventory = player.getComponent("inventory");
            if (!inventory)
                return "无法获取玩家背包";
            const container = inventory.container;
            // 查找玩家背包中匹配的物品
            let foundSlot = -1;
            let foundItem;
            for (let i = 0; i < container.size; i++) {
                const slotItem = container.getItem(i);
                if (slotItem && slotItem.typeId === item.typeId) {
                    // 检查物品数量
                    if (slotItem.amount >= amount) {
                        foundSlot = i;
                        foundItem = slotItem;
                        break;
                    }
                }
            }
            if (foundSlot === -1 || !foundItem)
                return "找不到足够数量的物品";
            // 创建商品数据
            const itemData = {
                playerName: player.name,
                price: price,
                amount: amount,
                name: name,
                description: (_a = item.getLore()) === null || _a === void 0 ? void 0 : _a.join("\n"),
                createdAt: Date.now(),
            };
            try {
                // 克隆物品并设置数量
                const itemToStore = item.clone();
                itemToStore.amount = amount;
                // 添加到数据库
                this.shopDB.add(itemToStore, Object.assign({}, itemData));
                // 从玩家背包中移除物品
                if (foundItem.amount === amount) {
                    container.setItem(foundSlot);
                }
                else {
                    foundItem.amount -= amount;
                    container.setItem(foundSlot, foundItem);
                }
                // 显示成功消息
                openDialogForm(player, {
                    title: "上架成功",
                    desc: `${colorCodes.green}成功上架 ${colorCodes.yellow}${itemData.amount} ${colorCodes.green}个 ${colorCodes.aqua}${itemData.name}${colorCodes.green}，单价: ${colorCodes.gold}${itemData.price}`,
                }, callback);
            }
            catch (error) {
                return `上架失败: ${error}`;
            }
        });
    }
    /**
     * 下架物品
     * @param player 玩家
     * @param entry 商品条目
     * @param callback 回调函数
     */
    unlistItem(player, entry, callback) {
        return __awaiter(this, void 0, void 0, function* () {
            // 检查是否是物品所有者
            if (entry.data.playerName !== player.name)
                return "只能下架自己的物品";
            // 检查条目是否有效
            if (!this.isValid(entry))
                return "物品不存在或已被下架";
            // 获取玩家背包
            const inventory = player.getComponent("inventory");
            if (!inventory)
                return "无法获取玩家背包";
            const container = inventory.container;
            // 检查背包是否有空间
            if (container.emptySlotsCount === 0) {
                openDialogForm(player, {
                    title: "下架失败",
                    desc: color.red(`背包已满，无法将物品返还给玩家`),
                }, callback);
                return;
            }
            try {
                // 取回物品
                const item = yield this.takeItem(entry);
                // 添加到玩家背包
                container.addItem(item);
                // 显示成功消息
                openDialogForm(player, {
                    title: "下架成功",
                    desc: `${colorCodes.green}成功下架 ${colorCodes.yellow}${entry.data.amount} ${colorCodes.green}个 ${colorCodes.aqua}${entry.data.name}`,
                }, callback);
            }
            catch (error) {
                return `下架失败: ${error}`;
            }
        });
    }
    /**
     * 购买物品
     * @param player 购买者
     * @param entry 商品条目
     * @param amount 购买数量
     * @param callback 回调函数
     */
    buyItem(player_1, entry_1) {
        return __awaiter(this, arguments, void 0, function* (player, entry, amount = 0, callback) {
            // 检查条目是否有效
            if (!this.isValid(entry))
                return "物品不存在或已被购买";
            // 如果未指定数量，则购买全部
            if (amount <= 0 || amount > entry.data.amount) {
                amount = entry.data.amount;
            }
            // 计算总价
            const totalPrice = entry.data.price * amount;
            // 检查玩家是否有足够的金钱
            if (!economic.hasEnoughGold(player.name, totalPrice))
                return "金钱不足";
            // 获取玩家背包
            const inventory = player.getComponent("inventory");
            if (!inventory)
                return "无法获取玩家背包";
            const container = inventory.container;
            // 检查背包是否有空间
            if (container.emptySlotsCount === 0) {
                openDialogForm(player, {
                    title: "购买失败",
                    desc: color.red(`背包已满，无法接收物品`),
                }, callback);
                return;
            }
            try {
                // 转账
                const result = economic.transfer(player.name, entry.data.playerName, totalPrice, "购买玩家商店物品");
                if (typeof result === "string") {
                    openDialogForm(player, {
                        title: "购买失败",
                        desc: color.red(result),
                    }, callback);
                    return; // 停止执行
                }
                // 如果购买全部数量，直接取回物品
                if (amount === entry.data.amount) {
                    // 取回物品
                    const item = yield this.takeItem(entry);
                    // 添加到玩家背包
                    container.addItem(item);
                }
                else {
                    // 部分购买
                    // 1. 获取原物品
                    const originalItem = entry.item.clone();
                    originalItem.amount = amount;
                    // 2. 更新数据库中的数量
                    entry.data.amount -= amount;
                    entry.itemDB.editData({ amount: entry.data.amount });
                    // 3. 添加到玩家背包
                    container.addItem(originalItem);
                }
                // 显示成功消息
                openDialogForm(player, {
                    title: "购买成功",
                    desc: `${colorCodes.green}成功购买 ${colorCodes.yellow}${amount} ${colorCodes.green}个 ${colorCodes.aqua}${entry.data.name}${colorCodes.green}，总价: ${colorCodes.gold}${totalPrice} ${colorCodes.yellow}金币`,
                }, callback);
            }
            catch (error) {
                // 如果出错，尝试退款
                economic.transfer(entry.data.playerName, player.name, totalPrice, "购买失败退款");
                return `购买失败: ${error}`;
            }
        });
    }
    /**
     * 检查条目是否有效
     */
    isValid(entry) {
        return entry.itemDB.isValid();
    }
    /**
     * 取回物品，不保留数据库中的原条目
     */
    takeItem(entry) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield entry.itemDB.unStore(false);
        });
    }
    /**
     * 遍历所有商店条目
     */
    forEach(callback) {
        this.shopDB.forEach((dbItem) => {
            const entry = {
                item: dbItem.data.item,
                data: dbItem.data,
                itemDB: dbItem,
            };
            callback(entry);
        });
    }
    /**
     * 获取所有商店物品
     */
    getItems() {
        const items = [];
        this.forEach((entry) => items.push(entry));
        return items;
    }
    /**
     * 获取指定玩家的商店物品
     */
    getPlayerItems(playerName) {
        return this.getItems().filter((item) => item.data.playerName === playerName);
    }
}
// 导出单例
const auctionHouse = new AuctionHouse();
export default auctionHouse;
//# sourceMappingURL=AuctionHouse.js.map