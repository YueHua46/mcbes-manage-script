import {
  createQuestInstanceId,
  getGoalProgressValue,
  type QuestDefinitionV2,
  type QuestFactState,
  type QuestGoalState,
  type QuestInstanceState,
  type QuestLifecycle,
  type QuestPlayerAggregate,
  type RewardDeliveryState,
} from "../domain";

export interface LegacyQuestPlayerQuestState {
  questId: string;
  acceptedAt: number;
  periodKey: string;
  progress: Record<string, number>;
  completedAt?: number;
  claimedAt?: number;
}

export interface LegacyQuestPlayerState {
  playerName: string;
  quests: Record<string, LegacyQuestPlayerQuestState>;
}

export interface LegacyNameMigrationInput {
  playerCmid: string;
  displayName: string;
  knownNames: readonly string[];
  existing?: QuestPlayerAggregate;
  legacyStates: Readonly<Record<string, LegacyQuestPlayerState | undefined>>;
  resolveDefinition: (questId: string) => QuestDefinitionV2 | undefined;
  migratedAt: number;
}

export interface LegacyNameMigrationResult {
  aggregate: QuestPlayerAggregate;
  migratedKeys: string[];
  changed: boolean;
}

const DELIVERY_PRECEDENCE: Readonly<Record<RewardDeliveryState["state"], number>> = {
  pending: 0,
  prepared: 1,
  recovery_required: 2,
  granted: 3,
};

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createEmptyQuestPlayerAggregate(playerCmid: string, displayName: string): QuestPlayerAggregate {
  return {
    schemaVersion: 2,
    playerCmid,
    displayName,
    activeByQuestId: {},
    instances: {},
    facts: {},
    rewardLedger: {},
  };
}

function lifecycleFromLegacy(state: LegacyQuestPlayerQuestState): QuestLifecycle {
  if (state.claimedAt !== undefined) return "claimed";
  if (state.completedAt !== undefined) return "completed";
  return "accepted";
}

function freezeLegacyCompletion(
  state: LegacyQuestPlayerQuestState,
  instanceId: string,
  definition: QuestDefinitionV2 | undefined
): QuestInstanceState["completionSnapshot"] {
  if (state.completedAt === undefined || !definition) return undefined;
  return {
    questId: state.questId,
    instanceId,
    definitionVersion: definition.definitionVersion,
    title: definition.title,
    description: definition.description,
    rarity: definition.rarity,
    completedAt: state.completedAt,
    rewardScale: 1,
    rewards: definition.rewards.map((reward) => clone(reward)),
  };
}

function convertLegacyInstance(
  state: LegacyQuestPlayerQuestState,
  definition: QuestDefinitionV2 | undefined
): QuestInstanceState {
  const instanceId = createQuestInstanceId(state.questId, state.periodKey, 1);
  return {
    instanceId,
    questId: state.questId,
    definitionVersion: definition?.definitionVersion ?? 1,
    periodKey: state.periodKey,
    attempt: 1,
    acceptedAt: state.acceptedAt,
    lifecycle: lifecycleFromLegacy(state),
    progress: Object.fromEntries(
      Object.entries(state.progress).map(([goalId, value]) => [goalId, { kind: "number", value: Math.max(0, value) }])
    ),
    completedAt: state.completedAt,
    claimedAt: state.claimedAt,
    completionSnapshot: freezeLegacyCompletion(state, instanceId, definition),
  };
}

function mergeGoalState(left: QuestGoalState | undefined, right: QuestGoalState): QuestGoalState {
  if (!left) return clone(right);
  if (left.kind === "number" && right.kind === "number") {
    return { kind: "number", value: Math.max(left.value, right.value) };
  }
  if (left.kind === "distinct_set" && right.kind === "distinct_set") {
    return { kind: "distinct_set", values: Array.from(new Set([...left.values, ...right.values])) };
  }
  if (left.kind === "milestone" && right.kind === "milestone") {
    if (!left.achieved) return clone(right);
    if (!right.achieved) return clone(left);
    return (left.achievedAt ?? Number.MAX_SAFE_INTEGER) <= (right.achievedAt ?? Number.MAX_SAFE_INTEGER)
      ? clone(left)
      : clone(right);
  }
  if (left.kind === "snapshot" && right.kind === "snapshot") {
    return left.reconciledAt >= right.reconciledAt ? clone(left) : clone(right);
  }
  return getGoalProgressValue(left) >= getGoalProgressValue(right) ? clone(left) : clone(right);
}

function lifecyclePrecedence(lifecycle: QuestLifecycle): number {
  if (lifecycle === "claimed") return 5;
  if (lifecycle === "recovery_required") return 4;
  if (lifecycle === "claiming") return 3;
  if (lifecycle === "completed") return 2;
  if (lifecycle === "accepted") return 1;
  return 0;
}

export function mergeQuestInstances(left: QuestInstanceState, right: QuestInstanceState): QuestInstanceState {
  if (left.instanceId !== right.instanceId) throw new Error("Cannot merge different quest instances");
  const progress: Record<string, QuestGoalState> = clone(left.progress);
  for (const [goalId, state] of Object.entries(right.progress))
    progress[goalId] = mergeGoalState(progress[goalId], state);
  const preferred = lifecyclePrecedence(left.lifecycle) >= lifecyclePrecedence(right.lifecycle) ? left : right;

  return {
    ...clone(preferred),
    acceptedAt: Math.min(left.acceptedAt, right.acceptedAt),
    progress,
    completedAt:
      left.completedAt === undefined
        ? right.completedAt
        : right.completedAt === undefined
          ? left.completedAt
          : Math.min(left.completedAt, right.completedAt),
    claimedAt:
      left.claimedAt === undefined
        ? right.claimedAt
        : right.claimedAt === undefined
          ? left.claimedAt
          : Math.min(left.claimedAt, right.claimedAt),
    completionSnapshot: clone(preferred.completionSnapshot ?? left.completionSnapshot ?? right.completionSnapshot),
  };
}

function mergeFact(left: QuestFactState | undefined, right: QuestFactState): QuestFactState {
  if (!left) return clone(right);
  if (left.kind === "counter" && right.kind === "counter") {
    return {
      kind: "counter",
      value: Math.max(left.value, right.value),
      updatedAt: Math.max(left.updatedAt, right.updatedAt),
    };
  }
  if (left.kind === "milestone" && right.kind === "milestone") {
    return left.achievedAt <= right.achievedAt ? clone(left) : clone(right);
  }
  if (left.kind === "snapshot" && right.kind === "snapshot") {
    return left.observedAt >= right.observedAt ? clone(left) : clone(right);
  }
  return clone(left);
}

export function mergeQuestPlayerAggregates(
  left: QuestPlayerAggregate,
  right: QuestPlayerAggregate
): QuestPlayerAggregate {
  if (left.playerCmid !== right.playerCmid) throw new Error("Cannot merge different player aggregates");
  const merged = clone(left);
  merged.displayName = right.displayName || left.displayName;

  for (const [instanceId, instance] of Object.entries(right.instances)) {
    merged.instances[instanceId] = merged.instances[instanceId]
      ? mergeQuestInstances(merged.instances[instanceId], instance)
      : clone(instance);
  }
  for (const [questId, instanceId] of Object.entries(right.activeByQuestId)) {
    const currentId = merged.activeByQuestId[questId];
    if (
      !currentId ||
      lifecyclePrecedence(merged.instances[instanceId]?.lifecycle ?? "not_started") >=
        lifecyclePrecedence(merged.instances[currentId]?.lifecycle ?? "not_started")
    ) {
      merged.activeByQuestId[questId] = instanceId;
    }
  }
  for (const [factId, fact] of Object.entries(right.facts))
    merged.facts[factId] = mergeFact(merged.facts[factId], fact);
  for (const [key, delivery] of Object.entries(right.rewardLedger)) {
    const current = merged.rewardLedger[key];
    if (!current || DELIVERY_PRECEDENCE[delivery.state] > DELIVERY_PRECEDENCE[current.state]) {
      merged.rewardLedger[key] = clone(delivery);
    }
  }
  merged.migration = {
    legacyNameMigrationVersion: Math.max(
      left.migration?.legacyNameMigrationVersion ?? 0,
      right.migration?.legacyNameMigrationVersion ?? 0
    ),
    migratedNames: Array.from(
      new Set([...(left.migration?.migratedNames ?? []), ...(right.migration?.migratedNames ?? [])])
    ),
    migratedAt: Math.max(left.migration?.migratedAt ?? 0, right.migration?.migratedAt ?? 0) || undefined,
  };
  return merged;
}

export function migrateLegacyNameStates(input: LegacyNameMigrationInput): LegacyNameMigrationResult {
  let aggregate = input.existing
    ? clone(input.existing)
    : createEmptyQuestPlayerAggregate(input.playerCmid, input.displayName);
  aggregate.displayName = input.displayName;
  const migratedNames = new Set((aggregate.migration?.migratedNames ?? []).map(normalizeName));
  const migratedKeys: string[] = [];
  let processedName = false;

  for (const knownName of input.knownNames) {
    const key = normalizeName(knownName);
    if (!key || migratedNames.has(key)) continue;
    processedName = true;
    const legacy = input.legacyStates[key];
    if (legacy) {
      const converted = createEmptyQuestPlayerAggregate(input.playerCmid, input.displayName);
      for (const state of Object.values(legacy.quests)) {
        const instance = convertLegacyInstance(state, input.resolveDefinition(state.questId));
        converted.instances[instance.instanceId] = instance;
        converted.activeByQuestId[state.questId] = instance.instanceId;
      }
      aggregate = mergeQuestPlayerAggregates(aggregate, converted);
      migratedKeys.push(key);
    }
    migratedNames.add(key);
  }

  const changed =
    processedName || migratedKeys.length > 0 || !input.existing || aggregate.displayName !== input.existing.displayName;
  aggregate.migration = {
    ...aggregate.migration,
    legacyNameMigrationVersion: 1,
    migratedNames: Array.from(migratedNames),
    migratedAt: changed ? input.migratedAt : aggregate.migration?.migratedAt,
  };
  return { aggregate, migratedKeys, changed };
}
