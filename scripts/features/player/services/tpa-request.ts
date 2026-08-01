/**
 * TPA 待处理请求存储与超时自动拒绝
 */

import { Player } from "@minecraft/server";
import { system } from "@minecraft/server";
import { notifyTimeout } from "./tpa-logic";

const TPA_TIMEOUT_TICKS = 60 * 20; // 60 秒

interface PendingRequest {
  id: number;
  requestPlayerName: string;
  type: "to" | "come";
  timeoutId: number;
}

const pendingByTarget = new Map<string, PendingRequest>();
let nextRequestId = 1;

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
): { ok: true; requestId: number } | { ok: false; requestPlayerName: string } {
  const key = targetPlayer.name;
  const existing = pendingByTarget.get(key);
  if (existing) {
    return { ok: false, requestPlayerName: existing.requestPlayerName };
  }

  const requestId = nextRequestId++;

  const timeoutId = system.runTimeout(() => {
    const req = pendingByTarget.get(key);
    if (!req || req.id !== requestId) return;
    pendingByTarget.delete(key);
    notifyTimeout(req.requestPlayerName, key);
  }, TPA_TIMEOUT_TICKS);

  pendingByTarget.set(key, {
    id: requestId,
    requestPlayerName: requestPlayer.name,
    type,
    timeoutId,
  });
  return { ok: true, requestId };
}

/** 判断指定请求是否仍是目标玩家当前等待处理的请求。 */
export function isPendingRequest(targetPlayerName: string, requestId: number): boolean {
  return pendingByTarget.get(targetPlayerName)?.id === requestId;
}

/**
 * 取走并移除目标玩家当前待处理的 TPA 请求（用于接受/拒绝时）
 */
export function takePendingRequest(
  targetPlayerName: string,
  requestId?: number
): { requestPlayerName: string; type: "to" | "come" } | undefined {
  const entry = pendingByTarget.get(targetPlayerName);
  if (!entry || (requestId !== undefined && entry.id !== requestId)) return undefined;
  system.clearRun(entry.timeoutId);
  pendingByTarget.delete(targetPlayerName);
  return { requestPlayerName: entry.requestPlayerName, type: entry.type };
}

/** 仅在编号匹配时取消请求，防止旧弹窗误删后来发送的新请求。 */
export function cancelPendingRequest(targetPlayerName: string, requestId: number): boolean {
  const entry = pendingByTarget.get(targetPlayerName);
  if (!entry || entry.id !== requestId) return false;
  clearTimeoutForTarget(targetPlayerName);
  return true;
}

/**
 * 超时时间（秒），用于提示文案
 */
export const TPA_TIMEOUT_SECONDS = TPA_TIMEOUT_TICKS / 20;
