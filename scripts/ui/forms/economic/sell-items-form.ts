/**
 * 出售物品表单
 * 完整迁移自 Modules/Economic/SellItems/SellItemsForm.ts (490行)
 * 简化版：由于ChestUI依赖复杂，使用简化实现
 */

import { Player, ItemStack, RawMessage } from "@minecraft/server";
import { ActionFormData, ActionFormResponse, ModalFormData } from "@minecraft/server-ui";
import { openDialogForm } from "../../components/dialog";
import economic from "../../../features/economic/services/economic";
import itemPriceDb from "../../../features/economic/services/item-price-database";
import { colorCodes } from "../../../shared/utils/color";

class SellItemsForm {
  /**
   * 打开出售物品主界面
   */
  openSellItemsMenu(player: Player): void {
    const { openEconomyMenuForm } = require("./index");
    const form = new ActionFormData()
      .title("出售物品")
      .body(
        `${colorCodes.green}您可以在这里出售背包中的物品来获取金币。\n${colorCodes.yellow}系统会根据物品的价值给予您相应的金币。`
      )
      .button("出售单个物品", "textures/icons/gem")
      .button("一键出售所有物品", "textures/icons/sandik")
      .button("返回", "textures/icons/back");

    form.show(player).then((response) => {
      if (response.canceled) return;

      switch (response.selection) {
        case 0:
          this.showSellItemSelection(player);
          break;
        case 1:
          this.confirmSellAllItems(player);
          break;
        case 2:
          openEconomyMenuForm(player);
          break;
      }
    });
  }

  /**
   * 显示玩家背包中可出售的物品（简化版）
   */
  showSellItemSelection(player: Player): void {
    const { ChestFormData, ChestUIUtility } = require("../../components/chest-ui");
    const { getItemDisplayName, getItemDurabilityPercent, hasAnyEnchantment } = ChestUIUtility;

    const inventory = player.getComponent("inventory");
    if (!inventory) {
      openDialogForm(player, { title: "错误", desc: "无法获取玩家背包" }, () => this.openSellItemsMenu(player));
      return;
    }

    const chestForm = new ChestFormData("shop");
    chestForm.title("选择要出售的物品");

    const container = inventory.container;
    let hasItems = false;

    for (let i = 0; i < container.size; i++) {
      const item = container.getItem(i);
      if (item && item.typeId !== "yuehua:sm") {
        hasItems = true;
        const itemPrice = this.getItemPrice(item);
        const totalPrice = itemPrice * item.amount;

        const lores: string[] = [];
        
        if (itemPrice === 0) {
          // 价格为0，显示未设置出售价格的提示
          lores.push(`${colorCodes.red}未设置出售价格`);
          lores.push(`${colorCodes.gray}该物品无法出售`);
          lores.push(`${colorCodes.gold}数量: ${colorCodes.yellow}${item.amount}`);
        } else {
          // 价格正常，显示价格信息
          lores.push(`${colorCodes.gold}单价: ${colorCodes.yellow}${itemPrice} 金币`);
          lores.push(`${colorCodes.gold}总价: ${colorCodes.yellow}${totalPrice} 金币`);
          lores.push(`${colorCodes.gold}数量: ${colorCodes.yellow}${item.amount}`);
        }

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
      openDialogForm(player, { title: "背包为空", desc: "您的背包中没有可出售的物品" }, () =>
        this.openSellItemsMenu(player)
      );
      return;
    }

    chestForm.button(49, "返回", ["返回上一级"], "textures/icons/back");

    chestForm.show(player).then((data: ActionFormResponse) => {
      if (data.canceled) return;

      const selection = data.selection;
      if (selection === undefined) return;

      if (selection === 49) {
        this.openSellItemsMenu(player);
        return;
      }

      const selectedItem = container.getItem(selection);
      if (!selectedItem) {
        openDialogForm(player, { title: "错误", desc: "无法获取物品信息" }, () => this.showSellItemSelection(player));
        return;
      }

      // 检查物品价格是否为0
      const itemPrice = this.getItemPrice(selectedItem);
      if (itemPrice === 0) {
        const { ChestUIUtility } = require("../../components/chest-ui");
        const { getItemDisplayName } = ChestUIUtility;
        const itemNameRaw: RawMessage = {
          rawtext: [
            { text: `${colorCodes.red}该物品未设置出售价格，无法出售！\n${colorCodes.yellow}物品：` },
            getItemDisplayName(selectedItem),
            { text: `\n${colorCodes.gray}请联系管理员设置该物品的出售价格。` },
          ],
        };
        openDialogForm(player, { title: "无法出售", desc: itemNameRaw }, () => this.showSellItemSelection(player));
        return;
      }

      this.showSellConfirmation(player, selectedItem, selection);
    });
  }

  /**
   * 显示出售确认表单
   */
  private showSellConfirmation(player: Player, item: ItemStack, slotIndex: number): void {
    const itemPrice = this.getItemPrice(item);
    const maxAmount = item.amount;
    const { ChestUIUtility } = require("../../components/chest-ui");
    const { getItemDisplayName } = ChestUIUtility;

    const title: RawMessage = {
      rawtext: [{ text: "出售 - " }, getItemDisplayName(item)],
    };

    const form = new ModalFormData().title(title).slider("请选择出售数量", 1, maxAmount, {
      valueStep: 1,
      defaultValue: maxAmount,
    });

    form.show(player).then((response) => {
      if (response.canceled) {
        this.showSellItemSelection(player);
        return;
      }

      const amount = response.formValues![0] as number;
      if (amount <= 0 || amount > maxAmount) {
        openDialogForm(player, { title: "错误", desc: "请选择有效的出售数量" }, () =>
          this.showSellConfirmation(player, item, slotIndex)
        );
        return;
      }

      const sellPrice = itemPrice * amount;
      this.confirmSellItem(player, item, slotIndex, amount, sellPrice);
    });
  }

  /**
   * 确认出售物品
   */
  private confirmSellItem(
    player: Player,
    item: ItemStack,
    slotIndex: number,
    amount: number,
    totalPrice: number
  ): void {
    const { ChestUIUtility } = require("../../components/chest-ui");
    const { getItemDisplayName } = ChestUIUtility;

    const bodyRawText: RawMessage = {
      rawtext: [
        {
          text: `${colorCodes.green}您确定要出售 ${colorCodes.yellow}${amount} ${colorCodes.green}个 ${colorCodes.yellow}`,
        },
        getItemDisplayName(item),
        { text: ` ${colorCodes.green}吗？\n总价: ${colorCodes.gold}${totalPrice} ${colorCodes.green}金币` },
      ],
    };

    const form = new ActionFormData()
      .title("确认出售")
      .body(bodyRawText)
      .button("确认出售", "textures/icons/accept")
      .button("取消", "textures/icons/deny");

    form.show(player).then((response) => {
      if (response.canceled || response.selection === 1) {
        this.showSellItemSelection(player);
        return;
      }
      if (response.selection === 0) {
        this.sellItem(player, slotIndex, amount, totalPrice);
      }
    });
  }

  /**
   * 执行出售物品操作
   */
  private sellItem(player: Player, slotIndex: number, amount: number, totalPrice: number): void {
    const inventory = player.getComponent("inventory");
    if (!inventory) return;

    const container = inventory.container;
    const item = container.getItem(slotIndex);

    if (!item) {
      openDialogForm(player, { title: "错误", desc: "物品不存在或已被移除" }, () => this.showSellItemSelection(player));
      return;
    }

    const itemPrice = this.getItemPrice(item);
    const remainingLimit = economic.getRemainingDailyLimit(player.name);

    let actualAmount = amount;
    let actualPrice = totalPrice;
    let reachedLimit = false;

    if (remainingLimit < totalPrice) {
      reachedLimit = true;
      actualAmount = Math.floor(remainingLimit / itemPrice);
      actualPrice = actualAmount * itemPrice;

      if (actualAmount <= 0) {
        openDialogForm(
          player,
          { title: "出售失败", desc: `${colorCodes.red}您已达到今日金币获取上限，无法出售任何物品！` },
          () => this.showSellItemSelection(player)
        );
        return;
      }
    }

    if (item.amount === actualAmount) {
      container.setItem(slotIndex);
    } else {
      item.amount -= actualAmount;
      container.setItem(slotIndex, item);
    }

    economic.addGold(player.name, actualPrice, `出售物品 ${item.typeId}`);

    const { ChestUIUtility } = require("../../components/chest-ui");
    const { getItemDisplayName } = ChestUIUtility;
    let desc: RawMessage;
    if (reachedLimit) {
      desc = {
        rawtext: [
          { text: `${colorCodes.green}成功出售 ${colorCodes.yellow}` },
          getItemDisplayName(item),
          {
            text: ` x${actualAmount} ${colorCodes.green}个，获得: ${colorCodes.gold}${actualPrice} ${colorCodes.green}金币\n${colorCodes.red}您已达到今日金币获取上限，只出售了部分物品！`,
          },
        ],
      };
    } else {
      desc = {
        rawtext: [
          { text: `${colorCodes.green}成功出售 ${colorCodes.yellow}` },
          getItemDisplayName(item),
          {
            text: ` x${actualAmount} ${colorCodes.green}个，获得: ${colorCodes.gold}${actualPrice} ${colorCodes.green}金币`,
          },
        ],
      };
    }

    openDialogForm(player, { title: "出售成功", desc }, () => this.showSellItemSelection(player));
  }

  /**
   * 确认一键出售所有物品
   */
  private confirmSellAllItems(player: Player): void {
    const form = new ActionFormData()
      .title("一键出售")
      .body(`${colorCodes.yellow}您确定要出售背包中的所有物品吗？\n${colorCodes.red}注意：服务器菜单道具不会被出售。`)
      .button("确认出售", "textures/icons/accept")
      .button("取消", "textures/icons/deny");

    form.show(player).then((response) => {
      if (response.canceled || response.selection === 1) {
        this.openSellItemsMenu(player);
        return;
      }

      this.sellAllItems(player);
    });
  }

  /**
   * 一键出售所有物品
   */
  private sellAllItems(player: Player): void {
    const inventory = player.getComponent("inventory");
    if (!inventory) return;

    const container = inventory.container;
    let totalEarnings = 0;
    let itemsSold = 0;
    const remainingLimit = economic.getRemainingDailyLimit(player.name);
    let reachedLimit = false;

    const itemsToSell: { index: number; item: ItemStack; price: number; amount: number }[] = [];
    const itemsWithoutPrice: { item: ItemStack; amount: number }[] = []; // 记录没有设置价格的物品
    const soldItems: { item: ItemStack; soldAmount: number; price: number; totalPrice: number }[] = []; // 记录已出售的物品详情

    for (let i = 0; i < container.size; i++) {
      const item = container.getItem(i);
      if (item && item.typeId !== "yuehua:sm") {
        const itemPrice = this.getItemPrice(item);
        const sellPrice = itemPrice * item.amount;

        if (itemPrice > 0) {
          // 只添加有价格的物品到出售列表
          itemsToSell.push({
            index: i,
            item: item,
            price: itemPrice,
            amount: item.amount,
          });
        } else {
          // 记录没有价格的物品
          itemsWithoutPrice.push({
            item: item,
            amount: item.amount,
          });
        }
      }
    }

    if (itemsToSell.length === 0) {
      // 如果有物品但都没有价格，显示详细列表
      if (itemsWithoutPrice.length > 0) {
        this.showSellAllResultForm(player, [], itemsWithoutPrice, 0, false);
      } else {
        openDialogForm(player, { title: "出售失败", desc: "背包中没有可出售的物品" }, () =>
          this.openSellItemsMenu(player)
        );
      }
      return;
    }

    itemsToSell.sort((a, b) => b.price - a.price);

    let remainingGoldLimit = remainingLimit;

    for (const itemData of itemsToSell) {
      if (remainingGoldLimit <= 0) {
        reachedLimit = true;
        break;
      }

      const maxSellAmount = Math.min(itemData.amount, Math.floor(remainingGoldLimit / itemData.price));

      if (maxSellAmount <= 0) continue;

      const sellPrice = maxSellAmount * itemData.price;
      totalEarnings += sellPrice;
      itemsSold += maxSellAmount;
      remainingGoldLimit -= sellPrice;

      // 记录出售详情
      soldItems.push({
        item: itemData.item,
        soldAmount: maxSellAmount,
        price: itemData.price,
        totalPrice: sellPrice,
      });

      if (maxSellAmount === itemData.amount) {
        container.setItem(itemData.index);
      } else {
        const updatedItem = itemData.item.clone();
        updatedItem.amount -= maxSellAmount;
        container.setItem(itemData.index, updatedItem);
        reachedLimit = true;
      }
    }

    if (totalEarnings > 0) {
      economic.addGold(player.name, totalEarnings, `一键出售物品`);
      
      // 显示详细的出售结果
      this.showSellAllResultForm(player, soldItems, itemsWithoutPrice, totalEarnings, reachedLimit);
    } else {
      openDialogForm(player, { title: "出售失败", desc: "背包中没有可出售的物品或您已达到今日金币获取上限" }, () =>
        this.openSellItemsMenu(player)
      );
    }
  }

  /**
   * 显示一键出售的详细结果
   */
  private showSellAllResultForm(
    player: Player,
    soldItems: { item: ItemStack; soldAmount: number; price: number; totalPrice: number }[],
    itemsWithoutPrice: { item: ItemStack; amount: number }[],
    totalEarnings: number,
    reachedLimit: boolean
  ): void {
    const form = new ActionFormData();
    form.title("§w一键出售结果");

    // 构建 RawMessage 格式的详细信息
    const bodyRawText: any[] = [];

    // 总结信息
    if (soldItems.length > 0) {
      bodyRawText.push({ text: `${colorCodes.green}═════════ 出售成功 ═════════\n` });
      bodyRawText.push({ text: `${colorCodes.gold}总收入: ${colorCodes.yellow}${totalEarnings} 金币\n` });
      bodyRawText.push({ text: `${colorCodes.gold}出售种类: ${colorCodes.yellow}${soldItems.length} 种物品\n\n` });

      if (reachedLimit) {
        bodyRawText.push({ text: `${colorCodes.red}⚠ 已达今日金币获取上限\n\n` });
      }

      // 已出售物品清单
      bodyRawText.push({ text: `${colorCodes.green}━━━ 已出售物品清单 ━━━\n` });
      soldItems.forEach((soldItem, index) => {
        bodyRawText.push({ text: `${colorCodes.yellow}${index + 1}. ${colorCodes.white}` });
        bodyRawText.push({ translate: soldItem.item.localizationKey });
        bodyRawText.push({ 
          text: `\n   ${colorCodes.gray}数量: ${soldItem.soldAmount} | 单价: ${soldItem.price} | 获得: ${colorCodes.gold}${soldItem.totalPrice}\n` 
        });
      });
    }

    // 未出售物品清单
    if (itemsWithoutPrice.length > 0) {
      bodyRawText.push({ text: `\n${colorCodes.red}━━━ 未出售物品清单 ━━━\n` });
      bodyRawText.push({ text: `${colorCodes.yellow}以下物品因未设置出售价格而未出售:\n\n` });
      
      itemsWithoutPrice.forEach((item, index) => {
        bodyRawText.push({ text: `${colorCodes.red}${index + 1}. ${colorCodes.white}` });
        bodyRawText.push({ translate: item.item.localizationKey });
        bodyRawText.push({ text: ` ${colorCodes.gray}x${item.amount}\n` });
      });
      
      bodyRawText.push({ text: `\n${colorCodes.gray}请联系管理员设置这些物品的出售价格` });
    }

    // 如果所有物品都未设置价格
    if (soldItems.length === 0 && itemsWithoutPrice.length > 0) {
      // 清空之前的内容
      bodyRawText.length = 0;
      
      bodyRawText.push({ text: `${colorCodes.red}═════════ 出售失败 ═════════\n` });
      bodyRawText.push({ text: `${colorCodes.yellow}背包中的所有物品均未设置出售价格！\n\n` });
      bodyRawText.push({ text: `${colorCodes.red}━━━ 物品清单 ━━━\n` });
      
      itemsWithoutPrice.forEach((item, index) => {
        bodyRawText.push({ text: `${colorCodes.red}${index + 1}. ${colorCodes.white}` });
        bodyRawText.push({ translate: item.item.localizationKey });
        bodyRawText.push({ text: ` ${colorCodes.gray}x${item.amount}\n` });
      });
      
      bodyRawText.push({ text: `\n${colorCodes.gray}请联系管理员设置物品出售价格` });
    }

    const bodyMessage: RawMessage = { rawtext: bodyRawText };
    form.body(bodyMessage);
    form.button("§a确定", "textures/icons/accept");

    form.show(player).then(() => {
      this.openSellItemsMenu(player);
    });
  }

  /**
   * 获取物品的价格
   */
  private getItemPrice(item: ItemStack): number {
    return itemPriceDb.getPrice(item.typeId);
  }
}

const sellItemsForm = new SellItemsForm();
export default sellItemsForm;
