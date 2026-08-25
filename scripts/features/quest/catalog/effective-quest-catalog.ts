import type { PresetPackServerState, QuestChapterDefinition, QuestDefinitionV2, QuestPackDefinition } from "../domain";
import type { QuestCatalogDiagnostic } from "./preset-validator";
import { validatePresetRegistry } from "./preset-validator";
import type { QuestCapabilityRegistry } from "./capability-registry";
import type { QuestPresetRegistry } from "./preset-registry";
import type { QuestSelectorRegistry } from "./selector-registry";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const SUPPORTED_REWARD_ACTIONS = new Set(["give_item", "add_money", "add_exp", "send_message", "run_command"]);

function isValidRewardOverride(reward: QuestDefinitionV2["rewards"][number]): boolean {
  if (!SUPPORTED_REWARD_ACTIONS.has(reward.action)) return false;
  if (["give_item", "add_money", "add_exp"].includes(reward.action)) {
    const amount = Number(reward.params.amount);
    if (!Number.isFinite(amount) || amount <= 0) return false;
  }
  if (reward.action === "give_item" && !String(reward.params.item ?? "").trim()) return false;
  if (reward.action === "send_message" && !String(reward.params.message ?? "").trim()) return false;
  if (reward.action === "run_command" && !String(reward.params.command ?? "").trim()) return false;
  return true;
}

export interface EffectiveQuestCatalogBuildInput {
  presets: QuestPresetRegistry;
  customQuests: readonly QuestDefinitionV2[];
  selectors: QuestSelectorRegistry;
  capabilities: QuestCapabilityRegistry;
  serverStates?: readonly PresetPackServerState[];
}

export interface EffectiveQuestEntry {
  definition: QuestDefinitionV2;
  pack?: QuestPackDefinition;
  packEnabled: boolean;
  chapterEnabled: boolean;
  questEnabled: boolean;
  rewardScale: number;
  confirmedGameplayExperiments: ReadonlySet<string>;
}

export class EffectiveQuestCatalog {
  private readonly quests = new Map<string, QuestDefinitionV2>();
  private readonly packs = new Map<string, QuestPackDefinition>();
  private readonly chapters = new Map<string, QuestChapterDefinition>();
  private readonly serverStates = new Map<string, PresetPackServerState>();
  private readonly diagnostics: QuestCatalogDiagnostic[];

  constructor(input: EffectiveQuestCatalogBuildInput) {
    const snapshot = input.presets.snapshot();
    this.diagnostics = validatePresetRegistry(snapshot, input.selectors, input.capabilities);
    snapshot.packs.forEach((pack) => this.packs.set(pack.id, pack));
    snapshot.chapters.forEach((chapter) => this.chapters.set(chapter.id, chapter));
    snapshot.quests.forEach((quest) => this.quests.set(quest.id, quest));

    for (const state of input.serverStates ?? []) {
      const pack = this.packs.get(state.packId);
      if (!pack) {
        this.diagnostics.push({
          severity: "error",
          code: "unknown_server_override_pack",
          message: `Server override references unknown pack: ${state.packId}`,
          definitionId: state.packId,
        });
        continue;
      }
      if (this.serverStates.has(state.packId)) {
        this.diagnostics.push({
          severity: "error",
          code: "duplicate_server_override_pack",
          message: `Duplicate server override for pack: ${state.packId}`,
          definitionId: state.packId,
        });
        continue;
      }
      const rewardScale = state.rewardScale ?? 1;
      if (!Number.isFinite(rewardScale) || rewardScale < 0 || rewardScale > 100) {
        this.diagnostics.push({
          severity: "error",
          code: "invalid_reward_scale",
          message: `Invalid reward scale for pack ${state.packId}: ${String(state.rewardScale)}`,
          definitionId: state.packId,
        });
        continue;
      }
      for (const questId of Object.keys(state.overrideQuestEnabled ?? {})) {
        const quest = this.quests.get(questId);
        if (!quest || quest.packId !== state.packId) {
          this.diagnostics.push({
            severity: "error",
            code: "invalid_quest_server_override",
            message: `Pack ${state.packId} cannot override quest: ${questId}`,
            definitionId: questId,
          });
        }
      }
      for (const chapterId of Object.keys(state.overrideChapterEnabled ?? {})) {
        const chapter = this.chapters.get(chapterId);
        if (!chapter || chapter.packId !== state.packId) {
          this.diagnostics.push({
            severity: "error",
            code: "invalid_chapter_server_override",
            message: `Pack ${state.packId} cannot override chapter: ${chapterId}`,
            definitionId: chapterId,
          });
        }
      }
      const validRewardOverrides: Record<string, QuestDefinitionV2["rewards"]> = {};
      for (const [questId, rewards] of Object.entries(state.overrideQuestRewards ?? {})) {
        const quest = this.quests.get(questId);
        if (!quest || quest.packId !== state.packId) {
          this.diagnostics.push({
            severity: "error",
            code: "invalid_quest_reward_override",
            message: `Pack ${state.packId} cannot override rewards for quest: ${questId}`,
            definitionId: questId,
          });
          continue;
        }
        const rewardIds = new Set<string>();
        let valid = true;
        for (const reward of rewards) {
          if (!/^[a-z0-9][a-z0-9_.-]*$/.test(reward.id) || !isValidRewardOverride(reward) || rewardIds.has(reward.id)) {
            valid = false;
            this.diagnostics.push({
              severity: "error",
              code: "invalid_reward_server_override",
              message: `Quest ${questId} has an invalid or duplicate overridden reward: ${reward.id}`,
              definitionId: questId,
            });
          }
          rewardIds.add(reward.id);
        }
        if (valid) {
          validRewardOverrides[questId] = rewards.map((reward) => ({ ...reward, params: { ...reward.params } }));
        }
      }
      this.serverStates.set(state.packId, {
        ...state,
        overrideChapterEnabled: { ...state.overrideChapterEnabled },
        overrideQuestEnabled: { ...state.overrideQuestEnabled },
        overrideQuestRewards: validRewardOverrides,
        gameplayExperimentConfirmation: { ...state.gameplayExperimentConfirmation },
      });
    }

    for (const customQuest of input.customQuests) {
      if (this.quests.has(customQuest.id)) {
        this.diagnostics.push({
          severity: "error",
          code: "preset_custom_id_conflict",
          message: `Custom quest conflicts with preset id: ${customQuest.id}`,
          definitionId: customQuest.id,
        });
        continue;
      }
      this.quests.set(customQuest.id, customQuest);
    }
  }

  getAll(options: { includePlanned?: boolean } = {}): QuestDefinitionV2[] {
    const definitions = Array.from(this.quests.values());
    return (options.includePlanned ? definitions : definitions.filter((quest) => quest.releaseState !== "planned")).map(
      clone
    );
  }

  getById(id: string): QuestDefinitionV2 | undefined {
    const definition = this.quests.get(id);
    return definition ? clone(definition) : undefined;
  }

  getPack(id: string): QuestPackDefinition | undefined {
    const definition = this.packs.get(id);
    return definition ? clone(definition) : undefined;
  }

  getPacks(): QuestPackDefinition[] {
    return Array.from(this.packs.values(), clone);
  }

  getChapter(id: string): QuestChapterDefinition | undefined {
    const definition = this.chapters.get(id);
    return definition ? clone(definition) : undefined;
  }

  getChapters(packId?: string): QuestChapterDefinition[] {
    return Array.from(this.chapters.values(), clone)
      .filter((chapter) => !packId || chapter.packId === packId)
      .sort((left, right) => left.order - right.order);
  }

  getDiagnostics(): QuestCatalogDiagnostic[] {
    return [...this.diagnostics];
  }

  getEffectiveQuest(id: string): EffectiveQuestEntry | undefined {
    const definition = this.quests.get(id);
    if (!definition) return undefined;
    if (!definition.packId) {
      return {
        definition: clone(definition),
        packEnabled: true,
        chapterEnabled: true,
        questEnabled: definition.enabled,
        rewardScale: 1,
        confirmedGameplayExperiments: new Set(),
      };
    }

    const pack = this.packs.get(definition.packId);
    if (!pack) return undefined;
    const override = this.serverStates.get(pack.id);
    const chapterEnabled = definition.chapterId
      ? (override?.overrideChapterEnabled?.[definition.chapterId] ?? true)
      : true;
    const rewardOverride = override?.overrideQuestRewards?.[definition.id];
    return {
      definition: rewardOverride
        ? {
            ...clone(definition),
            rewards: rewardOverride.map((reward) => ({ ...reward, params: { ...reward.params } })),
          }
        : clone(definition),
      pack: clone(pack),
      packEnabled: override?.enabled ?? pack.defaultEnabled,
      chapterEnabled,
      questEnabled: chapterEnabled && (override?.overrideQuestEnabled?.[definition.id] ?? definition.enabled),
      rewardScale: override?.rewardScale ?? 1,
      confirmedGameplayExperiments: new Set(
        Object.entries(override?.gameplayExperimentConfirmation ?? {})
          .filter(([, confirmed]) => confirmed)
          .map(([experiment]) => experiment)
      ),
    };
  }

  isValid(): boolean {
    return !this.diagnostics.some((diagnostic) => diagnostic.severity === "error");
  }
}
