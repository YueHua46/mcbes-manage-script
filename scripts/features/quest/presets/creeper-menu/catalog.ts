import type { QuestChapterDefinition, QuestDefinitionV2, QuestPackDefinition } from "../../domain";
import { creeperGuideChapter, creeperGuidePack, creeperGuideQuests } from "./guide";

export const creeperPresetPacks: QuestPackDefinition[] = [creeperGuidePack];
export const creeperPresetChapters: QuestChapterDefinition[] = [creeperGuideChapter];
export const creeperPresetQuests: QuestDefinitionV2[] = [...creeperGuideQuests];
