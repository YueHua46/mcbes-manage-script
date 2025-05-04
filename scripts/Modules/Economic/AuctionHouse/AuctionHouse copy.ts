import ItemDatabase, { Item as DbItem } from "../ItemDatabase";
import * as mc from "@minecraft/server";

// ======= 拍卖行全局配置 =======
const AuctionConfig = {
  /**
   * 最大拍卖容量：拍卖行可同时存储的最大物品数量。
   * 该值决定了 ItemDatabase 实例在底层可分配的实体数量上限。
   */
  maxAuction: 255,
  /**
   * 默认数据库名称，用于持久化存储拍卖条目。
   */
  dbName: "Auction2.5.1",
};

/**
 * 拍卖行数据结构
 */
export interface AuctionData {
  playerName: string;
  price: number;
  displayname: string;
  createdAt: number;
}

/**
 * 拍卖行条目结构
 */
export interface AuctionItem {
  item: mc.ItemStack;
  data: AuctionData;
  itemDB: DbItem;
}

/**
 * 拍卖行类
 */
export class AuctionHouse {
  private auctionDB: ItemDatabase;

  constructor(dbName = "Auction2.5.1") {
    // 使用 any 兼容旧逻辑的多余参数
    // @ts-ignore
    this.auctionDB = new ItemDatabase(dbName);
  }

  /** 添加物品到拍卖行 */
  async addItem(item: mc.ItemStack, data: AuctionData): Promise<void> {
    await this.auctionDB.add(item, { ...data, [Symbol.iterator]: undefined });
  }

  /** 从拍卖行移除物品 */
  async removeItem(entry: AuctionItem): Promise<void> {
    await entry.itemDB.delete();
  }

  /** 检查条目是否仍有效 */
  isValid(entry: AuctionItem): boolean {
    return entry.itemDB.isValid();
  }

  /** 取回物品，不保留数据库中的原条目 */
  async takeItem(entry: AuctionItem): Promise<mc.ItemStack> {
    return await entry.itemDB.unStore(false);
  }

  /** 遍历所有拍卖条目 */
  forEach(callback: (entry: AuctionItem) => void): void {
    this.auctionDB.forEach((dbItem: DbItem) => {
      const entry: AuctionItem = {
        item: dbItem.data.item as mc.ItemStack,
        data: dbItem.data as unknown as AuctionData,
        itemDB: dbItem,
      };
      callback(entry);
    });
  }

  /** 获取所有拍卖条目数组 */
  getItems(): AuctionItem[] {
    const items: AuctionItem[] = [];
    this.forEach((entry) => items.push(entry));
    return items;
  }
}

// 导出单例
const Auction = new AuctionHouse();
export default Auction;
