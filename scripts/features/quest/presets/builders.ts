import type {
  QuestChapterDefinition,
  QuestDefinitionV2,
  QuestFilter,
  QuestGoalDefinitionV2,
  QuestReliability,
  QuestRewardDefinitionV2,
  QuestRule,
} from "../domain";

export const PRESET_DEFINITION_TIMESTAMP = Date.UTC(2026, 7, 24);
export const ALWAYS_AVAILABLE: QuestRule = { type: "always" };

export function presetRewards(gold: number, experience: number): QuestRewardDefinitionV2[] {
  return [
    { id: "reward.gold", action: "add_money", params: { amount: gold } },
    { id: "reward.exp", action: "add_exp", params: { amount: experience } },
  ];
}

export function counterGoal(
  id: string,
  eventType: string,
  target: number,
  displayText: string,
  options: {
    filters?: Record<string, QuestFilter>;
    selectorId?: string;
    aggregation?: "count" | "sum";
    field?: string;
    backfillPolicy?: "none" | "historical";
  } = {}
): QuestGoalDefinitionV2 {
  return {
    id,
    displayText,
    semantics: "counter",
    eventType,
    filters: options.filters ?? {},
    selectorId: options.selectorId,
    aggregation: options.aggregation ?? "count",
    field: options.field,
    target,
    backfillPolicy: options.backfillPolicy ?? "none",
  };
}

export function distinctCounterGoal(
  id: string,
  eventType: string,
  distinctField: string,
  target: number,
  displayText: string,
  options: {
    filters?: Record<string, QuestFilter>;
    selectorId?: string;
  } = {}
): QuestGoalDefinitionV2 {
  return {
    id,
    displayText,
    semantics: "distinct_counter",
    eventType,
    filters: options.filters ?? {},
    selectorId: options.selectorId,
    distinctField,
    target,
    backfillPolicy: "none",
  };
}

export function inventoryGoal(
  id: string,
  selectorId: string,
  target: number,
  displayText: string
): QuestGoalDefinitionV2 {
  return snapshotGoal(id, "inventory", selectorId, target, displayText);
}

export function snapshotGoal(
  id: string,
  provider: "inventory" | "equipment" | "effects" | "nearby_world" | "creeper_state",
  selectorId: string,
  target: number,
  displayText: string,
  query?: Record<string, unknown>
): QuestGoalDefinitionV2 {
  return {
    id,
    displayText,
    semantics: "snapshot",
    provider,
    selectorId,
    query,
    target,
    snapshotMode: "current",
  };
}

export function milestoneGoal(
  id: string,
  eventType: string,
  displayText: string,
  options: {
    filters?: Record<string, QuestFilter>;
    backfillPolicy?: "none" | "current_state" | "historical";
    evidenceProviderId?: string;
  } = {}
): QuestGoalDefinitionV2 {
  return {
    id,
    displayText,
    semantics: "milestone",
    eventType,
    filters: options.filters ?? {},
    backfillPolicy: options.backfillPolicy ?? "none",
    evidenceProviderId: options.evidenceProviderId,
  };
}

export interface CorePresetQuestInput {
  id: string;
  title: string;
  description: string;
  completionMessage: string;
  chapterId: string;
  order: number;
  rarity: QuestDefinitionV2["rarity"];
  reliability: QuestReliability;
  goals: QuestGoalDefinitionV2[];
  gold: number;
  experience: number;
  requiredCapabilities: string[];
  requiredGameplayExperiments?: string[];
  completeWhen?: QuestDefinitionV2["completeWhen"];
  unlockRule?: QuestRule;
  unlockEventPolicy?: QuestDefinitionV2["unlockEventPolicy"];
}

export interface PresetQuestInput extends CorePresetQuestInput {
  packId: string;
  category: string;
  hidden?: boolean;
  trackWhileHidden?: boolean;
  contributesToProgress?: boolean;
}

function releaseStateForReliability(reliability: QuestReliability): QuestDefinitionV2["releaseState"] {
  if (reliability === "A") return "active";
  if (reliability === "B") return "experimental";
  return "planned";
}

export function presetQuest(input: PresetQuestInput): QuestDefinitionV2 {
  return {
    id: input.id,
    source: "preset",
    definitionVersion: 1,
    title: input.title,
    description: input.description,
    completionMessage: input.completionMessage,
    packId: input.packId,
    chapterId: input.chapterId,
    category: input.category,
    order: input.order,
    rarity: input.rarity,
    reliability: input.reliability,
    releaseState: releaseStateForReliability(input.reliability),
    scope: "once",
    completeWhen: input.completeWhen ?? "all",
    acceptMode: "auto",
    claimMode: "manual",
    enabled: true,
    hidden: input.hidden ?? false,
    trackWhileHidden: input.trackWhileHidden ?? false,
    contributesToProgress: input.contributesToProgress ?? true,
    unlockRule: input.unlockRule ?? ALWAYS_AVAILABLE,
    unlockEventPolicy: input.unlockEventPolicy ?? "exclude",
    requiredCapabilities: [...input.requiredCapabilities],
    requiredGameplayExperiments: [...(input.requiredGameplayExperiments ?? [])],
    goals: input.goals,
    rewards: presetRewards(input.gold, input.experience),
    createdAt: PRESET_DEFINITION_TIMESTAMP,
    updatedAt: PRESET_DEFINITION_TIMESTAMP,
  };
}

export function corePresetQuest(input: CorePresetQuestInput): QuestDefinitionV2 {
  return presetQuest({ ...input, packId: "preset.core", category: "core" });
}

export function worldPresetQuest(input: CorePresetQuestInput): QuestDefinitionV2 {
  return presetQuest({ ...input, packId: "preset.world", category: "world" });
}

export function creeperPresetQuest(input: CorePresetQuestInput): QuestDefinitionV2 {
  return presetQuest({ ...input, packId: "preset.creeper", category: "creeper" });
}

export function updatePresetQuest(packId: `preset.update.${string}`, input: CorePresetQuestInput): QuestDefinitionV2 {
  return presetQuest({ ...input, packId, category: "update" });
}

export function experimentPresetQuest(input: CorePresetQuestInput): QuestDefinitionV2 {
  return presetQuest({ ...input, packId: "preset.experiment.drop3", category: "experiment" });
}

export function hiddenPresetQuest(input: CorePresetQuestInput): QuestDefinitionV2 {
  return presetQuest({
    ...input,
    packId: "preset.hidden",
    category: "hidden",
    hidden: true,
    trackWhileHidden: true,
    contributesToProgress: false,
  });
}

export function presetChapter(
  packId: string,
  input: Omit<QuestChapterDefinition, "packId" | "releaseState" | "progressPolicy">
): QuestChapterDefinition {
  return {
    ...input,
    packId,
    releaseState: "active",
    progressPolicy: { includeHidden: false, includeUnavailable: false },
  };
}

export function coreChapter(
  input: Omit<QuestChapterDefinition, "packId" | "releaseState" | "progressPolicy">
): QuestChapterDefinition {
  return presetChapter("preset.core", input);
}

export function worldChapter(
  input: Omit<QuestChapterDefinition, "packId" | "releaseState" | "progressPolicy">
): QuestChapterDefinition {
  return presetChapter("preset.world", input);
}

export function creeperChapter(
  input: Omit<QuestChapterDefinition, "packId" | "releaseState" | "progressPolicy">
): QuestChapterDefinition {
  return presetChapter("preset.creeper", input);
}

export function updateChapter(
  packId: `preset.update.${string}`,
  input: Omit<QuestChapterDefinition, "packId" | "releaseState" | "progressPolicy">
): QuestChapterDefinition {
  return presetChapter(packId, input);
}

export function experimentChapter(
  input: Omit<QuestChapterDefinition, "packId" | "releaseState" | "progressPolicy">
): QuestChapterDefinition {
  return presetChapter("preset.experiment.drop3", input);
}

export function hiddenChapter(
  input: Omit<QuestChapterDefinition, "packId" | "releaseState" | "progressPolicy">
): QuestChapterDefinition {
  return presetChapter("preset.hidden", input);
}
