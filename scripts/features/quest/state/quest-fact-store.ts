import type { QuestFactValue, QuestPlayerAggregate } from "../domain";

export function recordQuestFactCounter(
  aggregate: QuestPlayerAggregate,
  factId: string,
  delta: number,
  updatedAt: number
): number {
  const current = aggregate.facts[factId];
  const previous = current?.kind === "counter" ? current.value : 0;
  const positiveDelta = Number.isFinite(delta) && delta > 0 ? delta : 0;
  const value = previous + positiveDelta;
  aggregate.facts[factId] = { kind: "counter", value, updatedAt };
  return value;
}

export function setQuestFactMilestone(
  aggregate: QuestPlayerAggregate,
  factId: string,
  achievedAt: number,
  evidenceId: string
): void {
  const current = aggregate.facts[factId];
  if (current?.kind === "milestone") return;
  aggregate.facts[factId] = { kind: "milestone", achievedAt, evidenceId };
}

export function setQuestFactSnapshot(
  aggregate: QuestPlayerAggregate,
  factId: string,
  value: QuestFactValue,
  observedAt: number
): void {
  aggregate.facts[factId] = { kind: "snapshot", value, observedAt };
}

export function getQuestFactValue(aggregate: QuestPlayerAggregate, factId: string): QuestFactValue | undefined {
  const fact = aggregate.facts[factId];
  if (!fact) return undefined;
  if (fact.kind === "counter") return fact.value;
  if (fact.kind === "milestone") return true;
  return fact.value;
}
