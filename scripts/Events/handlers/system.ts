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
        world.sendMessage(`${other.note} §e服务器掉落物过多，即将在30秒后清理掉落物！`);
        await system.waitTicks(20 * 25);
        world.sendMessage(`${other.note} §e即将在5秒后清理掉落物！`);
        await system.waitTicks(20 * 2);
        world.sendMessage(`${other.note} §e3...`);
        await system.waitTicks(20 * 1);
        world.sendMessage(`${other.note} §e2...`);
        await system.waitTicks(20 * 1);
        world.sendMessage(`${other.note} §e1...`);
        useItems().forEach((i) => i.kill());
        await system.waitTicks(20 * 1);
        world.sendMessage(`${other.note} §a掉落物清理完成`);
        isRunning = false;
      }
    },
  });
}

// 注册到事件中心
eventRegistry.register("system", registerSystemEvents);
