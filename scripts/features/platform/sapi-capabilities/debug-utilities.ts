/**
 * @minecraft/debug-utilities 能力包装。
 * 仅本地/BDS 调试版 manifest 声明此模块；Realms 兼容构建不应调用这里的运行时能力。
 */

import { isDebugUtilitiesBuild } from "./build-flags";

export type DebugUtilitiesModule = typeof import("@minecraft/debug-utilities");
export type DebugRuntimeStats = import("@minecraft/debug-utilities").RuntimeStats;
export type DebugPluginStats = import("@minecraft/debug-utilities").PluginStats;

let cachedModule: DebugUtilitiesModule | null | undefined;

export function isDebugUtilitiesAvailable(): boolean {
  return isDebugUtilitiesBuild();
}

export async function getDebugUtilities(): Promise<DebugUtilitiesModule | null> {
  if (!isDebugUtilitiesBuild()) return null;
  if (cachedModule !== undefined) return cachedModule;

  try {
    cachedModule = await import("@minecraft/debug-utilities");
  } catch {
    cachedModule = null;
  }

  return cachedModule;
}

export async function collectDebugRuntimeStats(): Promise<DebugRuntimeStats | null> {
  const debug = await getDebugUtilities();
  if (!debug) return null;

  try {
    return debug.collectRuntimeStats();
  } catch {
    return null;
  }
}

export async function collectDebugPluginStats(): Promise<DebugPluginStats | null> {
  const debug = await getDebugUtilities();
  if (!debug) return null;

  try {
    return debug.collectPluginStats();
  } catch {
    return null;
  }
}
