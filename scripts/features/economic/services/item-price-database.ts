/**
 * 物品价格数据库服务
 * 完整迁移自 Modules/Economic/ItemPriceDatabase.ts (118行)
 */

import { Database } from "../../../shared/database/database";
import { system } from "@minecraft/server";
// 临时保留对旧数据的引用，因为itemsByGold数据量大
import { itemsByGold } from "../data/items-by-gold";

export class ItemPriceDatabase {
  db!: Database<number | undefined>;

  constructor() {
    system.run(() => {
      this.db = new Database<number | undefined>("itemPrices");
    });
  }

  /**
   * 获取物品出售价格
   */
  getPrice(itemId: string): number {
    const customPrice = this.db.get(itemId);
    if (typeof customPrice === "number") {
      return customPrice;
    }

    const defaultPrice = itemsByGold[itemId as keyof typeof itemsByGold];
    return defaultPrice || 0;
  }

  /**
   * 设置自定义物品出售价格
   */
  setPrice(itemId: string, price: number): void {
    this.db.set(itemId, price);
  }

  /**
   * 删除自定义物品出售价格
   */
  removePrice(itemId: string): void {
    this.db.delete(itemId);
  }

  /**
   * 获取所有自定义物品出售价格
   */
  getAllCustomPrices(): Record<string, number> {
    const prices = this.db.getAll();
    const customPrices: Record<string, number> = {};

    Object.entries(prices).forEach(([itemId, price]) => {
      if (typeof price === "number") {
        customPrices[itemId] = price;
      }
    });

    return customPrices;
  }

  /**
   * 获取所有物品出售价格（包括自定义和默认）
   */
  getAllPrices(): Record<string, number> {
    const customPrices = this.getAllCustomPrices();
    const allPrices: Record<string, number> = { ...customPrices };

    Object.entries(itemsByGold).forEach(([itemId, price]) => {
      if (!(itemId in allPrices) && typeof price === "number") {
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
   * 重置所有物品出售价格为默认值
   */
  resetToDefaultPrices(): void {
    console.warn("[ItemPriceDatabase] 开始重置所有物品出售价格为默认值");
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
