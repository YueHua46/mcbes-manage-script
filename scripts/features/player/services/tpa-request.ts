/**
 * TPA 待处理请求存储与超时自动拒绝（勿扰模式下使用）
 */

import { Player } from "@minecraft/server";
import { system } from "@minecraft/server";
import { notifyTimeout } from "./tpa-logic";

const TPA_TIMEOUT_TICKS = 60 * 20; // 60 秒

interface PendingRequest {
  requestPlayerName: string;
  type: "to" | "come";
  timeoutId: number;
}

const pendingByTarget = new Map<string, PendingRequest>();

function clearTimeoutForTarget(targetPlayerName: string): void {
  const entry = pendingByTarget.get(targetPlayerName);
  if (entry) {
    system.clearRun(entry.timeoutId);
    pendingByTarget.delete(targetPlayerName);
  }
}

/**
 * 向目标玩家添加一条待处理的 TPA 请求，并安排超时自动拒绝
 */
export function addPendingRequest(
  targetPlayer: Player,
  requestPlayer: Player,
  type: "to" | "come"
): void {
  const key = targetPlayer.name;
  clearTimeoutForTarget(key);

  const timeoutId = system.runTimeout(() => {
    if (!pendingByTarget.has(key)) return;
    const req = pendingByTarget.get(key)!;
    pendingByTarget.delete(key);
    notifyTimeout(req.requestPlayerName, key);
  }, TPA_TIMEOUT_TICKS);

  pendingByTarget.set(key, {
    requestPlayerName: requestPlayer.name,
    type,
    timeoutId,
  });
}

/**
 * 取走并移除目标玩家当前待处理的 TPA 请求（用于接受/拒绝时）
 */
export function takePendingRequest(targetPlayerName: string): { requestPlayerName: string; type: "to" | "come" } | undefined {
  const entry = pendingByTarget.get(targetPlayerName);
  if (!entry) return undefined;
  system.clearRun(entry.timeoutId);
  pendingByTarget.delete(targetPlayerName);
  return { requestPlayerName: entry.requestPlayerName, type: entry.type };
}

/**
 * 超时时间（秒），用于提示文案
 */
export const TPA_TIMEOUT_SECONDS = TPA_TIMEOUT_TICKS / 20;
