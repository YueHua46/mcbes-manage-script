import type {
  QuestAvailability,
  QuestAvailabilityInput,
  QuestFactValue,
  QuestRule,
  QuestRuleContext,
} from "./quest-types";

function compareFact(
  actual: QuestFactValue | undefined,
  operator: "eq" | "gte" | "lte",
  expected: QuestFactValue
): boolean {
  if (actual === undefined) return false;
  if (operator === "eq") return String(actual) === String(expected);

  const actualNumber = Number(actual);
  const expectedNumber = Number(expected);
  if (!Number.isFinite(actualNumber) || !Number.isFinite(expectedNumber)) return false;
  return operator === "gte" ? actualNumber >= expectedNumber : actualNumber <= expectedNumber;
}

export function evaluateQuestRule(rule: QuestRule, context: QuestRuleContext): boolean {
  if (rule.type === "always") return true;
  if (rule.type === "all") return rule.rules.every((child) => evaluateQuestRule(child, context));
  if (rule.type === "any") return rule.rules.some((child) => evaluateQuestRule(child, context));
  if (rule.type === "capability") return context.capabilities.has(rule.capabilityId);
  if (rule.type === "fact") return compareFact(context.facts[rule.factId], rule.operator, rule.value);

  const actual = context.questStatuses[rule.questId];
  if (rule.status === "completed") return actual === "completed" || actual === "claimed";
  return actual === "claimed";
}

export function resolveAvailability(input: QuestAvailabilityInput, context: QuestRuleContext): QuestAvailability {
  if (input.releaseState === "planned") return "unavailable";
  if (!input.requiredCapabilities.every((capability) => context.capabilities.has(capability))) return "unavailable";
  if (!input.requiredGameplayExperiments.every((experiment) => input.availableGameplayExperiments.has(experiment))) {
    return "unavailable";
  }
  if (!input.enabled || !input.packEnabled) return "suspended";
  if (!evaluateQuestRule(input.unlockRule, context)) return "locked";
  return "available";
}
