export interface QuestInteractionItem {
  typeId: string;
  amount: number;
}

export interface QuestTameOwnershipSnapshot {
  componentKind: "tameable" | "tamemount";
  isTamed: boolean;
  ownerPlayerId?: string;
  tameItemIds?: readonly string[];
}

export interface QuestTameEvidence {
  tamingItem: string;
}

export interface QuestVaultUnlockEvidence {
  vaultType: "normal" | "ominous";
  key: "minecraft:trial_key" | "minecraft:ominous_trial_key";
}

export interface QuestArchaeologyEvidence {
  suspiciousBlock: "minecraft:suspicious_sand" | "minecraft:suspicious_gravel";
  resultingBlock: "minecraft:sand" | "minecraft:gravel";
}

export function isSameInteractionItem(
  expected: QuestInteractionItem | undefined,
  actual: QuestInteractionItem | undefined
): boolean {
  return expected?.typeId === actual?.typeId && expected?.amount === actual?.amount;
}

export function wasInteractionItemConsumed(
  before: QuestInteractionItem | undefined,
  after: QuestInteractionItem | undefined,
  expectedTypeId?: string
): boolean {
  if (!before || before.amount < 1 || (expectedTypeId && before.typeId !== expectedTypeId)) return false;
  if (!after) return before.amount === 1;
  return after.typeId === before.typeId && after.amount === before.amount - 1;
}

export function resolveTameEvidence(
  playerId: string,
  beforeOwnership: QuestTameOwnershipSnapshot | undefined,
  afterOwnership: QuestTameOwnershipSnapshot | undefined,
  beforeItem: QuestInteractionItem | undefined,
  afterItem: QuestInteractionItem | undefined
): QuestTameEvidence | undefined {
  if (!beforeOwnership || !afterOwnership || beforeOwnership.componentKind !== afterOwnership.componentKind) {
    return undefined;
  }
  // A pre-interaction ownership snapshot is mandatory. This prevents a script
  // reload from treating an interaction with an already-tamed entity as a new tame.
  if (beforeOwnership.isTamed || !afterOwnership.isTamed || afterOwnership.ownerPlayerId !== playerId) {
    return undefined;
  }
  if (!wasInteractionItemConsumed(beforeItem, afterItem)) return undefined;
  if (
    beforeOwnership.componentKind === "tameable" &&
    (!beforeOwnership.tameItemIds?.length || !beforeOwnership.tameItemIds.includes(beforeItem!.typeId))
  ) {
    return undefined;
  }
  return { tamingItem: beforeItem!.typeId };
}

export function resolveVaultUnlockEvidence(
  blockTypeId: string,
  ominousState: unknown,
  beforeItem: QuestInteractionItem | undefined,
  afterItem: QuestInteractionItem | undefined
): QuestVaultUnlockEvidence | undefined {
  let vaultType: QuestVaultUnlockEvidence["vaultType"];
  if (blockTypeId === "minecraft:ominous_vault") {
    vaultType = "ominous";
  } else if (blockTypeId === "minecraft:vault" && typeof ominousState === "boolean") {
    vaultType = ominousState ? "ominous" : "normal";
  } else {
    return undefined;
  }
  const key = vaultType === "ominous" ? "minecraft:ominous_trial_key" : "minecraft:trial_key";
  return wasInteractionItemConsumed(beforeItem, afterItem, key) ? { vaultType, key } : undefined;
}

export function resolveArchaeologyEvidence(
  beforeBlockTypeId: string,
  afterBlockTypeId: string,
  itemTypeId: string | undefined
): QuestArchaeologyEvidence | undefined {
  if (itemTypeId !== "minecraft:brush") return undefined;
  if (beforeBlockTypeId === "minecraft:suspicious_sand" && afterBlockTypeId === "minecraft:sand") {
    return { suspiciousBlock: beforeBlockTypeId, resultingBlock: afterBlockTypeId };
  }
  if (beforeBlockTypeId === "minecraft:suspicious_gravel" && afterBlockTypeId === "minecraft:gravel") {
    return { suspiciousBlock: beforeBlockTypeId, resultingBlock: afterBlockTypeId };
  }
  return undefined;
}
