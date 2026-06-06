/**
 * @minecraft/server-admin 能力包装（BDS 增强版专用）。
 * 进服前拦截等 admin API 应经此模块注册，避免在事件处理器中直接 static import。
 */

import type { AsyncPlayerJoinBeforeEvent } from "@minecraft/server-admin";
import { isServerAdminBuild } from "./build-flags";

export type AsyncPlayerJoinHandler = (event: AsyncPlayerJoinBeforeEvent) => Promise<void>;

export function isServerAdminAvailable(): boolean {
  return isServerAdminBuild();
}

/**
 * 订阅 asyncPlayerJoin（进服前拦截）。
 * @returns 是否成功注册；非 BDS 构建或模块不可用时为 false。
 */
export async function subscribeAsyncPlayerJoin(handler: AsyncPlayerJoinHandler): Promise<boolean> {
  if (!isServerAdminBuild()) return false;

  try {
    const { beforeEvents } = await import("@minecraft/server-admin");
    beforeEvents.asyncPlayerJoin.subscribe(handler);
    return true;
  } catch {
    return false;
  }
}
