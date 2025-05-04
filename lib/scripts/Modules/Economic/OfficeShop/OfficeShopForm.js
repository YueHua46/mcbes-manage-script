import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import officeShop from "./OfficeShop";
import ChestFormData from "../../ChestUI/ChestForms";
import { openDialogForm } from "../../Forms/Dialog";
import economic from "../Economic";
import { getItemDisplayName, getItemDurability, hasAnyEnchantment } from "../../../utils/utils";
import { openEconomyMenuForm } from "../Forms";
class OfficeShopForm {
    constructor() { }
    static getInstance() {
        if (!OfficeShopForm.instance) {
            OfficeShopForm.instance = new OfficeShopForm();
        }
        return OfficeShopForm.instance;
    }
    // 打开分类列表
    openCategoryList(player, page = 1) {
        const categories = officeShop.getCategories();
        if (categories.length === 0) {
            openDialogForm(player, {
                title: "商店为空",
                desc: "当前没有任何商品类别",
            }, () => openEconomyMenuForm(player));
            return;
        }
        // 计算分页信息
        const itemsPerPage = 45; // 箱子UI每页最多显示45个物品
        const totalPages = Math.ceil(categories.length / itemsPerPage);
        const startIndex = (page - 1) * itemsPerPage;
        const endIndex = Math.min(startIndex + itemsPerPage, categories.length);
        const currentPageCategories = categories.slice(startIndex, endIndex);
        const form = new ChestFormData("shop").title(`官方商店 - 商品类别 (第${page}/${totalPages}页)`);
        // 填充类别
        currentPageCategories.forEach((category, index) => {
            const lore = [
                `§e描述: §f${category.description || "无描述"}`,
                `§e创建时间: §f${new Date(category.created).toLocaleString()}`,
            ];
            form.button(index, category.name, lore, category.icon || officeShop.defaultIcon, 1, 0, false);
        });
        // 添加导航按钮
        if (page > 1) {
            form.button(45, "上一页", ["查看上一页"], "textures/icons/left_arrow", 1);
        }
        form.button(49, "返回", ["返回主菜单"], "textures/icons/back", 1);
        if (page < totalPages) {
            form.button(53, "下一页", ["查看下一页"], "textures/icons/right_arrow", 1);
        }
        form.show(player).then((response) => {
            if (response.canceled) {
                this.openCategoryList(player);
                return;
            }
            const selection = response.selection;
            if (selection === undefined)
                return;
            // 处理导航按钮
            if (selection === 45 && page > 1) {
                // 上一页
                return this.openCategoryList(player, page - 1);
            }
            else if (selection === 49) {
                // 返回
                return this.openCategoryList(player);
            }
            else if (selection === 53 && page < totalPages) {
                // 下一页
                return this.openCategoryList(player, page + 1);
            }
            // 处理类别选择
            if (selection < currentPageCategories.length) {
                const selectedCategory = currentPageCategories[selection];
                if (selectedCategory) {
                    this.openCategoryProducts(player, selectedCategory.name);
                }
            }
        });
    }
    // 打开类别商品列表
    openCategoryProducts(player, categoryName, page = 1) {
        const itemDatas = officeShop.getCategoryItems(categoryName);
        const category = officeShop.getCategory(categoryName);
        if (!category) {
            openDialogForm(player, {
                title: "错误",
                desc: "商品类别不存在",
            }, () => this.openCategoryList(player));
            return;
        }
        if (itemDatas.length === 0) {
            openDialogForm(player, {
                title: `${category.name}`,
                desc: "该类别下暂无商品",
            }, () => this.openCategoryList(player));
            return;
        }
        // 计算分页信息
        const itemsPerPage = 45; // 箱子UI每页最多显示45个物品
        const totalPages = Math.ceil(itemDatas.length / itemsPerPage);
        const startIndex = (page - 1) * itemsPerPage;
        const endIndex = Math.min(startIndex + itemsPerPage, itemDatas.length);
        const currentPageProducts = itemDatas.slice(startIndex, endIndex);
        const form = new ChestFormData("shop").title(`${category.name} - 商品列表 (第${page}/${totalPages}页)`);
        // 填充商品
        currentPageProducts.forEach((itemData, index) => {
            const displayName = getItemDisplayName(itemData.item);
            const lores = itemData.item.getLore();
            const itemIconPath = `textures/ui/${itemData.item.typeId}`;
            const amount = itemData.item.amount;
            const durability = getItemDurability(itemData.item);
            const isEnchanted = hasAnyEnchantment(itemData.item);
            form.button(index, displayName, lores, itemIconPath, amount, durability, isEnchanted);
        });
        // 添加导航按钮
        if (page > 1) {
            form.button(45, "上一页", ["查看上一页商品"], "textures/icons/left_arrow", 1);
        }
        form.button(49, "返回", ["返回类别列表"], "textures/icons/back", 1);
        if (page < totalPages) {
            form.button(53, "下一页", ["查看下一页商品"], "textures/icons/right_arrow", 1);
        }
        form.show(player).then((response) => {
            if (response.canceled) {
                this.openCategoryList(player);
                return;
            }
            const selection = response.selection;
            if (selection === undefined)
                return;
            // 处理导航按钮
            if (selection === 45 && page > 1) {
                // 上一页
                return this.openCategoryProducts(player, categoryName, page - 1);
            }
            else if (selection === 49) {
                // 返回
                return this.openCategoryList(player);
            }
            else if (selection === 53 && page < totalPages) {
                // 下一页
                return this.openCategoryProducts(player, categoryName, page + 1);
            }
            // 处理商品选择
            if (selection < currentPageProducts.length) {
                const selectedProduct = currentPageProducts[selection];
                if (selectedProduct) {
                    this.showProductDetails(player, selectedProduct);
                }
            }
        });
    }
    /** 1. 先让玩家选数量 */
    askBuyQuantity(player, item) {
        const maxAmount = item.data.amount;
        const modal = new ModalFormData()
            .title(`购买 - ${getItemDisplayName(item.item)}`)
            .slider("选择购买数量", 1, maxAmount, {
            defaultValue: 1,
            valueStep: 1,
            tooltip: `当前最大可购买数量: ${maxAmount}`,
        });
        modal
            .show(player)
            .then((res) => {
            if (!res.formValues)
                return;
            const qty = res.formValues[0];
            this.executePurchase(player, item, qty);
        })
            .catch(console.error);
    }
    /** 2. 真正的购买逻辑 */
    executePurchase(player, item, qty) {
        var _a;
        // 库存 & 余额检查
        if (qty > item.data.amount) {
            openDialogForm(player, { title: "失败", desc: "库存不足" }, () => this.showProductDetails(player, item));
            return;
        }
        const totalPrice = item.data.price * qty;
        const wallet = economic.getWallet(player.name);
        if (wallet.gold < totalPrice) {
            openDialogForm(player, { title: "失败", desc: "余额不足" }, () => this.showProductDetails(player, item));
            return;
        }
        // 扣款
        const result = economic.removeGold(player.name, totalPrice, `商店购买 x${qty}`);
        if (typeof result === "string") {
            openDialogForm(player, { title: "失败", desc: result }, () => this.showProductDetails(player, item));
            return;
        }
        // 发物
        try {
            const inv = (_a = player.getComponent("inventory")) === null || _a === void 0 ? void 0 : _a.container;
            for (let i = 0; i < qty; i++)
                inv === null || inv === void 0 ? void 0 : inv.addItem(item.item);
        }
        catch (e) {
            console.error("发物失败", e);
        }
        // 更新库存
        officeShop.updateItemMeta(item.data, Object.assign(Object.assign({}, item.data), { amount: item.data.amount - qty }));
        // 成功提示
        openDialogForm(player, { title: "成功", desc: `已购买 ${getItemDisplayName(item.item)} x${qty}` }, () => this.openCategoryProducts(player, item.data.category));
    }
    // 展示商品详细购买页
    showProductDetails(player, item) {
        const displayName = getItemDisplayName(item.item);
        const lores = item.item.getLore();
        const durability = getItemDurability(item.item);
        const isEnchanted = hasAnyEnchantment(item.item);
        const wallet = economic.getWallet(player.name);
        const form = new ActionFormData()
            .title(`商品详细 - ${displayName}`)
            .body(`§e商品: §f${displayName}\n` +
            `§e描述: §f${lores.join("\n")}\n` +
            `§e单价: §f${item.data.price}\n` +
            `§e库存: §f${item.data.amount}\n` +
            `§e耐久: §f${durability}\n` +
            `§e附魔: §f${isEnchanted ? "有" : "无"}\n\n` +
            `§7您的余额: §f${wallet.gold}`)
            .button("购买", "textures/ui/icon_book_writable")
            .button("返回", "textures/ui/arrow_left");
        form
            .show(player)
            .then((res) => {
            if (res.canceled || res.selection === 1) {
                this.openCategoryProducts(player, item.data.category);
            }
            else {
                this.askBuyQuantity(player, item);
            }
        })
            .catch(console.error);
    }
}
export const officeShopForm = OfficeShopForm.getInstance();
//# sourceMappingURL=OfficeShopForm.js.map