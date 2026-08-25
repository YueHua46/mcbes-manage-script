import type { QuestDefinitionV2, QuestFilter, QuestGoalDefinitionV2 } from "../domain";

export interface QuestGoalReference {
  questId: string;
  goalId: string;
}

const INDEXED_FIELDS = ["entity", "item", "block", "dimension"] as const;

function indexValues(filter: QuestFilter | undefined): string[] | undefined {
  if (!filter || (filter.op !== "eq" && filter.op !== "in")) return undefined;
  return (Array.isArray(filter.value) ? filter.value : [filter.value]).map(String);
}

function indexedValue(field: (typeof INDEXED_FIELDS)[number], value: unknown): string {
  const text = String(value);
  return field === "dimension" && text.startsWith("minecraft:") ? text.slice("minecraft:".length) : text;
}

export class QuestEventIndex {
  private readonly refs = new Map<string, QuestGoalReference[]>();
  private readonly autoAcceptQuestIds = new Set<string>();
  private definitions = new Map<string, QuestDefinitionV2>();
  private version = 0;

  rebuild(definitions: readonly QuestDefinitionV2[], version: number): void {
    this.refs.clear();
    this.autoAcceptQuestIds.clear();
    this.definitions = new Map(definitions.map((definition) => [definition.id, definition]));
    this.version = version;

    for (const definition of definitions) {
      if (definition.acceptMode === "auto") this.autoAcceptQuestIds.add(definition.id);
      for (const goal of definition.goals) {
        if (goal.semantics === "snapshot") continue;
        const eventType = goal.eventType;
        const reference = { questId: definition.id, goalId: goal.id };
        let indexed = false;
        for (const field of INDEXED_FIELDS) {
          const values = indexValues(goal.filters[field]);
          if (!values) continue;
          for (const value of values) this.add(`${eventType}:${field}:${indexedValue(field, value)}`, reference);
          indexed = true;
          break;
        }
        if (!indexed) this.add(eventType, reference);
      }
    }
  }

  getVersion(): number {
    return this.version;
  }

  getDefinition(questId: string): QuestDefinitionV2 | undefined {
    return this.definitions.get(questId);
  }

  getAutoAcceptQuestIds(): string[] {
    return [...this.autoAcceptQuestIds];
  }

  getCandidates(eventType: string, payload: Readonly<Record<string, unknown>>): QuestGoalReference[] {
    const result = new Map<string, QuestGoalReference>();
    const collect = (key: string) => {
      for (const reference of this.refs.get(key) ?? [])
        result.set(`${reference.questId}\0${reference.goalId}`, reference);
    };
    collect(eventType);
    for (const field of INDEXED_FIELDS) {
      const value = payload[field];
      if (value !== undefined) collect(`${eventType}:${field}:${indexedValue(field, value)}`);
    }
    return [...result.values()];
  }

  private add(key: string, reference: QuestGoalReference): void {
    const refs = this.refs.get(key) ?? [];
    refs.push(reference);
    this.refs.set(key, refs);
  }
}
