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
   * 注意：如果没有自定义价格，则返回0（表示不可出售）
   * 管理员需要先初始化价格或手动设置价格才能出售物品
   */
  getPrice(itemId: string): number {
    const customPrice = this.db.get(itemId);
    if (typeof customPrice === "number") {
      return customPrice;
    }

    // 如果没有自定义价格，返回0（不可出售）
    return 0;
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
   * 初始化所有物品出售价格（使用配置文件中的默认价格）
   * 只初始化未设置价格的物品，不会覆盖已手动设置的价格
   * @returns {initialized: 初始化数量, skipped: 跳过数量}
   */
  initializeAllPrices(): { initialized: number; skipped: number } {
    console.warn("[ItemPriceDatabase] 开始初始化所有物品出售价格");
    let initialized = 0;
    let skipped = 0;
    
    Object.entries(itemsByGold).forEach(([itemId, price]) => {
      if (typeof price === "number") {
        // 检查是否已经设置过价格
        const existingPrice = this.db.get(itemId);
        if (typeof existingPrice === "number") {
          // 已设置过价格，跳过
          skipped++;
          console.warn(`[ItemPriceDatabase] 跳过已设置价格的物品: ${itemId} (当前价格: ${existingPrice})`);
        } else {
          // 未设置价格，进行初始化
          this.db.set(itemId, price);
          initialized++;
        }
      }
    });
    
    console.warn(`[ItemPriceDatabase] 初始化完成，已初始化 ${initialized} 个物品，跳过 ${skipped} 个已设置的物品`);
    return { initialized, skipped };
  }

  /**
   * 清空所有物品出售价格
   * 这将删除所有已设置的价格，使得所有物品都不可出售
   */
  clearAllPrices(): number {
    console.warn("[ItemPriceDatabase] 开始清空所有物品出售价格");
    const customPrices = this.getAllCustomPrices();
    const count = Object.keys(customPrices).length;
    Object.keys(customPrices).forEach((itemId) => {
      this.removePrice(itemId);
    });
    console.warn(`[ItemPriceDatabase] 清空完成，共清空 ${count} 个物品价格`);
    return count;
  }

  /**
   * 重置所有物品出售价格为默认值
   * @deprecated 使用 clearAllPrices() 代替
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
