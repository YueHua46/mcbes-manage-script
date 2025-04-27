import * as mc from "@minecraft/server";
import { Database } from "../Database";
import { ModalFormData } from "@minecraft/server-ui";
import { openDialogForm } from "../Forms/Dialog";
import { color } from "../../utils/color";
/**
 * 箱子商店管理类
 * 用于创建、获取和管理箱子商店
 */
class ChestShopManager {
    /**
     * 构造函数，初始化数据库
     */
    constructor() {
        this.db = new Database("chestShopDB");
    }
    /**
     * 创建一个箱子商店
     * @param player 创建商店的玩家
     * @param sign 商店的告示牌
     * @param chest 商店的箱子
     * @param data 商店数据
     */
    createChestShop(player, sign, chest, data) {
        // 创建完整的商店数据
        const shopData = Object.assign(Object.assign({}, data), { signLocation: sign.location, chestLocation: chest.location, playerName: player.name });
        // 生成唯一键并存储商店数据
        this.db.set(`${player.name}${Object.keys(sign.location)
            .map((l) => sign.location[l])
            .join("|")}`, shopData);
    }
    /**
     * 获取箱子商店数据
     * @param key 商店唯一标识
     * @returns 商店数据
     */
    getChestShop(key) {
        return this.db.get(key);
    }
    /**
     * 获取所有箱子商店
     * @returns 所有商店数据
     */
    getAllChestShops() {
        return this.db.getAll();
    }
    /**
     * 删除箱子商店
     * @param key 商店唯一标识
     */
    deleteChestShop(key) {
        this.db.delete(key);
    }
}
/**
 * 获取方块周围的箱子
 * @param block 中心方块
 * @returns 找到的箱子方块，如果没有则返回undefined
 */
const getChestAround = (block) => {
    // 检查四个方向
    const checkDirections = ["east", "north", "south", "west"];
    for (const direction of checkDirections) {
        const adjacentBlock = block[direction]();
        // 检查是否有物品栏组件（箱子有这个组件）
        if (adjacentBlock === null || adjacentBlock === void 0 ? void 0 : adjacentBlock.getComponent("inventory")) {
            return adjacentBlock;
        }
    }
    return undefined;
};
// 注册方块交互事件，处理商店创建
mc.world.beforeEvents.playerInteractWithBlock.subscribe((data) => __awaiter(void 0, void 0, void 0, function* () {
    const { block, player, itemStack } = data;
    // 检查是否与告示牌交互且告示牌文本为"createshop"
    const signComponent = block.getComponent("minecraft:sign");
    if (signComponent && signComponent.getText() === "createshop") {
        data.cancel = true;
        yield null;
        // 检查玩家是否手持物品
        if (!itemStack) {
            return player.sendMessage(color.red("请手持你想要出售的物品！"));
        }
        // 查找附近的箱子
        const chest = getChestAround(block);
        if (!chest) {
            return player.sendMessage(color.red("找不到箱子！请确保箱子与告示牌相邻。"));
        }
        // 创建商店UI
        const shopTypes = ["出售", "购买"];
        const createChestShopUI = new ModalFormData()
            .title("箱子商店")
            .dropdown("商店类型", shopTypes)
            .textField("价格", "请输入价格");
        // 显示UI并处理结果
        createChestShopUI.show(player).then((res) => {
            if (res.canceled || res.cancelationReason)
                return;
            const formValues = res.formValues;
            if (!formValues)
                return;
            let [typeIndex, price] = formValues;
            const type = shopTypes[typeIndex];
            // 验证价格
            if (price === "") {
                return openDialogForm(player, {
                    title: "创建失败",
                    desc: color.red("您必须完成表单！"),
                });
            }
            const numericPrice = Number(price);
            if (!Number.isSafeInteger(numericPrice) || numericPrice < 1) {
                return openDialogForm(player, {
                    title: "创建失败",
                    desc: color.red("您必须输入有效的价格！"),
                });
            }
            // 创建箱子商店
            chestShop.createChestShop(player, block, chest, {
                itemId: itemStack.typeId,
                type,
                price: numericPrice,
            });
            // 显示成功消息
            openDialogForm(player, {
                title: "创建成功",
                desc: color.green(`成功创建${type}商店，价格: ${numericPrice}`),
            });
        });
    }
}));
// 防止破坏商店方块
mc.world.beforeEvents.playerBreakBlock.subscribe((data) => {
    const { block, player } = data;
    // TODO: 检查是否为商店方块，如果是则阻止破坏
    // 这里需要实现检查逻辑
});
// 创建并导出箱子商店管理器实例
const chestShop = new ChestShopManager();
export default chestShop;
//# sourceMappingURL=ChestShop.js.map