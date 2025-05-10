var _Item_data, _Item_db, _ItemDatabase_instances, _ItemDatabase_name, _ItemDatabase_loaded, _ItemDatabase_entities, _ItemDatabase_itemData, _ItemDatabase_database, _ItemDatabase_findEmptySlot, _ItemDatabase_setItem, _ItemDatabase_deleteItem;
// ItemDatabase.ts
import { system, world } from "@minecraft/server";
import { Database } from "../Database";
import Utility from "../ChestUI/Utility";
import { SystemLog } from "../../utils/utils";
// 每个实体可存储的最大槽位数
const ITEM_MAX_PER_ENTITY = 256;
// 在世界中用于存储的实体类型
const ENTITY_TYPE_ID = "pao:new_database";
// 记录已注册的数据库名称，防止重复
const nameRegistered = [];
/**
 * 工具：等待世界与玩家加载完成
 */
function waitLoaded() {
    return new Promise((resolve) => {
        const id = system.runInterval(() => {
            if (world.getAllPlayers().length > 0) {
                system.clearRun(id);
                resolve();
            }
        }, 10);
    });
}
/**
 * 工具：延迟
 * @param ms 毫秒
 */
function sleep(ms) {
    return new Promise((resolve) => {
        system.runTimeout(() => resolve(), (ms / 1000) * 20);
    });
}
/**
 * 根据值在对象中查找键
 */
function findIndexByValue(obj, value) {
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key) && JSON.stringify(obj[key]) === JSON.stringify(value)) {
            return key;
        }
    }
    return undefined;
}
/**
 * 封装单个物品，提供对数据库操作的方法
 */
export class Item {
    constructor(data, db) {
        _Item_data.set(this, void 0);
        _Item_db.set(this, void 0);
        __classPrivateFieldSet(this, _Item_data, data, "f");
        __classPrivateFieldSet(this, _Item_db, db, "f");
        this.item = data.item; // 构造时保证有 item
    }
    get data() {
        return Object.assign({}, __classPrivateFieldGet(this, _Item_data, "f"));
    }
    isValid() {
        return __classPrivateFieldGet(this, _Item_db, "f").isValid(__classPrivateFieldGet(this, _Item_data, "f"));
    }
    delete() {
        __classPrivateFieldGet(this, _Item_db, "f").remove(__classPrivateFieldGet(this, _Item_data, "f"));
    }
    unStore(keepItem = true) {
        return __classPrivateFieldGet(this, _Item_db, "f").unStore(__classPrivateFieldGet(this, _Item_data, "f"), keepItem);
    }
    editData(newData = {}) {
        __classPrivateFieldGet(this, _Item_db, "f").edit(__classPrivateFieldGet(this, _Item_data, "f"), newData);
    }
}
_Item_data = new WeakMap(), _Item_db = new WeakMap();
/**
 * 主类：实体背包数据库
 */
class ItemDatabase {
    constructor(name) {
        _ItemDatabase_instances.add(this);
        _ItemDatabase_name.set(this, void 0);
        _ItemDatabase_loaded.set(this, false);
        _ItemDatabase_entities.set(this, []);
        _ItemDatabase_itemData.set(this, {});
        _ItemDatabase_database.set(this, void 0);
        // 名称校验
        if (nameRegistered.includes(name)) {
            throw new Error(`Database with name "${name}" already exists!`);
        }
        __classPrivateFieldSet(this, _ItemDatabase_name, name, "f");
        system.run(() => {
            __classPrivateFieldSet(this, _ItemDatabase_database, new Database(`EntityDatabase_${name}`), "f");
        });
        nameRegistered.push(name);
        this.init().catch((e) => console.error(e));
    }
    /** 初始化，加载已有实体与槽位数据 */
    init() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            yield waitLoaded();
            system.run(() => {
                world.getDimension("minecraft:overworld").runCommand(`tickingarea add circle 8 0 8 4 "PaoDatabase" true`);
            });
            const start = Date.now();
            const loadedTimes = [];
            // 获取所有已存在对应 nameTag 的实体
            const ents = world
                .getDimension("minecraft:overworld")
                .getEntities()
                .filter((e) => e.typeId === ENTITY_TYPE_ID && e.nameTag === `DB_${__classPrivateFieldGet(this, _ItemDatabase_name, "f")}`)
                .sort((a, b) => {
                var _a, _b, _c, _d;
                const ta = Number((_b = (_a = a
                    .getTags()
                    .find((t) => t.startsWith("spawntime:"))) === null || _a === void 0 ? void 0 : _a.slice(9)) !== null && _b !== void 0 ? _b : 0);
                const tb = Number((_d = (_c = b
                    .getTags()
                    .find((t) => t.startsWith("spawntime:"))) === null || _c === void 0 ? void 0 : _c.slice(9)) !== null && _d !== void 0 ? _d : 0);
                return ta - tb;
            });
            if (ents.length > 0) {
                let entityCount = 0;
                for (const ent of ents) {
                    const inv = (_a = ent.getComponent("inventory")) === null || _a === void 0 ? void 0 : _a.container;
                    for (let i = 0; i < ITEM_MAX_PER_ENTITY; i++) {
                        const t0 = Date.now();
                        const it = inv === null || inv === void 0 ? void 0 : inv.getItem(i);
                        const slot = i + entityCount * ITEM_MAX_PER_ENTITY;
                        const stored = __classPrivateFieldGet(this, _ItemDatabase_database, "f").get(`slot_${slot}`);
                        if (it && stored) {
                            stored.item = it;
                            __classPrivateFieldGet(this, _ItemDatabase_itemData, "f")[slot] = stored;
                        }
                        else {
                            __classPrivateFieldGet(this, _ItemDatabase_database, "f").delete(`slot_${slot}`);
                        }
                        loadedTimes.push(Date.now() - t0);
                    }
                    __classPrivateFieldGet(this, _ItemDatabase_entities, "f").push(ent);
                    entityCount++;
                }
            }
            else {
                // 如果没有实体就生成一个
                const id = system.run(() => {
                    if (__classPrivateFieldGet(this, _ItemDatabase_entities, "f").length === 0) {
                        const e = world
                            .getDimension("minecraft:overworld")
                            .spawnEntity(ENTITY_TYPE_ID, { x: 8, y: 0, z: 8 });
                        e.nameTag = `DB_${__classPrivateFieldGet(this, _ItemDatabase_name, "f")}`;
                        e.addTag(`spawntime:${Date.now()}`);
                        __classPrivateFieldGet(this, _ItemDatabase_entities, "f").push(e);
                    }
                    else {
                        system.clearRun(id);
                    }
                });
            }
            // 等待至少一个实体准备就绪
            yield new Promise((resolve) => {
                const id = system.run(() => {
                    if (__classPrivateFieldGet(this, _ItemDatabase_entities, "f").length > 0) {
                        system.clearRun(id);
                        resolve();
                    }
                });
            });
            __classPrivateFieldSet(this, _ItemDatabase_loaded, true, "f");
            const avg = Utility.CalculateAverage(loadedTimes) || 0;
            SystemLog(`[Entity Database] ${__classPrivateFieldGet(this, _ItemDatabase_name, "f")} loaded in ${Date.now() - start}ms, ` + `${this.length} items, avg ${avg}ms/item.`);
        });
    }
    /** 当前所有实体可用的总槽位 */
    get fullInventory() {
        return __classPrivateFieldGet(this, _ItemDatabase_entities, "f").length * ITEM_MAX_PER_ENTITY;
    }
    /** 当前已存储的物品数量 */
    get length() {
        return Object.keys(__classPrivateFieldGet(this, _ItemDatabase_itemData, "f")).length;
    }
    /** 查询匹配特定 data 的物品数量 */
    getAmountByData(data = {}) {
        return Object.values(__classPrivateFieldGet(this, _ItemDatabase_itemData, "f")).filter((d) => Object.entries(data).every(([k, v]) => d[k] === v)).length;
    }
    /**
     * 添加物品到数据库
     * @param item 要存储的 ItemStack
     * @param data 额外元数据
     */
    add(item, data = {}) {
        if (!__classPrivateFieldGet(this, _ItemDatabase_loaded, "f"))
            throw new ReferenceError("Database is not loaded");
        if (__classPrivateFieldGet(this, _ItemDatabase_instances, "m", _ItemDatabase_findEmptySlot).call(this).length === 0) {
            // 自动扩展实体
            const e = world
                .getDimension("minecraft:overworld")
                .spawnEntity(ENTITY_TYPE_ID, { x: 8, y: 0, z: 8 });
            e.nameTag = `DB_${__classPrivateFieldGet(this, _ItemDatabase_name, "f")}`;
            e.addTag(`spawntime:${Date.now()}`);
            __classPrivateFieldGet(this, _ItemDatabase_entities, "f").push(e);
        }
        const slot = __classPrivateFieldGet(this, _ItemDatabase_instances, "m", _ItemDatabase_findEmptySlot).call(this)[0];
        __classPrivateFieldGet(this, _ItemDatabase_instances, "m", _ItemDatabase_setItem).call(this, slot, item, data);
    }
    /**
     * 根据槽位索引获取封装后的 Item 对象
     */
    get(slot) {
        const d = __classPrivateFieldGet(this, _ItemDatabase_itemData, "f")[slot];
        return d ? new Item(d, this) : undefined;
    }
    /**
     * 按 data 删除物品
     */
    remove(data) {
        if (!__classPrivateFieldGet(this, _ItemDatabase_loaded, "f"))
            throw new ReferenceError("Database is not loaded");
        const key = findIndexByValue(__classPrivateFieldGet(this, _ItemDatabase_itemData, "f"), data);
        if (key === undefined)
            throw new Error("Item not found!");
        __classPrivateFieldGet(this, _ItemDatabase_instances, "m", _ItemDatabase_deleteItem).call(this, Number(key));
    }
    /**
     * 卸出（复制）物品，可选择是否保留原槽
     */
    unStore(data, keepItem = true) {
        if (!__classPrivateFieldGet(this, _ItemDatabase_loaded, "f"))
            throw new ReferenceError("Database is not loaded");
        const key = findIndexByValue(__classPrivateFieldGet(this, _ItemDatabase_itemData, "f"), data);
        if (key === undefined)
            throw new Error("Item not found!");
        const slot = Number(key);
        const orig = __classPrivateFieldGet(this, _ItemDatabase_itemData, "f")[slot].item;
        const copy = orig.clone();
        if (!keepItem)
            __classPrivateFieldGet(this, _ItemDatabase_instances, "m", _ItemDatabase_deleteItem).call(this, slot);
        return copy;
    }
    /**
     * 编辑已有槽位的数据
     */
    edit(oldData, newData) {
        if (!__classPrivateFieldGet(this, _ItemDatabase_loaded, "f"))
            throw new ReferenceError("Database is not loaded");
        const key = findIndexByValue(__classPrivateFieldGet(this, _ItemDatabase_itemData, "f"), oldData);
        if (key === undefined)
            throw new Error("Item not found!");
        const slot = Number(key);
        const merged = Object.assign(Object.assign({}, __classPrivateFieldGet(this, _ItemDatabase_itemData, "f")[slot]), newData);
        __classPrivateFieldGet(this, _ItemDatabase_database, "f").set(`slot_${slot}`, merged);
        __classPrivateFieldGet(this, _ItemDatabase_itemData, "f")[slot] = merged;
    }
    /**
     * 验证某 data 是否仍存在于数据库
     */
    isValid(data) {
        return findIndexByValue(__classPrivateFieldGet(this, _ItemDatabase_itemData, "f"), data) !== undefined;
    }
    /** 清空整个数据库并重置实体 */
    clear() {
        if (!__classPrivateFieldGet(this, _ItemDatabase_loaded, "f"))
            throw new ReferenceError("Database is not loaded");
        for (const e of __classPrivateFieldGet(this, _ItemDatabase_entities, "f"))
            e.remove();
        __classPrivateFieldSet(this, _ItemDatabase_entities, [], "f");
        __classPrivateFieldSet(this, _ItemDatabase_itemData, {}, "f");
        __classPrivateFieldGet(this, _ItemDatabase_database, "f").clear();
        // 重建空实体
        const e = world
            .getDimension("minecraft:overworld")
            .spawnEntity(ENTITY_TYPE_ID, { x: 8, y: 0, z: 8 });
        e.nameTag = `DB_${__classPrivateFieldGet(this, _ItemDatabase_name, "f")}`;
        e.addTag(`spawntime:${Date.now()}`);
        __classPrivateFieldGet(this, _ItemDatabase_entities, "f").push(e);
    }
    /**
     * 遍历所有 Item
     */
    forEach(callback) {
        if (!__classPrivateFieldGet(this, _ItemDatabase_loaded, "f"))
            throw new ReferenceError("Database is not loaded");
        for (const slot of Object.keys(__classPrivateFieldGet(this, _ItemDatabase_itemData, "f")).map((n) => Number(n))) {
            const it = this.get(slot);
            if (it)
                callback(it);
        }
    }
    /**
     * 硬重置：删除所有实体并重建
     */
    hardReset() {
        return __awaiter(this, void 0, void 0, function* () {
            __classPrivateFieldSet(this, _ItemDatabase_entities, [], "f");
            world
                .getDimension("minecraft:overworld")
                .getEntities()
                .filter((e) => e.typeId === ENTITY_TYPE_ID && e.nameTag === `DB_${__classPrivateFieldGet(this, _ItemDatabase_name, "f")}`)
                .forEach((e) => e.remove());
            yield new Promise((resolve) => {
                const id = system.run(() => {
                    if (__classPrivateFieldGet(this, _ItemDatabase_entities, "f").length === 0) {
                        const e = world
                            .getDimension("minecraft:overworld")
                            .spawnEntity(ENTITY_TYPE_ID, { x: 8, y: 0, z: 8 });
                        e.nameTag = `DB_${__classPrivateFieldGet(this, _ItemDatabase_name, "f")}`;
                        e.addTag(`spawntime:${Date.now()}`);
                        __classPrivateFieldGet(this, _ItemDatabase_entities, "f").push(e);
                        system.clearRun(id);
                        resolve();
                    }
                });
            });
            __classPrivateFieldSet(this, _ItemDatabase_itemData, {}, "f");
        });
    }
}
_ItemDatabase_name = new WeakMap(), _ItemDatabase_loaded = new WeakMap(), _ItemDatabase_entities = new WeakMap(), _ItemDatabase_itemData = new WeakMap(), _ItemDatabase_database = new WeakMap(), _ItemDatabase_instances = new WeakSet(), _ItemDatabase_findEmptySlot = function _ItemDatabase_findEmptySlot() {
    const empties = [];
    for (let i = 0; i < this.fullInventory; i++) {
        if (!__classPrivateFieldGet(this, _ItemDatabase_itemData, "f")[i])
            empties.push(i);
    }
    return empties;
}, _ItemDatabase_setItem = function _ItemDatabase_setItem(slot, item, data) {
    var _a;
    const entityIndex = Math.floor(slot / ITEM_MAX_PER_ENTITY);
    const entitySlot = slot % ITEM_MAX_PER_ENTITY;
    const ent = __classPrivateFieldGet(this, _ItemDatabase_entities, "f")[entityIndex];
    (_a = ent.getComponent("inventory")) === null || _a === void 0 ? void 0 : _a.container.setItem(entitySlot, item);
    const fullData = Object.assign({ slot, item }, data);
    __classPrivateFieldGet(this, _ItemDatabase_database, "f").set(`slot_${slot}`, fullData);
    __classPrivateFieldGet(this, _ItemDatabase_itemData, "f")[slot] = fullData;
    return fullData;
}, _ItemDatabase_deleteItem = function _ItemDatabase_deleteItem(slot) {
    var _a;
    const entityIndex = Math.floor(slot / ITEM_MAX_PER_ENTITY);
    const entitySlot = slot % ITEM_MAX_PER_ENTITY;
    const ent = __classPrivateFieldGet(this, _ItemDatabase_entities, "f")[entityIndex];
    const inv = (_a = ent.getComponent("inventory")) === null || _a === void 0 ? void 0 : _a.container;
    if (!inv)
        return;
    inv.setItem(entitySlot);
    // 如果一个实体已空且总实体数 >1，可删实体
    if (inv.emptySlotsCount >= ITEM_MAX_PER_ENTITY && __classPrivateFieldGet(this, _ItemDatabase_entities, "f").length > 1) {
        __classPrivateFieldGet(this, _ItemDatabase_entities, "f").splice(entityIndex, 1);
        ent.remove();
    }
    __classPrivateFieldGet(this, _ItemDatabase_database, "f").delete(`slot_${slot}`);
    delete __classPrivateFieldGet(this, _ItemDatabase_itemData, "f")[slot];
};
export default ItemDatabase;
//# sourceMappingURL=ItemDatabase.js.map