/**
 * 拍卖行服务
 * 完整迁移自 Modules/Economic/AuctionHouse/AuctionHouse.ts (324行)
 */

import { Player, ItemStack, world, system } from "@minecraft/server";
import economic from "./economic";
import { openDialogForm } from "../../../ui/components/dialog";
import { color } from "../../../shared/utils/color";
import ItemDatabase, { Item as DbItem } from "./item-database";
import { colorCodes } from "../../../shared/utils/color";

// 商店物品数据结构
export interface ShopItemData {
  name: string;
  playerName: string;
  price: number;
  amount: number;
  description?: string;
  createdAt: number;
}

// 商店物品完整结构
export interface ShopItem {
  item: ItemStack;
  data: ShopItemData;
  itemDB: DbItem;
}

/**
 * 拍卖行模块 - 玩家之间的物品交易
 */
class AuctionHouse {
  private shopDB!: ItemDatabase;

  constructor(dbName: string = "AuctionHouse2.0") {
    // @ts-ignore
    this.shopDB = new ItemDatabase(dbName);
  }

  /**
   * 上架物品
   */
  async listItem(
    player: Player,
    item: ItemStack,
    price: number,
    amount: number = 1,
    name: string,
    description?: string,
    callback?: () => void
  ): Promise<string | void> {
    if (!item) return "物品不存在";

    const inventory = player.getComponent("inventory");
    if (!inventory) return "无法获取玩家背包";

    const container = inventory.container;

    let foundSlot = -1;
    let foundItem: ItemStack | undefined;

    for (let i = 0; i < container.size; i++) {
      const slotItem = container.getItem(i);
      if (slotItem && slotItem.typeId === item.typeId) {
        if (slotItem.amount >= amount) {
          foundSlot = i;
          foundItem = slotItem;
          break;
        }
      }
    }

    if (foundSlot === -1 || !foundItem) return "找不到足够数量的物品";

    const itemData: ShopItemData = {
      playerName: player.name,
      price: price,
      amount: amount,
      name: name,
      description: item.getLore()?.join("\n"),
      createdAt: Date.now(),
    };

    try {
      const itemToStore = item.clone();
      itemToStore.amount = amount;

      this.shopDB.add(itemToStore, { ...itemData });

      if (foundItem.amount === amount) {
        container.setItem(foundSlot);
      } else {
        foundItem.amount -= amount;
        container.setItem(foundSlot, foundItem);
      }

      openDialogForm(
        player,
        {
          title: "上架成功",
          desc: `${colorCodes.green}成功上架 ${colorCodes.yellow}${itemData.amount} ${colorCodes.green}个 ${colorCodes.aqua}${itemData.name}${colorCodes.green}，单价: ${colorCodes.gold}${itemData.price}`,
        },
        callback
      );
    } catch (error) {
      return `上架失败: ${error}`;
    }
  }

  /**
   * 下架物品
   */
  async unlistItem(player: Player, entry: ShopItem, callback?: () => void): Promise<string | void> {
    if (entry.data.playerName !== player.name) return "只能下架自己的物品";

    if (!this.isValid(entry)) return "物品不存在或已被下架";

    const inventory = player.getComponent("inventory");
    if (!inventory) return "无法获取玩家背包";

    const container = inventory.container;

    if (container.emptySlotsCount === 0) {
      openDialogForm(
        player,
        {
          title: "下架失败",
          desc: color.red(`背包已满，无法将物品返还给玩家`),
        },
        callback
      );
      return;
    }

    try {
      const item = await this.takeItem(entry);
      container.addItem(item);

      openDialogForm(
        player,
        {
          title: "下架成功",
          desc: `${colorCodes.green}成功下架 ${colorCodes.yellow}${entry.data.amount} ${colorCodes.green}个 ${colorCodes.aqua}${entry.data.name}`,
        },
        callback
      );
    } catch (error) {
      return `下架失败: ${error}`;
    }
  }

  /**
   * 购买物品
   */
  async buyItem(player: Player, entry: ShopItem, amount: number = 0, callback?: () => void): Promise<string | void> {
    if (!this.isValid(entry)) return "物品不存在或已被购买";

    if (amount <= 0 || amount > entry.data.amount) {
      amount = entry.data.amount;
    }

    const totalPrice = entry.data.price * amount;

    if (!economic.hasEnoughGold(player.name, totalPrice)) return "金钱不足";

    const inventory = player.getComponent("inventory");
    if (!inventory) return "无法获取玩家背包";

    const container = inventory.container;

    if (container.emptySlotsCount === 0) {
      openDialogForm(
        player,
        {
          title: "购买失败",
          desc: color.red(`背包已满，无法接收物品`),
        },
        callback
      );
      return;
    }

    try {
      const result = economic.transfer(player.name, entry.data.playerName, totalPrice, "购买玩家商店物品");

      if (typeof result === "string") {
        openDialogForm(
          player,
          {
            title: "购买失败",
            desc: color.red(result),
          },
          callback
        );
        return;
      }

      if (amount === entry.data.amount) {
        const item = await this.takeItem(entry);
        container.addItem(item);
      } else {
        const originalItem = entry.item.clone();
        originalItem.amount = amount;

        entry.data.amount -= amount;
        entry.itemDB.editData({ amount: entry.data.amount });

        container.addItem(originalItem);
      }

      openDialogForm(
        player,
        {
          title: "购买成功",
          desc: `${colorCodes.green}成功购买 ${colorCodes.yellow}${amount} ${colorCodes.green}个 ${colorCodes.aqua}${entry.data.name}${colorCodes.green}，总价: ${colorCodes.gold}${totalPrice} ${colorCodes.yellow}金币`,
        },
        callback
      );
    } catch (error) {
      economic.transfer(entry.data.playerName, player.name, totalPrice, "购买失败退款");
      return `购买失败: ${error}`;
    }
  }

  /**
   * 检查条目是否有效
   */
  isValid(entry: ShopItem): boolean {
    return entry.itemDB.isValid();
  }

  /**
   * 取回物品
   */
  async takeItem(entry: ShopItem): Promise<ItemStack> {
    return await entry.itemDB.unStore(false);
  }

  /**
   * 遍历所有商店条目
   */
  forEach(callback: (entry: ShopItem) => void): void {
    this.shopDB.forEach((dbItem: DbItem) => {
      const entry: ShopItem = {
        item: dbItem.data.item as ItemStack,
        data: dbItem.data as unknown as ShopItemData,
        itemDB: dbItem,
      };
      callback(entry);
    });
  }

  /**
   * 获取所有商店物品
   */
  getItems(): ShopItem[] {
    const items: ShopItem[] = [];
    this.forEach((entry) => items.push(entry));
    return items;
  }

  /**
   * 获取指定玩家的商店物品
   */
  getPlayerItems(playerName: string): ShopItem[] {
    return this.getItems().filter((item) => item.data.playerName === playerName);
  }
}

const auctionHouse = new AuctionHouse();
export default auctionHouse;
