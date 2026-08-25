import type { QuestChapterDefinition, QuestDefinitionV2 } from "../../domain";
import { coreApexChapter, coreApexQuests } from "./apex";
import { coreEndChapter, coreEndQuests } from "./end";
import { coreEndcityChapter, coreEndcityQuests } from "./endcity";
import { coreEyeChapter, coreEyeQuests } from "./eye";
import { coreMagicChapter, coreMagicQuests } from "./magic";
import { coreMiningAdditionalQuests } from "./mining";
import { coreNetherAdditionalQuests } from "./nether";
import { coreSurvivalAdditionalQuests } from "./survival";

/** New chapters that do not exist in the first twelve-quest slice. */
export const coreRemainingChapters: QuestChapterDefinition[] = [
  coreMagicChapter,
  coreEyeChapter,
  coreEndChapter,
  coreEndcityChapter,
  coreApexChapter,
];

/**
 * Quest IDs that the eventual integration must append to the three chapters
 * already owned by first-slice.ts. Keeping this manifest separate avoids
 * registering duplicate chapter definitions while the first slice remains
 * untouched.
 */
export const coreExistingChapterQuestAdditions: Readonly<Record<string, readonly string[]>> = {
  "core.survival": coreSurvivalAdditionalQuests.map((quest) => quest.id),
  "core.mining": coreMiningAdditionalQuests.map((quest) => quest.id),
  "core.nether": coreNetherAdditionalQuests.map((quest) => quest.id),
};

export const coreRemainingQuests: QuestDefinitionV2[] = [
  ...coreSurvivalAdditionalQuests,
  ...coreMiningAdditionalQuests,
  ...coreMagicQuests,
  ...coreNetherAdditionalQuests,
  ...coreEyeQuests,
  ...coreEndQuests,
  ...coreEndcityQuests,
  ...coreApexQuests,
];
