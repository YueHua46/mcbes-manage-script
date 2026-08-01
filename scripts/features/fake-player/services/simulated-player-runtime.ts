/**
 * 新版模拟玩家运行时边界。
 *
 * Realms 构建会在打包阶段将本模块替换为无 GameTest 依赖的兼容实现。
 */

import { spawnSimulatedPlayer as spawnFromGameTest, type SimulatedPlayer } from "@minecraft/server-gametest";

export type { SimulatedPlayer };
export const spawnSupportedSimulatedPlayer = spawnFromGameTest;
