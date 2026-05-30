/**
 * runCommand 能力检测与安全包装。
 * 部分环境（Realms、权限受限）可能抛错或 successCount 为 0。
 */

import type { Dimension, Entity, Player } from "@minecraft/server";

export interface RunCommandResult {
  success: boolean;
  successCount: number;
}

function normalizeResult(successCount: number): RunCommandResult {
  return { success: successCount > 0, successCount };
}

function runCommandSafe(runner: () => { successCount: number }): RunCommandResult {
  try {
    return normalizeResult(runner().successCount);
  } catch {
    return { success: false, successCount: 0 };
  }
}

export function isRunCommandAvailable(entity: Entity | Player | Dimension): boolean {
  return typeof (entity as Entity).runCommand === "function";
}

export function runPlayerCommand(player: Player, command: string): RunCommandResult {
  if (!isRunCommandAvailable(player)) {
    return { success: false, successCount: 0 };
  }
  return runCommandSafe(() => player.runCommand(command));
}

export function runDimensionCommand(dimension: Dimension, command: string): RunCommandResult {
  if (!isRunCommandAvailable(dimension)) {
    return { success: false, successCount: 0 };
  }
  return runCommandSafe(() => dimension.runCommand(command));
}
