import type { QuestSelectorRegistry } from "../catalog/selector-registry";
import {
  applyMilestoneProgress,
  questGoalEventMatches,
  type QuestGoalDefinitionV2,
  type QuestGoalState,
} from "../domain";
import type {
  CreeperStateSnapshotSummary,
  EffectsSnapshotSummary,
  EquipmentSnapshotSummary,
  InventorySnapshotSummary,
} from "./snapshot-summary";

export interface SnapshotReconcileInput {
  goals: readonly QuestGoalDefinitionV2[];
  progress: Record<string, QuestGoalState>;
  selectors: QuestSelectorRegistry;
  inventory?: InventorySnapshotSummary;
  equipment?: EquipmentSnapshotSummary;
  effects?: EffectsSnapshotSummary;
  creeperState?: CreeperStateSnapshotSummary;
}

function observeInventory(
  selectorId: string,
  summary: InventorySnapshotSummary,
  selectors: QuestSelectorRegistry
): number {
  let amount = 0;
  for (const item of summary.entries) {
    if (selectors.matchItem(selectorId, item)) amount += item.amount;
  }
  return amount;
}

export function reconcileSnapshotGoals(input: SnapshotReconcileInput): string[] {
  const changedGoalIds: string[] = [];
  for (const goal of input.goals) {
    if (
      goal.semantics === "milestone" &&
      goal.backfillPolicy === "current_state" &&
      goal.evidenceProviderId?.startsWith("evidence.creeper.") &&
      input.creeperState?.evidenceIds.has(goal.evidenceProviderId)
    ) {
      const current = input.progress[goal.id];
      if (current?.kind === "milestone" && current.achieved) continue;
      input.progress[goal.id] = applyMilestoneProgress(
        current?.kind === "milestone" ? current : undefined,
        input.creeperState.builtAt,
        `${goal.evidenceProviderId}:${input.creeperState.playerCmid}`
      );
      changedGoalIds.push(goal.id);
      continue;
    }
    if (
      goal.semantics === "milestone" &&
      goal.backfillPolicy === "current_state" &&
      goal.evidenceProviderId === "evidence.effect.current" &&
      input.effects
    ) {
      const effectFilter = goal.filters.effect;
      if (!effectFilter || effectFilter.op !== "eq" || typeof effectFilter.value !== "string") continue;
      const effect = input.effects.effects.get(effectFilter.value);
      if (!effect) continue;
      const evidenceId = `${goal.evidenceProviderId}:${effect.typeId}`;
      const current = input.progress[goal.id];
      if (current?.kind === "milestone" && current.achieved) continue;
      if (
        !questGoalEventMatches(goal, {
          effect: effect.typeId,
          amplifier: effect.amplifier,
          duration: effect.duration,
        })
      ) {
        continue;
      }
      input.progress[goal.id] = applyMilestoneProgress(
        current?.kind === "milestone" ? current : undefined,
        input.effects.builtAt,
        evidenceId
      );
      changedGoalIds.push(goal.id);
      continue;
    }
    if (goal.semantics !== "snapshot") continue;
    const summary =
      goal.provider === "inventory" ? input.inventory : goal.provider === "equipment" ? input.equipment : undefined;
    if (!summary) continue;

    const observed =
      goal.provider === "inventory"
        ? observeInventory(goal.selectorId, summary as InventorySnapshotSummary, input.selectors)
        : input.selectors.matchEquipment(goal.selectorId, summary as EquipmentSnapshotSummary)
          ? 1
          : 0;
    const current = input.progress[goal.id];
    const currentValue = current?.kind === "snapshot" ? current.observedValue : 0;
    const nextValue = goal.snapshotMode === "peak" ? Math.max(currentValue, observed) : observed;
    const next: QuestGoalState = {
      kind: "snapshot",
      observedValue: nextValue,
      reconciledAt: summary.builtAt,
      providerVersion: summary.providerVersion,
    };
    if (
      current?.kind !== "snapshot" ||
      current.observedValue !== next.observedValue ||
      current.providerVersion !== next.providerVersion
    ) {
      input.progress[goal.id] = next;
      changedGoalIds.push(goal.id);
    } else {
      // Freshness is useful in memory, but must not write a whole generation for unchanged progress.
      current.reconciledAt = next.reconciledAt;
    }
  }
  return changedGoalIds;
}
