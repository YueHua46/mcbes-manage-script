import { system } from "@minecraft/server";
import { Database } from "../Database";
import { getNowDate } from "../../utils/utils";
import { WithExtra } from "../../typing";
import { GlyphKey, glyphKeys, glyphMap } from "../../glyphMap";

// 商品数据结构
export interface IProduct {
  name: string; // 商品名称
  description: string; // 商品描述
  icon: string; // 商品图标
  price: number; // 商品价格
  itemId: string; // 物品ID (如 minecraft:diamond)
  stock: number; // 库存
  created: string; // 创建时间
  modified: string; // 修改时间
  createdBy: string; // 创建者
}

// 扩展商品类别接口，添加商品列表
export interface IProductCategory {
  name: string; // 类别名称
  description?: string; // 类别描述
  icon?: GlyphKey; // 类别图标
  created: string; // 创建时间
  modified: string; // 修改时间
  createdBy: string; // 创建者
  products?: IProduct[]; // 该类别下的商品列表
}

class ProductCategory {
  db!: Database<IProductCategory>;
  defaultIcon = glyphKeys[0] as GlyphKey;

  constructor() {
    system.run(() => {
      this.db = new Database("productCategory");
    });
  }

  // 创建商品类别
  createCategory(categoryOption: Omit<IProductCategory, "created" | "modified">): string | boolean {
    const { name, icon, description, createdBy } = categoryOption;

    if (!name || !description || !createdBy) return "错误，参数没有填写完整";
    if (this.db.get(name)) return "该商品对应名称已存在，请换一个名称";

    const time = getNowDate();
    const category: IProductCategory = {
      name: name,
      icon: icon,
      description: description,
      created: time,
      modified: time,
      createdBy: createdBy,
    };

    this.db.set(name, category);
    return true;
  }

  // 获取单个商品类别
  getCategory(categoryName: string): IProductCategory | undefined {
    return this.db.get(categoryName);
  }

  // 获取所有商品类别
  getCategories(): IProductCategory[] {
    return this.db.values();
  }

  // 删除商品类别
  deleteCategory(categoryName: string): string | boolean {
    if (this.db.get(categoryName)) {
      return this.db.delete(categoryName);
    }
    return "商品类别不存在";
  }

  // 更新商品类别
  updateCategory(
    updateArgs: WithExtra<Omit<IProductCategory, "created" | "modified" | "createdBy">, { newName: string }>
  ): string | boolean {
    const { name, newName, icon, description } = updateArgs;

    const category = this.db.get(name);
    if (!category) return "商品类别不存在";

    if (newName) category.name = newName;
    if (icon) category.icon = icon;
    if (description) category.description = description;
    category.modified = getNowDate();
    this.db.delete(name);
    this.db.set(newName, category);
    return true;
  }

  // 获取类别下的所有商品
  getProductsByCategory(categoryName: string): IProduct[] {
    const category = this.getCategory(categoryName);
    return category?.products || [];
  }

  // 添加商品到类别
  addProductToCategory(categoryName: string, product: Omit<IProduct, "created" | "modified">) {
    const category = this.getCategory(categoryName);
    if (!category) return "商品类别不存在";

    // 检查商品ID是否已存在
    if (category.products?.some((p) => p.name === product.name)) {
      return "该商品名称已存在，请使用其他名称";
    }

    const time = getNowDate();
    const newProduct: IProduct = {
      ...product,
      created: time,
      modified: time,
    };

    // 初始化products数组（如果不存在）
    if (!category.products) {
      category.products = [];
    }

    // 添加新商品
    category.products.push(newProduct);
    category.modified = time;

    // 更新类别
    this.db.set(category.name, category);
    return true;
  }

  // 删除商品
  removeProductFromCategory(categoryName: string, productName: string) {
    const category = this.getCategory(categoryName);
    if (!category) return "商品类别不存在";
    if (!category.products) return "该类别下没有商品";

    const productIndex = category.products.findIndex((p) => p.name === productName);
    if (productIndex === -1) return "商品不存在";

    // 删除商品
    category.products.splice(productIndex, 1);
    category.modified = getNowDate();

    // 更新类别
    this.db.set(category.name, category);
    return true;
  }

  // 更新商品信息
  updateProduct(
    categoryName: string,
    productName: string,
    updates: Partial<Omit<IProduct, "id" | "created" | "modified">>
  ) {
    const category = this.getCategory(categoryName);
    if (!category) return "商品类别不存在";
    if (!category.products) return "该类别下没有商品";

    const productIndex = category.products.findIndex((p) => p.name === productName);
    if (productIndex === -1) return "商品不存在";

    // 更新商品信息
    const product = category.products[productIndex];
    Object.assign(product, updates, { modified: getNowDate() });
    category.modified = getNowDate();

    // 更新类别
    this.db.set(category.name, category);
    return true;
  }
}

export default new ProductCategory();
