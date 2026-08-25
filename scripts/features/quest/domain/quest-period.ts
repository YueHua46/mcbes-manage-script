import type { QuestScope } from "./quest-types";

export interface QuestPeriodConfig {
  utcOffsetMinutes: number;
  dailyResetHour: number;
  weekStartsOn: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  weeklyKeyMode: "legacy" | "iso" | "start_date";
}

export const LEGACY_QUEST_PERIOD_CONFIG: QuestPeriodConfig = {
  utcOffsetMinutes: 8 * 60,
  dailyResetHour: 0,
  weekStartsOn: 1,
  weeklyKeyMode: "legacy",
};

export const DEFAULT_QUEST_PERIOD_CONFIG: QuestPeriodConfig = {
  utcOffsetMinutes: 8 * 60,
  dailyResetHour: 0,
  weekStartsOn: 1,
  weeklyKeyMode: "iso",
};

const DAY_MS = 24 * 60 * 60 * 1000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function shiftedDate(at: number, config: QuestPeriodConfig): Date {
  const resetOffsetMs = config.dailyResetHour * 60 * 60 * 1000;
  return new Date(at + config.utcOffsetMinutes * 60 * 1000 - resetOffsetMs);
}

function formatDate(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function resolveLegacyWeeklyKey(date: Date): string {
  const year = date.getUTCFullYear();
  const weekStart = new Date(Date.UTC(year, date.getUTCMonth(), date.getUTCDate()));
  const dayOfWeek = weekStart.getUTCDay() || 7;
  weekStart.setUTCDate(weekStart.getUTCDate() - dayOfWeek + 1);
  const week = Math.ceil(((weekStart.getTime() - Date.UTC(weekStart.getUTCFullYear(), 0, 1)) / DAY_MS + 1) / 7);
  return `${weekStart.getUTCFullYear()}-W${pad(week)}`;
}

function resolveIsoWeeklyKey(date: Date): string {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const isoYear = target.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${isoYear}-W${pad(week)}`;
}

function resolveWeekStartDate(date: Date, weekStartsOn: QuestPeriodConfig["weekStartsOn"]): string {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const current = start.getUTCDay() || 7;
  const offset = (current - weekStartsOn + 7) % 7;
  start.setUTCDate(start.getUTCDate() - offset);
  return `week:${formatDate(start)}`;
}

export function resolvePeriodKey(
  scope: QuestScope,
  at = Date.now(),
  config: QuestPeriodConfig = DEFAULT_QUEST_PERIOD_CONFIG
): string {
  if (scope === "once" || scope === "repeatable") return scope;
  if (!Number.isFinite(at)) throw new Error("Quest period timestamp must be finite");

  const date = shiftedDate(at, config);
  if (scope === "daily") return formatDate(date);
  if (config.weeklyKeyMode === "legacy") return resolveLegacyWeeklyKey(date);
  if (config.weeklyKeyMode === "iso" && config.weekStartsOn === 1) return resolveIsoWeeklyKey(date);
  return resolveWeekStartDate(date, config.weekStartsOn);
}
