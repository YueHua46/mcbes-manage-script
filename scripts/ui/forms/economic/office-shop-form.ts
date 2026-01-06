/**
 * 官方商店表单
 * 完整迁移自 Modules/Economic/OfficeShop/OfficeShopForm.ts (363行)
 * 注意：依赖ChestUI系统显示商品列表
 */

import { ItemStack, Player, RawMessage } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import officeShop, { ICategory, OfficeShopItemData } from "../../../features/economic/services/office-shop";
import ChestFormData from "../../../ui/components/chest-ui/chest-forms";
import { openDialogForm } from "../../components/dialog";
import economic from "../../../features/economic/services/economic";
import { colorCodes } from "../../../shared/utils/color";

import { ChestUIUtility } from "../../components/chest-ui";
import { SystemLog } from "../../../shared";
const { getItemDisplayName, getItemDurability, hasAnyEnchantment } = ChestUIUtility;

class OfficeShopForm {
  private static instance: OfficeShopForm;

  private constructor() {}

  public static getInstance(): OfficeShopForm {
    if (!OfficeShopForm.instance) {
      OfficeShopForm.instance = new OfficeShopForm();
    }
    return OfficeShopForm.instance;
  }

  /**
   * 打开分类列表
   */
  openCategoryList(player: Player, page: number = 1): void {
    const { openEconomyMenuForm } = require("./index");
    const categories = officeShop.getCategories();

    if (categories.length === 0) {
      openDialogForm(player, { title: "商店为空", desc: "当前没有任何商品类别，请联系管理员添加！" }, () =>
        openEconomyMenuForm(player)
      );
      return;
    }

    const itemsPerPage = 8;
    const totalPages = Math.ceil(categories.length / itemsPerPage);
    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, categories.length);
    const currentPageCategories = categories.slice(startIndex, endIndex);

    const form = new ActionFormData().title(`官方商店 - 商品类别 (第${page}/${totalPages}页)`);

    form.body("请选择您要浏览的商品类别");

    currentPageCategories.forEach((category) => {
      const buttonText = `${category.name}\n§e${category.description || "无描述"}`;
      form.button(buttonText, category.icon || officeShop.defaultIcon);
    });

    if (page > 1) {
      form.button("上一页", "textures/icons/left_arrow");
    }

    form.button("返回主菜单", "textures/icons/back");

    if (page < totalPages) {
      form.button("下一页", "textures/icons/right_arrow");
    }

    form.show(player).then((response) => {
      if (response.canceled) return;

      const selection = response.selection;
      if (selection === undefined) return;

      const categoryCount = currentPageCategories.length;
      const prevPageIndex = categoryCount;
      const backIndex = page > 1 ? prevPageIndex + 1 : prevPageIndex;
      const nextPageIndex = page > 1 ? backIndex + 1 : backIndex + 1;

      if (page > 1 && selection === prevPageIndex) {
        return this.openCategoryList(player, page - 1);
      } else if (selection === backIndex) {
        return openEconomyMenuForm(player);
      } else if (page < totalPages && selection === nextPageIndex) {
        return this.openCategoryList(player, page + 1);
      }

      if (selection < categoryCount) {
        const selectedCategory = currentPageCategories[selection];
        if (selectedCategory) {
          this.openCategoryProducts(player, selectedCategory.name);
        }
      }
    });
  }

  /**
   * 打开指定类别商品列表
   */
  openCategoryProducts(player: Player, categoryName: string, page: number = 1): void {
    const itemDatas = officeShop.getCategoryItems(categoryName);
    const category = officeShop.getCategory(categoryName);

    if (!category) {
      openDialogForm(player, { title: "错误", desc: "商品类别不存在" }, () => this.openCategoryList(player));
      return;
    }

    if (itemDatas.length === 0) {
      openDialogForm(player, { title: `${category.name}`, desc: "该类别下暂无商品" }, () =>
        this.openCategoryList(player)
      );
      return;
    }

    const itemsPerPage = 45;
    const totalPages = Math.ceil(itemDatas.length / itemsPerPage);
    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, itemDatas.length);
    const currentPageProducts = itemDatas.slice(startIndex, endIndex);

    const chestForm = new ChestFormData("shop").title(`${category.name} - 商品列表 (第${page}/${totalPages}页)`);

    currentPageProducts.forEach((itemData, index) => {
      const displayName = getItemDisplayName(itemData.item);
      const lores = itemData.item.getLore();
      const itemIconPath = itemData.item.typeId;
      const amount = itemData.data.amount; // 使用商品库存数量，而不是物品本身的数量
      const durability = getItemDurability(itemData.item);
      const isEnchanted = hasAnyEnchantment(itemData.item);

      const updatedLores = [`${colorCodes.gold}价格: ${colorCodes.yellow}${itemData.data.price} 金币`, ...lores];

      chestForm.button(index, displayName, updatedLores, itemIconPath, amount, durability, isEnchanted);
    });

    if (page > 1) {
      chestForm.button(45, "上一页", ["查看上一页商品"], "textures/icons/left_arrow", 1);
    }
    chestForm.button(49, "返回", ["返回类别列表"], "textures/icons/back", 1);
    if (page < totalPages) {
      chestForm.button(53, "下一页", ["查看下一页商品"], "textures/icons/right_arrow", 1);
    }

    chestForm.show(player).then((response) => {
      if (response.canceled) return;

      const selection = response.selection;
      if (selection === undefined) return;

      if (selection === 45 && page > 1) {
        return this.openCategoryProducts(player, categoryName, page - 1);
      } else if (selection === 49) {
        return this.openCategoryList(player);
      } else if (selection === 53 && page < totalPages) {
        return this.openCategoryProducts(player, categoryName, page + 1);
      }

      if (selection < currentPageProducts.length) {
        const selectedItem = currentPageProducts[selection];
        if (selectedItem) {
          this.showProductDetails(player, selectedItem, categoryName, page);
        }
      }
    });
  }

  /**
   * 显示商品详情
   */
  private showProductDetails(player: Player, itemData: OfficeShopItemData, categoryName: string, page: number): void {
    const wallet = economic.getWallet(player.name);

    const form = new ActionFormData()
      .title("商品详情")
      .body(
        `${colorCodes.gold}单价: ${colorCodes.yellow}${itemData.data.price} 金币\n` +
          `${colorCodes.gold}库存: ${colorCodes.yellow}${itemData.data.amount}\n` +
          `${colorCodes.gold}您的余额: ${colorCodes.yellow}${wallet.gold} 金币`
      )
      .button("购买", "textures/ui/confirm")
      .button("返回", "textures/icons/back");

    form.show(player).then((response) => {
      if (response.canceled) return;

      if (response.selection === 0) {
        this.askBuyQuantity(player, itemData, categoryName, page);
      } else {
        this.openCategoryProducts(player, categoryName, page);
      }
    });
  }

  /**
   * 询问购买数量
   */
  private askBuyQuantity(player: Player, itemData: OfficeShopItemData, categoryName: string, page: number): void {
    const displayName = getItemDisplayName(itemData.item);
    const title: RawMessage = {
      rawtext: [{ text: "购买 - " }, displayName as any],
    };

    const modal = new ModalFormData().title(title).textField("请输入购买数量", "1", { defaultValue: "1" });

    modal.show(player).then((res) => {
      if (res.canceled || !res.formValues) return;

      const qtyStr = res.formValues[0] as string;
      if (!qtyStr || qtyStr.trim() === "") {
        openDialogForm(player, { title: "错误", desc: "请输入有效的购买数量" }, () =>
          this.askBuyQuantity(player, itemData, categoryName, page)
        );
        return;
      }

      const qty = parseInt(qtyStr);
      if (isNaN(qty) || qty <= 0) {
        openDialogForm(player, { title: "错误", desc: "请输入有效的购买数量" }, () =>
          this.askBuyQuantity(player, itemData, categoryName, page)
        );
        return;
      }

      if (qty > itemData.data.amount) {
        openDialogForm(player, { title: "错误", desc: "库存不足" }, () =>
          this.askBuyQuantity(player, itemData, categoryName, page)
        );
        return;
      }

      this.confirmPurchase(player, itemData, qty, categoryName, page);
    });
  }

  /**
   * 计算背包能容纳的物品数量
   */
  private calculateInventoryCapacity(container: any, itemToAdd: ItemStack, requestedAmount: number): number {
    const maxStackSize = itemToAdd.maxAmount;
    let canHold = 0;

    // 计算现有同类物品堆叠可用空间
    for (let i = 0; i < container.size; i++) {
      const slotItem = container.getItem(i);
      if (slotItem && slotItem.typeId === itemToAdd.typeId) {
        // 检查是否可以堆叠（附魔、名称等是否相同）
        if (slotItem.isStackableWith(itemToAdd)) {
          canHold += maxStackSize - slotItem.amount;
        }
      }
    }

    // 计算空槽位可容纳数量
    const emptySlots = container.emptySlotsCount;
    canHold += emptySlots * maxStackSize;

    return Math.min(canHold, requestedAmount);
  }

  /**
   * 确认购买
   */
  private confirmPurchase(
    player: Player,
    itemData: OfficeShopItemData,
    qty: number,
    categoryName: string,
    page: number
  ): void {
    const inventory = player.getComponent("inventory");
    if (!inventory) return;

    const container = inventory.container;
    if (!container) return;

    // 检查背包空间
    const itemToGive = itemData.item.clone();
    const canHoldAmount = this.calculateInventoryCapacity(container, itemToGive, qty);

    if (canHoldAmount === 0) {
      openDialogForm(player, { title: "购买失败", desc: `${colorCodes.red}背包已满！` }, () =>
        this.openCategoryProducts(player, categoryName, page)
      );
      return;
    }

    // 如果背包空间不足，提示玩家并调整购买数量
    if (canHoldAmount < qty) {
      const adjustedPrice = itemData.data.price * canHoldAmount;
      openDialogForm(
        player,
        {
          title: "背包空间不足",
          desc:
            `${colorCodes.yellow}您想购买 ${qty} 个，但背包只能容纳 ${canHoldAmount} 个。\n` +
            `${colorCodes.white}已自动调整为购买 ${canHoldAmount} 个\n` +
            `${colorCodes.gold}总价: ${colorCodes.yellow}${adjustedPrice} 金币`,
        },
        () => {
          // 使用调整后的数量继续购买
          this.executePurchase(player, itemData, canHoldAmount, categoryName, page);
        }
      );
      return;
    }

    // 背包空间充足，正常购买
    this.executePurchase(player, itemData, qty, categoryName, page);
  }

  /**
   * 执行购买（实际的购买逻辑）
   */
  private executePurchase(
    player: Player,
    itemData: OfficeShopItemData,
    qty: number,
    categoryName: string,
    page: number
  ): void {
    const totalPrice = itemData.data.price * qty;

    // 检查金币
    if (!economic.hasEnoughGold(player.name, totalPrice)) {
      openDialogForm(player, { title: "购买失败", desc: `${colorCodes.red}金币不足！需要: ${totalPrice} 金币` }, () =>
        this.openCategoryProducts(player, categoryName, page)
      );
      return;
    }

    const inventory = player.getComponent("inventory");
    if (!inventory) return;

    const container = inventory.container;
    if (!container) return;

    // 扣除金币
    if (!economic.removeGold(player.name, totalPrice, "购买官方商店物品")) {
      openDialogForm(player, { title: "购买失败", desc: `${colorCodes.red}支付失败！` }, () =>
        this.openCategoryProducts(player, categoryName, page)
      );
      return;
    }

    // 给予物品
    try {
      const itemToGive = itemData.item.clone();
      const maxStackSize = itemToGive.maxAmount;
      let remainingAmount = qty;

      // 按照物品的最大堆叠数分批添加
      while (remainingAmount > 0) {
        const currentAmount = Math.min(remainingAmount, maxStackSize);
        const stackToAdd = itemToGive.clone();
        stackToAdd.amount = currentAmount;
        container.addItem(stackToAdd);
        remainingAmount -= currentAmount;
      }

      // 更新商品库存
      officeShop.updateItemMeta(itemData.data, {
        ...itemData.data,
        amount: itemData.data.amount - qty,
      });

      // 如果库存为0，删除商品
      if (itemData.data.amount - qty === 0) {
        officeShop.deleteItem(itemData.data);
      }

      openDialogForm(
        player,
        {
          title: "购买成功",
          desc: `${colorCodes.green}成功购买 ${colorCodes.yellow}${qty} ${colorCodes.green}个商品！`,
        },
        () => this.openCategoryProducts(player, categoryName, page)
      );
    } catch (error) {
      // 退款
      SystemLog.error(`购买失败退款: ${error}`);
      economic.addGold(player.name, totalPrice, "购买失败退款", true);
      openDialogForm(
        player,
        { title: "购买失败", desc: `${colorCodes.red}购买物品失败，已退款 ${totalPrice} 金币！` },
        () => this.openCategoryProducts(player, categoryName, page)
      );
    }
  }

  /**
   * 显示上架物品表单（管理员功能）
   */
  showListItemForm(player: Player): void {
    openDialogForm(
      player,
      {
        title: "管理员功能",
        desc: "上架官方商店商品是管理员功能，请在系统设置的官方商店管理中操作。",
      },
      () => this.openCategoryList(player, 1)
    );
  }
}

const officeShopForm = OfficeShopForm.getInstance();
export { officeShopForm };
