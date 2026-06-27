/**
 * 玩家相关钩子
 */

import { Player } from "@minecraft/server";
import { getOnlineRealPlayerByName, getOnlineRealPlayerCount, getOnlineRealPlayers } from "../utils/online-players";

/**
 * 通过名字获取玩家
 */
export function usePlayerByName(name: string): Player | undefined {
  return getOnlineRealPlayerByName(name);
}

/**
 * 获取所有在线玩家
 */
export function useAllPlayers(): Player[] {
  return getOnlineRealPlayers();
}

/**
 * 获取玩家数量
 */
export function usePlayerCount(): number {
  return getOnlineRealPlayerCount();
}
