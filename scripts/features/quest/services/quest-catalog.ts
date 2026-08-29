import { system } from "@minecraft/server";
import { Database } from "../../../shared/database/database";
import {
  createDefaultQuestCapabilityRegistry,
  createDefaultQuestSelectorRegistry,
  EffectiveQuestCatalog,
  normalizeLegacyCustomQuest,
  type EffectiveQuestEntry,
} from "../catalog";
import {
  type PresetPackServerState,
  type QuestAvailability,
  type QuestChapterDefinition,
  type QuestDefinitionV2,
  type QuestPackDefinition,
  type QuestPlayerAggregate,
  type QuestRewardDefinitionV2,
  type QuestRuleContext,
} from "../domain";
import { resolveAvailability } from "../domain/quest-rules";
import { createQuestPresetRegistry } from "../presets";
import { getQuestFactValue } from "../state/quest-fact-store";
import questDefinitionService from "./quest-definition";
import { getQuestRewardSchema } from "./quest-definition";
import { arePresetQuestsEnabled } from "./quest-runtime-policy";

const SERVER_STATE_DB = "quest_preset_pack_states";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function validateRewardOverride(reward: QuestRewardDefinitionV2): string | undefined {
  const schema = getQuestRewardSchema(reward.action);
  if (!schema) return `未知奖励类型：${reward.action}`;
  for (const field of schema.fields) {
    const value = reward.params[field.key];
    if (field.required && String(value ?? "").trim() === "") return `奖励缺少「${field.label}」`;
    if (field.type === "number" && (!Number.isFinite(Number(value)) || Number(value) <= 0)) {
      return `奖励「${field.label}」必须是正数`;
    }
  }
  return undefined;
}

function questStatuses(aggregate: QuestPlayerAggregate): QuestRuleContext["questStatuses"] {
  const result: Record<string, "completed" | "claimed" | undefined> = {};
  for (const instance of Object.values(aggregate.instances)) {
    if (instance.lifecycle === "claimed") result[instance.questId] = "claimed";
    else if (
      result[instance.questId] !== "claimed" &&
      ["completed", "claiming", "recovery_required"].includes(instance.lifecycle)
    ) {
      result[instance.questId] = "completed";
    }
  }
  return result;
}

class QuestCatalogService {
  readonly selectors = createDefaultQuestSelectorRegistry();
  readonly capabilities = createDefaultQuestCapabilityRegistry();
  private readonly presets = createQuestPresetRegistry();
  private serverStateDb?: Database<PresetPackServerState>;
  private catalog?: EffectiveQuestCatalog;
  private builtDefinitionRevision = -1;
  private serverStateRevision = 0;
  private builtServerStateRevision = -1;

  constructor() {
    system.run(() => {
      this.serverStateDb = new Database<PresetPackServerState>(SERVER_STATE_DB);
      this.serverStateRevision += 1;
    });
  }

  isReady(): boolean {
    return !!this.serverStateDb && questDefinitionService.isReady();
  }

  getRevision(): number {
    this.ensureCatalog();
    const catalogRevision = this.builtDefinitionRevision * 1_000_000 + this.builtServerStateRevision;
    return catalogRevision * 2 + (arePresetQuestsEnabled() ? 1 : 0);
  }

  getAllDefinitions(): QuestDefinitionV2[] {
    const catalog = this.ensureCatalog();
    return catalog.getAll().map((definition) => catalog.getEffectiveQuest(definition.id)?.definition ?? definition);
  }

  getDefinition(questId: string): QuestDefinitionV2 | undefined {
    return this.ensureCatalog().getEffectiveQuest(questId)?.definition;
  }

  getEffectiveQuest(questId: string): EffectiveQuestEntry | undefined {
    const entry = this.ensureCatalog().getEffectiveQuest(questId);
    if (!entry?.definition.packId || arePresetQuestsEnabled()) return entry;
    return { ...entry, packEnabled: false };
  }

  getDiagnostics() {
    return this.ensureCatalog().getDiagnostics();
  }

  getPresetPacks(): QuestPackDefinition[] {
    return this.presets.snapshot().packs.sort((left, right) => left.title.localeCompare(right.title, "zh-CN"));
  }

  getPresetChapters(packId: string): QuestChapterDefinition[] {
    return this.presets
      .snapshot()
      .chapters.filter((chapter) => chapter.packId === packId)
      .sort((left, right) => left.order - right.order);
  }

  getPresetQuests(packId: string, chapterId?: string): QuestDefinitionV2[] {
    return this.presets
      .snapshot()
      .quests.filter((quest) => quest.packId === packId && (!chapterId || quest.chapterId === chapterId))
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
  }

  getOfficialPresetQuest(questId: string): QuestDefinitionV2 | undefined {
    return this.presets.getQuest(questId);
  }

  getAvailability(questId: string, aggregate: QuestPlayerAggregate): QuestAvailability {
    const catalog = this.ensureCatalog();
    const entry = this.getEffectiveQuest(questId);
    if (!entry) return "unavailable";
    const definition = entry.definition;
    const chapter = definition.chapterId ? catalog.getChapter(definition.chapterId) : undefined;
    const pack = entry.pack;
    const context = this.ruleContext(aggregate);
    const releaseState =
      definition.releaseState === "planned" || chapter?.releaseState === "planned" || pack?.releaseState === "planned"
        ? "planned"
        : definition.releaseState;
    const unlockRule = chapter
      ? { type: "all" as const, rules: [chapter.unlockRule, definition.unlockRule] }
      : definition.unlockRule;
    return resolveAvailability(
      {
        releaseState,
        enabled: entry.questEnabled,
        packEnabled: entry.packEnabled,
        requiredCapabilities: [...(pack?.requiredCapabilities ?? []), ...definition.requiredCapabilities],
        requiredGameplayExperiments: [
          ...(pack?.requiredGameplayExperiments ?? []),
          ...definition.requiredGameplayExperiments,
        ],
        availableGameplayExperiments: entry.confirmedGameplayExperiments,
        unlockRule,
      },
      context
    );
  }

  getRewardScale(questId: string): number {
    return this.ensureCatalog().getEffectiveQuest(questId)?.rewardScale ?? 1;
  }

  getServerStates(): PresetPackServerState[] {
    return Object.values(this.serverStateDb?.getAll() ?? {}).map(clone);
  }

  getServerState(packId: string): PresetPackServerState | undefined {
    const state = this.serverStateDb?.get(packId);
    return state ? clone(state) : undefined;
  }

  saveServerState(state: PresetPackServerState): boolean {
    if (!this.serverStateDb) return false;
    const pack = this.presets.getPack(state.packId);
    if (
      !pack ||
      !Number.isFinite(state.rewardScale ?? 1) ||
      (state.rewardScale ?? 1) < 0 ||
      (state.rewardScale ?? 1) > 100
    )
      return false;
    const chapterIds = new Set(this.getPresetChapters(state.packId).map((chapter) => chapter.id));
    const questIds = new Set(this.getPresetQuests(state.packId).map((quest) => quest.id));
    if (Object.keys(state.overrideChapterEnabled ?? {}).some((chapterId) => !chapterIds.has(chapterId))) return false;
    if (Object.keys(state.overrideQuestEnabled ?? {}).some((questId) => !questIds.has(questId))) return false;
    for (const [questId, rewards] of Object.entries(state.overrideQuestRewards ?? {})) {
      if (!questIds.has(questId)) return false;
      const rewardIds = new Set<string>();
      for (const reward of rewards) {
        if (!/^[a-z0-9][a-z0-9_.-]*$/.test(reward.id) || rewardIds.has(reward.id)) return false;
        if (validateRewardOverride(reward)) return false;
        rewardIds.add(reward.id);
      }
    }
    const persisted = clone({ ...state, updatedAt: Date.now() });
    this.serverStateDb.set(state.packId, persisted);
    this.serverStateDb.save(true);
    this.serverStateRevision += 1;
    return true;
  }

  private ruleContext(aggregate: QuestPlayerAggregate): QuestRuleContext {
    const facts = Object.fromEntries(
      Object.keys(aggregate.facts).map((factId) => [factId, getQuestFactValue(aggregate, factId)])
    );
    const capabilities = new Set(
      this.capabilities
        .getAll()
        .filter((capability) => this.capabilities.isAvailable(capability.id))
        .map((capability) => capability.id)
    );
    return { questStatuses: questStatuses(aggregate), facts, capabilities };
  }

  private ensureCatalog(): EffectiveQuestCatalog {
    if (!this.isReady()) throw new Error("Quest catalog is not ready");
    const definitionRevision = questDefinitionService.getRevision();
    if (
      this.catalog &&
      definitionRevision === this.builtDefinitionRevision &&
      this.serverStateRevision === this.builtServerStateRevision
    ) {
      return this.catalog;
    }
    const customQuests = questDefinitionService.getAll().map((definition) => normalizeLegacyCustomQuest(definition));
    this.catalog = new EffectiveQuestCatalog({
      presets: this.presets,
      customQuests,
      selectors: this.selectors,
      capabilities: this.capabilities,
      serverStates: this.getServerStates(),
    });
    this.builtDefinitionRevision = definitionRevision;
    this.builtServerStateRevision = this.serverStateRevision;
    for (const diagnostic of this.catalog.getDiagnostics()) {
      const output = `[QuestCatalog] ${diagnostic.code}: ${diagnostic.message}`;
      if (diagnostic.severity === "error") console.error(output);
      else console.warn(output);
    }
    return this.catalog;
  }
}

export default new QuestCatalogService();
