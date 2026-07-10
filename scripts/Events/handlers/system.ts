/**
 * 系统相关事件处理器
 */

import { system, world } from "@minecraft/server";
import { eventRegistry } from "../registry";
import setting from "../../features/system/services/setting";
import { taskScheduler } from "../../features/platform/scheduler";
import { useItems } from "../../shared/hooks/use-items";
import { otherGlyphMap } from "../../assets/glyph-map";

/**
 * 注册系统事件处理器
 */
export function registerSystemEvents(): void {
  let isRunning = false;

  taskScheduler.register({
    id: "system.killDroppedItems",
    label: "掉落物超限清理",
    category: "system",
    intervalTicks: 20,
    when: () => {
      const killItemAmount = setting.getState("killItemAmount");
      return Boolean(killItemAmount) && setting.getState("killItem") === true;
    },
    skipIfRunning: true,
    run: async () => {
      const killItemAmount = setting.getState("killItemAmount");
      if (isRunning || !killItemAmount) return;

      const items = useItems();
      const other = otherGlyphMap;

      if (items.length > Number(killItemAmount)) {
        isRunning = true;
        try {
          for (let remaining = 30; remaining >= 1; remaining--) {
            if (remaining === 30 || remaining === 20 || remaining === 10 || remaining <= 9) {
              world.sendMessage(`${other.note} §e服务器掉落物过多，将在 §c${remaining} §e秒后自动清理！`);
            }
            await system.waitTicks(20);
          }
          const latestItems = useItems();
          latestItems.forEach((item) => {
            try {
              item.kill();
            } catch {
              // 实体可能刚好被拾取或卸载。
            }
          });
          world.sendMessage(`${other.note} §a掉落物清理完成，共处理 ${latestItems.length} 个掉落物。`);
        } finally {
          isRunning = false;
        }
      }
    },
  });
}

// 注册到事件中心
eventRegistry.register("system", registerSystemEvents);
