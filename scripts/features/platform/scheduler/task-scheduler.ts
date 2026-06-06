import { system } from "@minecraft/server";
import type { RegisterTaskOptions, TaskCategory, TaskRuntimeSnapshot } from "./types";

const TICK_MS = 50;
const DEFAULT_SLOW_RATIO = 0.5;
const BACKOFF_SKIP_COUNT = 1;

interface InternalTask extends RegisterTaskOptions {
  category: TaskCategory;
  enabled: boolean;
  runId?: number;
  isRunning: boolean;
  runCount: number;
  skipCount: number;
  errorCount: number;
  slowCount: number;
  totalDurationMs: number;
  lastDurationMs: number;
  maxDurationMs: number;
  lastRunTick: number;
  backoffSkips: number;
  slowThresholdRatio: number;
}

class TaskScheduler {
  private readonly tasks = new Map<string, InternalTask>();

  register(options: RegisterTaskOptions): () => void {
    const existing = this.tasks.get(options.id);
    if (existing?.runId !== undefined) {
      system.clearRun(existing.runId);
    }

    const task: InternalTask = {
      ...options,
      category: options.category ?? "system",
      enabled: true,
      isRunning: false,
      runCount: 0,
      skipCount: 0,
      errorCount: 0,
      slowCount: 0,
      totalDurationMs: 0,
      lastDurationMs: 0,
      maxDurationMs: 0,
      lastRunTick: 0,
      backoffSkips: 0,
      slowThresholdRatio: options.slowThresholdRatio ?? DEFAULT_SLOW_RATIO,
    };

    task.runId = system.runInterval(() => {
      void this.execute(task);
    }, options.intervalTicks);

    this.tasks.set(options.id, task);
    return () => this.unregister(options.id);
  }

  unregister(id: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    if (task.runId !== undefined) {
      system.clearRun(task.runId);
    }
    this.tasks.delete(id);
  }

  setEnabled(id: string, enabled: boolean): void {
    const task = this.tasks.get(id);
    if (task) {
      task.enabled = enabled;
    }
  }

  isEnabled(id: string): boolean {
    return this.tasks.get(id)?.enabled ?? false;
  }

  getSnapshots(): TaskRuntimeSnapshot[] {
    return [...this.tasks.values()].map((task) => this.toSnapshot(task));
  }

  getTopByAvgDuration(limit = 6): TaskRuntimeSnapshot[] {
    return this.getSnapshots()
      .filter((task) => task.runCount > 0)
      .sort((a, b) => b.avgDurationMs - a.avgDurationMs)
      .slice(0, limit);
  }

  formatPanelSection(limit = 5): string {
    const top = this.getTopByAvgDuration(limit);
    if (top.length === 0) {
      return "调度任务：暂无运行数据";
    }

    return top
      .map((task) => {
        const intervalSec = (task.intervalTicks / 20).toFixed(1).replace(/\.0$/, "");
        const flag = task.enabled ? "" : " [停]";
        const slow = task.slowCount > 0 ? ` 慢×${task.slowCount}` : "";
        return `${task.label}${flag}  均${task.avgDurationMs.toFixed(1)}ms  ${intervalSec}s${slow}`;
      })
      .join("\n");
  }

  private async execute(task: InternalTask): Promise<void> {
    if (!task.enabled) {
      return;
    }

    if (task.when && !task.when()) {
      return;
    }

    if (task.backoffSkips > 0) {
      task.backoffSkips -= 1;
      task.skipCount += 1;
      return;
    }

    if (task.skipIfRunning && task.isRunning) {
      task.skipCount += 1;
      return;
    }

    const startedAt = Date.now();
    task.isRunning = true;

    try {
      await task.run();
      const durationMs = Date.now() - startedAt;
      task.runCount += 1;
      task.lastDurationMs = durationMs;
      task.totalDurationMs += durationMs;
      task.maxDurationMs = Math.max(task.maxDurationMs, durationMs);
      task.lastRunTick = system.currentTick;

      const slowLimitMs = task.intervalTicks * TICK_MS * task.slowThresholdRatio;
      if (durationMs > slowLimitMs) {
        task.slowCount += 1;
        task.backoffSkips = BACKOFF_SKIP_COUNT;
      }
    } catch {
      task.errorCount += 1;
    } finally {
      task.isRunning = false;
    }
  }

  private toSnapshot(task: InternalTask): TaskRuntimeSnapshot {
    return {
      id: task.id,
      label: task.label,
      category: task.category,
      intervalTicks: task.intervalTicks,
      enabled: task.enabled,
      runCount: task.runCount,
      skipCount: task.skipCount,
      errorCount: task.errorCount,
      slowCount: task.slowCount,
      lastDurationMs: task.lastDurationMs,
      avgDurationMs: task.runCount > 0 ? task.totalDurationMs / task.runCount : 0,
      maxDurationMs: task.maxDurationMs,
      lastRunTick: task.lastRunTick,
      isRunning: task.isRunning,
      backoffSkips: task.backoffSkips,
    };
  }
}

export const taskScheduler = new TaskScheduler();
