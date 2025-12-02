/**
 * 服务器信息服务
 * 完整迁移自 Modules/Server.ts (53行)
 */

import { world } from "@minecraft/server";
import { getTPS } from "../../../shared/utils/tps";
import { oneSecondRunInterval } from "../../../shared/utils/common";

class Server {
  TPS: number = 0;
  organismLength: number = 0;
  itemsLength: number = 0;

  constructor() {
    this.getTps();
    this.getEntityLength();
    this.getItemsLength();
  }

  /**
   * 获取服务器TPS
   */
  getTps(): void {
    oneSecondRunInterval(() => (this.TPS = getTPS()));
  }

  /**
   * 获取实体数量
   */
  getEntityLength(): void {
    oneSecondRunInterval(() => {
      const owLength = world.getDimension("overworld").getEntities({
        excludeTypes: ["item"],
      }).length;
      const netherLength = world.getDimension("nether").getEntities({
        excludeTypes: ["item"],
      }).length;
      const endLength = world.getDimension("the_end").getEntities({
        excludeTypes: ["item"],
      }).length;
      this.organismLength = owLength + netherLength + endLength;
    });
  }

  /**
   * 获取掉落物数量
   */
  getItemsLength(): void {
    oneSecondRunInterval(() => {
      const owLength = world.getDimension("overworld").getEntities({
        type: "item",
      }).length;
      const netherLength = world.getDimension("nether").getEntities({
        type: "item",
      }).length;
      const endLength = world.getDimension("the_end").getEntities({
        type: "item",
      }).length;
      this.itemsLength = owLength + netherLength + endLength;
    });
  }
}

export default new Server();
