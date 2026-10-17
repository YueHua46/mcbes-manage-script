/**
 * 玩家交易市场服务
 */

import { Container, Player, ItemStack } from "@minecraft/server";
import economic, { PLAYER_MARKET_PURCHASE_REASON } from "./economic";
import { openDialogForm } from "../../../ui/components/dialog";
import { color } from "../../../shared/utils/color";
import ItemDatabase, { Item as DbItem } from "./item-database";
import { colorCodes } from "../../../shared/utils/color";
import { isAdmin, SystemLog } from "../../../shared/utils/common";
import { usePlayerByName } from "../../../shared/hooks/use-player";
import { recordCreeperQuestSuccess } from "../../quest/integrations/creeper-quest-events";

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

    const itemToStore = slotItem.clone();
    itemToStore.amount = amount;
    let remaining: ItemStack | undefined;
    if (slotItem.amount > amount) {
      remaining = slotItem.clone();
      remaining.amount -= amount;
    }

    // 1. 先从玩家背包扣除：失败则什么都没发生
    try {
      container.setItem(slotIndex, remaining);
    } catch (error) {
      return `上架失败: ${error}`;
    }

    // 2. 提交挂单：失败则把原物品放回原槽位
    try {
      this.marketDB.add(itemToStore, { ...itemData });
    } catch (error) {
      try {
        container.setItem(slotIndex, slotItem);
      } catch (restoreError) {
        SystemLog.error(
          `玩家市场上架失败且归还物品失败: ${player.name} 槽位 ${slotIndex} ${slotItem.typeId} x${slotItem.amount}（${String(restoreError)}）`
        );
        return `上架失败，且物品归还失败，请截图联系管理员处理：${error}`;
      }
      return `上架失败: ${error}`;
    }

    // 3. 已提交：通知失败不影响结果
    this.afterCommit("上架成功提示", () =>
      openDialogForm(
        player,
        {
          title: "上架成功",
          desc: `${colorCodes.green}成功上架 ${colorCodes.yellow}${itemData.amount} ${colorCodes.green}个 ${colorCodes.aqua}${itemData.name}${colorCodes.green}，单价: ${colorCodes.gold}${itemData.price}`,
        },
        callback
      )
    );
  }

  /** 交易已提交后的通知类步骤：失败只记录，绝不回滚交易 */
  private afterCommit(label: string, step: () => void): void {
    try {
      step();
    } catch (error) {
      SystemLog.error(`玩家市场${label}失败（交易已完成，不回滚）: ${String(error)}`);
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

    if (this.calculateContainerCapacity(container, entry.item, entry.data.amount) < entry.data.amount) {
      return "背包空间不足，无法将物品返还给你";
    }

    try {
      this.withdrawToContainer(entry, container);
    } catch (error) {
      return `下架失败: ${error}`;
    }

    this.afterCommit("下架成功提示", () =>
      openDialogForm(
        player,
        {
          title: "下架成功",
          desc: `${colorCodes.green}成功下架 ${colorCodes.yellow}${entry.data.amount} ${colorCodes.green}个 ${colorCodes.aqua}${entry.data.name}`,
        },
        callback
      )
    );
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

  /**
   * 兼容旧挂单：确保记录中的数量与实体中物品的数量一致（只在不一致时写入）。
   */
  private syncEntryStoredAmount(entry: MarketItem): ItemStack {
    const amount = Math.max(1, Math.min(entry.data.amount, entry.item.maxAmount));
    if (amount === entry.item.amount && amount === entry.data.amount) return entry.item.clone();
    const storedItem = entry.item.clone();
    storedItem.amount = amount;
    entry.itemDB.replaceItem(storedItem, { amount });
    entry.item = storedItem;
    entry.data.amount = amount;
    return storedItem;
  }

  /**
   * 把挂单中的物品取到容器里：先放进容器，再提交删除；提交失败则撤回容器改动。
   * 交付的是存储实体中真实保存的物品（完整 NBT）。
   */
  private withdrawToContainer(entry: MarketItem, container: Container): ItemStack {
    this.syncEntryStoredAmount(entry);
    const actual = entry.itemDB.unStore(true);
    const snapshot = this.snapshotContainer(container);
    try {
      this.addItemStacksToContainer(container, actual, actual.amount);
      entry.itemDB.unStore(false);
    } catch (error) {
      this.restoreContainer(container, snapshot);
      throw error;
    }
    return actual;
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

    // 交易阶段：付款 → 发放 → 提交库存变更；任何一步失败都撤回背包并退款
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
        this.withdrawToContainer(entry, container);
      } else {
        // 以实体中真实保存的物品为模板发放，剩余部分替换回存储
        const actual = entry.itemDB.unStore(true);
        const purchasedItem = actual.clone();
        purchasedItem.amount = amount;

        this.addItemStacksToContainer(container, purchasedItem, amount);

        const nextAmount = entry.data.amount - amount;
        const remainingItem = actual.clone();
        remainingItem.amount = nextAmount;
        entry.itemDB.replaceItem(remainingItem, { amount: nextAmount });
        entry.data.amount = nextAmount;
        entry.item = remainingItem;
      }
    } catch (error) {
      this.restoreContainer(container, inventorySnapshot);
      let refundFailed = false;
      if (paid) {
        const refund = economic.transfer(entry.data.playerName, player.name, totalPrice, "购买失败退款");
        if (refund !== true) {
          refundFailed = true;
          SystemLog.error(
            `玩家市场退款失败: ${entry.data.playerName} -> ${player.name} ${totalPrice} 金币（${String(refund)}）`
          );
        }
      }
      const desc = refundFailed
        ? `购买失败: ${error}\n自动退款失败（应退 ${totalPrice} 金币），请截图联系管理员处理！`
        : `购买失败: ${error}`;
      openDialogForm(player, { title: "购买失败", desc: color.red(desc) }, callback);
      return;
    }

    // 已提交：任务事件与提示失败只记录，绝不回滚交易
    const tradeDedupeKey = `${entry.data.createdAt}:${player.name}:${Date.now()}`;
    const tradedTypeId = entry.item.typeId;
    this.afterCommit("买家任务事件", () =>
      recordCreeperQuestSuccess(player, "marketTrade", {
        payload: {
          action: "buy",
          sellerName: entry.data.playerName,
          item: tradedTypeId,
          amount,
          totalPrice,
        },
        dedupeKey: `creeper.market.trade:buyer:${tradeDedupeKey}`,
      })
    );
    this.afterCommit("卖家任务事件", () => {
      const onlineSeller = usePlayerByName(entry.data.playerName);
      if (onlineSeller && onlineSeller.name !== player.name) {
        recordCreeperQuestSuccess(onlineSeller, "marketTrade", {
          payload: {
            action: "sell",
            buyerName: player.name,
            item: tradedTypeId,
            amount,
            totalPrice,
          },
          dedupeKey: `creeper.market.trade:seller:${tradeDedupeKey}`,
        });
      }
    });
    this.afterCommit("购买成功提示", () =>
      openDialogForm(
        player,
        {
          title: "购买成功",
          desc: `${colorCodes.green}成功购买 ${colorCodes.yellow}${amount} ${colorCodes.green}个 ${colorCodes.aqua}${entry.data.name}${colorCodes.green}，总价: ${colorCodes.gold}${totalPrice} ${colorCodes.yellow}金币`,
        },
        callback
      )
    );
  }

  /**
   * 检查条目是否有效
   */
  isValid(entry: MarketItem): boolean {
    return entry.itemDB.isValid();
  }

  /**
   * 取回物品（直接从数据库移除并返回实体中的真实物品）。
   * 需要放进容器时请用 withdrawToContainer，它会在放入失败时撤销。
   */
  async takeItem(entry: MarketItem): Promise<ItemStack> {
    this.syncEntryStoredAmount(entry);
    return entry.itemDB.unStore(false);
  }

  /**
   * 管理员修改市场商品单价
   */
  adminSetItemPrice(admin: Player, entry: MarketItem, price: number): string | void {
    if (!isAdmin(admin)) return "只有管理员可以管理玩家交易市场商品";
    if (!this.isValid(entry)) return "物品不存在或已被下架";
    if (!Number.isInteger(price) || price <= 0 || !Number.isSafeInteger(price)) return "请输入有效的正整数价格";

    try {
      entry.itemDB.editData({ price });
    } catch (error) {
      return `修改失败，商品可能已变化：${String(error)}`;
    }
    entry.data.price = price;

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

    const canHoldAmount = this.calculateContainerCapacity(inventory.container, entry.item, entry.data.amount);
    if (canHoldAmount < entry.data.amount) return "卖家背包空间不足，无法完整返还";

    let item: ItemStack;
    try {
      item = this.withdrawToContainer(entry, inventory.container);
    } catch (error) {
      return `强制下架失败: ${error}`;
    }

    this.afterCommit("强制下架通知", () =>
      seller.sendMessage(
        `${colorCodes.yellow}管理员 ${admin.name} 已将您在玩家交易市场的 ${colorCodes.aqua}${entry.data.name}${colorCodes.yellow} 强制下架并返还到背包。`
      )
    );
    this.afterCommit("强制下架提示", () =>
      openDialogForm(
        admin,
        {
          title: "强制下架成功",
          desc: `${colorCodes.green}已下架 ${colorCodes.yellow}${item.amount} ${colorCodes.green}个 ${colorCodes.aqua}${entry.data.name}${colorCodes.green}，并返还给 ${colorCodes.white}${entry.data.playerName}`,
        },
        callback
      )
    );
  }

  /**
   * 管理员没收商品到自己的背包
   */
  async adminConfiscateItem(admin: Player, entry: MarketItem, callback?: () => void): Promise<string | void> {
    if (!isAdmin(admin)) return "只有管理员可以管理玩家交易市场商品";
    if (!this.isValid(entry)) return "物品不存在或已被下架";

    const inventory = admin.getComponent("inventory");
    if (!inventory) return "无法获取管理员背包";

    const canHoldAmount = this.calculateContainerCapacity(inventory.container, entry.item, entry.data.amount);
    if (canHoldAmount < entry.data.amount) return "管理员背包空间不足，无法完整没收";

    let item: ItemStack;
    try {
      item = this.withdrawToContainer(entry, inventory.container);
    } catch (error) {
      return `没收失败: ${error}`;
    }

    this.afterCommit("没收通知", () =>
      usePlayerByName(entry.data.playerName)?.sendMessage(
        `${colorCodes.red}管理员 ${admin.name} 已没收您在玩家交易市场上架的 ${colorCodes.aqua}${entry.data.name}${colorCodes.red}。`
      )
    );
    this.afterCommit("没收提示", () =>
      openDialogForm(
        admin,
        {
          title: "没收成功",
          desc: `${colorCodes.green}已没收 ${colorCodes.yellow}${item.amount} ${colorCodes.green}个 ${colorCodes.aqua}${entry.data.name}${colorCodes.green} 到你的背包。`,
        },
        callback
      )
    );
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
