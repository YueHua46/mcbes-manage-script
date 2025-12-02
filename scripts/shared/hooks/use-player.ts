/**
 * 玩家相关钩子
 */

import { world, Player } from '@minecraft/server';

/**
 * 通过名字获取玩家
 */
export function usePlayerByName(name: string): Player | undefined {
  return world.getAllPlayers().find(p => p.name === name);
}

/**
 * 获取所有在线玩家
 */
export function useAllPlayers(): Player[] {
  return world.getAllPlayers();
}

/**
 * 获取玩家数量
 */
export function usePlayerCount(): number {
  return world.getAllPlayers().length;
}


