import { system } from "@minecraft/server";
import { Database } from "../../Database";
import ItemDatabase from "../ItemDatabase";
import { openDialogForm } from "../../Forms/Dialog";
import { glyphKeys, glyphList } from "../../../glyphMap";
class OfficeShop {
    constructor() {
        this.defaultIcon = "textures/items/apple";
        system.run(() => {
            this.db = new Database("officeShopCategories");
            this.itemDB = new ItemDatabase("officeShopItems");
        });
    }
    // 遍历所有商品
    forEach(callback) {
        this.itemDB.forEach((dbItem) => {
            const entry = {
                item: dbItem.data.item,
                data: dbItem.data,
                itemDB: dbItem,
            };
            callback(entry);
        });
    }
    // 获取所有分类
    getCategories() {
        return this.db.values();
    }
    // 获取指定分类
    getCategory(name) {
        return this.db.has(name) ? this.db.get(name) : null;
    }
    // 获取指定分类下的所有商品
    getCategoryItems(categoryName) {
        const targetItems = [];
        this.forEach((entry) => {
            if (entry.data.category === categoryName) {
                targetItems.push(entry);
            }
        });
        return targetItems;
    }
    // 创建分类
    createCategory({ player, name, description, icon }) {
        if (this.db.has(name)) {
            openDialogForm(player, { title: "§c错误", desc: "§c该类别已存在！" }, () => { });
            return;
        }
        const newCategory = {
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
    // 编辑分类
    editCategory(name, updates) {
        const existing = this.getCategory(name);
        if (!existing)
            return;
        const updated = Object.assign(Object.assign(Object.assign({}, existing), updates), { modified: Date.now() });
        this.db.set(name, updated);
    }
    // 删除分类
    deleteCategory(name) {
        if (!this.db.has(name))
            return;
        this.db.delete(name);
        // 同时删除该分类下的所有商品
        this.getCategoryItems(name).forEach((entry) => entry.itemDB.delete());
    }
    // 添加商品到分类
    addItemToCategory({ player, categoryName, item, amount, price, cb }) {
        const category = this.getCategory(categoryName);
        if (!category) {
            openDialogForm(player, { title: "§c错误", desc: "§c该类别不存在！" }, () => cb());
            return;
        }
        const itemMetaData = {
            category: categoryName,
            price,
            amount,
            createdAt: Date.now(),
        };
        this.itemDB.add(item, itemMetaData);
        cb();
    }
    // 更新商品信息
    updateItemMeta(oldData, newData) {
        this.itemDB.edit(oldData, newData);
    }
    // 删除商品
    deleteItem(data) {
        this.itemDB.remove(data);
    }
    // 获得商品图标列表
    getCategoryIcons() {
        return [glyphKeys, glyphList];
    }
}
export default new OfficeShop();
//# sourceMappingURL=OfficeShop.js.map