import { system } from "@minecraft/server";
import { Database } from "../Database";

/**
 * ChestUI 模块的设置类
 * 用于存储和管理 ChestUI 相关的配置
 */
class ChestUISetting {
  private db!: Database<any>;

  constructor() {
    system.run(() => {
      this.db = new Database<any>("chestUISetting");
      this.initDefaultSettings();
    });
  }

  /**
   * 初始化默认设置
   */
  private initDefaultSettings() {
    if (this.get("NumberOf_1_16_100_Items") === undefined) {
      this.set("NumberOf_1_16_100_Items", 0);
    }
  }

  /**
   * 获取设置值
   * @param key 设置键名
   * @returns 设置值
   */
  get(key: string): any {
    return this.db.get(key);
  }

  /**
   * 设置值
   * @param key 设置键名
   * @param value 设置值
   */
  set(key: string, value: any): void {
    this.db.set(key, value);
  }
}

export default new ChestUISetting();