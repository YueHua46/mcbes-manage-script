import { system } from "@minecraft/server";
import { Database } from "../Database";
import { getNowDate } from "../../utils/utils";

export interface IProductCategory {
  name: string;
  icon?: string;
  description?: string;
  created?: string;
  modified?: string;
  createdBy?: string;
}

class ProductCategory {
  db!: Database<IProductCategory>;

  defaultIcon = "textures/icons/quest";

  constructor() {
    system.run(() => {
      this.db = new Database("productCategory");
    });
  }

  // 创建商品类别
  createCategory(categoryOption: IProductCategory): string | boolean {
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
  updateCategory(updateArgs: IProductCategory): string | boolean {
    const { name, icon, description } = updateArgs;

    const category = this.db.get(name);
    if (!category) return "商品类别不存在";

    if (name) category.name = name;
    if (icon) category.icon = icon;
    if (description) category.description = description;
    category.modified = getNowDate();

    this.db.set(name, category);
    return true;
  }
}

export default new ProductCategory();
