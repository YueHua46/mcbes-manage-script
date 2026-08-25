import type { LegacyCustomQuestDefinition, QuestDefinitionV2, QuestGoalDefinitionV2 } from "../domain";

const EVENT_CAPABILITIES: Readonly<Record<string, string>> = {
  "entity.kill": "cap.event.entity.kill.v1",
  "block.break": "cap.event.block.break.v1",
  "item.obtain": "cap.event.item.obtain.v1",
  "player.online_time": "cap.event.player.online_time.v1",
};

export function normalizeLegacyCustomQuest(definition: LegacyCustomQuestDefinition): QuestDefinitionV2 {
  const goals: QuestGoalDefinitionV2[] = definition.goals.map((goal) => ({
    id: goal.id,
    semantics: "counter",
    eventType: goal.event,
    filters: { ...goal.filters },
    aggregation: goal.progress.mode,
    field: goal.progress.field,
    target: goal.progress.target,
    backfillPolicy: "none",
  }));
  const requiredCapabilities = Array.from(
    new Set(
      goals
        .map((goal) => (goal.semantics === "counter" ? EVENT_CAPABILITIES[goal.eventType] : undefined))
        .filter(Boolean)
    )
  ) as string[];

  return {
    id: definition.id,
    source: "custom",
    definitionVersion: 1,
    title: definition.title,
    description: definition.description,
    completionMessage: definition.completionMessage?.trim() || undefined,
    category: "custom",
    rarity: "common",
    reliability: "A",
    releaseState: "active",
    scope: definition.scope,
    completeWhen: definition.completeWhen,
    acceptMode: definition.autoAccept ? "auto" : "manual",
    claimMode: "manual",
    enabled: definition.enabled,
    hidden: false,
    trackWhileHidden: false,
    contributesToProgress: false,
    unlockRule: { type: "always" },
    unlockEventPolicy: "exclude",
    requiredCapabilities,
    requiredGameplayExperiments: [],
    goals,
    rewards: definition.rewards.map((reward) => ({ ...reward, params: { ...reward.params } })),
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
  };
}
