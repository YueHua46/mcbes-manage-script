import { Player, ItemStack, world, system } from "@minecraft/server";
import { Database } from "../Database";
import { useGetAllPlayer } from "../../hooks/hooks";
import economic from "./Economic";
import { openDialogForm } from "../Forms/Dialog";
import { color } from "@mcbe-mods/utils";
import { extractStackData, generateStackData, SerializableStack } from "../../utils/utils";

export interface IShopItem {
  id: string;
  item: SerializableStack | ItemStack;
  slot: number;
  displayName: string;
  price: number;
  amount: number;
  description?: string;
  seller: string;
  listTime: string;
}

/**
 * 玩家商店模块
 */
class PlayerShop {
  db!: Database<IShopItem>;

  constructor() {
    system.run(() => {
      this.db = new Database<IShopItem>("playerShop");
    });
  }

  // 上架物品
  listItem(player: Player, itemData: Omit<IShopItem, "id">, cb: () => void) {
    // 生成唯一ID
    const id = `${player.name}_${Date.now()}`;

    // 生成可序列化堆栈对象
    const _stackData = extractStackData(itemData.item as ItemStack);

    // 从玩家背包中移除对应数量的物品
    system.run(() => {
      const inventory = player.getComponent("inventory");
      if (!inventory) return "无法获取玩家背包";

      const container = inventory.container;
      const slotItem = container.getItem(itemData.slot);

      if (!slotItem) return "物品不存在";
      if (slotItem.amount < itemData.amount) return "物品数量不足";

      // 如果全部上架，直接移除物品
      if (slotItem.amount === itemData.amount) {
        container.setItem(itemData.slot);
      } else {
        // 否则减少物品数量
        slotItem.amount -= itemData.amount;
        container.setItem(itemData.slot, slotItem);
      }

      // 保存到数据库
      this.db.set(id, {
        id,
        item: _stackData,
        slot: itemData.slot,
        displayName: itemData.displayName,
        price: itemData.price,
        amount: itemData.amount,
        description: itemData.description,
        seller: player.name,
        listTime: new Date().toLocaleString(),
      });
      openDialogForm(
        player,
        {
          title: "上架成功",
          desc: color.green(`成功上架 ${itemData.amount} 个 ${itemData.displayName}`),
        },
        cb
      );
    });
  }

  // 下架物品
  unlistItem(player: Player, itemId: string, cb: () => void) {
    if (!this.db.has(itemId)) return "物品不存在";

    const item = this.db.get(itemId);
    if (item.seller !== player.name) return "只能下架自己的物品";
    console.warn(`unlistItem -> ${item.item.typeId}`);

    system.run(() => {
      // 将物品返还给玩家
      const inventory = player.getComponent("inventory");
      if (!inventory) return "无法获取玩家背包";
      // 尝试将物品添加到玩家背包
      const container = inventory.container;
      if (container.emptySlotsCount === 0) {
        openDialogForm(
          player,
          {
            title: "下架失败",
            desc: color.red(`背包已满，无法将 ${item.amount} 个 ${item.displayName} 返还给玩家`),
          },
          cb
        );
        return;
      }
      const _stackItem = generateStackData(item.item as SerializableStack);
      container.addItem(_stackItem);
      // 从数据库中移除
      this.db.delete(itemId);
      openDialogForm(
        player,
        {
          title: "下架成功",
          desc: color.green(`成功下架 ${item.amount} 个 ${item.displayName}`),
        },
        cb
      );
    });
  }

  // 购买物品
  buyItem(player: Player, itemId: string, cb: () => void) {
    if (!this.db.has(itemId)) return "物品不存在或已被购买";
    const item = this.db.get(itemId);

    // 检查玩家是否有足够的金钱
    const wallet = economic.getWallet(player.name);
    if (wallet.gold < item.price) return "金钱不足";

    // 扣除玩家金钱
    economic.transfer(player.name, item.seller, item.price, "与玩家交易物品");

    // 将物品添加到玩家背包
    const inventory = player.getComponent("inventory");
    if (!inventory) return "无法获取玩家背包";

    system.run(() => {
      const container = inventory.container;
      // 检查玩家背包是否已满
      if (container.emptySlotsCount === 0) {
        // 返还金钱
        economic.transfer(item.seller, player.name, item.price, "购买物品失败，返还金钱");
        openDialogForm(
          player,
          {
            title: "购买物品失败",
            desc: color.red(`背包已满，无法将 ${item.amount} 个 ${item.displayName} 返还给玩家`),
          },
          cb
        );
      }
      // 尝试将物品添加到玩家背包
      const _stackItem = generateStackData(item.item as SerializableStack);
      container.addItem(_stackItem);
      // 从数据库中移除
      this.db.delete(itemId);
      openDialogForm(
        player,
        {
          title: "购买成功",
          desc: color.green(`成功购买 ${item.amount} 个 ${item.displayName}`),
        },
        cb
      );
    });
  }

  // 获取玩家上架的所有物品
  getPlayerListedItems(playerName: string): IShopItem[] {
    return Object.values(this.db.getAll()).filter((item) => item.seller === playerName);
  }

  // 获取所有上架的物品
  getAllListedItems(): IShopItem[] {
    return Object.values(this.db.getAll());
  }
}

export default new PlayerShop();
