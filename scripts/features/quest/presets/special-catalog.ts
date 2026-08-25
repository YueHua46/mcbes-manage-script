import type { QuestChapterDefinition, QuestDefinitionV2, QuestPackDefinition } from "../domain";
import { experimentPresetChapters, experimentPresetPacks, experimentPresetQuests } from "./experiment/catalog";
import { hiddenPresetChapters, hiddenPresetPacks, hiddenPresetQuests } from "./hidden/catalog";

export const specialPresetPacks: QuestPackDefinition[] = [...experimentPresetPacks, ...hiddenPresetPacks];
export const specialPresetChapters: QuestChapterDefinition[] = [...experimentPresetChapters, ...hiddenPresetChapters];
export const specialPresetQuests: QuestDefinitionV2[] = [...experimentPresetQuests, ...hiddenPresetQuests];
