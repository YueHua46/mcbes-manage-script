/**
 * 全服「登记拿到某物品时记背包」的 typeId 列表（world DynamicProperty）。
 * 仅管理员可通过命令或管理界面修改；任意玩家获得列表中的物品类型时都会触发记录。
 *
 * 保留字 {@link SPAWN_EGG_GROUP_TOKEN}：登记后匹配任意 typeId 以 `_spawn_egg` 结尾的物品（含未知作弊 ID）。
 */

import type { Player } from "@minecraft/server";
import { world } from "@minecraft/server";

const DP_KEY = "yuehua:itemWatchGlobalSubscriptions";
const MAX_SUBS = 16;

/** 写入列表的固定 token；匹配逻辑见 {@link matchesItemWatchSubscribedType} */
export const SPAWN_EGG_GROUP_TOKEN = "__spawn_egg_group__";

function normalizeSubscriptionEntry(raw: string): string {
  const t = raw.trim();
  const lower = t.toLowerCase();
  if (lower === SPAWN_EGG_GROUP_TOKEN.toLowerCase() || lower === "spawn_egg_group") {
    return SPAWN_EGG_GROUP_TOKEN;
  }
  return t;
}

/** 列表/命令展示用（不改变存储 id） */
export function formatItemWatchSubscriptionLabel(id: string): string {
  if (id === SPAWN_EGG_GROUP_TOKEN) {
    return "全部生成蛋（任意 …_spawn_egg）";
  }
  return id;
}

/** 事件侧：当前物品 typeId 是否命中任一登记规则 */
export function matchesItemWatchSubscribedType(typeId: string): boolean {
  if (!typeId) return false;
  const subs = getSubscribedTypeIds();
  if (subs.has(typeId)) return true;
  if (subs.has(SPAWN_EGG_GROUP_TOKEN) && typeId.toLowerCase().endsWith("_spawn_egg")) {
    return true;
  }
  return false;
}

export function getSubscribedTypeIds(): Set<string> {
  const raw = world.getDynamicProperty(DP_KEY) as string | undefined;
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === "string" && x.trim().length > 0));
  } catch {
    return new Set();
  }
}

export function setSubscribedTypeIds(ids: string[]): void {
  world.setDynamicProperty(DP_KEY, JSON.stringify(ids.slice(0, MAX_SUBS)));
}

/** `_player` 仅占位，与历史签名兼容；列表为全服共享。 */
export function addSubscription(_player: Player, typeId: string): { ok: boolean; message: string } {
  const t = normalizeSubscriptionEntry(typeId);
  if (!t) return { ok: false, message: "物品类型编号不能为空。" };
  const set = getSubscribedTypeIds();
  if (set.has(t)) return { ok: false, message: "这种物品已经在全服登记列表里了。" };
  if (set.size >= MAX_SUBS) return { ok: false, message: `全服最多只能登记 ${MAX_SUBS} 种物品。` };
  set.add(t);
  setSubscribedTypeIds([...set]);
  const shown = t === SPAWN_EGG_GROUP_TOKEN ? formatItemWatchSubscriptionLabel(t) : t;
  return { ok: true, message: `已登记监控：§b${shown}` };
}

export function removeSubscription(_player: Player, typeId: string): { ok: boolean; message: string } {
  const t = normalizeSubscriptionEntry(typeId);
  if (!t) return { ok: false, message: "物品类型编号不能为空。" };
  const set = getSubscribedTypeIds();
  if (!set.has(t)) return { ok: false, message: "全服列表里没有登记这种物品。" };
  set.delete(t);
  setSubscribedTypeIds([...set]);
  const shown = t === SPAWN_EGG_GROUP_TOKEN ? formatItemWatchSubscriptionLabel(t) : t;
  return { ok: true, message: `已取消对这种物品的监控：§b${shown}` };
}

export function clearSubscriptions(_player: Player): void {
  world.setDynamicProperty(DP_KEY, JSON.stringify([]));
}

export function listSubscriptions(_player: Player): string[] {
  return [...getSubscribedTypeIds()].sort((a, b) => a.localeCompare(b, "en"));
}

