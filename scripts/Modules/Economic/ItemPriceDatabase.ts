import { Database } from "../Database";
import { system } from "@minecraft/server";
import { itemsByGold } from "./data/itemsByGold";

export class ItemPriceDatabase {
  db!: Database<number>;

  constructor() {
    system.run(() => {
      this.db = new Database<number>("itemPrices");
      this.initDefaultPrices();
    });
  }

  initDefaultPrices() {
    console.warn("[ItemPriceDatabase] 开始初始化默认出售物品价格");
    // 每次启动时都更新价格
    Object.entries(itemsByGold).forEach(([itemId, price]) => {
      // 如果数据库中没有这个物品,就更新
      const currentPrice = this.getPrice(itemId);
      if (currentPrice === undefined) {
        this.setPrice(itemId, price);
        console.warn(`[ItemPriceDatabase] 更新物品价格: ${itemId} = ${price}`);
      }
    });
    console.warn("[ItemPriceDatabase] 初始化默认出售物品价格完成");
  }

  getPrice(itemId: string): number {
    const price = this.db.get(itemId) as unknown as number;
    return price || 0;
  }

  setPrice(itemId: string, price: number): void {
    this.db.set(itemId, price);
  }

  getAllPrices(): Record<string, number> {
    const prices = this.db.getAll();
    console.warn(`prices -> ${prices}`);
    return prices;
  }
}

export default new ItemPriceDatabase();
