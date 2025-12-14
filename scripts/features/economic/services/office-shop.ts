/**
 * 官方商店服务
 * 完整迁移自 Modules/Economic/OfficeShop/OfficeShop.ts (136行)
 */

import { ItemStack, Player, system } from "@minecraft/server";
import { Database } from "../../../shared/database/database";
import ItemDatabase, { Item as DbItem } from "./item-database";
import { openDialogForm } from "../../../ui/components/dialog";
import { officeShopCategoryIcons } from "../../../assets/glyph-map";

// 商品类别接口定义
export interface ICategory {
  player: Player;
  name: string;
  description?: string;
  icon?: string;
  created: number;
  modified: number;
  createdBy: string;
}

// 商品元数据
export interface OfficeShopItemMetaData {
  category: string;
  price: number;
  amount: number;
  createdAt: number;
}

// 商品完整数据
export interface OfficeShopItemData {
  item: ItemStack;
  data: OfficeShopItemMetaData;
  itemDB: DbItem;
}

// 添加商品参数
export interface IAddItemToCategory {
  player: Player;
  categoryName: string;
  item: ItemStack;
  amount: number;
  price: number;
  cb: () => void;
}

class OfficeShop {
  db!: Database<ICategory>;
  itemDB!: ItemDatabase;
  defaultIcon = "textures/items/apple";

  constructor() {
    system.run(() => {
      this.db = new Database("officeShopCategories");
      this.itemDB = new ItemDatabase("officeShopItems");
    });
  }

  /**
   * 遍历所有商品
   */
  forEach(callback: (entry: OfficeShopItemData) => void): void {
    this.itemDB.forEach((dbItem: DbItem) => {
      const entry: OfficeShopItemData = {
        item: dbItem.data.item as ItemStack,
        data: dbItem.data as unknown as OfficeShopItemMetaData,
        itemDB: dbItem,
      };
      callback(entry);
    });
  }

  /**
   * 获取所有分类
   */
  getCategories(): ICategory[] {
    return this.db.values();
  }

  /**
   * 获取指定分类
   */
  getCategory(name: string): ICategory | null {
    return this.db.has(name) ? this.db.get(name) : null;
  }

  /**
   * 获取指定分类下的所有商品
   */
  getCategoryItems(categoryName: string): OfficeShopItemData[] {
    const targetItems: OfficeShopItemData[] = [];
    this.forEach((entry) => {
      if (entry.data.category === categoryName) {
        targetItems.push(entry);
      }
    });
    return targetItems;
  }

  /**
   * 创建分类
   */
  createCategory({ player, name, description, icon }: Omit<ICategory, "created" | "modified" | "createdBy">): void {
    if (this.db.has(name)) {
      openDialogForm(player, { title: "§c错误", desc: "§c该类别已存在！" }, () => {});
      return;
    }
    const newCategory: ICategory = {
      player,
      name,
      description,
      icon,
      created: Date.now(),
      modified: Date.now(),
      createdBy: player.name,
    };
    this.db.set(name, newCategory);
  }

  /**
   * 编辑分类
   */
  editCategory(name: string, updates: Partial<Omit<ICategory, "name" | "player" | "createdBy">>): void {
    const existing = this.getCategory(name);
    if (!existing) return;
    const updated: ICategory = {
      ...existing,
      ...updates,
      modified: Date.now(),
    };
    this.db.set(name, updated);
  }

  /**
   * 删除分类
   */
  deleteCategory(name: string): void {
    if (!this.db.has(name)) return;
    this.db.delete(name);
    this.getCategoryItems(name).forEach((entry) => entry.itemDB.delete());
  }

  /**
   * 添加商品到分类
   */
  addItemToCategory({ player, categoryName, item, amount, price, cb }: IAddItemToCategory): void {
    const category = this.getCategory(categoryName);
    if (!category) {
      openDialogForm(player, { title: "§c错误", desc: "§c该类别不存在！" }, () => cb());
      return;
    }
    const itemMetaData: OfficeShopItemMetaData = {
      category: categoryName,
      price,
      amount,
      createdAt: Date.now(),
    };
    this.itemDB.add(item, itemMetaData);
    cb();
  }

  /**
   * 更新商品信息
   */
  updateItemMeta(oldData: Partial<OfficeShopItemMetaData>, newData: Partial<OfficeShopItemMetaData>): void {
    this.itemDB.edit(oldData, newData);
  }

  /**
   * 删除商品
   */
  deleteItem(data: Partial<OfficeShopItemMetaData>): void {
    this.itemDB.remove(data);
  }

  /**
   * 获得商品图标列表
   */
  getCategoryIcons(): [string[], string[]] {
    return officeShopCategoryIcons;
  }
}

export default new OfficeShop();
