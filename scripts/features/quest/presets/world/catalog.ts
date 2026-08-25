import type { QuestChapterDefinition, QuestDefinitionV2, QuestPackDefinition } from "../../domain";
import { worldArchaeologyChapter, worldArchaeologyQuests } from "./archaeology";
import { worldDeepdarkChapter, worldDeepdarkQuests } from "./deepdark";
import { worldFarmChapter, worldFarmQuests } from "./farm";
import { worldOceanChapter, worldOceanQuests } from "./ocean";
import { worldPaleGardenChapter, worldPaleGardenQuests } from "./pale-garden";
import { worldRedstoneChapter, worldRedstoneQuests } from "./redstone";
import { worldTrialsChapter, worldTrialsQuests } from "./trials";
import { worldVillageChapter, worldVillageQuests } from "./village";

export const worldPresetChapters: QuestChapterDefinition[] = [
  worldVillageChapter,
  worldOceanChapter,
  worldArchaeologyChapter,
  worldDeepdarkChapter,
  worldTrialsChapter,
  worldFarmChapter,
  worldRedstoneChapter,
  worldPaleGardenChapter,
];

export const worldPresetPack: QuestPackDefinition = {
  id: "preset.world",
  version: 1,
  title: "主线之外，世界很忙",
  description: "村庄、海洋、古城与试炼密室各有自己的麻烦；按兴趣开启章节，冒险不必排成一条直线。",
  category: "world",
  defaultEnabled: false,
  releaseState: "active",
  requiredCapabilities: [],
  requiredGameplayExperiments: [],
  chapterIds: worldPresetChapters.map((chapter) => chapter.id),
};

export const worldPresetQuests: QuestDefinitionV2[] = [
  ...worldVillageQuests,
  ...worldOceanQuests,
  ...worldArchaeologyQuests,
  ...worldDeepdarkQuests,
  ...worldTrialsQuests,
  ...worldFarmQuests,
  ...worldRedstoneQuests,
  ...worldPaleGardenQuests,
];
