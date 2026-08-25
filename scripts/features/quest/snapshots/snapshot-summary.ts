import type { QuestEnchantmentSnapshot, QuestEquipmentSnapshot, QuestItemSnapshot } from "../catalog/selector-registry";

export interface InventorySnapshotSummary {
  /** Per-stack evidence used by component/enchantment selectors. */
  entries: readonly QuestItemSnapshot[];
  /** Type-id totals retained for ordinary inventory selectors and diagnostics. */
  items: ReadonlyMap<string, QuestItemSnapshot>;
  builtAt: number;
  providerVersion: number;
}

export interface EquipmentSnapshotSummary extends QuestEquipmentSnapshot {
  builtAt: number;
  providerVersion: number;
}

export interface QuestEffectSnapshot {
  typeId: string;
  amplifier: number;
  duration: number;
}

export interface EffectsSnapshotSummary {
  effects: ReadonlyMap<string, QuestEffectSnapshot>;
  builtAt: number;
  providerVersion: number;
}

export const CREEPER_STATE_EVIDENCE_IDS = {
  privateWaypoint: "evidence.creeper.waypoint.exists",
  land: "evidence.creeper.land.exists",
  guild: "evidence.creeper.guild.joined",
} as const;

export type CreeperStateEvidenceId = (typeof CREEPER_STATE_EVIDENCE_IDS)[keyof typeof CREEPER_STATE_EVIDENCE_IDS];

export interface CreeperStateSnapshotSummary {
  playerCmid: string;
  playerName: string;
  knownNames: readonly string[];
  guildId?: string;
  evidenceIds: ReadonlySet<string>;
  builtAt: number;
  providerVersion: number;
}

export interface CreeperStateSnapshotInput {
  playerCmid: string;
  playerName: string;
  knownNames: readonly string[];
  guildId?: string;
  hasPrivateWaypoint: boolean;
  hasLand: boolean;
  hasGuild: boolean;
}

export function createCreeperStateSnapshotSummary(
  input: CreeperStateSnapshotInput,
  builtAt: number,
  providerVersion: number
): CreeperStateSnapshotSummary {
  const evidenceIds = new Set<CreeperStateEvidenceId>();
  if (input.hasPrivateWaypoint) evidenceIds.add(CREEPER_STATE_EVIDENCE_IDS.privateWaypoint);
  if (input.hasLand) evidenceIds.add(CREEPER_STATE_EVIDENCE_IDS.land);
  if (input.hasGuild) evidenceIds.add(CREEPER_STATE_EVIDENCE_IDS.guild);
  return {
    playerCmid: input.playerCmid,
    playerName: input.playerName,
    knownNames: [...new Set(input.knownNames)],
    guildId: input.guildId,
    evidenceIds,
    builtAt,
    providerVersion,
  };
}

function mergeEnchantments(
  current: readonly QuestEnchantmentSnapshot[] | undefined,
  incoming: readonly QuestEnchantmentSnapshot[] | undefined
): QuestEnchantmentSnapshot[] | undefined {
  if (!current?.length && !incoming?.length) return undefined;
  const levels = new Map<string, number>();
  for (const entry of [...(current ?? []), ...(incoming ?? [])]) {
    if (!entry.typeId || !Number.isFinite(entry.level) || entry.level < 1) continue;
    levels.set(entry.typeId, Math.max(levels.get(entry.typeId) ?? 0, entry.level));
  }
  return [...levels].map(([typeId, level]) => ({ typeId, level }));
}

export function createInventorySnapshotSummary(
  items: readonly QuestItemSnapshot[],
  builtAt: number,
  providerVersion: number
): InventorySnapshotSummary {
  const totals = new Map<string, QuestItemSnapshot>();
  const entries: QuestItemSnapshot[] = [];
  for (const item of items) {
    if (!item.typeId || !Number.isFinite(item.amount) || item.amount <= 0) continue;
    entries.push({
      typeId: item.typeId,
      amount: item.amount,
      componentIds: item.componentIds,
      enchantments: mergeEnchantments(undefined, item.enchantments),
    });
    const current = totals.get(item.typeId);
    totals.set(item.typeId, {
      typeId: item.typeId,
      amount: (current?.amount ?? 0) + item.amount,
      componentIds: current?.componentIds ?? item.componentIds,
      enchantments: mergeEnchantments(current?.enchantments, item.enchantments),
    });
  }
  return { entries, items: totals, builtAt, providerVersion };
}

export function createEffectsSnapshotSummary(
  effects: readonly QuestEffectSnapshot[],
  builtAt: number,
  providerVersion: number
): EffectsSnapshotSummary {
  const current = new Map<string, QuestEffectSnapshot>();
  for (const effect of effects) {
    if (
      !effect.typeId ||
      !Number.isFinite(effect.amplifier) ||
      effect.amplifier < 0 ||
      !Number.isFinite(effect.duration) ||
      effect.duration <= 0
    ) {
      continue;
    }
    const previous = current.get(effect.typeId);
    current.set(effect.typeId, {
      typeId: effect.typeId,
      amplifier: Math.max(previous?.amplifier ?? 0, effect.amplifier),
      duration: Math.max(previous?.duration ?? 0, effect.duration),
    });
  }
  return { effects: current, builtAt, providerVersion };
}
