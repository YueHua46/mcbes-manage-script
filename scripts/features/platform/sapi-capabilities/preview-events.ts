/**
 * 预览版 beforeEvents 能力检测与 fallback。
 * 部分事件仅在 preview API 存在；不存在时尝试 afterEvents 或跳过。
 */

import { world } from "@minecraft/server";

type EventSignal<T = unknown> = {
  subscribe?: (handler: (event: T) => void) => void;
};

function pickEventSignal<T>(beforeKey: string, afterKey?: string): EventSignal<T> | undefined {
  const beforeEvents = world.beforeEvents as unknown as Record<string, EventSignal<T> | undefined>;
  const afterEvents = world.afterEvents as unknown as Record<string, EventSignal<T> | undefined>;

  const before = beforeEvents[beforeKey];
  if (typeof before?.subscribe === "function") return before;

  if (afterKey) {
    const after = afterEvents[afterKey];
    if (typeof after?.subscribe === "function") return after;
  }

  return undefined;
}

export function subscribePreviewEvent<T>(beforeKey: string, handler: (event: T) => void, afterKey?: string): boolean {
  const signal = pickEventSignal<T>(beforeKey, afterKey);
  if (!signal?.subscribe) return false;

  signal.subscribe(handler);
  return true;
}

export function isPreviewEventAvailable(beforeKey: string, afterKey?: string): boolean {
  return pickEventSignal(beforeKey, afterKey)?.subscribe !== undefined;
}
