/**
 * 官方商店服务
 * 完整迁移自 Modules/Economic/OfficeShop/OfficeShop.ts (136行)
 */

import { ItemStack, Player, system } from "@minecraft/server";
import { Database } from "../../../shared/database/database";
import ItemDatabase, { Item as DbItem } from "./item-database";
import { openDialogForm } from "../../../ui/components/dialog";
import { officeShopCategoryIcons } from "../../../assets/glyph-map";

// 商品类别接口定义（持久化记录，不再保存 Player 对象：它序列化后只是 {}）
export interface ICategory {
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
  /** 缺省为有限库存，兼容已有商品。 */
  unlimitedSupply?: boolean;
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
  unlimitedSupply?: boolean;
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

  /** 保存分类；失败时恢复缓存并抛出 */
  private saveCategory(name: string, category: ICategory): void {
    const previous = this.db.get(name);
    const { player: _legacyPlayer, ...record } = category as ICategory & { player?: unknown };
    this.db.set(name, record);
    try {
      this.db.save();
    } catch (error) {
      if (previous === undefined) this.db.delete(name);
      else this.db.set(name, previous);
      throw error;
    }
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
  createCategory({
    player,
    name,
    description,
    icon,
  }: {
    player: Player;
    name: string;
    description?: string;
    icon?: string;
  }): void {
    if (this.db.has(name)) {
      openDialogForm(player, { title: "§c错误", desc: "§c该类别已存在！" }, () => {});
      return;
    }
    const newCategory: ICategory = {
      name,
      description,
      icon,
      created: Date.now(),
      modified: Date.now(),
      createdBy: player.name,
    };
    this.saveCategory(name, newCategory);
  }

  /**
   * 编辑分类
   */
  editCategory(name: string, updates: Partial<Omit<ICategory, "name" | "createdBy">>): void {
    const existing = this.getCategory(name);
    if (!existing) return;
    const updated: ICategory = {
      ...existing,
      ...updates,
      modified: Date.now(),
    };
    this.saveCategory(name, updated);
  }

  /**
   * 删除分类：先一次提交删除该分类下的全部商品，成功后再删除分类本身。
   * 任何一步失败都会抛出；商品删除失败时分类与商品都保持原样。
   */
  deleteCategory(name: string): void {
    if (!this.db.has(name)) return;
    const entries = this.getCategoryItems(name);
    if (entries.length > 0) {
      this.itemDB.removeMany(entries.map((entry) => entry.itemDB.data));
    }
    const previous = this.db.get(name);
    this.db.delete(name);
    try {
      this.db.save();
    } catch (error) {
      this.db.set(name, previous);
      throw error;
    }
  }

  /**
   * 添加商品到分类
   */
  addItemToCategory({
    player,
    categoryName,
    item,
    amount,
    unlimitedSupply = false,
    price,
    cb,
  }: IAddItemToCategory): void {
    const category = this.getCategory(categoryName);
    if (!category) {
      openDialogForm(player, { title: "§c错误", desc: "§c该类别不存在！" }, () => cb());
      return;
    }
    const itemMetaData: OfficeShopItemMetaData = {
      category: categoryName,
      price,
      amount,
      unlimitedSupply,
      createdAt: Date.now(),
    };
    try {
      this.itemDB.add(item, itemMetaData);
    } catch (error) {
      // cb 是“添加成功”提示，失败时不能调用
      openDialogForm(player, { title: "§c错误", desc: `§c添加商品失败：${String(error)}` }, () => {});
      return;
    }
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
