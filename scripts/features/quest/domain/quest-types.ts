export type QuestScope = "once" | "daily" | "weekly" | "repeatable";
export type QuestCompleteWhen = "all" | "any";
export type QuestFilterOperator = "eq" | "in" | "gte" | "lte" | "contains";
export type QuestProgressMode = "count" | "sum";

export interface QuestFilter {
  op: QuestFilterOperator;
  value: string | number | boolean | string[];
}

/**
 * Phase 0 compatibility shape for the currently persisted counter goals.
 * New goal variants are represented separately below and are not persisted
 * until the Phase 1 repository migration is enabled.
 */
export interface LegacyCounterGoalDefinition {
  id: string;
  event: string;
  filters: Record<string, QuestFilter>;
  progress: {
    mode: QuestProgressMode;
    target: number;
    field?: string;
  };
}

export interface LegacyQuestDefinition {
  scope: QuestScope;
  completeWhen: QuestCompleteWhen;
  goals: LegacyCounterGoalDefinition[];
}

export interface LegacyRewardDefinition {
  id: string;
  action: string;
  params: Record<string, string | number | boolean | Record<string, unknown> | unknown[]>;
}

export interface LegacyCustomQuestDefinition extends LegacyQuestDefinition {
  id: string;
  title: string;
  description: string;
  completionMessage?: string;
  autoAccept: boolean;
  enabled: boolean;
  rewards: LegacyRewardDefinition[];
  createdAt: number;
  updatedAt: number;
}

export type QuestSource = "preset" | "custom";
export type QuestRarity = "common" | "rare" | "epic" | "legendary";
export type QuestReliability = "A" | "B" | "C";
export type QuestReleaseState = "active" | "experimental" | "planned";

export interface CounterGoalDefinition {
  id: string;
  displayText?: string;
  semantics: "counter";
  eventType: string;
  filters: Record<string, QuestFilter>;
  selectorId?: string;
  aggregation: "count" | "sum";
  field?: string;
  target: number;
  backfillPolicy: "none" | "historical";
}

export interface DistinctCounterGoalDefinition {
  id: string;
  displayText?: string;
  semantics: "distinct_counter";
  eventType: string;
  filters: Record<string, QuestFilter>;
  selectorId?: string;
  distinctField: string;
  target: number;
  backfillPolicy: "none" | "historical";
}

export interface SnapshotGoalDefinition {
  id: string;
  displayText?: string;
  semantics: "snapshot";
  provider: "inventory" | "equipment" | "effects" | "nearby_world" | "creeper_state";
  selectorId: string;
  query?: Record<string, unknown>;
  target: number;
  snapshotMode: QuestSnapshotMode;
}

export interface MilestoneGoalDefinition {
  id: string;
  displayText?: string;
  semantics: "milestone";
  eventType: string;
  filters: Record<string, QuestFilter>;
  backfillPolicy: "none" | "current_state" | "historical";
  evidenceProviderId?: string;
}

export type QuestGoalDefinitionV2 =
  | CounterGoalDefinition
  | DistinctCounterGoalDefinition
  | SnapshotGoalDefinition
  | MilestoneGoalDefinition;

export interface QuestRewardDefinitionV2 {
  id: string;
  action: string;
  params: Record<string, string | number | boolean | Record<string, unknown> | unknown[]>;
}

export interface QuestDefinitionV2 {
  id: string;
  source: QuestSource;
  definitionVersion: number;

  title: string;
  description: string;
  completionMessage?: string;

  packId?: string;
  chapterId?: string;
  category: string;
  order?: number;

  rarity: QuestRarity;
  reliability: QuestReliability;
  releaseState: QuestReleaseState;

  scope: QuestScope;
  completeWhen: QuestCompleteWhen;
  acceptMode: "manual" | "auto";
  claimMode: "manual" | "auto";

  enabled: boolean;
  hidden: boolean;
  trackWhileHidden: boolean;
  contributesToProgress: boolean;

  unlockRule: QuestRule;
  unlockEventPolicy: QuestUnlockEventPolicy;

  requiredCapabilities: string[];
  requiredGameplayExperiments: string[];

  goals: QuestGoalDefinitionV2[];
  rewards: QuestRewardDefinitionV2[];

  createdAt: number;
  updatedAt: number;
}

export interface QuestPackDefinition {
  id: string;
  version: number;
  title: string;
  description: string;
  category: "core" | "world" | "creeper" | "update" | "experiment" | "hidden";
  defaultEnabled: boolean;
  releaseState: QuestReleaseState;
  requiredCapabilities: string[];
  requiredGameplayExperiments: string[];
  chapterIds: string[];
}

export interface QuestChapterDefinition {
  id: string;
  packId: string;
  title: string;
  description: string;
  icon?: string;
  order: number;
  releaseState: QuestReleaseState;
  unlockRule: QuestRule;
  questIds: string[];
  progressPolicy: {
    includeHidden: boolean;
    includeUnavailable: boolean;
  };
}

export interface PresetPackServerState {
  packId: string;
  enabled: boolean;
  rewardScale?: number;
  /** Chapter-level switches. A chapter is the administrator-facing task type within a pack. */
  overrideChapterEnabled?: Record<string, boolean>;
  overrideQuestEnabled?: Record<string, boolean>;
  /** Replaces rewards only for future completions. Existing completion snapshots remain untouched. */
  overrideQuestRewards?: Record<string, QuestRewardDefinitionV2[]>;
  gameplayExperimentConfirmation?: Record<string, boolean>;
  updatedAt: number;
}

export type QuestAvailability = "locked" | "available" | "suspended" | "unavailable";
export type QuestLifecycle = "not_started" | "accepted" | "completed" | "claiming" | "claimed" | "recovery_required";

export interface QuestNumberGoalState {
  kind: "number";
  value: number;
}

export interface QuestDistinctSetGoalState {
  kind: "distinct_set";
  values: string[];
}

export interface QuestMilestoneGoalState {
  kind: "milestone";
  achieved: boolean;
  achievedAt?: number;
  evidenceId?: string;
}

export interface QuestSnapshotGoalState {
  kind: "snapshot";
  observedValue: number;
  reconciledAt: number;
  providerVersion: number;
}

export type QuestGoalState =
  | QuestNumberGoalState
  | QuestDistinctSetGoalState
  | QuestMilestoneGoalState
  | QuestSnapshotGoalState;

export type QuestSnapshotMode = "current" | "peak";
export type QuestUnlockEventPolicy = "exclude" | "include_once";

export type QuestFactValue = string | number | boolean;

export type QuestRule =
  | { type: "always" }
  | { type: "all"; rules: QuestRule[] }
  | { type: "any"; rules: QuestRule[] }
  | { type: "quest"; questId: string; status: "completed" | "claimed" }
  | {
      type: "fact";
      factId: string;
      operator: "eq" | "gte" | "lte";
      value: QuestFactValue;
    }
  | { type: "capability"; capabilityId: string };

export interface QuestRuleContext {
  questStatuses: Readonly<Record<string, "completed" | "claimed" | undefined>>;
  facts: Readonly<Record<string, QuestFactValue | undefined>>;
  capabilities: ReadonlySet<string>;
}

export interface QuestAvailabilityInput {
  releaseState: "active" | "experimental" | "planned";
  enabled: boolean;
  packEnabled: boolean;
  requiredCapabilities: readonly string[];
  requiredGameplayExperiments: readonly string[];
  availableGameplayExperiments: ReadonlySet<string>;
  unlockRule: QuestRule;
}

export interface LegacyLifecycleState {
  acceptedAt?: number;
  completedAt?: number;
  claimedAt?: number;
  claiming?: boolean;
  recoveryRequired?: boolean;
}

export interface QuestTrackingInput {
  hidden: boolean;
  trackWhileHidden: boolean;
  availability: QuestAvailability;
  lifecycle: QuestLifecycle;
}

export interface FrozenQuestReward extends QuestRewardDefinitionV2 {
  scaledFrom?: number;
}

export interface QuestCompletionSnapshot {
  questId: string;
  instanceId: string;
  definitionVersion: number;
  title: string;
  description: string;
  rarity: QuestRarity;
  completedAt: number;
  rewardScale: number;
  rewards: FrozenQuestReward[];
}

export interface QuestInstanceState {
  instanceId: string;
  questId: string;
  definitionVersion: number;
  periodKey: string;
  attempt: number;
  acceptedAt: number;
  lifecycle: QuestLifecycle;
  progress: Record<string, QuestGoalState>;
  completedAt?: number;
  claimedAt?: number;
  completionSnapshot?: QuestCompletionSnapshot;
}

export interface QuestFactCounterState {
  kind: "counter";
  value: number;
  updatedAt: number;
}

export interface QuestFactMilestoneState {
  kind: "milestone";
  achievedAt: number;
  evidenceId: string;
}

export interface QuestFactSnapshotState {
  kind: "snapshot";
  value: QuestFactValue;
  observedAt: number;
}

export type QuestFactState = QuestFactCounterState | QuestFactMilestoneState | QuestFactSnapshotState;

export interface RewardDeliveryState {
  rewardId: string;
  instanceId: string;
  state: "pending" | "prepared" | "granted" | "recovery_required";
  idempotencyKey: string;
  preparedAt?: number;
  grantedAt?: number;
  handlerId: string;
  handlerVersion: number;
  error?: string;
}

export interface QuestMigrationMetadata {
  legacyNameMigrationVersion?: number;
  migratedNames?: string[];
  migratedAt?: number;
}

export interface QuestPlayerAggregate {
  schemaVersion: 2;
  playerCmid: string;
  displayName: string;
  activeByQuestId: Record<string, string>;
  instances: Record<string, QuestInstanceState>;
  facts: Record<string, QuestFactState>;
  rewardLedger: Record<string, RewardDeliveryState>;
  processedEventDedupe?: string[];
  migration?: QuestMigrationMetadata;
}

export interface QuestEvent {
  id: string;
  type: string;
  playerCmid: string;
  timestamp: number;
  payload: Record<string, unknown>;
  source: string;
  dedupeKey?: string;
}
