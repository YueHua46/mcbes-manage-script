import { Player, ItemStack, world, system, RawMessage } from "@minecraft/server";
import economic from "../Economic";
import { openDialogForm } from "../../Forms/Dialog";
import { color } from "@mcbe-mods/utils";
import ItemDatabase, { Item as DbItem } from "../ItemDatabase";
import { getItemDisplayName } from "../../../utils/utils";

// 玩家商店配置
// const PlayerShopConfig = {
//   maxItems: 255,
//   dbName: "PlayerShop2.0",
// };

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
 * 玩家商店模块 - 使用实体容器存储物品
 */
class AuctionHouse {
  private shopDB!: ItemDatabase;

  constructor(dbName: string = "AuctionHouse2.0") {
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
  async listItem(
    player: Player,
    item: ItemStack,
    price: number,
    amount: number = 1,
    name: string,
    description?: string,
    callback?: () => void
  ): Promise<string | void> {
    // 检查物品是否有效
    if (!item) return "物品不存在";

    // 从玩家背包中移除对应数量的物品
    const inventory = player.getComponent("inventory");
    if (!inventory) return "无法获取玩家背包";

    const container = inventory.container;

    // 查找玩家背包中匹配的物品
    let foundSlot = -1;
    let foundItem: ItemStack | undefined;

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

    if (foundSlot === -1 || !foundItem) return "找不到足够数量的物品";

    // 创建商品数据
    const itemData: ShopItemData = {
      playerName: player.name,
      price: price,
      amount: amount,
      name: name,
      description: item.getLore()?.join("\n"),
      createdAt: Date.now(),
    };

    try {
      // 克隆物品并设置数量
      const itemToStore = item.clone();
      itemToStore.amount = amount;

      // 添加到数据库
      this.shopDB.add(itemToStore, { ...itemData });

      // 从玩家背包中移除物品
      if (foundItem.amount === amount) {
        container.setItem(foundSlot);
      } else {
        foundItem.amount -= amount;
        container.setItem(foundSlot, foundItem);
      }

      // 显示成功消息
      openDialogForm(
        player,
        {
          title: "上架成功",
          desc: color.green(`成功上架 ${itemData.amount} 个 ${itemData.name}，价格: ${itemData.price}`),
        },
        callback
      );
    } catch (error) {
      return `上架失败: ${error}`;
    }
  }

  /**
   * 下架物品
   * @param player 玩家
   * @param entry 商品条目
   * @param callback 回调函数
   */
  async unlistItem(player: Player, entry: ShopItem, callback?: () => void): Promise<string | void> {
    // 检查是否是物品所有者
    if (entry.data.playerName !== player.name) return "只能下架自己的物品";

    // 检查条目是否有效
    if (!this.isValid(entry)) return "物品不存在或已被下架";

    // 获取玩家背包
    const inventory = player.getComponent("inventory");
    if (!inventory) return "无法获取玩家背包";

    const container = inventory.container;

    // 检查背包是否有空间
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
      // 取回物品
      const item = await this.takeItem(entry);

      // 添加到玩家背包
      container.addItem(item);

      // 显示成功消息
      openDialogForm(
        player,
        {
          title: "下架成功",
          desc: color.green(`成功下架 ${entry.data.amount} 个 ${entry.data.name}`),
        },
        callback
      );
    } catch (error) {
      return `下架失败: ${error}`;
    }
  }

  /**
   * 购买物品
   * @param player 购买者
   * @param entry 商品条目
   * @param callback 回调函数
   */
  async buyItem(player: Player, entry: ShopItem, callback?: () => void): Promise<string | void> {
    // 检查条目是否有效
    if (!this.isValid(entry)) return "物品不存在或已被购买";

    // 检查玩家是否有足够的金钱
    if (!economic.hasEnoughGold(player.name, entry.data.price)) return "金钱不足";

    // 获取玩家背包
    const inventory = player.getComponent("inventory");
    if (!inventory) return "无法获取玩家背包";

    const container = inventory.container;

    // 检查背包是否有空间
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
      // 转账
      const result = economic.transfer(player.name, entry.data.playerName, entry.data.price, "购买玩家商店物品");

      if (typeof result === "string") {
        openDialogForm(
          player,
          {
            title: "购买失败",
            desc: color.red(result),
          },
          callback
        );
        return; // 停止执行
      }

      // 取回物品
      const item = await this.takeItem(entry);

      // 添加到玩家背包
      container.addItem(item);

      // 显示成功消息
      openDialogForm(
        player,
        {
          title: "购买成功",
          desc: color.green(`成功购买 ${entry.data.amount} 个 ${entry.data.name}`),
        },
        callback
      );
    } catch (error) {
      // 如果出错，尝试退款
      economic.transfer(entry.data.playerName, player.name, entry.data.price, "购买失败退款");
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
   * 取回物品，不保留数据库中的原条目
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

// 导出单例
const auctionHouse = new AuctionHouse();
export default auctionHouse;
