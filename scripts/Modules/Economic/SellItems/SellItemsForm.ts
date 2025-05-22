import { Player, ItemStack, RawMessage } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import ChestFormData from "../../ChestUI/ChestForms";
import { openDialogForm } from "../../Forms/Dialog";
import { getItemDisplayName, getItemDurabilityPercent, hasAnyEnchantment } from "../../../utils/utils";
import economic from "../Economic";
import { openEconomyMenuForm } from "../Forms";
import { colorCodes } from "../../../utils/color";
import { itemsByGold } from "../data/itemsByGold";
import setting from "../../System/Setting";

/**
 * 物品出售系统UI管理类
 */
class SellItemsForm {
  /**
   * 打开出售物品主界面
   */
  openSellItemsMenu(player: Player): void {
    const form = new ActionFormData()
      .title("出售物品")
      .body(
        `${colorCodes.green}您可以在这里出售背包中的物品来获取金币。\n${colorCodes.yellow}系统会根据物品的价值给予您相应的金币。`
      )
      .button("出售单个物品", "textures/packs/15174541")
      .button("一键出售所有物品", "textures/packs/15174544")
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
   * 显示玩家背包中可出售的物品
   */
  showSellItemSelection(player: Player): void {
    // 获取玩家背包
    const inventory = player.getComponent("inventory");
    if (!inventory) {
      openDialogForm(
        player,
        {
          title: "错误",
          desc: "无法获取玩家背包",
        },
        () => this.openSellItemsMenu(player)
      );
      return;
    }

    // 使用ChestUI显示玩家背包中的所有物品
    const chestForm = new ChestFormData("shop");
    chestForm.title("选择要出售的物品");

    // 渲染玩家背包内容到ChestUI
    const container = inventory.container;
    let hasItems = false;

    for (let i = 0; i < container.size; i++) {
      const item = container.getItem(i);
      if (item && item.typeId !== "yuehua:sm") {
        // 排除服务器菜单道具
        hasItems = true;
        const itemPrice = this.getItemPrice(item);
        const totalPrice = itemPrice * item.amount;

        const lores: string[] = [
          `${colorCodes.gold}单价: ${colorCodes.yellow}${itemPrice} 金币`,
          `${colorCodes.gold}总价: ${colorCodes.yellow}${totalPrice} 金币`,
          `${colorCodes.gold}数量: ${colorCodes.yellow}${item.amount}`,
        ];

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
      openDialogForm(
        player,
        {
          title: "背包为空",
          desc: "您的背包中没有可出售的物品",
        },
        () => this.openSellItemsMenu(player)
      );
      return;
    }

    // 添加返回按钮
    chestForm.button(49, "返回", ["返回上一级"], "textures/icons/back");

    // 显示表单
    chestForm.show(player).then((data) => {
      if (data.canceled) {
        return;
      }

      const slotIndex = data.selection;
      if (slotIndex === undefined) return;

      // 处理返回按钮
      if (slotIndex === 49) {
        this.openSellItemsMenu(player);
        return;
      }

      // 获取选中的物品
      const selectedItem = container.getItem(slotIndex);
      if (!selectedItem) {
        openDialogForm(
          player,
          {
            title: "错误",
            desc: "无法获取物品信息",
          },
          () => this.showSellItemSelection(player)
        );
        return;
      }

      // 显示出售确认表单
      this.showSellConfirmation(player, selectedItem, slotIndex);
    });
  }

  /**
   * 显示出售确认表单
   */
  private showSellConfirmation(player: Player, item: ItemStack, slotIndex: number): void {
    const itemPrice = this.getItemPrice(item);
    const maxAmount = item.amount;
    const totalPrice = itemPrice * maxAmount;
    const title: RawMessage = {
      rawtext: [
        {
          text: "出售 - ",
        },
        getItemDisplayName(item),
      ],
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
        openDialogForm(
          player,
          {
            title: "错误",
            desc: "请选择有效的出售数量",
          },
          () => this.showSellConfirmation(player, item, slotIndex)
        );
        return;
      }

      // 计算总价
      const sellPrice = itemPrice * amount;

      // 确认出售
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
    // 给某些文字加点颜色来突出
    const bodyRawText: RawMessage = {
      rawtext: [
        {
          text: `${colorCodes.green}您确定要出售 ${colorCodes.yellow}${amount} ${colorCodes.green}个 ${colorCodes.yellow}`,
        },
        getItemDisplayName(item),
        {
          text: ` ${colorCodes.green}吗？\n总价: ${colorCodes.gold}${totalPrice} ${colorCodes.green}金币`,
        },
      ],
    };
    const form = new ActionFormData()
      .title("确认出售")
      .body(bodyRawText)
      .button("确认出售", "textures/packs/15174544")
      .button("取消", "textures/ui/cancel");

    form.show(player).then((response) => {
      if (response.canceled) {
        return;
      }
      if (response.selection === 1) {
        this.showSellItemSelection(player);
        return;
      }
      if (response.selection === 0) {
        // 执行出售
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
      openDialogForm(
        player,
        {
          title: "错误",
          desc: "物品不存在或已被移除",
        },
        () => this.showSellItemSelection(player)
      );
      return;
    }

    const itemName = getItemDisplayName(item);
    const itemPrice = this.getItemPrice(item);

    // 检查玩家是否达到每日出售上限
    const remainingLimit = economic.getRemainingDailyLimit(player.name);

    // 如果剩余额度小于总价，计算可以出售的最大数量
    let actualAmount = amount;
    let actualPrice = totalPrice;
    let reachedLimit = false;

    if (remainingLimit < totalPrice) {
      reachedLimit = true;
      // 计算可以出售的最大数量（向下取整）
      actualAmount = Math.floor(remainingLimit / itemPrice);
      actualPrice = actualAmount * itemPrice;

      // 如果无法出售任何物品，提示玩家并返回
      if (actualAmount <= 0) {
        openDialogForm(
          player,
          {
            title: "出售失败",
            desc: `${colorCodes.red}您已达到今日金币获取上限，无法出售任何物品！`,
          },
          () => this.showSellItemSelection(player)
        );
        return;
      }
    }

    // 从背包中移除物品
    if (item.amount === actualAmount) {
      container.setItem(slotIndex);
    } else {
      item.amount -= actualAmount;
      container.setItem(slotIndex, item);
    }

    // 添加金币
    economic.addGold(player.name, actualPrice, `出售物品 ${item.typeId}`);

    // 构建成功消息
    let desc: RawMessage;
    if (reachedLimit) {
      desc = {
        rawtext: [
          {
            text: `${colorCodes.green}成功出售 ${colorCodes.yellow}`,
          },
          itemName,
          {
            text: ` x${actualAmount} ${colorCodes.green}个，获得: ${colorCodes.gold}${actualPrice} ${colorCodes.green}金币\n${colorCodes.red}您已达到今日金币获取上限，只出售了部分物品！`,
          },
        ],
      };
    } else {
      desc = {
        rawtext: [
          {
            text: `${colorCodes.green}成功出售 ${colorCodes.yellow}`,
          },
          itemName,
          {
            text: ` x${actualAmount} ${colorCodes.green}个，获得: ${colorCodes.gold}${actualPrice} ${colorCodes.green}金币`,
          },
        ],
      };
    }

    // 显示成功消息
    openDialogForm(
      player,
      {
        title: "出售成功",
        desc,
      },
      () => this.showSellItemSelection(player)
    );
  }

  /**
   * 确认一键出售所有物品
   */
  private confirmSellAllItems(player: Player): void {
    const form = new ActionFormData()
      .title("一键出售")
      .body(`${colorCodes.yellow}您确定要出售背包中的所有物品吗？\n${colorCodes.red}注意：服务器菜单道具不会被出售。`)
      .button("确认出售", "textures/packs/15174544")
      .button("取消", "textures/ui/cancel");

    form.show(player).then((response) => {
      if (response.canceled || response.selection === 1) {
        this.openSellItemsMenu(player);
        return;
      }

      // 执行一键出售
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

    // 先计算所有物品的总价值
    const itemsToSell: { index: number; item: ItemStack; price: number; amount: number }[] = [];

    // 遍历背包中的所有物品，收集可出售物品信息
    for (let i = 0; i < container.size; i++) {
      const item = container.getItem(i);
      if (item && item.typeId !== "yuehua:sm") {
        // 排除服务器菜单道具
        const itemPrice = this.getItemPrice(item);
        const sellPrice = itemPrice * item.amount;

        itemsToSell.push({
          index: i,
          item: item,
          price: itemPrice,
          amount: item.amount,
        });
      }
    }

    // 如果没有可出售物品
    if (itemsToSell.length === 0) {
      openDialogForm(
        player,
        {
          title: "出售失败",
          desc: "背包中没有可出售的物品",
        },
        () => this.openSellItemsMenu(player)
      );
      return;
    }

    // 按照物品价格从高到低排序，优先出售高价值物品
    itemsToSell.sort((a, b) => b.price - a.price);

    // 逐个出售物品，直到达到每日上限或全部出售完毕
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

      // 从背包中移除物品
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
      // 添加金币
      economic.addGold(player.name, totalEarnings, `一键出售物品`);

      // 显示成功消息
      if (reachedLimit) {
        openDialogForm(
          player,
          {
            title: "出售成功",
            desc: `${colorCodes.green}成功出售 ${colorCodes.yellow}${itemsSold} ${colorCodes.green}个物品，获得: ${colorCodes.gold}${totalEarnings} ${colorCodes.yellow}金币\n${colorCodes.red}您已达到今日金币获取上限，只出售了部分物品！`,
          },
          () => this.openSellItemsMenu(player)
        );
      } else {
        openDialogForm(
          player,
          {
            title: "出售成功",
            desc: `${colorCodes.green}成功出售 ${colorCodes.yellow}${itemsSold} ${colorCodes.green}个物品，获得: ${colorCodes.gold}${totalEarnings} ${colorCodes.yellow}金币`,
          },
          () => this.openSellItemsMenu(player)
        );
      }
    } else {
      openDialogForm(
        player,
        {
          title: "出售失败",
          desc: "背包中没有可出售的物品或您已达到今日金币获取上限",
        },
        () => this.openSellItemsMenu(player)
      );
    }
  }

  /**
   * 获取物品的价格
   */
  private getItemPrice(item: ItemStack): number {
    // 从itemsByGold.json中获取物品价格
    const price = (itemsByGold as Record<string, number>)[item.typeId] || 0;

    // 如果物品没有定价，给一个默认价格
    return price > 0 ? price : 1;
  }
}

// 创建单例实例
const sellItemsForm = new SellItemsForm();
export default sellItemsForm;
