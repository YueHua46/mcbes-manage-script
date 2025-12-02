/**
 * ChestUI设置管理
 * 迁移自 Modules/ChestUI/Setting.ts (47行)
 */

import { system } from "@minecraft/server";
import { Database } from "../../../shared/database/database";

class ChestUISetting {
  private db!: Database<any>;

  constructor() {
    system.run(() => {
      this.db = new Database<any>("chestUISetting");
      this.initDefaultSettings();
    });
  }

  private initDefaultSettings(): void {
    if (this.get("NumberOf_1_16_100_Items") === undefined) {
      this.set("NumberOf_1_16_100_Items", 0);
    }
  }

  get(key: string): any {
    return this.db.get(key);
  }

  set(key: string, value: any): void {
    this.db.set(key, value);
  }
}

export default new ChestUISetting();
