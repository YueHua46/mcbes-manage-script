import type {
  LegacyLifecycleState,
  QuestAvailability,
  QuestLifecycle,
  QuestTrackingInput,
  QuestUnlockEventPolicy,
} from "./quest-types";

export function resolveLifecycleState(state: LegacyLifecycleState | undefined): QuestLifecycle {
  if (state?.acceptedAt === undefined) return "not_started";
  if (state.recoveryRequired) return "recovery_required";
  if (state.claimedAt !== undefined) return "claimed";
  if (state.claiming) return "claiming";
  if (state.completedAt !== undefined) return "completed";
  return "accepted";
}

export function canApplyQuestProgress(availability: QuestAvailability, lifecycle: QuestLifecycle): boolean {
  return availability === "available" && lifecycle === "accepted";
}

export function isCompletionAbsorbing(lifecycle: QuestLifecycle): boolean {
  return (
    lifecycle === "completed" ||
    lifecycle === "claiming" ||
    lifecycle === "claimed" ||
    lifecycle === "recovery_required"
  );
}

export function shouldTrackQuest(input: QuestTrackingInput): boolean {
  if (input.hidden && !input.trackWhileHidden) return false;
  return canApplyQuestProgress(input.availability, input.lifecycle);
}

export function shouldPropagateUnlockingEvent(
  wasEligibleAtEventStart: boolean,
  policy: QuestUnlockEventPolicy
): boolean {
  return wasEligibleAtEventStart || policy === "include_once";
}

export function createQuestInstanceId(questId: string, periodKey: string, attempt: number): string {
  const normalizedQuestId = questId.trim();
  const normalizedPeriodKey = periodKey.trim();
  if (!normalizedQuestId || !normalizedPeriodKey) throw new Error("Quest instance identifiers must not be empty");
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error("Quest instance attempt must be a positive integer");
  return `${normalizedQuestId}@${normalizedPeriodKey}#${attempt}`;
}
