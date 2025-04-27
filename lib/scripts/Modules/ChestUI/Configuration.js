import { system } from "@minecraft/server";
import { Database } from "../Database";
import systemSetting from "../System/Setting";
/**
 * ChestUI 模块的配置类
 * 用于管理 ChestUI 的配置项
 */
class Configuration {
    /**
     * 构造函数，初始化配置
     */
    constructor() {
        system.run(() => {
            // 创建数据库实例
            this.db = new Database("chestUIConfig");
            // 初始化默认配置
            this.initDefaultConfig();
        });
    }
    /**
     * 初始化默认配置
     * 设置ChestUI模块的基本配置项
     */
    initDefaultConfig() {
        // 设置默认配置项
        const defaultConfigs = {
            enableInventoryDisplay: true, // 是否显示物品栏
            maxStackSize: 64, // 最大堆叠数量
            defaultChestSize: "small", // 默认箱子大小
        };
        // 检查并设置默认值
        for (const [key, value] of Object.entries(defaultConfigs)) {
            if (this.get(key) === undefined) {
                this.set(key, value);
            }
        }
    }
    /**
     * 获取配置值
     * @param key 配置键名
     * @returns 配置值
     */
    get(key) {
        return this.db.get(key);
    }
    /**
     * 设置配置值
     * @param key 配置键名
     * @param value 配置值
     */
    set(key, value) {
        this.db.set(key, value);
    }
    /**
     * 获取系统设置
     * 这是一个桥接方法，用于访问系统设置
     * @param key 系统设置键名
     * @returns 系统设置值
     */
    getSystemSetting(key) {
        return systemSetting.getState(key);
    }
}
// 导出配置实例
export default new Configuration();
//# sourceMappingURL=Configuration.js.map