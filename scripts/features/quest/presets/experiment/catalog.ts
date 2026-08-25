import type { QuestChapterDefinition, QuestDefinitionV2, QuestPackDefinition } from "../../domain";
import { experimentDrop3Chapter, experimentDrop3Pack, experimentDrop3Quests } from "./drop3";

export const experimentPresetPacks: QuestPackDefinition[] = [experimentDrop3Pack];
export const experimentPresetChapters: QuestChapterDefinition[] = [experimentDrop3Chapter];
export const experimentPresetQuests: QuestDefinitionV2[] = [...experimentDrop3Quests];
