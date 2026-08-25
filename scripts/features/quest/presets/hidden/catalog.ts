import type { QuestChapterDefinition, QuestDefinitionV2, QuestPackDefinition } from "../../domain";
import { hiddenChallengeQuests, hiddenChallengesChapter, hiddenChallengesPack } from "./challenges";

export const hiddenPresetPacks: QuestPackDefinition[] = [hiddenChallengesPack];
export const hiddenPresetChapters: QuestChapterDefinition[] = [hiddenChallengesChapter];
export const hiddenPresetQuests: QuestDefinitionV2[] = [...hiddenChallengeQuests];
