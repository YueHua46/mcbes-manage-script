import { Player } from "@minecraft/server";
import { isRealPlayerEntity } from "../../../shared/utils/online-players";
import { normalizeLegacyCustomQuest } from "../catalog/custom-quest-normalizer";
import {
  LEGACY_QUEST_PERIOD_CONFIG,
  applyQuestGoalEvent,
  createQuestInstanceId,
  getGoalProgressValue,
  isQuestDefinitionComplete,
  resolvePeriodKey,
  type QuestDefinitionV2,
  type QuestGoalDefinitionV2,
  type QuestInstanceState,
  type QuestEvent,
  type QuestPlayerAggregate,
  type QuestRarity,
} from "../domain";
import { hasProcessedQuestEvent, markQuestEventProcessed, QuestEventBus, QuestEventIndex } from "../events";
import { claimQuestRewards, completeQuestInstance } from "../rewards";
import { createRuntimeQuestRewardHandlers } from "../rewards/runtime-reward-handlers";
import questStateRepository from "../state/quest-state-repository";
import {
  reconcileHistoricalBossCounterGoals,
  recordBossKillFact,
  resolveHistoricalBossCounterValue,
} from "../state/historical-counter-progress";
import { recordQuestFactCounter, setQuestFactMilestone } from "../state/quest-fact-store";
import { reconcileSnapshotGoals } from "../snapshots";
import type { RuntimeQuestSnapshotBatch } from "../snapshots/runtime-snapshot-queue";
import questCatalogService from "./quest-catalog";
import questDefinitionService, { QuestDefinition, QuestGoalDefinition, formatFilterValue } from "./quest-definition";

export interface QuestPlayerQuestState {
  questId: string;
  acceptedAt: number;
  periodKey: string;
  progress: Record<string, number>;
  completedAt?: number;
  claimedAt?: number;
}

export interface QuestPlayerState {
  playerName: string;
  quests: Record<string, QuestPlayerQuestState>;
}

export interface QuestProgressChange {
  quest: QuestDefinition;
  goal: QuestGoalDefinition;
  current: number;
  target: number;
  completedQuest: boolean;
}

export interface QuestEventPayload {
  [key: string]: string | number | undefined;
  entity?: string;
  block?: string;
  item?: string;
  amount?: number;
  seconds?: number;
  dimension?: string;
}

function getPeriodKey(quest: Pick<QuestDefinition, "scope">, at = Date.now()): string {
  return resolvePeriodKey(quest.scope, at, LEGACY_QUEST_PERIOD_CONFIG);
}

function toLegacyQuestState(instance: QuestInstanceState): QuestPlayerQuestState {
  return {
    questId: instance.questId,
    acceptedAt: instance.acceptedAt,
    periodKey: instance.periodKey,
    progress: Object.fromEntries(
      Object.entries(instance.progress).map(([goalId, state]) => [goalId, getGoalProgressValue(state)])
    ),
    completedAt: instance.completedAt,
    claimedAt: instance.claimedAt,
  };
}

function getCurrentInstance(
  aggregate: QuestPlayerAggregate,
  quest: Pick<QuestDefinition, "id" | "scope">,
  at = Date.now()
): QuestInstanceState | undefined {
  const instanceId = aggregate.activeByQuestId[quest.id];
  if (!instanceId) return undefined;
  const instance = aggregate.instances[instanceId];
  return instance?.periodKey === getPeriodKey(quest, at) ? instance : undefined;
}

function nextAttempt(aggregate: QuestPlayerAggregate, questId: string, periodKey: string): number {
  let result = 0;
  for (const instance of Object.values(aggregate.instances)) {
    if (instance.questId === questId && instance.periodKey === periodKey) result = Math.max(result, instance.attempt);
  }
  return result + 1;
}

function createAcceptedInstance(
  aggregate: QuestPlayerAggregate,
  quest: QuestDefinitionV2,
  acceptedAt: number
): QuestInstanceState {
  const periodKey = getPeriodKey(quest, acceptedAt);
  const attempt = nextAttempt(aggregate, quest.id, periodKey);
  const instance: QuestInstanceState = {
    instanceId: createQuestInstanceId(quest.id, periodKey, attempt),
    questId: quest.id,
    definitionVersion: quest.definitionVersion,
    periodKey,
    attempt,
    acceptedAt,
    lifecycle: "accepted",
    progress: {},
  };
  reconcileHistoricalBossCounterGoals(aggregate, quest, instance);
  return instance;
}

function toLegacyDefinitionView(definition: QuestDefinitionV2): QuestDefinition {
  return {
    id: definition.id,
    title: definition.title,
    description: definition.description,
    completionMessage: definition.completionMessage,
    scope: definition.scope,
    autoAccept: definition.acceptMode === "auto",
    enabled: definition.enabled,
    completeWhen: definition.completeWhen,
    goals: definition.goals.map((goal) => ({
      id: goal.id,
      displayText: goal.displayText,
      event: goal.semantics === "snapshot" ? `quest.snapshot.${goal.provider}` : goal.eventType,
      filters: goal.semantics === "snapshot" ? {} : { ...goal.filters },
      progress: {
        mode: goal.semantics === "counter" && goal.aggregation === "sum" ? "sum" : "count",
        target: goal.semantics === "milestone" ? 1 : goal.target,
        field: goal.semantics === "counter" ? goal.field : undefined,
      },
    })),
    rewards: definition.rewards.map((reward) => ({ ...reward, params: { ...reward.params } })),
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
    source: definition.source,
    category: definition.category,
    chapterId: definition.chapterId,
    rarity: definition.rarity,
  };
}

function goalTarget(goal: QuestGoalDefinitionV2): number {
  return goal.semantics === "milestone" ? 1 : goal.target;
}

function progressChanged(
  before: QuestInstanceState["progress"][string] | undefined,
  after: QuestInstanceState["progress"][string] | undefined
): boolean {
  if (!after) return false;
  return getGoalProgressValue(after) !== getGoalProgressValue(before);
}

function claimErrorMessage(status: Awaited<ReturnType<typeof claimQuestRewards>>): string | undefined {
  if (status.status === "claimed" || status.status === "already_claimed") return undefined;
  if (status.status === "recovery_required") return `奖励发放状态需要管理员恢复：${status.error}`;
  if (status.status === "retryable_error") return `奖励发放失败，请稍后重试：${status.error}`;
  return status.error;
}

interface RuntimeQuestEventContext {
  player: Player;
  aggregate: QuestPlayerAggregate;
}

class QuestPlayerService {
  private readonly rewardHandlers = createRuntimeQuestRewardHandlers();
  private readonly eventIndex = new QuestEventIndex();
  private readonly eventBus = new QuestEventBus<RuntimeQuestEventContext, QuestProgressChange[]>();
  private readonly pendingAutoAccepted = new Map<string, Set<string>>();
  private indexedDefinitionRevision = -1;
  private eventSequence = 0;

  constructor() {
    this.eventBus.subscribe((event, context) => this.applyEvent(event, context));
  }

  isReady(): boolean {
    return questStateRepository.isReady() && questCatalogService.isReady();
  }

  getState(playerOrName: Player | string): QuestPlayerState {
    const aggregate =
      typeof playerOrName === "string"
        ? questStateRepository.loadForName(playerOrName)
        : questStateRepository.loadForPlayer(playerOrName);
    if (!aggregate) {
      return { playerName: typeof playerOrName === "string" ? playerOrName : playerOrName.name, quests: {} };
    }

    const quests: Record<string, QuestPlayerQuestState> = {};
    for (const [questId, instanceId] of Object.entries(aggregate.activeByQuestId)) {
      const instance = aggregate.instances[instanceId];
      if (instance) quests[questId] = toLegacyQuestState(instance);
    }
    return { playerName: aggregate.displayName, quests };
  }

  /** @deprecated 新代码应通过任务命令修改聚合；保留此方法仅兼容旧调用。 */
  saveState(playerOrName: Player | string, state: QuestPlayerState): boolean {
    if (typeof playerOrName === "string" || !this.isReady()) return false;
    const aggregate = questStateRepository.loadForPlayer(playerOrName);
    for (const legacyState of Object.values(state.quests)) {
      const quest = questDefinitionService.get(legacyState.questId);
      if (!quest) continue;
      let instance = aggregate.instances[aggregate.activeByQuestId[quest.id]];
      if (!instance || instance.periodKey !== legacyState.periodKey) {
        const attempt = nextAttempt(aggregate, quest.id, legacyState.periodKey);
        instance = {
          instanceId: createQuestInstanceId(quest.id, legacyState.periodKey, attempt),
          questId: quest.id,
          definitionVersion: 1,
          periodKey: legacyState.periodKey,
          attempt,
          acceptedAt: legacyState.acceptedAt,
          lifecycle: "accepted",
          progress: {},
        };
      }
      instance.progress = Object.fromEntries(
        Object.entries(legacyState.progress).map(([goalId, value]) => [goalId, { kind: "number", value }])
      );
      instance.completedAt = legacyState.completedAt;
      instance.claimedAt = legacyState.claimedAt;
      instance.lifecycle = legacyState.claimedAt !== undefined ? "claimed" : "accepted";
      if (legacyState.completedAt !== undefined && legacyState.claimedAt === undefined) {
        completeQuestInstance(instance, normalizeLegacyCustomQuest(quest), legacyState.completedAt, 1);
      }
      aggregate.instances[instance.instanceId] = instance;
      aggregate.activeByQuestId[quest.id] = instance.instanceId;
    }
    questStateRepository.saveForPlayer(playerOrName, aggregate);
    return true;
  }

  getEnabledQuests(): QuestDefinition[] {
    if (!questCatalogService.isReady()) return [];
    return questCatalogService
      .getAllDefinitions()
      .filter((definition) => {
        const entry = questCatalogService.getEffectiveQuest(definition.id);
        return !!entry?.packEnabled && !!entry.questEnabled;
      })
      .map(toLegacyDefinitionView);
  }

  /**
   * Player journal view. Unlike the active event catalog, this also retains suspended
   * accepted/completed instances so turning a preset pack off never hides claimable rewards.
   */
  getJournalQuests(player: Player): QuestDefinition[] {
    const aggregate = questStateRepository.loadForPlayer(player);
    const definitions = new Map<string, QuestDefinition>();
    for (const quest of this.getEnabledQuests()) definitions.set(quest.id, quest);
    for (const [questId, instanceId] of Object.entries(aggregate.activeByQuestId)) {
      const definition = questCatalogService.getDefinition(questId);
      const instance = aggregate.instances[instanceId];
      if (!definition || !instance) continue;
      const view = toLegacyDefinitionView(definition);
      if (instance.completionSnapshot) {
        view.title = instance.completionSnapshot.title;
        view.description = instance.completionSnapshot.description;
        view.rarity = instance.completionSnapshot.rarity;
        view.rewards = instance.completionSnapshot.rewards.map((reward) => ({
          id: reward.id,
          action: reward.action,
          params: { ...reward.params },
        }));
      }
      definitions.set(questId, view);
    }
    return Array.from(definitions.values());
  }

  getQuestState(playerOrName: Player | string, quest: QuestDefinition): QuestPlayerQuestState | undefined {
    const aggregate =
      typeof playerOrName === "string"
        ? questStateRepository.loadForName(playerOrName)
        : questStateRepository.loadForPlayer(playerOrName);
    if (!aggregate) return undefined;
    const instance = getCurrentInstance(aggregate, quest);
    return instance ? toLegacyQuestState(instance) : undefined;
  }

  canAccept(playerOrName: Player | string, quest: QuestDefinition): boolean {
    const aggregate =
      typeof playerOrName === "string"
        ? questStateRepository.loadForName(playerOrName)
        : questStateRepository.loadForPlayer(playerOrName);
    if (!aggregate) return false;
    const definition = questCatalogService.getDefinition(quest.id);
    if (!definition || definition.acceptMode !== "manual") return false;
    if (questCatalogService.getAvailability(quest.id, aggregate) !== "available") return false;
    const instance = getCurrentInstance(aggregate, quest);
    if (!instance) return true;
    return quest.scope === "repeatable" && instance.lifecycle === "claimed";
  }

  acceptQuest(player: Player, questId: string): string | undefined {
    const quest = questCatalogService.getDefinition(questId);
    if (!quest || !quest.enabled || quest.acceptMode !== "manual") return "任务不存在、未启用或无需手动接受。";
    const aggregate = questStateRepository.loadForPlayer(player);
    if (questCatalogService.getAvailability(questId, aggregate) !== "available") return "任务尚未解锁或当前不可用。";
    const current = getCurrentInstance(aggregate, quest);
    if (current && !(quest.scope === "repeatable" && current.lifecycle === "claimed")) {
      return "你已经接受了这个任务。";
    }

    const instance = createAcceptedInstance(aggregate, quest, Date.now());
    aggregate.instances[instance.instanceId] = instance;
    aggregate.activeByQuestId[quest.id] = instance.instanceId;
    questStateRepository.saveForPlayer(player, aggregate);
    return undefined;
  }

  ensureAutoAccepted(player: Player): void {
    const aggregate = questStateRepository.loadForPlayer(player);
    this.ensureEventIndex();
    const accepted = this.ensureAutoAcceptedInAggregate(aggregate);
    const historicalChanged = this.reconcileHistoricalProgressInAggregate(aggregate);
    if (accepted.size > 0 || historicalChanged) {
      questStateRepository.saveForPlayer(player, aggregate);
      this.queueAutoAccepted(player, accepted);
    }
  }

  consumeAutoAccepted(player: Player): QuestDefinition[] {
    const ids = this.pendingAutoAccepted.get(player.id);
    this.pendingAutoAccepted.delete(player.id);
    if (!ids) return [];
    return [...ids]
      .map((questId) => questCatalogService.getDefinition(questId))
      .filter((definition): definition is QuestDefinitionV2 => !!definition)
      .map(toLegacyDefinitionView);
  }

  recordEvent(
    player: Player,
    eventKey: string,
    payload: QuestEventPayload,
    options: { source?: string; dedupeKey?: string } = {}
  ): QuestProgressChange[] {
    if (!isRealPlayerEntity(player) || !this.isReady()) return [];
    const aggregate = questStateRepository.loadForPlayer(player);
    this.ensureEventIndex();
    const event: QuestEvent = {
      id: `quest.runtime:${aggregate.playerCmid}:${++this.eventSequence}`,
      type: eventKey,
      playerCmid: aggregate.playerCmid,
      timestamp: Date.now(),
      payload,
      source: options.source ?? "minecraft.after_event",
      dedupeKey: options.dedupeKey,
    };
    if (hasProcessedQuestEvent(aggregate, event.dedupeKey)) return [];
    return this.eventBus.publish(event, { player, aggregate }).flat();
  }

  private applyEvent(event: QuestEvent, context: RuntimeQuestEventContext): QuestProgressChange[] {
    const { player, aggregate } = context;
    let changedAggregate = false;
    const acceptedBeforeEvent = this.ensureAutoAcceptedInAggregate(aggregate);
    if (acceptedBeforeEvent.size > 0) changedAggregate = true;
    if (this.reconcileHistoricalProgressInAggregate(aggregate)) changedAggregate = true;
    if (this.recordFacts(aggregate, event)) changedAggregate = true;
    const acceptedFromThisEvent = this.ensureAutoAcceptedInAggregate(aggregate);
    if (acceptedFromThisEvent.size > 0) changedAggregate = true;
    const changes: QuestProgressChange[] = [];
    const candidates = this.eventIndex.getCandidates(event.type, event.payload);
    const goalsByQuest = new Map<string, Set<string>>();
    for (const candidate of candidates) {
      const goalIds = goalsByQuest.get(candidate.questId) ?? new Set<string>();
      goalIds.add(candidate.goalId);
      goalsByQuest.set(candidate.questId, goalIds);
    }

    for (const [questId, goalIds] of goalsByQuest) {
      const quest = questCatalogService.getDefinition(questId);
      if (!quest || !quest.enabled) continue;
      if (acceptedFromThisEvent.has(questId) && quest.unlockEventPolicy !== "include_once") continue;
      if (questCatalogService.getAvailability(questId, aggregate) !== "available") continue;
      const instance = getCurrentInstance(aggregate, quest);
      if (!instance || instance.lifecycle !== "accepted") continue;

      let changedQuest = false;
      const legacyQuest = toLegacyDefinitionView(quest);
      for (const goal of quest.goals) {
        if (goal.semantics === "snapshot" || !goalIds.has(goal.id)) continue;
        const before = instance.progress[goal.id];
        if (getGoalProgressValue(before) >= goalTarget(goal)) continue;
        const historicalValue =
          goal.semantics === "counter" ? resolveHistoricalBossCounterValue(aggregate, goal) : undefined;
        const selectorId = "selectorId" in goal ? goal.selectorId : undefined;
        const selectorMatches =
          historicalValue !== undefined
            ? true
            : selectorId
              ? typeof event.payload.item === "string" &&
                questCatalogService.selectors.matchItem(selectorId, {
                  typeId: event.payload.item,
                  amount: Math.max(1, Number(event.payload.amount ?? 1)),
                })
              : true;
        const after =
          historicalValue === undefined
            ? applyQuestGoalEvent(before, goal, event.payload, event.timestamp, selectorMatches, event.id)
            : { kind: "number" as const, value: historicalValue };
        if (!progressChanged(before, after)) continue;

        instance.progress[goal.id] = after!;
        changedQuest = true;
        changedAggregate = true;
        const legacyGoal = legacyQuest.goals.find((candidate) => candidate.id === goal.id);
        if (legacyGoal) {
          changes.push({
            quest: legacyQuest,
            goal: legacyGoal,
            current: getGoalProgressValue(after),
            target: goalTarget(goal),
            completedQuest: false,
          });
        }
      }

      if (changedQuest && isQuestDefinitionComplete(quest, instance.progress)) {
        completeQuestInstance(instance, quest, Date.now(), questCatalogService.getRewardScale(quest.id));
        changes.forEach((change) => {
          if (change.quest.id === quest.id) change.completedQuest = true;
        });
      }
    }

    if (event.dedupeKey) {
      markQuestEventProcessed(aggregate, event.dedupeKey);
      changedAggregate = true;
    }
    const acceptedAfterCompletion = this.ensureAutoAcceptedInAggregate(aggregate);
    if (acceptedAfterCompletion.size > 0) changedAggregate = true;
    if (changedAggregate) questStateRepository.saveForPlayer(player, aggregate);
    this.queueAutoAccepted(
      player,
      new Set([...acceptedBeforeEvent, ...acceptedFromThisEvent, ...acceptedAfterCompletion])
    );
    return changes;
  }

  getProgress(playerOrName: Player | string, quest: QuestDefinition, goal: QuestGoalDefinition): number {
    return this.getQuestState(playerOrName, quest)?.progress[goal.id] ?? 0;
  }

  isCompleted(playerOrName: Player | string, quest: QuestDefinition): boolean {
    const aggregate =
      typeof playerOrName === "string"
        ? questStateRepository.loadForName(playerOrName)
        : questStateRepository.loadForPlayer(playerOrName);
    if (!aggregate) return false;
    const instance = getCurrentInstance(aggregate, quest);
    if (!instance) return false;
    if (["completed", "claiming", "claimed", "recovery_required"].includes(instance.lifecycle)) return true;
    const definition = questCatalogService.getDefinition(quest.id);
    return !!definition && isQuestDefinitionComplete(definition, instance.progress);
  }

  canClaim(playerOrName: Player | string, quest: QuestDefinition): boolean {
    const aggregate =
      typeof playerOrName === "string"
        ? questStateRepository.loadForName(playerOrName)
        : questStateRepository.loadForPlayer(playerOrName);
    if (!aggregate) return false;
    const instance = getCurrentInstance(aggregate, quest);
    if (!instance || instance.lifecycle === "claimed" || instance.lifecycle === "recovery_required") return false;
    if (instance.lifecycle === "completed" || instance.lifecycle === "claiming") return true;
    const definition = questCatalogService.getDefinition(quest.id);
    return !!definition && isQuestDefinitionComplete(definition, instance.progress);
  }

  async claimQuest(player: Player, questId: string): Promise<string | undefined> {
    const aggregate = questStateRepository.loadForPlayer(player);
    const instanceId = aggregate.activeByQuestId[questId];
    const instance = instanceId ? aggregate.instances[instanceId] : undefined;
    if (!instance) return "你还没有接受这个任务。";
    if (instance.lifecycle === "claimed") return "这个任务奖励已经领取过了。";
    if (instance.lifecycle === "recovery_required") return "这个任务的奖励发放状态需要管理员恢复。";

    if (instance.lifecycle === "accepted") {
      const quest = questCatalogService.getDefinition(questId);
      if (!quest) return "任务定义已不存在，且没有可用的完成快照。";
      if (!isQuestDefinitionComplete(quest, instance.progress)) return "任务还没有完成。";
      completeQuestInstance(instance, quest, Date.now(), questCatalogService.getRewardScale(quest.id));
      questStateRepository.saveForPlayer(player, aggregate);
    }

    const result = await claimQuestRewards({
      aggregate,
      instanceId: instance.instanceId,
      handlers: this.rewardHandlers,
      context: player,
      persist: (nextAggregate) => questStateRepository.saveForPlayer(player, nextAggregate),
      now: () => Date.now(),
    });
    return claimErrorMessage(result);
  }

  getSummary(player: Player): {
    total: number;
    accepted: number;
    completed: number;
    claimable: number;
    available: number;
  } {
    const enabledQuests = this.getEnabledQuests();
    const journalQuests = this.getJournalQuests(player);
    const acceptedStates = journalQuests.map((quest) => this.getQuestState(player, quest)).filter(Boolean);
    return {
      total: enabledQuests.length,
      accepted: acceptedStates.length,
      completed: journalQuests.filter((quest) => this.isCompleted(player, quest)).length,
      claimable: journalQuests.filter((quest) => this.canClaim(player, quest)).length,
      available: enabledQuests.filter((quest) => this.canAccept(player, quest)).length,
    };
  }

  formatGoalProgress(player: Player, quest: QuestDefinition, goal: QuestGoalDefinition): string {
    const current = this.getProgress(player, quest, goal);
    const target = goal.progress.target;
    const filterText = Object.entries(goal.filters)
      .map(([key, filter]) => `${key} ${filter.op} ${formatFilterValue(filter.value)}`)
      .join("，");
    return `${current}/${target}${filterText ? ` · ${filterText}` : ""}`;
  }

  getQuestRarity(questId: string): QuestRarity {
    return questCatalogService.getDefinition(questId)?.rarity ?? "common";
  }

  reconcileSnapshots(player: Player, batch: RuntimeQuestSnapshotBatch): QuestProgressChange[] {
    if (!this.isReady()) return [];
    const aggregate = questStateRepository.loadForPlayer(player);
    this.ensureEventIndex();
    const autoAccepted = this.ensureAutoAcceptedInAggregate(aggregate);
    let changedAggregate = autoAccepted.size > 0;
    if (this.reconcileHistoricalProgressInAggregate(aggregate)) changedAggregate = true;
    const changes: QuestProgressChange[] = [];

    for (const [questId, instanceId] of Object.entries(aggregate.activeByQuestId)) {
      const definition = questCatalogService.getDefinition(questId);
      const instance = aggregate.instances[instanceId];
      if (!definition || !instance || instance.lifecycle !== "accepted") continue;
      if (questCatalogService.getAvailability(questId, aggregate) !== "available") continue;

      const beforeValues = Object.fromEntries(
        definition.goals.map((goal) => [goal.id, getGoalProgressValue(instance.progress[goal.id])])
      );
      const changedGoalIds = reconcileSnapshotGoals({
        goals: definition.goals,
        progress: instance.progress,
        selectors: questCatalogService.selectors,
        inventory: batch.inventory,
        equipment: batch.equipment,
        effects: batch.effects,
        creeperState: batch.creeperState,
      });
      if (changedGoalIds.length === 0) continue;
      changedAggregate = true;
      const legacyQuest = toLegacyDefinitionView(definition);
      for (const goalId of changedGoalIds) {
        const goal = definition.goals.find((candidate) => candidate.id === goalId);
        const legacyGoal = legacyQuest.goals.find((candidate) => candidate.id === goalId);
        if (!goal || !legacyGoal) continue;
        const current = getGoalProgressValue(instance.progress[goalId]);
        if (current === beforeValues[goalId]) continue;
        changes.push({
          quest: legacyQuest,
          goal: legacyGoal,
          current,
          target: goalTarget(goal),
          completedQuest: false,
        });
      }
      if (isQuestDefinitionComplete(definition, instance.progress)) {
        completeQuestInstance(instance, definition, Date.now(), questCatalogService.getRewardScale(questId));
        changes.forEach((change) => {
          if (change.quest.id === questId) change.completedQuest = true;
        });
      }
    }

    if (changedAggregate) questStateRepository.saveForPlayer(player, aggregate);
    this.queueAutoAccepted(player, autoAccepted);
    return changes;
  }

  private recordFacts(aggregate: QuestPlayerAggregate, event: QuestEvent): boolean {
    let changed = false;
    if (event.type === "item.obtain" && event.payload.item === "minecraft:iron_ingot") {
      const amount = Number(event.payload.amount ?? 1);
      if (Number.isFinite(amount) && amount > 0) {
        recordQuestFactCounter(aggregate, "fact.item.iron_ingot", amount, event.timestamp);
        changed = true;
      }
    }
    if (event.type === "player.dimension_enter" && String(event.payload.dimension) === "nether") {
      setQuestFactMilestone(aggregate, "fact.dimension.nether.entered", event.timestamp, event.id);
      changed = true;
    }
    if (event.type === "entity.kill" && typeof event.payload.entity === "string") {
      if (recordBossKillFact(aggregate, event.payload.entity, event.timestamp)) changed = true;
    }
    return changed;
  }

  private reconcileHistoricalProgressInAggregate(aggregate: QuestPlayerAggregate): boolean {
    let changed = false;
    for (const [questId, instanceId] of Object.entries(aggregate.activeByQuestId)) {
      const definition = questCatalogService.getDefinition(questId);
      const instance = aggregate.instances[instanceId];
      if (!definition || !instance || instance.lifecycle !== "accepted") continue;
      if (questCatalogService.getAvailability(questId, aggregate) !== "available") continue;
      if (reconcileHistoricalBossCounterGoals(aggregate, definition, instance).length === 0) continue;
      changed = true;
      if (isQuestDefinitionComplete(definition, instance.progress)) {
        completeQuestInstance(instance, definition, Date.now(), questCatalogService.getRewardScale(questId));
      }
    }
    return changed;
  }

  private ensureAutoAcceptedInAggregate(aggregate: QuestPlayerAggregate): Set<string> {
    const now = Date.now();
    const accepted = new Set<string>();
    for (const questId of this.eventIndex.getAutoAcceptQuestIds()) {
      const quest = questCatalogService.getDefinition(questId);
      if (!quest || !quest.enabled || quest.acceptMode !== "auto") continue;
      if (questCatalogService.getAvailability(questId, aggregate) !== "available") continue;
      const current = getCurrentInstance(aggregate, quest, now);
      if (current && !(quest.scope === "repeatable" && current.lifecycle === "claimed")) continue;
      const instance = createAcceptedInstance(aggregate, quest, now);
      aggregate.instances[instance.instanceId] = instance;
      aggregate.activeByQuestId[quest.id] = instance.instanceId;
      accepted.add(quest.id);
    }
    return accepted;
  }

  private ensureEventIndex(): void {
    const revision = questCatalogService.getRevision();
    if (revision === this.indexedDefinitionRevision) return;
    const definitions = questCatalogService.getAllDefinitions().filter((definition) => {
      const entry = questCatalogService.getEffectiveQuest(definition.id);
      return !!entry?.packEnabled && !!entry.questEnabled;
    });
    this.eventIndex.rebuild(definitions, revision);
    this.indexedDefinitionRevision = revision;
  }

  private queueAutoAccepted(player: Player, questIds: ReadonlySet<string>): void {
    if (questIds.size === 0) return;
    const pending = this.pendingAutoAccepted.get(player.id) ?? new Set<string>();
    questIds.forEach((questId) => pending.add(questId));
    this.pendingAutoAccepted.set(player.id, pending);
  }
}

export default new QuestPlayerService();
