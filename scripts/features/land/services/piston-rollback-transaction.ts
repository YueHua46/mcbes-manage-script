import type { Vector3 } from "../../../core/types";
import type { PistonBlockMove } from "./piston-movement-plan";

export interface PistonRollbackCommitInput<TTerminalSnapshot> {
  moves: readonly PistonBlockMove[];
  terminalSnapshots: readonly TTerminalSnapshot[];
  clearLocations: readonly Vector3[];
  checkpointLocations: readonly Vector3[];
}

export interface PistonRollbackCommitAdapter<TMovedSnapshot, TTerminalSnapshot, TCheckpoint> {
  captureMoved(move: PistonBlockMove, index: number): TMovedSnapshot;
  captureCheckpoint(locations: readonly Vector3[]): TCheckpoint;
  clear(location: Vector3): void;
  restoreMoved(snapshot: TMovedSnapshot, move: PistonBlockMove): void;
  restoreTerminal(snapshot: TTerminalSnapshot): void;
  verifyMoved(snapshot: TMovedSnapshot, move: PistonBlockMove): void;
  verifyTerminal(snapshot: TTerminalSnapshot): void;
  restoreCheckpoint(checkpoint: TCheckpoint): void;
}

export interface PistonRollbackCommitResult<TMovedSnapshot, TCheckpoint> {
  status: "completed" | "precommit-failed" | "commit-reverted" | "checkpoint-restore-failed";
  mutated: boolean;
  movedSnapshots: readonly TMovedSnapshot[];
  checkpoint?: TCheckpoint;
  error?: unknown;
  checkpointError?: unknown;
}

/**
 * 先完成所有移动快照和检查点，再执行第一次世界写入。提交失败时只恢复完整检查点，
 * 不尝试继续执行剩余的猜测性写入。
 */
export function executePistonRollbackCommit<TMovedSnapshot, TTerminalSnapshot, TCheckpoint>(
  input: PistonRollbackCommitInput<TTerminalSnapshot>,
  adapter: PistonRollbackCommitAdapter<TMovedSnapshot, TTerminalSnapshot, TCheckpoint>
): PistonRollbackCommitResult<TMovedSnapshot, TCheckpoint> {
  const movedSnapshots: TMovedSnapshot[] = [];
  let checkpoint: TCheckpoint;
  try {
    for (let index = 0; index < input.moves.length; index++) {
      movedSnapshots.push(adapter.captureMoved(input.moves[index], index));
    }
    checkpoint = adapter.captureCheckpoint(input.checkpointLocations);
  } catch (error) {
    return { status: "precommit-failed", mutated: false, movedSnapshots, error };
  }

  try {
    for (const location of input.clearLocations) adapter.clear(location);
    for (let index = 0; index < input.moves.length; index++) {
      adapter.restoreMoved(movedSnapshots[index], input.moves[index]);
    }
    for (const snapshot of input.terminalSnapshots) adapter.restoreTerminal(snapshot);
    for (let index = 0; index < input.moves.length; index++) {
      adapter.verifyMoved(movedSnapshots[index], input.moves[index]);
    }
    for (const snapshot of input.terminalSnapshots) adapter.verifyTerminal(snapshot);
    return { status: "completed", mutated: true, movedSnapshots, checkpoint };
  } catch (error) {
    try {
      adapter.restoreCheckpoint(checkpoint);
      return { status: "commit-reverted", mutated: true, movedSnapshots, checkpoint, error };
    } catch (checkpointError) {
      return {
        status: "checkpoint-restore-failed",
        mutated: true,
        movedSnapshots,
        checkpoint,
        error,
        checkpointError,
      };
    }
  }
}
