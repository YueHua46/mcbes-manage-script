import { system } from "@minecraft/server";
import { Database } from "../Database";
import { getNowDate } from "../../utils/utils";
class ProductCategory {
    constructor() {
        this.defaultIcon = "textures/icons/quest";
        system.run(() => {
            this.db = new Database("productCategory");
        });
    }
    // 创建商品类别
    createCategory(categoryOption) {
        const { name, icon, description, createdBy } = categoryOption;
        if (!name || !description || !createdBy)
            return "错误，参数没有填写完整";
        if (this.db.get(name))
            return "该商品对应名称已存在，请换一个名称";
        const time = getNowDate();
        const category = {
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
    getCategory(categoryName) {
        return this.db.get(categoryName);
    }
    // 获取所有商品类别
    getCategories() {
        return this.db.values();
    }
    // 删除商品类别
    deleteCategory(categoryName) {
        if (this.db.get(categoryName)) {
            return this.db.delete(categoryName);
        }
        return "商品类别不存在";
    }
    // 更新商品类别
    updateCategory(updateArgs) {
        const { name, icon, description } = updateArgs;
        const category = this.db.get(name);
        if (!category)
            return "商品类别不存在";
        if (name)
            category.name = name;
        if (icon)
            category.icon = icon;
        if (description)
            category.description = description;
        category.modified = getNowDate();
        this.db.set(name, category);
        return true;
    }
}
export default new ProductCategory();
//# sourceMappingURL=ProcuctCategory.js.map