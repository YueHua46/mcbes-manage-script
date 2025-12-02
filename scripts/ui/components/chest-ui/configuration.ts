/**
 * ChestUI配置管理
 * 迁移自 Modules/ChestUI/Configuration.ts (76行)
 */

import { system } from "@minecraft/server";
import { Database } from "../../../shared/database/database";
import setting from "../../../features/system/services/setting";

class Configuration {
  private db!: Database<any>;

  constructor() {
    system.run(() => {
      this.db = new Database<any>("chestUIConfig");
      this.initDefaultConfig();
    });
  }

  private initDefaultConfig(): void {
    const defaultConfigs = {
      enableInventoryDisplay: true,
      maxStackSize: 64,
      defaultChestSize: "small",
    };

    for (const [key, value] of Object.entries(defaultConfigs)) {
      if (this.get(key) === undefined) {
        this.set(key, value);
      }
    }
  }

  get(key: string): any {
    return this.db.get(key);
  }

  set(key: string, value: any): void {
    this.db.set(key, value);
  }

  getSystemSetting(key: any): any {
    return setting.getState(key);
  }
}

export default new Configuration();
