/**
 * 玩家交易市场服务
 */

import { Container, Player, ItemStack } from "@minecraft/server";
import economic, { PLAYER_MARKET_PURCHASE_REASON } from "./economic";
import { openDialogForm } from "../../../ui/components/dialog";
import { color } from "../../../shared/utils/color";
import ItemDatabase, { Item as DbItem } from "./item-database";
import { colorCodes } from "../../../shared/utils/color";
import { isAdmin } from "../../../shared/utils/common";
import { usePlayerByName } from "../../../shared/hooks/use-player";

// 玩家交易市场商品数据结构
export interface MarketItemData {
  name: string;
  playerName: string;
  price: number;
  amount: number;
  description?: string;
  createdAt: number;
}

// 玩家交易市场商品完整结构
export interface MarketItem {
  item: ItemStack;
  data: MarketItemData;
  itemDB: DbItem;
}

/**
 * 玩家交易市场模块 - 玩家之间的物品交易
 */
class PlayerMarket {
  private marketDB!: ItemDatabase;

  constructor(dbName: string = "AuctionHouse2.0") {
    // 保留原数据库标识，确保升级后已有挂单可继续读取。
    // @ts-ignore
    this.marketDB = new ItemDatabase(dbName);
  }

  /**
   * 上架物品（必须指定槽位，避免多格同 typeId 时错扣与附魔错乱）
   */
  async listItem(
    player: Player,
    slotIndex: number,
    price: number,
    amount: number = 1,
    name: string,
    description?: string,
    callback?: () => void
  ): Promise<string | void> {
    const inventory = player.getComponent("inventory");
    if (!inventory) return "无法获取玩家背包";

    const container = inventory.container;
    if (slotIndex < 0 || slotIndex >= container.size) return "无效的槽位";

    const slotItem = container.getItem(slotIndex);
    if (!slotItem) return "物品不存在";
    if (slotItem.amount < amount) return "找不到足够数量的物品";

    const itemData: MarketItemData = {
      playerName: player.name,
      price: price,
      amount: amount,
      name: name,
      description: slotItem.getLore()?.join("\n"),
      createdAt: Date.now(),
    };

    try {
      const itemToStore = slotItem.clone();
      itemToStore.amount = amount;

      this.marketDB.add(itemToStore, { ...itemData });

      if (slotItem.amount === amount) {
        container.setItem(slotIndex);
      } else {
        const remaining = slotItem.clone();
        remaining.amount -= amount;
        container.setItem(slotIndex, remaining);
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
  async unlistItem(player: Player, entry: MarketItem, callback?: () => void): Promise<string | void> {
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
   * 按最大堆叠将物品加入容器（与官方商店 executePurchase 一致）
   */
  private addItemStacksToContainer(container: Container, template: ItemStack, amount: number): void {
    let remaining = amount;
    const maxStack = template.maxAmount;
    while (remaining > 0) {
      const n = Math.min(remaining, maxStack);
      const stack = template.clone();
      stack.amount = n;
      const leftover = container.addItem(stack);
      if (leftover) {
        throw new Error("背包空间不足，无法完整接收物品");
      }
      remaining -= n;
    }
  }

  private snapshotContainer(container: Container): Array<ItemStack | undefined> {
    const snapshot: Array<ItemStack | undefined> = [];
    for (let i = 0; i < container.size; i++) {
      snapshot.push(container.getItem(i)?.clone());
    }
    return snapshot;
  }

  private restoreContainer(container: Container, snapshot: Array<ItemStack | undefined>): void {
    for (let i = 0; i < snapshot.length; i++) {
      container.setItem(i, snapshot[i]?.clone());
    }
  }

  private calculateContainerCapacity(container: Container, itemToAdd: ItemStack, requestedAmount: number): number {
    const maxStackSize = itemToAdd.maxAmount;
    let canHold = 0;

    for (let i = 0; i < container.size; i++) {
      const slotItem = container.getItem(i);
      if (slotItem?.isStackableWith(itemToAdd)) {
        canHold += maxStackSize - slotItem.amount;
      }
    }

    canHold += container.emptySlotsCount * maxStackSize;
    return Math.min(canHold, requestedAmount);
  }

  private syncEntryStoredAmount(entry: MarketItem): ItemStack {
    const amount = Math.max(1, Math.min(entry.data.amount, entry.item.maxAmount));
    const storedItem = entry.item.clone();
    storedItem.amount = amount;
    entry.item = storedItem;
    entry.data.amount = amount;
    entry.itemDB.editData({ amount, item: storedItem });
    return storedItem;
  }

  /**
   * 购买物品
   */
  async buyItem(player: Player, entry: MarketItem, amount: number = 0, callback?: () => void): Promise<void> {
    if (!this.isValid(entry)) {
      openDialogForm(player, { title: "购买失败", desc: color.red("物品不存在或已被购买") }, callback);
      return;
    }

    if (amount <= 0 || amount > entry.data.amount) {
      amount = entry.data.amount;
    }

    const totalPrice = entry.data.price * amount;

    if (!economic.hasEnoughGold(player.name, totalPrice)) {
      openDialogForm(player, { title: "购买失败", desc: color.red("金钱不足") }, callback);
      return;
    }

    const inventory = player.getComponent("inventory");
    if (!inventory) {
      openDialogForm(player, { title: "购买失败", desc: color.red("无法获取玩家背包") }, callback);
      return;
    }

    const container = inventory.container;

    const itemToBuy = entry.item.clone();
    itemToBuy.amount = Math.min(amount, entry.item.maxAmount);
    const canHoldAmount = this.calculateContainerCapacity(container, itemToBuy, amount);
    if (canHoldAmount < amount) {
      openDialogForm(
        player,
        {
          title: "购买失败",
          desc: color.red(`背包空间不足，无法完整接收 ${amount} 个物品`),
        },
        callback
      );
      return;
    }

    const inventorySnapshot = this.snapshotContainer(container);
    let paid = false;

    try {
      const result = economic.transfer(player.name, entry.data.playerName, totalPrice, PLAYER_MARKET_PURCHASE_REASON);

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
      paid = true;

      if (amount === entry.data.amount) {
        const item = entry.item.clone();
        item.amount = amount;
        this.addItemStacksToContainer(container, item, item.amount);
        await this.takeItem(entry);
      } else {
        const purchasedItem = entry.item.clone();
        purchasedItem.amount = amount;

        this.addItemStacksToContainer(container, purchasedItem, amount);

        const nextAmount = entry.data.amount - amount;
        const remainingItem = entry.item.clone();
        remainingItem.amount = nextAmount;
        entry.itemDB.editData({ amount: nextAmount, item: remainingItem });
        entry.data.amount = nextAmount;
        entry.item = remainingItem;
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
      this.restoreContainer(container, inventorySnapshot);
      if (paid) {
        economic.transfer(entry.data.playerName, player.name, totalPrice, "购买失败退款");
      }
      openDialogForm(player, { title: "购买失败", desc: color.red(`购买失败: ${error}`) }, callback);
    }
  }

  /**
   * 检查条目是否有效
   */
  isValid(entry: MarketItem): boolean {
    return entry.itemDB.isValid();
  }

  /**
   * 取回物品
   */
  async takeItem(entry: MarketItem): Promise<ItemStack> {
    this.syncEntryStoredAmount(entry);
    return await entry.itemDB.unStore(false);
  }

  /**
   * 管理员修改市场商品单价
   */
  adminSetItemPrice(admin: Player, entry: MarketItem, price: number): string | void {
    if (!isAdmin(admin)) return "只有管理员可以管理玩家交易市场商品";
    if (!this.isValid(entry)) return "物品不存在或已被下架";
    if (!Number.isInteger(price) || price <= 0 || !Number.isSafeInteger(price)) return "请输入有效的正整数价格";

    entry.data.price = price;
    entry.itemDB.editData({ price });

    const seller = usePlayerByName(entry.data.playerName);
    seller?.sendMessage(
      `${colorCodes.yellow}管理员 ${admin.name} 已将您在玩家交易市场的 ${colorCodes.aqua}${entry.data.name}${colorCodes.yellow} 单价调整为 ${colorCodes.gold}${price}${colorCodes.yellow} 金币。`
    );
  }

  /**
   * 管理员强制下架商品并返还给在线卖家
   */
  async adminReturnItemToSeller(admin: Player, entry: MarketItem, callback?: () => void): Promise<string | void> {
    if (!isAdmin(admin)) return "只有管理员可以管理玩家交易市场商品";
    if (!this.isValid(entry)) return "物品不存在或已被下架";

    const seller = usePlayerByName(entry.data.playerName);
    if (!seller) return "卖家不在线，无法直接返还到背包";

    const inventory = seller.getComponent("inventory");
    if (!inventory) return "无法获取卖家背包";

    const itemToReturn = this.syncEntryStoredAmount(entry);
    const canHoldAmount = this.calculateContainerCapacity(inventory.container, itemToReturn, entry.data.amount);
    if (canHoldAmount < entry.data.amount) return "卖家背包空间不足，无法完整返还";

    try {
      const item = await this.takeItem(entry);
      this.addItemStacksToContainer(inventory.container, item, item.amount);

      seller.sendMessage(
        `${colorCodes.yellow}管理员 ${admin.name} 已将您在玩家交易市场的 ${colorCodes.aqua}${entry.data.name}${colorCodes.yellow} 强制下架并返还到背包。`
      );

      openDialogForm(
        admin,
        {
          title: "强制下架成功",
          desc: `${colorCodes.green}已下架 ${colorCodes.yellow}${item.amount} ${colorCodes.green}个 ${colorCodes.aqua}${entry.data.name}${colorCodes.green}，并返还给 ${colorCodes.white}${entry.data.playerName}`,
        },
        callback
      );
    } catch (error) {
      return `强制下架失败: ${error}`;
    }
  }

  /**
   * 管理员没收商品到自己的背包
   */
  async adminConfiscateItem(admin: Player, entry: MarketItem, callback?: () => void): Promise<string | void> {
    if (!isAdmin(admin)) return "只有管理员可以管理玩家交易市场商品";
    if (!this.isValid(entry)) return "物品不存在或已被下架";

    const inventory = admin.getComponent("inventory");
    if (!inventory) return "无法获取管理员背包";

    const itemToConfiscate = this.syncEntryStoredAmount(entry);
    const canHoldAmount = this.calculateContainerCapacity(inventory.container, itemToConfiscate, entry.data.amount);
    if (canHoldAmount < entry.data.amount) return "管理员背包空间不足，无法完整没收";

    try {
      const item = await this.takeItem(entry);
      this.addItemStacksToContainer(inventory.container, item, item.amount);

      const seller = usePlayerByName(entry.data.playerName);
      seller?.sendMessage(
        `${colorCodes.red}管理员 ${admin.name} 已没收您在玩家交易市场上架的 ${colorCodes.aqua}${entry.data.name}${colorCodes.red}。`
      );

      openDialogForm(
        admin,
        {
          title: "没收成功",
          desc: `${colorCodes.green}已没收 ${colorCodes.yellow}${item.amount} ${colorCodes.green}个 ${colorCodes.aqua}${entry.data.name}${colorCodes.green} 到你的背包。`,
        },
        callback
      );
    } catch (error) {
      return `没收失败: ${error}`;
    }
  }

  /**
   * 遍历所有市场条目
   */
  forEach(callback: (entry: MarketItem) => void): void {
    this.marketDB.forEach((dbItem: DbItem) => {
      const entry: MarketItem = {
        item: dbItem.data.item as ItemStack,
        data: dbItem.data as unknown as MarketItemData,
        itemDB: dbItem,
      };
      callback(entry);
    });
  }

  /**
   * 获取所有市场商品
   */
  getItems(): MarketItem[] {
    const items: MarketItem[] = [];
    this.forEach((entry) => items.push(entry));
    return items;
  }

  /**
   * 获取指定玩家的市场商品
   */
  getPlayerItems(playerName: string): MarketItem[] {
    return this.getItems().filter((item) => item.data.playerName === playerName);
  }
}

const playerMarket = new PlayerMarket();
export default playerMarket;
