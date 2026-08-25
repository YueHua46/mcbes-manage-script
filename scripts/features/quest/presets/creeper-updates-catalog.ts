import type { QuestChapterDefinition, QuestDefinitionV2, QuestPackDefinition } from "../domain";
import { creeperPresetChapters, creeperPresetPacks, creeperPresetQuests } from "./creeper-menu/catalog";
import { updatePresetChapters, updatePresetPacks, updatePresetQuests } from "./updates/catalog";

export const creeperAndUpdatePacks: QuestPackDefinition[] = [...creeperPresetPacks, ...updatePresetPacks];
export const creeperAndUpdateChapters: QuestChapterDefinition[] = [...creeperPresetChapters, ...updatePresetChapters];
export const creeperAndUpdateQuests: QuestDefinitionV2[] = [...creeperPresetQuests, ...updatePresetQuests];
