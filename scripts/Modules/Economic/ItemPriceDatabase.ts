import { Database } from "../Database";
import { system } from "@minecraft/server";
import { itemsByGold } from "./data/itemsByGold";

export class ItemPriceDatabase {
  db!: Database<number | undefined>;

  constructor() {
    system.run(() => {
      this.db = new Database<number | undefined>("itemPrices");
    });
  }

  /**
   * 获取物品出售价格
   * 如果数据库中有自定义物品出售价格，返回自定义物品出售价格
   * 否则返回默认物品出售价格（不存储到数据库）
   */
  getPrice(itemId: string): number {
    const customPrice = this.db.get(itemId);
    if (typeof customPrice === "number") {
      return customPrice;
    }

    // 返回默认物品出售价格，不存储到数据库
    const defaultPrice = itemsByGold[itemId as keyof typeof itemsByGold];
    return defaultPrice || 0; // 如果没有默认物品出售价格，返回0
  }

  /**
   * 设置自定义物品出售价格（存储到数据库）
   */
  setPrice(itemId: string, price: number): void {
    this.db.set(itemId, price);
  }

  /**
   * 删除自定义物品出售价格（从数据库中移除，恢复使用默认物品出售价格）
   */
  removePrice(itemId: string): void {
    this.db.delete(itemId);
  }

  /**
   * 获取所有自定义物品出售价格（只返回数据库中实际存储的价格）
   */
  getAllCustomPrices(): Record<string, number> {
    const prices = this.db.getAll();
    const customPrices: Record<string, number> = {};

    // 只返回有效的自定义物品出售价格
    Object.entries(prices).forEach(([itemId, price]) => {
      if (typeof price === "number") {
        customPrices[itemId] = price;
      }
    });

    return customPrices;
  }

  /**
   * 获取所有物品出售价格（包括自定义物品出售价格和默认物品出售价格）
   * 用于兼容现有代码
   */
  getAllPrices(): Record<string, number> {
    const customPrices = this.getAllCustomPrices();
    const allPrices: Record<string, number> = { ...customPrices };

    // 添加所有默认物品出售价格
    Object.entries(itemsByGold).forEach(([itemId, price]) => {
      if (!(itemId in allPrices)) {
        allPrices[itemId] = price;
      }
    });

    return allPrices;
  }

  /**
   * 检查是否有自定义物品出售价格
   */
  hasCustomPrice(itemId: string): boolean {
    const price = this.db.get(itemId);
    return typeof price === "number";
  }

  /**
   * 获取默认物品出售价格
   */
  getDefaultPrice(itemId: string): number {
    return itemsByGold[itemId as keyof typeof itemsByGold] || 0;
  }

  /**
   * 强制重置所有物品出售价格为默认值（公开方法，用于管理界面）
   * 这会清除所有自定义物品出售价格，恢复使用默认物品出售价格
   */
  resetToDefaultPrices() {
    console.warn("[ItemPriceDatabase] 开始重置所有物品出售价格为默认值");
    // 清除所有自定义物品出售价格
    const customPrices = this.getAllCustomPrices();
    Object.keys(customPrices).forEach((itemId) => {
      this.removePrice(itemId);
      console.warn(`[ItemPriceDatabase] 重置物品出售价格: ${itemId} -> 使用默认物品出售价格`);
    });
    console.warn("[ItemPriceDatabase] 重置所有物品出售价格完成");
  }

  /**
   * 获取所有有默认物品出售价格的物品ID列表
   */
  getAllDefaultItemIds(): string[] {
    return Object.keys(itemsByGold);
  }
}

export default new ItemPriceDatabase();
