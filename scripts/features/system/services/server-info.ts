/**
 * 服务器信息服务
 * 完整迁移自 Modules/Server.ts (53行)
 */

import { world } from "@minecraft/server";
import { getTPS } from "../../../shared/utils/tps";
import { taskScheduler } from "../../platform/scheduler";

class Server {
  TPS: number = 0;
  organismLength: number = 0;
  itemsLength: number = 0;

  constructor() {
    this.registerScheduledTasks();
  }

  private registerScheduledTasks(): void {
    taskScheduler.register({
      id: "server.tps",
      label: "TPS 采样",
      category: "core",
      intervalTicks: 20,
      run: () => {
        this.TPS = getTPS();
      },
    });

    taskScheduler.register({
      id: "server.entityCount",
      label: "生物实体统计",
      category: "core",
      intervalTicks: 20,
      run: () => {
        const owLength = world.getDimension("overworld").getEntities({ excludeTypes: ["item"] }).length;
        const netherLength = world.getDimension("nether").getEntities({ excludeTypes: ["item"] }).length;
        const endLength = world.getDimension("the_end").getEntities({ excludeTypes: ["item"] }).length;
        this.organismLength = owLength + netherLength + endLength;
      },
    });

    taskScheduler.register({
      id: "server.itemCount",
      label: "掉落物统计",
      category: "core",
      intervalTicks: 20,
      run: () => {
        const owLength = world.getDimension("overworld").getEntities({ type: "item" }).length;
        const netherLength = world.getDimension("nether").getEntities({ type: "item" }).length;
        const endLength = world.getDimension("the_end").getEntities({ type: "item" }).length;
        this.itemsLength = owLength + netherLength + endLength;
      },
    });
  }
}

export default new Server();
