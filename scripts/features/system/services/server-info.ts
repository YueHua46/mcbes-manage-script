/**
 * 服务器信息服务
 * 完整迁移自 Modules/Server.ts (53行)
 */

import { world } from "@minecraft/server";
import { getTPS } from "../../../shared/utils/tps";

const ITEM_ENTITY_TYPE_ID = "minecraft:item";
const TRACKED_DIMENSIONS = ["overworld", "nether", "the_end"];

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
  organismLength: number = 0;
  itemsLength: number = 0;
  private lastEntityRefreshAt = 0;

  get TPS(): number {
    return getTPS();
  }

  constructor() {
    // Entity enumeration allocates native BDS wrappers. Keep it on demand and
    // briefly cached instead of scanning every dimension every second forever.
  }

  refreshEntityCounts(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastEntityRefreshAt < 5000) return;
    this.lastEntityRefreshAt = now;
    this.organismLength = countEntities({ excludeTypes: [ITEM_ENTITY_TYPE_ID] });
    this.itemsLength = countEntities({ type: ITEM_ENTITY_TYPE_ID });
  }
}

export default new Server();
