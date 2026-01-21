/**
 * 通用工具函数
 */

import { CommandPermissionLevel, Player, PlayerPermissionLevel, system, world } from "@minecraft/server";

/**
 * 防抖函数
 */
export function debounce(fn: Function, delay: number, context?: any): void {
  const key = context?.id || "global";
  const now = Date.now();
  const lastTime = debounceTimers.get(key) || 0;

  if (now - lastTime < delay) return;

  debounceTimers.set(key, now);
  fn.call(context);
}

const debounceTimers = new Map<string, number>();

/**
 * 节流函数 - 每N秒执行一次
 */
export function oneSecondRunInterval(fn: Function): void {
  system.runInterval(fn as any, 20);
}

/**
 * 检查玩家是否是管理员
 */
export function isAdmin(player: Player): boolean {
  return player.hasTag("admin") || player.playerPermissionLevel === PlayerPermissionLevel.Operator;
}

/**
 * 系统日志
 */
export class SystemLog {
  static info(message: string): void {
    console.info(`${message}`);
  }

  static error(message: string, error?: any): void {
    console.error(`${message}`, error);
  }

  static warn(message: string): void {
    console.warn(`${message}`);
  }

  static debug(message: string): void {
    console.debug(`${message}`);
  }
}

/**
 * 生成唯一ID
 */
export function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 获取所有物品实体
 */
export function getAllItems() {
  const items: any[] = [];
  const dimensions = ["overworld", "nether", "the_end"] as const;

  dimensions.forEach((dimId) => {
    const dimension = world.getDimension(dimId);
    const dimItems = dimension.getEntities({ type: "minecraft:item" });
    items.push(...dimItems);
  });

  return items;
}

/**
 * 延迟执行
 */
export async function delay(ticks: number): Promise<void> {
  return system.waitTicks(ticks);
}
