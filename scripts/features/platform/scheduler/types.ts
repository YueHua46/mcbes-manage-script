export type TaskCategory = "core" | "land" | "economy" | "log" | "player" | "pvp" | "system";

export interface RegisterTaskOptions {
  /** 唯一标识，如 database.autoSave */
  id: string;
  /** 中文展示名 */
  label: string;
  intervalTicks: number;
  category?: TaskCategory;
  /** 返回 false 时跳过本次（模块开关等，不计入 skipCount） */
  when?: () => boolean;
  /** 上次仍在执行时跳过（防重入） */
  skipIfRunning?: boolean;
  /** 耗时超过 interval * ratio * 50ms 视为慢任务，触发降频 */
  slowThresholdRatio?: number;
  run: () => void | Promise<void>;
}

export interface TaskRuntimeSnapshot {
  id: string;
  label: string;
  category: TaskCategory;
  intervalTicks: number;
  enabled: boolean;
  runCount: number;
  skipCount: number;
  errorCount: number;
  slowCount: number;
  lastDurationMs: number;
  avgDurationMs: number;
  maxDurationMs: number;
  lastRunTick: number;
  isRunning: boolean;
  backoffSkips: number;
}
