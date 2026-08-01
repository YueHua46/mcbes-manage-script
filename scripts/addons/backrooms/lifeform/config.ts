export const LIFEFORM_TYPE_ID = "yuehua:backrooms_lifeform";
export const DIRECTOR_CHECK_TICKS = 400;
export const ACTIVE_AUDIT_TICKS = 10;
export const MIN_SESSION_TICKS = 3 * 60 * 20;
export const MIN_UNIQUE_REGIONS = 4;
export const GUARANTEE_SESSION_TICKS = 8 * 60 * 20;
export const GUARANTEE_UNIQUE_REGIONS = 10;
export const GUARANTEE_TRAVEL_DISTANCE = 500;
export const MAX_GLOBAL_LIFEFORMS = 4;
export const ENCOUNTER_COOLDOWN_MS = 5 * 60 * 1000;

export interface EncounterEligibilityInput {
  sessionTicks: number;
  uniqueRegions: number;
  failedChecks: number;
  travelDistance?: number;
}

export interface EncounterEligibility {
  eligible: boolean;
  guaranteed: boolean;
  probability: number;
}

export function encounterProbability(failedChecks: number): number {
  const misses = Math.max(0, Math.floor(failedChecks));
  return Math.min(25, 8 + misses) / 100;
}

export function evaluateEncounterEligibility(input: EncounterEligibilityInput): EncounterEligibility {
  const eligible = input.sessionTicks >= MIN_SESSION_TICKS && input.uniqueRegions >= MIN_UNIQUE_REGIONS;
  // Time is the final safety net: a player who explores one large region for
  // eight minutes must not be excluded forever by the region counter.
  const guaranteed =
    input.sessionTicks >= GUARANTEE_SESSION_TICKS ||
    (input.travelDistance ?? 0) >= GUARANTEE_TRAVEL_DISTANCE ||
    (eligible && input.uniqueRegions >= GUARANTEE_UNIQUE_REGIONS);
  return {
    eligible,
    guaranteed,
    probability: encounterProbability(input.failedChecks),
  };
}

export interface EncounterStartPolicy {
  eligible: boolean;
  guaranteed: boolean;
  roll: number;
  probability?: number;
  sessionEncountered: boolean;
  manifestationActive: boolean;
  activeGlobal: number;
  nowMs: number;
  cooldownUntilMs: number;
}

export function canStartEncounter(input: EncounterStartPolicy): boolean {
  if ((!input.eligible && !input.guaranteed) || input.sessionEncountered || input.manifestationActive) return false;
  if (input.activeGlobal >= MAX_GLOBAL_LIFEFORMS) return false;
  if (input.cooldownUntilMs > input.nowMs) return false;
  return input.guaranteed || input.roll < (input.probability ?? encounterProbability(0));
}

export function voiceFirstDelayTicks(_roll = 0): { min: number; max: number } {
  return { min: 45 * 20, max: 120 * 20 };
}

export function voiceRepeatDelayTicks(): { min: number; max: number } {
  return { min: 2 * 60 * 20, max: 5 * 60 * 20 };
}

export type VoiceApproachOutcome = "disappear" | "relocate" | "lure-eligible";

export function voiceApproachOutcome(roll: number): VoiceApproachOutcome {
  if (roll < 0.7) return "disappear";
  if (roll < 0.9) return "relocate";
  return "lure-eligible";
}
