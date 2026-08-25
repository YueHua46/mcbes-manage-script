export type QuestSnapshotProviderKind = "inventory" | "equipment" | "effects" | "creeper_state";

export interface QuestSnapshotDirtyEntry {
  playerCmid: string;
  providers: QuestSnapshotProviderKind[];
  reasons: string[];
}

interface MutableDirtyEntry {
  providers: Set<QuestSnapshotProviderKind>;
  reasons: Set<string>;
}

export class QuestSnapshotDirtyQueue {
  private readonly entries = new Map<string, MutableDirtyEntry>();

  mark(playerCmid: string, provider: QuestSnapshotProviderKind, reason: string): void {
    if (!playerCmid.trim()) throw new Error("Snapshot dirty playerCmid is required");
    const entry = this.entries.get(playerCmid) ?? { providers: new Set(), reasons: new Set() };
    entry.providers.add(provider);
    if (reason.trim()) entry.reasons.add(reason);
    this.entries.set(playerCmid, entry);
  }

  takeBatch(limit: number): QuestSnapshotDirtyEntry[] {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Snapshot dirty batch limit must be positive");
    const result: QuestSnapshotDirtyEntry[] = [];
    for (const [playerCmid, entry] of this.entries) {
      result.push({ playerCmid, providers: [...entry.providers], reasons: [...entry.reasons] });
      this.entries.delete(playerCmid);
      if (result.length >= limit) break;
    }
    return result;
  }

  get size(): number {
    return this.entries.size;
  }
}
