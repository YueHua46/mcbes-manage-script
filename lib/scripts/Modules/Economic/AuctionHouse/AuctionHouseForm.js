import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import auctionHouse from "./AuctionHouse";
import ChestFormData from "../../ChestUI/ChestForms";
import { openDialogForm } from "../../Forms/Dialog";
import { color } from "@mcbe-mods/utils";
import { getItemDisplayName, getItemDurabilityPercent, hasAnyEnchantment } from "../../../utils/utils";
import { openEconomyMenuForm } from "../Forms";
import { colorCodes } from "../../../utils/color";
/**
 * 拍卖行UI管理类
 */
class AuctionHouseForm {
    /**
     * 打开主界面
     */
    openMainMenu(player) {
        const form = new ActionFormData()
            .title("拍卖行")
            .body(`${colorCodes.green}欢迎来到拍卖行！这里有全服玩家正在出售的物品。`)
            .button("浏览所有商品", "textures/packs/12065264")
            .button("我的上架商品", "textures/packs/16329456")
            .button("上架新商品", "textures/packs/14827849")
            .button("返回", "textures/icons/back");
        form.show(player).then((response) => {
            if (response.canceled)
                return;
            switch (response.selection) {
                case 0:
                    this.browseItems(player);
                    break;
                case 1:
                    this.myListedItems(player);
                    break;
                case 2:
                    this.showListItemForm(player);
                    break;
                case 3:
                    openEconomyMenuForm(player);
                    break;
            }
        });
    }
    /**
     * 浏览所有商品
     */
    browseItems(player, page = 1) {
        const items = auctionHouse.getItems();
        if (items.length === 0) {
            openDialogForm(player, {
                title: "商店为空",
                desc: "当前没有任何上架的商品",
            }, () => this.openMainMenu(player));
            return;
        }
        // 计算分页信息
        const itemsPerPage = 45; // 箱子UI每页最多显示45个物品
        const totalPages = Math.ceil(items.length / itemsPerPage);
        const startIndex = (page - 1) * itemsPerPage;
        const endIndex = Math.min(startIndex + itemsPerPage, items.length);
        const currentPageItems = items.slice(startIndex, endIndex);
        const form = new ChestFormData("shop").title(`拍卖会 - 所有商品 (第${page}/${totalPages}页)`);
        // 填充商品
        currentPageItems.forEach((item, index) => {
            const lore = [
                `§e价格: §f${item.data.price}`,
                `§e卖家: §f${item.data.playerName}`,
                `§e上架时间: §f${new Date(item.data.createdAt).toLocaleString()}`,
            ];
            if (item.data.description) {
                lore.push(`§e描述: §f${item.data.description}`);
            }
            form.button(index, getItemDisplayName(item.item), lore, item.item.typeId, item.data.amount, Number(getItemDurabilityPercent(item.item)), hasAnyEnchantment(item.item));
        });
        // 添加导航按钮
        if (page > 1) {
            form.button(45, "上一页", ["查看上一页商品"], "textures/icons/left_arrow", 1);
        }
        form.button(49, "返回", ["返回主菜单"], "textures/icons/back", 1);
        if (page < totalPages) {
            form.button(53, "下一页", ["查看下一页商品"], "textures/icons/right_arrow", 1);
        }
        form.show(player).then((response) => {
            if (response.canceled)
                return;
            const selection = response.selection;
            if (selection === undefined)
                return;
            // 处理导航按钮
            if (selection === 45 && page > 1) {
                // 上一页
                return this.browseItems(player, page - 1);
            }
            else if (selection === 49) {
                // 返回
                return this.openMainMenu(player);
            }
            else if (selection === 53 && page < totalPages) {
                // 下一页
                return this.browseItems(player, page + 1);
            }
            // 处理商品选择
            if (selection < currentPageItems.length) {
                const selectedItem = currentPageItems[selection];
                if (selectedItem) {
                    this.showItemDetails(player, selectedItem);
                }
            }
        });
    }
    /**
     * 显示我的上架商品
     */
    myListedItems(player, page = 1) {
        const items = auctionHouse.getPlayerItems(player.name);
        if (items.length === 0) {
            openDialogForm(player, {
                title: "没有上架商品",
                desc: "您当前没有上架任何商品",
            }, () => this.openMainMenu(player));
            return;
        }
        // 计算分页信息
        const itemsPerPage = 45; // 箱子UI每页最多显示45个物品
        const totalPages = Math.ceil(items.length / itemsPerPage);
        const startIndex = (page - 1) * itemsPerPage;
        const endIndex = Math.min(startIndex + itemsPerPage, items.length);
        const currentPageItems = items.slice(startIndex, endIndex);
        const form = new ChestFormData("shop").title(`我的上架商品 (第${page}/${totalPages}页)`);
        // 填充商品
        currentPageItems.forEach((item, index) => {
            const lore = [`§e价格: §f${item.data.price}`, `§e上架时间: §f${new Date(item.data.createdAt).toLocaleString()}`];
            if (item.data.description) {
                lore.push(`§e描述: §f${item.data.description}`);
            }
            form.button(index, getItemDisplayName(item.item), lore, item.item.typeId, item.data.amount, Number(getItemDurabilityPercent(item.item)), hasAnyEnchantment(item.item));
        });
        // 添加导航按钮
        if (page > 1) {
            form.button(45, "上一页", ["查看上一页商品"], "textures/icons/left_arrow", 1);
        }
        form.button(49, "返回", ["返回主菜单"], "textures/icons/back", 1);
        if (page < totalPages) {
            form.button(53, "下一页", ["查看下一页商品"], "textures/icons/right_arrow", 1);
        }
        form.show(player).then((response) => {
            if (response.canceled)
                return;
            const selection = response.selection;
            if (selection === undefined)
                return;
            // 处理导航按钮
            if (selection === 45 && page > 1) {
                // 上一页
                return this.myListedItems(player, page - 1);
            }
            else if (selection === 49) {
                // 返回
                return this.openMainMenu(player);
            }
            else if (selection === 53 && page < totalPages) {
                // 下一页
                return this.myListedItems(player, page + 1);
            }
            // 处理商品选择
            if (selection < currentPageItems.length) {
                const selectedItem = currentPageItems[selection];
                if (selectedItem) {
                    this.showMyItemDetails(player, selectedItem);
                }
            }
        });
    }
    /**
     * 显示商品详情
     */
    showItemDetails(player, item) {
        const form = new ActionFormData();
        const body = {
            rawtext: [
                getItemDisplayName(item.item),
                {
                    text: `\n§e数量: §f${item.data.amount}\n§e价格: §f${item.data.price}\n§e卖家: §f${item.data.playerName}\n§e上架时间: §f${new Date(item.data.createdAt).toLocaleString()}\n`,
                },
            ],
        };
        form
            .title(`拍卖会 - 购买物品 - ${item.data.name}`)
            .body(body)
            .button("购买", "textures/packs/15174544")
            .button("返回", "textures/icons/back");
        form.show(player).then((response) => {
            if (response.canceled)
                return;
            // 购买
            if (response.selection === 0) {
                auctionHouse.buyItem(player, item, () => {
                    this.browseItems(player);
                });
                // .then((result) => {
                //   if (typeof result === "string") {
                //     openDialogForm(
                //       player,
                //       {
                //         title: "购买失败",
                //         desc: result,
                //       },
                //       () => this.showItemDetails(player, item)
                //     );
                //   }
                // });
            }
            else {
                this.browseItems(player);
            }
        });
    }
    /**
     * 显示我的商品详情
     */
    showMyItemDetails(player, item) {
        const body = {
            rawtext: [
                getItemDisplayName(item.item),
                {
                    text: `\n§e数量: §f${item.data.amount}\n§e价格: §f${item.data.price}\n§e卖家: §f${item.data.playerName}\n§e上架时间: §f${new Date(item.data.createdAt).toLocaleString()}\n`,
                },
            ],
        };
        const form = new ActionFormData()
            .title(item.data.name)
            .body(body)
            .button("下架", "textures/ui/icon_trash")
            .button("返回", "textures/icons/back");
        form.show(player).then((response) => {
            if (response.canceled)
                return;
            if (response.selection === 1) {
                this.myListedItems(player);
                return;
            }
            // 下架
            if (response.selection === 0) {
                auctionHouse.unlistItem(player, item, () => {
                    this.myListedItems(player);
                });
            }
        });
    }
    /**
     * 显示上架物品表单
     */
    showListItemForm(player) {
        // 获取玩家背包
        const inventory = player.getComponent("inventory");
        if (!inventory) {
            openDialogForm(player, {
                title: "错误",
                desc: "无法获取玩家背包",
            }, () => this.openMainMenu(player));
            return;
        }
        // 使用ChestUI显示玩家背包中的所有物品
        const chestForm = new ChestFormData("shop");
        chestForm.title("选择要上架的物品");
        // 渲染玩家背包内容到ChestUI
        const container = inventory.container;
        for (let i = 0; i < container.size; i++) {
            const item = container.getItem(i);
            if (item) {
                const durability = item.getComponent("minecraft:durability");
                const lores = [`§e数量: §f${item.amount}`, `§e耐久: §f${getItemDurabilityPercent(item)}`];
                chestForm.button(i, getItemDisplayName(item), lores, item.typeId, item.amount, (durability === null || durability === void 0 ? void 0 : durability.damage) || 0, hasAnyEnchantment(item));
            }
        }
        // 添加返回按钮
        chestForm.button(49, "返回", ["§7返回上一级"], "textures/icons/back");
        // 显示表单
        chestForm.show(player).then((data) => {
            if (data.canceled) {
                return;
            }
            const slotIndex = data.selection;
            if (slotIndex === undefined)
                return;
            // 处理返回按钮
            if (slotIndex === 49) {
                this.openMainMenu(player);
                return;
            }
            // 获取选中的物品
            const selectedItem = container.getItem(slotIndex);
            if (!selectedItem) {
                openDialogForm(player, {
                    title: "错误",
                    desc: "无法获取物品信息",
                }, () => this.showListItemForm(player));
                return;
            }
            // 显示上架表单
            this.showItemListingForm(player, selectedItem, slotIndex);
        });
    }
    /**
     * 显示物品上架详情表单
     */
    showItemListingForm(player, item, slot) {
        const form = new ModalFormData()
            .title(`上架物品`)
            .textField(`物品名称`, "请输入物品名称")
            .textField(`物品描述`, "请输入物品描述", {
            defaultValue: "",
            tooltip: "请输入物品描述",
        })
            .slider("数量", 1, item.amount, {
            defaultValue: 1,
            valueStep: 1,
            tooltip: `数量: ${item.amount}`,
        })
            .textField("价格", "请输入价格", {
            defaultValue: "1",
            tooltip: "请输入价格",
        });
        form.show(player).then((response) => {
            if (response.canceled)
                return;
            const [name, desc, amount, priceStr] = response.formValues;
            if (!name) {
                openDialogForm(player, {
                    title: "错误",
                    desc: color.red("请输入物品名称"),
                }, () => this.showItemListingForm(player, item, slot));
                return;
            }
            const price = parseInt(priceStr);
            if (isNaN(price) || price <= 0) {
                openDialogForm(player, {
                    title: "错误",
                    desc: "请输入有效的价格",
                }, () => this.showItemListingForm(player, item, slot));
                return;
            }
            // 上架物品
            auctionHouse.listItem(player, item, price, amount, name, desc, () => this.openMainMenu(player));
        });
    }
}
export default new AuctionHouseForm();
//# sourceMappingURL=AuctionHouseForm.js.map