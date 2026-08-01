/**
 * Realms 不提供新版模拟玩家模块。
 *
 * 正常流程会在进入这里之前拒绝新版假人请求；保留显式异常作为最后一道
 * 防线，避免未来调用点绕过构建能力判断后静默失败。
 */

import type { DimensionLocation, GameMode, Player } from "@minecraft/server";

export type SimulatedPlayer = Player;

export function spawnSupportedSimulatedPlayer(_location: DimensionLocation, _name: string, _gameMode: GameMode): never {
  throw new Error("Realms 兼容版不支持新版模拟玩家");
}
