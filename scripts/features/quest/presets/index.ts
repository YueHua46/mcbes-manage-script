import { QuestPresetRegistry } from "../catalog/preset-registry";
import { coreFirstSliceChapters, coreFirstSlicePack, coreFirstSliceQuests } from "./core/first-slice";
import { coreExistingChapterQuestAdditions, coreRemainingChapters, coreRemainingQuests } from "./core/remaining";
import { creeperAndUpdateChapters, creeperAndUpdatePacks, creeperAndUpdateQuests } from "./creeper-updates-catalog";
import { specialPresetChapters, specialPresetPacks, specialPresetQuests } from "./special-catalog";
import { worldPresetChapters, worldPresetPack, worldPresetQuests } from "./world/catalog";

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

export function createQuestPresetRegistry(): QuestPresetRegistry {
  const registry = new QuestPresetRegistry();

  registry.registerPack({
    ...coreFirstSlicePack,
    chapterIds: unique([...coreFirstSlicePack.chapterIds, ...coreRemainingChapters.map((chapter) => chapter.id)]),
  });
  coreFirstSliceChapters.forEach((chapter) =>
    registry.registerChapter({
      ...chapter,
      questIds: unique([...chapter.questIds, ...(coreExistingChapterQuestAdditions[chapter.id] ?? [])]),
    })
  );
  coreRemainingChapters.forEach((chapter) => registry.registerChapter(chapter));
  [...coreFirstSliceQuests, ...coreRemainingQuests].forEach((quest) => registry.registerQuest(quest));

  [worldPresetPack, ...creeperAndUpdatePacks, ...specialPresetPacks].forEach((pack) => registry.registerPack(pack));
  [...worldPresetChapters, ...creeperAndUpdateChapters, ...specialPresetChapters].forEach((chapter) =>
    registry.registerChapter(chapter)
  );
  [...worldPresetQuests, ...creeperAndUpdateQuests, ...specialPresetQuests].forEach((quest) =>
    registry.registerQuest(quest)
  );
  return registry;
}
