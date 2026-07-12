/**
 * 服务器信息服务
 * 完整迁移自 Modules/Server.ts (53行)
 */

import { world } from "@minecraft/server";
import { getTPS } from "../../../shared/utils/tps";
import { taskScheduler } from "../../platform/scheduler";

const ITEM_ENTITY_TYPE_ID = "minecraft:item";
const TRACKED_DIMENSIONS = [
  "overworld",
  "nether",
  "the_end",
];

function countEntities(query: { type?: string; excludeTypes?: string[] }): number {
  let total = 0;
  for (const dimensionId of TRACKED_DIMENSIONS) {
    try {
      total += world.getDimension(dimensionId).getEntities(query).length;
    } catch {
      // 维度不存在或尚未加载时跳过，避免统计任务中断。
    }
  }
  return total;
}

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
      label: "其他实体统计",
      category: "core",
      intervalTicks: 20,
      run: () => {
        this.organismLength = countEntities({ excludeTypes: [ITEM_ENTITY_TYPE_ID] });
      },
    });

    taskScheduler.register({
      id: "server.itemCount",
      label: "掉落物统计",
      category: "core",
      intervalTicks: 20,
      run: () => {
        this.itemsLength = countEntities({ type: ITEM_ENTITY_TYPE_ID });
      },
    });
  }
}

export default new Server();
