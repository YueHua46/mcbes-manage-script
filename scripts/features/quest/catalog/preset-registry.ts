import type { QuestChapterDefinition, QuestDefinitionV2, QuestPackDefinition } from "../domain";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export interface QuestPresetRegistrySnapshot {
  packs: QuestPackDefinition[];
  chapters: QuestChapterDefinition[];
  quests: QuestDefinitionV2[];
}

export class QuestPresetRegistry {
  private readonly packs = new Map<string, QuestPackDefinition>();
  private readonly chapters = new Map<string, QuestChapterDefinition>();
  private readonly quests = new Map<string, QuestDefinitionV2>();

  registerPack(definition: QuestPackDefinition): void {
    if (this.packs.has(definition.id)) throw new Error(`Duplicate preset pack: ${definition.id}`);
    this.packs.set(definition.id, clone(definition));
  }

  registerChapter(definition: QuestChapterDefinition): void {
    if (this.chapters.has(definition.id)) throw new Error(`Duplicate preset chapter: ${definition.id}`);
    this.chapters.set(definition.id, clone(definition));
  }

  registerQuest(definition: QuestDefinitionV2): void {
    if (this.quests.has(definition.id)) throw new Error(`Duplicate preset quest: ${definition.id}`);
    this.quests.set(definition.id, clone(definition));
  }

  getPack(id: string): QuestPackDefinition | undefined {
    const definition = this.packs.get(id);
    return definition ? clone(definition) : undefined;
  }

  getChapter(id: string): QuestChapterDefinition | undefined {
    const definition = this.chapters.get(id);
    return definition ? clone(definition) : undefined;
  }

  getQuest(id: string): QuestDefinitionV2 | undefined {
    const definition = this.quests.get(id);
    return definition ? clone(definition) : undefined;
  }

  snapshot(): QuestPresetRegistrySnapshot {
    return {
      packs: Array.from(this.packs.values(), clone),
      chapters: Array.from(this.chapters.values(), clone),
      quests: Array.from(this.quests.values(), clone),
    };
  }
}
