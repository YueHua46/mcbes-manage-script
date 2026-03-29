/**
 * 防刷：方块坐标白名单存 world 动态属性；玩家侧「防刷白名单」存 setting（键 antiDupeTrustedPlacers）
 */

import type { Block, Dimension, Vector3 } from "@minecraft/server";
import { world } from "@minecraft/server";
import setting from "../system/services/setting";

const DP_WHITELIST_BLOCKS = "yuehua:antiDupeWhitelistedBlocks";
const MAX_BLOCK_KEYS = 5000;

export function blockKey(dimensionId: string, loc: Vector3): string {
  const x = Math.floor(loc.x);
  const y = Math.floor(loc.y);
  const z = Math.floor(loc.z);
  return `${dimensionId}:${x}:${y}:${z}`;
}

export function blockKeyFromBlock(block: Block): string {
  return blockKey(block.dimension.id, block.location);
}

function parseKeys(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const a = JSON.parse(raw) as unknown;
    if (!Array.isArray(a)) return [];
    return a.filter((x): x is string => typeof x === "string" && x.length > 0);
  } catch {
    return [];
  }
}

function saveKeys(keys: string[]): void {
  const unique = [...new Set(keys)];
  world.setDynamicProperty(DP_WHITELIST_BLOCKS, JSON.stringify(unique.slice(0, MAX_BLOCK_KEYS)));
}

export function isWhitelistedBlock(block: Block): boolean {
  const key = blockKeyFromBlock(block);
  const keys = parseKeys(world.getDynamicProperty(DP_WHITELIST_BLOCKS) as string | undefined);
  return keys.includes(key);
}

export function addWhitelistedBlock(block: Block): void {
  const key = blockKeyFromBlock(block);
  const keys = parseKeys(world.getDynamicProperty(DP_WHITELIST_BLOCKS) as string | undefined);
  if (keys.includes(key)) return;
  keys.push(key);
  saveKeys(keys);
}

export function removeWhitelistedBlockAt(dimension: Dimension, loc: Vector3): void {
  const key = blockKey(dimension.id, loc);
  const keys = parseKeys(world.getDynamicProperty(DP_WHITELIST_BLOCKS) as string | undefined);
  const next = keys.filter((k) => k !== key);
  if (next.length !== keys.length) {
    saveKeys(next);
  }
}

export function clearAllWhitelistedBlocks(): void {
  world.setDynamicProperty(DP_WHITELIST_BLOCKS, JSON.stringify([]));
}

/** 防刷白名单内的玩家名（放置受限容器时登记方块白名单） */
export function getTrustedPlacerNames(): Set<string> {
  const raw = String(setting.getState("antiDupeTrustedPlacers" as never) ?? "[]");
  try {
    const a = JSON.parse(raw) as unknown;
    if (!Array.isArray(a)) return new Set();
    return new Set(a.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim()));
  } catch {
    return new Set();
  }
}

/** 写入防刷白名单玩家列表 */
export function setTrustedPlacerNames(names: string[]): void {
  const unique = [...new Set(names.map((n) => n.trim()).filter((n) => n.length > 0))];
  setting.setState("antiDupeTrustedPlacers" as never, JSON.stringify(unique));
}

/** 是否在防刷白名单中 */
export function isTrustedPlacer(playerName: string): boolean {
  return getTrustedPlacerNames().has(playerName.trim());
}
