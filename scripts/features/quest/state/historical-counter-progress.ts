import type { CounterGoalDefinition, QuestDefinitionV2, QuestInstanceState, QuestPlayerAggregate } from "../domain";
import { recordQuestFactCounter } from "./quest-fact-store";

const BOSS_KILL_FACT_IDS: Readonly<Record<string, string>> = {
  "minecraft:ender_dragon": "fact.boss.ender_dragon.kill_count",
  "minecraft:wither": "fact.boss.wither.kill_count",
};

export function resolveBossKillFactId(entityTypeId: string): string | undefined {
  return BOSS_KILL_FACT_IDS[entityTypeId];
}

/** Records only kills backed by the authoritative player-attributed entity.kill adapter. */
export function recordBossKillFact(aggregate: QuestPlayerAggregate, entityTypeId: string, updatedAt: number): boolean {
  const factId = resolveBossKillFactId(entityTypeId);
  if (!factId) return false;
  recordQuestFactCounter(aggregate, factId, 1, updatedAt);
  return true;
}

function historicalBossEntities(goal: CounterGoalDefinition): string[] | undefined {
  if (
    goal.eventType !== "entity.kill" ||
    goal.backfillPolicy !== "historical" ||
    goal.selectorId !== "selector.counter.boss_kill_count"
  ) {
    return undefined;
  }
  const filter = goal.filters.entity;
  if (!filter || (filter.op !== "eq" && filter.op !== "in")) return undefined;
  const values = Array.isArray(filter.value) ? filter.value : [filter.value];
  const entities = values.filter((value): value is string => typeof value === "string");
  return entities.length === values.length ? entities : undefined;
}

/**
 * Resolves the authoritative historical value for the dedicated Boss counter.
 * Returning undefined keeps unrelated historical goal kinds out of this adapter.
 */
export function resolveHistoricalBossCounterValue(
  aggregate: QuestPlayerAggregate,
  goal: CounterGoalDefinition
): number | undefined {
  const entities = historicalBossEntities(goal);
  if (!entities) return undefined;
  let total = 0;
  for (const entityTypeId of entities) {
    const factId = resolveBossKillFactId(entityTypeId);
    if (!factId) return undefined;
    const fact = aggregate.facts[factId];
    if (fact?.kind === "counter" && Number.isFinite(fact.value)) total += Math.max(0, fact.value);
  }
  return Math.min(goal.target, total);
}

/** Rehydrates historical Boss goals exactly from durable facts after accept/reload. */
export function reconcileHistoricalBossCounterGoals(
  aggregate: QuestPlayerAggregate,
  definition: QuestDefinitionV2,
  instance: QuestInstanceState
): string[] {
  const changedGoalIds: string[] = [];
  for (const goal of definition.goals) {
    if (goal.semantics !== "counter") continue;
    const value = resolveHistoricalBossCounterValue(aggregate, goal);
    if (value === undefined) continue;
    const current = instance.progress[goal.id];
    if (current?.kind === "number" && current.value === value) continue;
    instance.progress[goal.id] = { kind: "number", value };
    changedGoalIds.push(goal.id);
  }
  return changedGoalIds;
}
