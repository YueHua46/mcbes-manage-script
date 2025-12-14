/**
 * 拍卖行表单
 * 完整迁移自 Modules/Economic/AuctionHouse/AuctionHouseForm.ts (490行)
 * 注意：依赖ChestUI系统显示物品列表
 */

import { ItemStack, Player, RawMessage } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import auctionHouse, { ShopItem } from "../../../features/economic/services/auction-house";
import economic from "../../../features/economic/services/economic";
import ChestFormData from "../../../ui/components/chest-ui/chest-forms";
import { openDialogForm } from "../../components/dialog";
import { colorCodes } from "../../../shared/utils/color";

import { ChestUIUtility } from "../../components/chest-ui";
import Utility from "../../components/chest-ui/utility";
const { getItemDisplayName, getItemDurabilityPercent, hasAnyEnchantment } = Utility;

class AuctionHouseForm {
  /**
   * 打开主界面
   */
  openMainMenu(player: Player): void {
    const { openEconomyMenuForm } = require("./index");
    const form = new ActionFormData()
      .title("拍卖行")
      .body(`${colorCodes.green}欢迎来到拍卖行！这里有全服玩家正在出售的物品。`)
      .button("浏览所有商品", "textures/icons/quest_chest")
      .button("我的上架商品", "textures/icons/sandik")
      .button("上架新商品", "textures/icons/add")
      .button("返回", "textures/icons/back");

    form.show(player).then((response) => {
      if (response.canceled) return;

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
  browseItems(player: Player, page: number = 1): void {
    const items = auctionHouse.getItems();

    if (items.length === 0) {
      openDialogForm(player, { title: "商店为空", desc: "当前没有任何上架的商品" }, () => this.openMainMenu(player));
      return;
    }

    const itemsPerPage = 45;
    const totalPages = Math.ceil(items.length / itemsPerPage);
    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, items.length);
    const currentPageItems = items.slice(startIndex, endIndex);

    const chestForm = new ChestFormData("shop").title(`拍卖会 - 所有商品 (第${page}/${totalPages}页)`);

    currentPageItems.forEach((item, index) => {
      const lore = [
        `${colorCodes.gold}单价: ${colorCodes.yellow}${item.data.price}`,
        `${colorCodes.aqua}卖家: ${colorCodes.white}${item.data.playerName}`,
        `${colorCodes.green}上架时间: ${colorCodes.white}${new Date(item.data.createdAt).toLocaleString()}`,
      ];

      if (item.data.description) {
        lore.push(`${colorCodes.lightPurple}描述: ${colorCodes.white}${item.data.description}`);
      }

      chestForm.button(
        index,
        getItemDisplayName(item.item),
        lore,
        item.item.typeId,
        item.data.amount,
        Number(getItemDurabilityPercent(item.item)),
        hasAnyEnchantment(item.item)
      );
    });

    if (page > 1) {
      chestForm.button(45, "上一页", ["查看上一页商品"], "textures/icons/left_arrow", 1);
    }
    chestForm.button(49, "返回", ["返回主菜单"], "textures/icons/back", 1);
    if (page < totalPages) {
      chestForm.button(53, "下一页", ["查看下一页商品"], "textures/icons/right_arrow", 1);
    }

    chestForm.show(player).then((response) => {
      if (response.canceled) return;

      const selection = response.selection;
      if (selection === undefined) return;

      if (selection === 45 && page > 1) {
        return this.browseItems(player, page - 1);
      } else if (selection === 49) {
        return this.openMainMenu(player);
      } else if (selection === 53 && page < totalPages) {
        return this.browseItems(player, page + 1);
      }

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
  myListedItems(player: Player, page: number = 1): void {
    const items = auctionHouse.getPlayerItems(player.name);

    if (items.length === 0) {
      openDialogForm(player, { title: "没有上架商品", desc: "您当前没有上架任何商品" }, () =>
        this.openMainMenu(player)
      );
      return;
    }

    const itemsPerPage = 45;
    const totalPages = Math.ceil(items.length / itemsPerPage);
    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, items.length);
    const currentPageItems = items.slice(startIndex, endIndex);

    const chestForm = new ChestFormData("shop").title(`我的上架商品 (第${page}/${totalPages}页)`);

    currentPageItems.forEach((item, index) => {
      const lore = [
        `${colorCodes.gold}单价: ${colorCodes.yellow}${item.data.price}`,
        `${colorCodes.green}上架时间: ${colorCodes.white}${new Date(item.data.createdAt).toLocaleString()}`,
      ];

      chestForm.button(
        index,
        getItemDisplayName(item.item),
        lore,
        item.item.typeId,
        item.data.amount,
        Number(getItemDurabilityPercent(item.item)),
        hasAnyEnchantment(item.item)
      );
    });

    if (page > 1) {
      chestForm.button(45, "上一页", ["查看上一页商品"], "textures/icons/left_arrow", 1);
    }
    chestForm.button(49, "返回", ["返回主菜单"], "textures/icons/back", 1);
    if (page < totalPages) {
      chestForm.button(53, "下一页", ["查看下一页商品"], "textures/icons/right_arrow", 1);
    }

    chestForm.show(player).then((response) => {
      if (response.canceled) return;

      const selection = response.selection;
      if (selection === undefined) return;

      if (selection === 45 && page > 1) {
        return this.myListedItems(player, page - 1);
      } else if (selection === 49) {
        return this.openMainMenu(player);
      } else if (selection === 53 && page < totalPages) {
        return this.myListedItems(player, page + 1);
      }

      if (selection < currentPageItems.length) {
        const selectedItem = currentPageItems[selection];
        if (selectedItem) {
          this.showMyItemDetails(player, selectedItem);
        }
      }
    });
  }

  /**
   * 显示物品详情
   */
  private showItemDetails(player: Player, item: ShopItem): void {
    const form = new ActionFormData()
      .title("商品详情")
      .body(
        `${colorCodes.gold}商品名称: ${colorCodes.white}${item.data.name}\n` +
          `${colorCodes.aqua}卖家: ${colorCodes.white}${item.data.playerName}\n` +
          `${colorCodes.gold}单价: ${colorCodes.yellow}${item.data.price} 金币\n` +
          `${colorCodes.gold}数量: ${colorCodes.yellow}${item.data.amount}\n` +
          `${colorCodes.gold}总价: ${colorCodes.yellow}${item.data.price * item.data.amount} 金币`
      )
      .button("购买", "textures/ui/confirm")
      .button("返回", "textures/icons/back");

    form.show(player).then((response) => {
      if (response.canceled) return;

      if (response.selection === 0) {
        this.showBuyConfirmation(player, item);
      } else {
        this.browseItems(player);
      }
    });
  }

  /**
   * 显示我的商品详情
   */
  private showMyItemDetails(player: Player, item: ShopItem): void {
    const form = new ActionFormData()
      .title("我的商品")
      .body(
        `${colorCodes.gold}商品名称: ${colorCodes.white}${item.data.name}\n` +
          `${colorCodes.gold}单价: ${colorCodes.yellow}${item.data.price} 金币\n` +
          `${colorCodes.gold}数量: ${colorCodes.yellow}${item.data.amount}`
      )
      .button("下架", "textures/ui/cancel")
      .button("返回", "textures/icons/back");

    form.show(player).then((response) => {
      if (response.canceled) return;

      if (response.selection === 0) {
        auctionHouse.unlistItem(player, item, () => this.myListedItems(player));
      } else {
        this.myListedItems(player);
      }
    });
  }

  /**
   * 显示购买确认
   */
  private showBuyConfirmation(player: Player, item: ShopItem): void {
    const totalPrice = item.data.price * item.data.amount;

    const form = new ActionFormData()
      .title("确认购买")
      .body(
        `${colorCodes.green}您确定要购买 ${colorCodes.yellow}${item.data.amount} ${colorCodes.green}个 ${colorCodes.aqua}${item.data.name}${colorCodes.green} 吗？\n` +
          `${colorCodes.gold}总价: ${colorCodes.yellow}${totalPrice} 金币`
      )
      .button("确认购买", "textures/icons/accept")
      .button("取消", "textures/icons/deny");

    form.show(player).then((response) => {
      if (response.canceled || response.selection === 1) {
        this.showItemDetails(player, item);
        return;
      }

      auctionHouse.buyItem(player, item, item.data.amount, () => this.browseItems(player));
    });
  }

  /**
   * 显示上架物品表单
   */
  showListItemForm(player: Player): void {
    const inventory = player.getComponent("inventory");
    if (!inventory) {
      openDialogForm(player, { title: "错误", desc: "无法获取玩家背包" }, () => this.openMainMenu(player));
      return;
    }

    const chestForm = new ChestFormData("shop");
    chestForm.title("选择要上架的物品");

    const container = inventory.container;
    let hasItems = false;

    for (let i = 0; i < container.size; i++) {
      const item = container.getItem(i);
      if (item && item.typeId !== "yuehua:sm") {
        hasItems = true;
        const lores: string[] = [`§e数量: §f${item.amount}`, `§e耐久: §f${getItemDurabilityPercent(item)}`];

        chestForm.button(
          i,
          getItemDisplayName(item),
          lores,
          item.typeId,
          item.amount,
          Number(getItemDurabilityPercent(item)),
          hasAnyEnchantment(item)
        );
      }
    }

    if (!hasItems) {
      openDialogForm(player, { title: "背包为空", desc: "您的背包中没有可上架的物品" }, () =>
        this.openMainMenu(player)
      );
      return;
    }

    chestForm.button(49, "返回", ["§7返回上一级"], "textures/icons/back");

    chestForm.show(player).then((data) => {
      if (data.canceled) return;

      const slotIndex = data.selection;
      if (slotIndex === undefined) return;

      if (slotIndex === 49) {
        this.openMainMenu(player);
        return;
      }

      const selectedItem = container.getItem(slotIndex);
      if (!selectedItem) {
        openDialogForm(player, { title: "错误", desc: "无法获取物品信息" }, () => this.showListItemForm(player));
        return;
      }

      this.showItemListingForm(player, selectedItem, slotIndex);
    });
  }

  /**
   * 显示物品上架详情表单
   */
  private showItemListingForm(player: Player, item: ItemStack, slot: number): void {
    const form = new ModalFormData()
      .title(`上架物品`)
      .textField(`物品名称`, "请输入物品名称", {
        defaultValue: "",
      })
      .textField(`物品描述`, "请输入物品描述（可选）", {
        defaultValue: "",
      })
      .slider("数量", 1, item.amount, {
        defaultValue: 1,
        valueStep: 1,
      })
      .textField("单价", "请输入单价（金币）", {
        defaultValue: "100",
      });

    form.show(player).then((response) => {
      if (response.canceled) {
        this.showListItemForm(player);
        return;
      }

      const [name, desc, amount, priceStr] = response.formValues as [string, string, number, string];
      if (!name) {
        openDialogForm(player, { title: "错误", desc: `${colorCodes.red}请输入物品名称` }, () =>
          this.showItemListingForm(player, item, slot)
        );
        return;
      }

      const price = parseInt(priceStr);
      if (isNaN(price) || price <= 0) {
        openDialogForm(player, { title: "错误", desc: `${colorCodes.red}请输入有效的价格` }, () =>
          this.showItemListingForm(player, item, slot)
        );
        return;
      }

      auctionHouse.listItem(player, item, price, amount, name, desc, () => this.openMainMenu(player));
    });
  }
}

const ahf = new AuctionHouseForm();
export default ahf;
