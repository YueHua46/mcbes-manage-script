import type { QuestDefinitionV2, QuestRule } from "../domain";
import type { QuestCapabilityRegistry } from "./capability-registry";
import type { QuestPresetRegistrySnapshot } from "./preset-registry";
import type { QuestSelectorRegistry } from "./selector-registry";

export interface QuestCatalogDiagnostic {
  severity: "error" | "warning";
  code: string;
  message: string;
  definitionId?: string;
}

const STABLE_ID = /^[a-z0-9][a-z0-9_.-]*$/;

function collectRuleReferences(rule: QuestRule, quests: Set<string>, capabilities: Set<string>): void {
  if (rule.type === "quest") quests.add(rule.questId);
  if (rule.type === "capability") capabilities.add(rule.capabilityId);
  if (rule.type === "all" || rule.type === "any") {
    rule.rules.forEach((child) => collectRuleReferences(child, quests, capabilities));
  }
}

function pushDuplicateDiagnostics(kind: string, ids: readonly string[], diagnostics: QuestCatalogDiagnostic[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      diagnostics.push({
        severity: "error",
        code: `duplicate_${kind}`,
        message: `Duplicate ${kind} id: ${id}`,
        definitionId: id,
      });
    }
    seen.add(id);
  }
}

function validateQuestLocalIds(quest: QuestDefinitionV2, diagnostics: QuestCatalogDiagnostic[]): void {
  pushDuplicateDiagnostics(
    "goal",
    quest.goals.map((goal) => goal.id),
    diagnostics
  );
  pushDuplicateDiagnostics(
    "reward",
    quest.rewards.map((reward) => reward.id),
    diagnostics
  );
  for (const goal of quest.goals) {
    if (!STABLE_ID.test(goal.id)) {
      diagnostics.push({
        severity: "error",
        code: "invalid_goal_id",
        message: `Invalid goal id: ${goal.id}`,
        definitionId: quest.id,
      });
    }
    if (goal.semantics !== "milestone" && (!Number.isFinite(goal.target) || goal.target <= 0)) {
      diagnostics.push({
        severity: "error",
        code: "invalid_goal_target",
        message: `Goal target must be positive: ${goal.id}`,
        definitionId: quest.id,
      });
    }
  }
  for (const reward of quest.rewards) {
    if (!STABLE_ID.test(reward.id)) {
      diagnostics.push({
        severity: "error",
        code: "invalid_reward_id",
        message: `Invalid reward id: ${reward.id}`,
        definitionId: quest.id,
      });
    }
  }
}

function validateQuestDependencyCycles(
  quests: readonly QuestDefinitionV2[],
  diagnostics: QuestCatalogDiagnostic[]
): void {
  const edges = new Map<string, string[]>();
  for (const quest of quests) {
    const refs = new Set<string>();
    collectRuleReferences(quest.unlockRule, refs, new Set());
    edges.set(quest.id, Array.from(refs));
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (questId: string, path: string[]): void => {
    if (visiting.has(questId)) {
      diagnostics.push({
        severity: "error",
        code: "quest_dependency_cycle",
        message: `Quest dependency cycle: ${[...path, questId].join(" -> ")}`,
        definitionId: questId,
      });
      return;
    }
    if (visited.has(questId)) return;
    visiting.add(questId);
    for (const dependency of edges.get(questId) ?? []) visit(dependency, [...path, questId]);
    visiting.delete(questId);
    visited.add(questId);
  };

  quests.forEach((quest) => visit(quest.id, []));
}

export function validatePresetRegistry(
  snapshot: QuestPresetRegistrySnapshot,
  selectors: QuestSelectorRegistry,
  capabilities: QuestCapabilityRegistry
): QuestCatalogDiagnostic[] {
  const diagnostics: QuestCatalogDiagnostic[] = [];
  pushDuplicateDiagnostics(
    "pack",
    snapshot.packs.map((pack) => pack.id),
    diagnostics
  );
  pushDuplicateDiagnostics(
    "chapter",
    snapshot.chapters.map((chapter) => chapter.id),
    diagnostics
  );
  pushDuplicateDiagnostics(
    "quest",
    snapshot.quests.map((quest) => quest.id),
    diagnostics
  );

  const packIds = new Set(snapshot.packs.map((pack) => pack.id));
  const chapterIds = new Set(snapshot.chapters.map((chapter) => chapter.id));
  const questIds = new Set(snapshot.quests.map((quest) => quest.id));

  for (const pack of snapshot.packs) {
    if (!STABLE_ID.test(pack.id)) {
      diagnostics.push({
        severity: "error",
        code: "invalid_pack_id",
        message: `Invalid pack id: ${pack.id}`,
        definitionId: pack.id,
      });
    }
    for (const chapterId of pack.chapterIds) {
      if (!chapterIds.has(chapterId)) {
        diagnostics.push({
          severity: "error",
          code: "missing_pack_chapter",
          message: `Pack ${pack.id} references missing chapter ${chapterId}`,
          definitionId: pack.id,
        });
      }
    }
  }

  for (const chapter of snapshot.chapters) {
    if (!packIds.has(chapter.packId)) {
      diagnostics.push({
        severity: "error",
        code: "missing_chapter_pack",
        message: `Chapter ${chapter.id} references missing pack ${chapter.packId}`,
        definitionId: chapter.id,
      });
    }
    for (const questId of chapter.questIds) {
      if (!questIds.has(questId)) {
        diagnostics.push({
          severity: "error",
          code: "missing_chapter_quest",
          message: `Chapter ${chapter.id} references missing quest ${questId}`,
          definitionId: chapter.id,
        });
      }
    }
    const ruleQuestRefs = new Set<string>();
    const ruleCapabilityRefs = new Set<string>();
    collectRuleReferences(chapter.unlockRule, ruleQuestRefs, ruleCapabilityRefs);
    for (const questId of ruleQuestRefs) {
      if (!questIds.has(questId)) {
        diagnostics.push({
          severity: "error",
          code: "missing_rule_quest",
          message: `Chapter ${chapter.id} rule references missing quest ${questId}`,
          definitionId: chapter.id,
        });
      }
    }
  }

  for (const quest of snapshot.quests) {
    if (quest.source !== "preset") {
      diagnostics.push({
        severity: "error",
        code: "invalid_preset_source",
        message: `${quest.id} is not preset`,
        definitionId: quest.id,
      });
    }
    if (!STABLE_ID.test(quest.id)) {
      diagnostics.push({
        severity: "error",
        code: "invalid_quest_id",
        message: `Invalid quest id: ${quest.id}`,
        definitionId: quest.id,
      });
    }
    if (!quest.packId || !packIds.has(quest.packId)) {
      diagnostics.push({
        severity: "error",
        code: "missing_quest_pack",
        message: `${quest.id} has no valid pack`,
        definitionId: quest.id,
      });
    }
    if (!quest.chapterId || !chapterIds.has(quest.chapterId)) {
      diagnostics.push({
        severity: "error",
        code: "missing_quest_chapter",
        message: `${quest.id} has no valid chapter`,
        definitionId: quest.id,
      });
    } else {
      const chapter = snapshot.chapters.find((candidate) => candidate.id === quest.chapterId);
      if (chapter && (chapter.packId !== quest.packId || !chapter.questIds.includes(quest.id))) {
        diagnostics.push({
          severity: "error",
          code: "quest_chapter_mismatch",
          message: `${quest.id} is inconsistent with chapter ${quest.chapterId}`,
          definitionId: quest.id,
        });
      }
    }

    validateQuestLocalIds(quest, diagnostics);
    const selectorIds = quest.goals
      .map((goal) => ("selectorId" in goal ? goal.selectorId : undefined))
      .filter((selectorId): selectorId is string => !!selectorId);
    for (const selectorId of selectorIds) {
      if (!selectors.has(selectorId)) {
        diagnostics.push({
          severity: "error",
          code: "missing_selector",
          message: `${quest.id} references missing selector ${selectorId}`,
          definitionId: quest.id,
        });
      }
    }

    const ruleQuestRefs = new Set<string>();
    const ruleCapabilityRefs = new Set<string>();
    collectRuleReferences(quest.unlockRule, ruleQuestRefs, ruleCapabilityRefs);
    for (const questId of ruleQuestRefs) {
      if (!questIds.has(questId)) {
        diagnostics.push({
          severity: "error",
          code: "missing_rule_quest",
          message: `${quest.id} rule references missing quest ${questId}`,
          definitionId: quest.id,
        });
      }
    }
    for (const capabilityId of [...quest.requiredCapabilities, ...ruleCapabilityRefs]) {
      if (!capabilities.has(capabilityId)) {
        diagnostics.push({
          severity: "error",
          code: "missing_capability",
          message: `${quest.id} references missing capability ${capabilityId}`,
          definitionId: quest.id,
        });
      }
    }
  }

  validateQuestDependencyCycles(snapshot.quests, diagnostics);
  return diagnostics;
}
