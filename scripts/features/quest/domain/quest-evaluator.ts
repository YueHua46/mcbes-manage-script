import type {
  LegacyCounterGoalDefinition,
  LegacyQuestDefinition,
  QuestDistinctSetGoalState,
  QuestFilter,
  QuestDefinitionV2,
  QuestGoalDefinitionV2,
  QuestGoalState,
  QuestMilestoneGoalState,
  QuestNumberGoalState,
  QuestSnapshotGoalState,
  QuestSnapshotMode,
} from "./quest-types";

export type QuestEventPayload = Readonly<Record<string, unknown>>;

function asList(value: QuestFilter["value"]): string[] {
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

export function normalizeDimension(value: unknown): string {
  const text = String(value ?? "");
  return text.startsWith("minecraft:") ? text.slice("minecraft:".length) : text;
}

export function matchesFilter(filter: QuestFilter | undefined, actual: string | number | boolean | undefined): boolean {
  if (!filter) return true;
  if (actual === undefined) return false;

  if (filter.op === "eq") return String(actual) === String(filter.value);
  if (filter.op === "in") return asList(filter.value).includes(String(actual));
  if (filter.op === "contains") return String(actual).includes(String(filter.value));

  const actualNumber = Number(actual);
  const expectedNumber = Number(filter.value);
  if (!Number.isFinite(actualNumber) || !Number.isFinite(expectedNumber)) return false;
  if (filter.op === "gte") return actualNumber >= expectedNumber;
  if (filter.op === "lte") return actualNumber <= expectedNumber;
  return false;
}

export function legacyGoalMatches(goal: LegacyCounterGoalDefinition, payload: QuestEventPayload): boolean {
  return Object.entries(goal.filters).every(([key, filter]) => {
    const raw = payload[key];
    const actual = key === "dimension" ? normalizeDimension(raw) : raw;
    if (typeof actual !== "string" && typeof actual !== "number" && typeof actual !== "boolean") {
      return matchesFilter(filter, undefined);
    }
    return matchesFilter(filter, actual);
  });
}

export function getLegacyCounterIncrement(goal: LegacyCounterGoalDefinition, payload: QuestEventPayload): number {
  if (goal.progress.mode === "sum" && goal.progress.field) {
    const value = Number(payload[goal.progress.field] ?? 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }
  return 1;
}

export function applyLegacyCounterProgress(
  current: number,
  goal: LegacyCounterGoalDefinition,
  payload: QuestEventPayload
): number {
  if (!legacyGoalMatches(goal, payload)) return current;
  const increment = getLegacyCounterIncrement(goal, payload);
  if (increment <= 0) return current;
  return Math.min(goal.progress.target, Math.max(0, current) + increment);
}

export function isLegacyGoalComplete(
  progress: Readonly<Record<string, number>>,
  goal: LegacyCounterGoalDefinition
): boolean {
  return (progress[goal.id] ?? 0) >= goal.progress.target;
}

export function isLegacyQuestComplete(
  quest: LegacyQuestDefinition,
  progress: Readonly<Record<string, number>>
): boolean {
  if (quest.goals.length === 0) return false;
  if (quest.completeWhen === "any") return quest.goals.some((goal) => isLegacyGoalComplete(progress, goal));
  return quest.goals.every((goal) => isLegacyGoalComplete(progress, goal));
}

export function applyCounterProgress(
  current: QuestNumberGoalState | undefined,
  delta: number,
  target: number
): QuestNumberGoalState {
  const previous = Math.max(0, current?.value ?? 0);
  const positiveDelta = Number.isFinite(delta) && delta > 0 ? delta : 0;
  return {
    kind: "number",
    value: Math.min(Math.max(0, target), previous + positiveDelta),
  };
}

export function applyDistinctCounterProgress(
  current: QuestDistinctSetGoalState | undefined,
  distinctValue: unknown
): QuestDistinctSetGoalState {
  const value = String(distinctValue ?? "").trim();
  const values = current?.values ? [...current.values] : [];
  if (value && !values.includes(value)) values.push(value);
  return { kind: "distinct_set", values };
}

export function applySnapshotProgress(
  current: QuestSnapshotGoalState | undefined,
  observedValue: number,
  snapshotMode: QuestSnapshotMode,
  reconciledAt: number,
  providerVersion: number
): QuestSnapshotGoalState {
  const observed = Number.isFinite(observedValue) ? Math.max(0, observedValue) : 0;
  const nextValue = snapshotMode === "peak" ? Math.max(current?.observedValue ?? 0, observed) : observed;
  return {
    kind: "snapshot",
    observedValue: nextValue,
    reconciledAt,
    providerVersion,
  };
}

export function applyMilestoneProgress(
  current: QuestMilestoneGoalState | undefined,
  achievedAt: number,
  evidenceId?: string
): QuestMilestoneGoalState {
  if (current?.achieved) return current;
  return {
    kind: "milestone",
    achieved: true,
    achievedAt,
    evidenceId,
  };
}

export function getGoalProgressValue(state: QuestGoalState | number | undefined): number {
  if (typeof state === "number") return Math.max(0, state);
  if (!state) return 0;
  if (state.kind === "number") return Math.max(0, state.value);
  if (state.kind === "distinct_set") return state.values.length;
  if (state.kind === "milestone") return state.achieved ? 1 : 0;
  return Math.max(0, state.observedValue);
}

export function isGoalStateComplete(state: QuestGoalState | number | undefined, target: number): boolean {
  return getGoalProgressValue(state) >= target;
}

export function questGoalEventMatches(
  goal: Exclude<QuestGoalDefinitionV2, { semantics: "snapshot" }>,
  payload: QuestEventPayload
): boolean {
  return Object.entries(goal.filters).every(([key, filter]) => {
    const raw = payload[key];
    const actual = key === "dimension" ? normalizeDimension(raw) : raw;
    return typeof actual === "string" || typeof actual === "number" || typeof actual === "boolean"
      ? matchesFilter(filter, actual)
      : false;
  });
}

export function applyQuestGoalEvent(
  current: QuestGoalState | undefined,
  goal: Exclude<QuestGoalDefinitionV2, { semantics: "snapshot" }>,
  payload: QuestEventPayload,
  timestamp: number,
  selectorMatches = true,
  evidenceId?: string
): QuestGoalState | undefined {
  if (!selectorMatches || !questGoalEventMatches(goal, payload)) return current;
  if (goal.semantics === "milestone") {
    return applyMilestoneProgress(current?.kind === "milestone" ? current : undefined, timestamp, evidenceId);
  }
  if (goal.semantics === "distinct_counter") {
    return applyDistinctCounterProgress(
      current?.kind === "distinct_set" ? current : undefined,
      payload[goal.distinctField]
    );
  }
  const delta = goal.aggregation === "sum" && goal.field ? Number(payload[goal.field] ?? 0) : 1;
  return applyCounterProgress(current?.kind === "number" ? current : undefined, delta, goal.target);
}

export function isQuestDefinitionComplete(
  definition: QuestDefinitionV2,
  progress: Readonly<Record<string, QuestGoalState>>
): boolean {
  if (definition.goals.length === 0) return false;
  const complete = (goal: QuestGoalDefinitionV2) =>
    isGoalStateComplete(progress[goal.id], goal.semantics === "milestone" ? 1 : goal.target);
  return definition.completeWhen === "any" ? definition.goals.some(complete) : definition.goals.every(complete);
}
