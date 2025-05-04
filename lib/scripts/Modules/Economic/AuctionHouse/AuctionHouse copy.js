import ItemDatabase from "../ItemDatabase";
// ======= 拍卖行全局配置 =======
const AuctionConfig = {
    /**
     * 最大拍卖容量：拍卖行可同时存储的最大物品数量。
     * 该值决定了 ItemDatabase 实例在底层可分配的实体数量上限。
     */
    maxAuction: 255,
    /**
     * 默认数据库名称，用于持久化存储拍卖条目。
     */
    dbName: "Auction2.5.1",
};
/**
 * 拍卖行类
 */
export class AuctionHouse {
    constructor(dbName = "Auction2.5.1") {
        // 使用 any 兼容旧逻辑的多余参数
        // @ts-ignore
        this.auctionDB = new ItemDatabase(dbName);
    }
    /** 添加物品到拍卖行 */
    addItem(item, data) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.auctionDB.add(item, Object.assign(Object.assign({}, data), { [Symbol.iterator]: undefined }));
        });
    }
    /** 从拍卖行移除物品 */
    removeItem(entry) {
        return __awaiter(this, void 0, void 0, function* () {
            yield entry.itemDB.delete();
        });
    }
    /** 检查条目是否仍有效 */
    isValid(entry) {
        return entry.itemDB.isValid();
    }
    /** 取回物品，不保留数据库中的原条目 */
    takeItem(entry) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield entry.itemDB.unStore(false);
        });
    }
    /** 遍历所有拍卖条目 */
    forEach(callback) {
        this.auctionDB.forEach((dbItem) => {
            const entry = {
                item: dbItem.data.item,
                data: dbItem.data,
                itemDB: dbItem,
            };
            callback(entry);
        });
    }
    /** 获取所有拍卖条目数组 */
    getItems() {
        const items = [];
        this.forEach((entry) => items.push(entry));
        return items;
    }
}
// 导出单例
const Auction = new AuctionHouse();
export default Auction;
//# sourceMappingURL=AuctionHouse%20copy.js.map