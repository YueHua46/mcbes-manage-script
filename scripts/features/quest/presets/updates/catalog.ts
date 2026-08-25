import type { QuestChapterDefinition, QuestDefinitionV2, QuestPackDefinition } from "../../domain";
import { updateChaosChapter, updateChaosPack, updateChaosQuests } from "./chaos";
import { updateCopperChapter, updateCopperPack, updateCopperQuests } from "./copper";
import { updateMountsChapter, updateMountsPack, updateMountsQuests } from "./mounts";
import { updateSkiesChapter, updateSkiesPack, updateSkiesQuests } from "./skies";
import { updateTinyChapter, updateTinyPack, updateTinyQuests } from "./tiny";

export const updatePresetPacks: QuestPackDefinition[] = [
  updateCopperPack,
  updateSkiesPack,
  updateMountsPack,
  updateTinyPack,
  updateChaosPack,
];

export const updatePresetChapters: QuestChapterDefinition[] = [
  updateCopperChapter,
  updateSkiesChapter,
  updateMountsChapter,
  updateTinyChapter,
  updateChaosChapter,
];

export const updatePresetQuests: QuestDefinitionV2[] = [
  ...updateCopperQuests,
  ...updateSkiesQuests,
  ...updateMountsQuests,
  ...updateTinyQuests,
  ...updateChaosQuests,
];
