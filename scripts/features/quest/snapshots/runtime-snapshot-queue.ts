import { Player, system } from "@minecraft/server";
import identityService from "../../player/services/identity-service";
import { QuestSnapshotDirtyQueue, type QuestSnapshotProviderKind } from "./snapshot-dirty-queue";
import {
  buildPlayerEffectsSummary,
  buildPlayerEquipmentSummary,
  buildPlayerInventorySummary,
} from "./runtime-snapshot-providers";
import type { EffectsSnapshotSummary, EquipmentSnapshotSummary, InventorySnapshotSummary } from "./snapshot-summary";
import type { CreeperStateSnapshotSummary } from "./snapshot-summary";
import { buildPlayerCreeperStateSummary } from "../integrations/creeper-state-provider";
import { isQuestSystemEnabled } from "../services/quest-runtime-policy";

const MAX_PLAYERS_PER_FLUSH = 8;
const FLUSH_DELAY_TICKS = 2; // 延迟2 ticks后再刷新快照，避免频繁的快照更新

export interface RuntimeQuestSnapshotBatch {
  playerCmid: string;
  reasons: readonly string[];
  inventory?: InventorySnapshotSummary;
  equipment?: EquipmentSnapshotSummary;
  effects?: EffectsSnapshotSummary;
  creeperState?: CreeperStateSnapshotSummary;
}

export type RuntimeQuestSnapshotConsumer = (player: Player, batch: RuntimeQuestSnapshotBatch) => void;

class RuntimeQuestSnapshotQueue {
  private readonly dirty = new QuestSnapshotDirtyQueue();
  private readonly players = new Map<string, Player>();
  private readonly consumers = new Set<RuntimeQuestSnapshotConsumer>();
  private scheduled = false;

  subscribe(consumer: RuntimeQuestSnapshotConsumer): () => void {
    this.consumers.add(consumer);
    return () => this.consumers.delete(consumer);
  }

  mark(player: Player, provider: QuestSnapshotProviderKind, reason: string): void {
    if (!isQuestSystemEnabled()) return;
    const playerCmid = identityService.resolvePlayerKeyForPlayer(player);
    this.players.set(playerCmid, player);
    this.dirty.mark(playerCmid, provider, reason);
    this.schedule();
  }

  markAll(player: Player, reason: string): void {
    this.mark(player, "inventory", reason);
    this.mark(player, "equipment", reason);
    this.mark(player, "effects", reason);
    this.mark(player, "creeper_state", reason);
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    // 延迟刷新，让多个快照标记能够批量处理
    system.runTimeout(() => this.flush(), FLUSH_DELAY_TICKS);
  }

  private flush(): void {
    this.scheduled = false;
    for (const entry of this.dirty.takeBatch(MAX_PLAYERS_PER_FLUSH)) {
      const player = this.players.get(entry.playerCmid);
      if (!player?.isValid) {
        this.players.delete(entry.playerCmid);
        continue;
      }
      if (this.consumers.size === 0) continue;
      try {
        const batch: RuntimeQuestSnapshotBatch = {
          playerCmid: entry.playerCmid,
          reasons: entry.reasons,
          inventory: entry.providers.includes("inventory") ? buildPlayerInventorySummary(player) : undefined,
          equipment: entry.providers.includes("equipment") ? buildPlayerEquipmentSummary(player) : undefined,
          effects: entry.providers.includes("effects") ? buildPlayerEffectsSummary(player) : undefined,
          creeperState: entry.providers.includes("creeper_state") ? buildPlayerCreeperStateSummary(player) : undefined,
        };
        for (const consumer of this.consumers) {
          try {
            consumer(player, batch);
          } catch (error) {
            console.warn(`[QuestSnapshot] consumer failed for ${player.name}: ${String(error)}`);
          }
        }
      } catch (error) {
        console.warn(`[QuestSnapshot] provider failed for ${player.name}: ${String(error)}`);
      }
    }
    if (this.dirty.size > 0) this.schedule();
  }
}

export default new RuntimeQuestSnapshotQueue();
