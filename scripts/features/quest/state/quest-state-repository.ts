import { Player, system, world } from "@minecraft/server";
import { Database } from "../../../shared/database/database";
import identityService from "../../player/services/identity-service";
import questDefinitionService from "../services/quest-definition";
import { normalizeLegacyCustomQuest } from "../catalog/custom-quest-normalizer";
import type { QuestDefinitionV2, QuestPlayerAggregate } from "../domain";
import { GenerationStore } from "./generation-store";
import {
  migrateLegacyNameStates,
  type LegacyQuestPlayerState,
  type LegacyNameMigrationResult,
} from "./quest-state-migration";
import { WorldStringPropertyStore } from "./world-string-property-store";

const LEGACY_DB = "quest_player_states";
const STORE_PREFIX = "cmquest:v2";
/** Offline aggregates (admin lookups, players who left without a leave event) are swept at this cadence. */
const OFFLINE_CACHE_SWEEP_TICKS = 6000;

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

class QuestStateRepository {
  private legacyDb?: Database<LegacyQuestPlayerState>;
  private readonly properties = new WorldStringPropertyStore();
  private readonly stores = new Map<string, GenerationStore<QuestPlayerAggregate>>();
  private readonly aggregateCache = new Map<string, QuestPlayerAggregate>();
  /** Runtime player id -> quest identity, so leave events can release that player's cache. */
  private readonly cmidByRuntimeId = new Map<string, string>();

  constructor() {
    system.run(() => {
      this.legacyDb = new Database<LegacyQuestPlayerState>(LEGACY_DB);
      // Every write is committed to world properties synchronously, so dropping the in-memory
      // copy never loses progress; the next load simply reads the committed generation again.
      world.afterEvents?.playerLeave?.subscribe((event: { playerId: string }) =>
        this.releaseRuntimePlayer(event.playerId)
      );
      system.runInterval?.(() => this.sweepOfflineCache(), OFFLINE_CACHE_SWEEP_TICKS);
    });
  }

  /** Drops cached quest state for an identity. Safe at any time: all state is already persisted. */
  release(playerCmid: string): void {
    this.aggregateCache.delete(playerCmid);
    this.stores.delete(playerCmid);
  }

  private releaseRuntimePlayer(runtimePlayerId: string): void {
    const playerCmid = this.cmidByRuntimeId.get(runtimePlayerId);
    this.cmidByRuntimeId.delete(runtimePlayerId);
    if (playerCmid === undefined) return;
    // Another live session can share the identity (e.g. rejoin before the leave event lands).
    for (const cmid of this.cmidByRuntimeId.values()) if (cmid === playerCmid) return;
    this.release(playerCmid);
  }

  private sweepOfflineCache(): void {
    const online = new Set<string>();
    const onlineRuntimeIds = new Set<string>();
    for (const player of world.getAllPlayers()) {
      onlineRuntimeIds.add(player.id);
      const cmid = this.cmidByRuntimeId.get(player.id);
      if (cmid !== undefined) online.add(cmid);
    }
    for (const runtimeId of [...this.cmidByRuntimeId.keys()]) {
      if (!onlineRuntimeIds.has(runtimeId)) this.cmidByRuntimeId.delete(runtimeId);
    }
    for (const cmid of [...this.aggregateCache.keys()]) if (!online.has(cmid)) this.release(cmid);
    for (const cmid of [...this.stores.keys()]) if (!online.has(cmid)) this.stores.delete(cmid);
  }

  isReady(): boolean {
    return this.legacyDb !== undefined;
  }

  loadForPlayer(player: Player): QuestPlayerAggregate {
    const profile = identityService.getProfileForPlayer(player);
    this.cmidByRuntimeId.set(player.id, profile.id);
    return this.loadForIdentity(profile.id, profile.currentName, profile.knownNames, player.name);
  }

  loadForName(name: string): QuestPlayerAggregate | undefined {
    const profile = identityService.getProfileByName(name);
    if (!profile) return undefined;
    return this.loadForIdentity(profile.id, profile.currentName, profile.knownNames, name);
  }

  private loadForIdentity(
    playerCmid: string,
    displayName: string,
    knownProfileNames: readonly string[],
    logName: string
  ): QuestPlayerAggregate {
    if (!this.legacyDb) throw new Error("Quest state repository is not ready");
    const store = this.getStore(playerCmid);
    const cached = this.aggregateCache.get(playerCmid);
    if (cached?.displayName === displayName && cached.migration?.legacyNameMigrationVersion === 1) {
      const migratedNames = new Set((cached.migration.migratedNames ?? []).map(normalizeName));
      if ([...knownProfileNames, displayName].every((name) => migratedNames.has(normalizeName(name)))) return cached;
    }
    const loaded = cached ? undefined : store.load();
    if (loaded?.status === "corrupt") throw new Error(`任务聚合数据损坏，已停止自动覆盖：${loaded.error}`);

    const existing = cached ?? (loaded && loaded.status !== "empty" ? loaded.value : undefined);
    const knownNames = Array.from(new Set([...knownProfileNames, displayName]));
    const legacyStates = Object.fromEntries(
      knownNames.map((name) => {
        const key = normalizeName(name);
        return [key, this.legacyDb?.get(key)];
      })
    );
    const migration = migrateLegacyNameStates({
      playerCmid,
      displayName,
      knownNames,
      existing,
      legacyStates,
      resolveDefinition: (questId) => this.resolveDefinition(questId),
      migratedAt: Date.now(),
    });

    if (migration.changed || loaded?.status === "empty" || loaded?.status === "recovered") {
      store.save(migration.aggregate);
      this.deleteMigratedLegacyKeys(migration);
      if (loaded?.status === "recovered") {
        console.warn(`[QuestStateRepository] ${logName} 的任务数据已从上一代恢复并重新提交`);
      }
    }
    this.aggregateCache.set(playerCmid, migration.aggregate);
    return migration.aggregate;
  }

  saveForPlayer(player: Player, aggregate: QuestPlayerAggregate): void {
    const playerCmid = identityService.resolvePlayerKeyForPlayer(player);
    if (aggregate.playerCmid !== playerCmid) throw new Error("Quest aggregate player identity mismatch");
    aggregate.displayName = player.name;
    this.cmidByRuntimeId.set(player.id, playerCmid);
    this.getStore(playerCmid).save(aggregate);
    this.aggregateCache.set(playerCmid, aggregate);
  }

  private getStore(playerCmid: string): GenerationStore<QuestPlayerAggregate> {
    let store = this.stores.get(playerCmid);
    if (!store) {
      store = new GenerationStore(this.properties, `${STORE_PREFIX}:${playerCmid}`);
      this.stores.set(playerCmid, store);
    }
    return store;
  }

  private resolveDefinition(questId: string): QuestDefinitionV2 | undefined {
    const definition = questDefinitionService.get(questId);
    return definition ? normalizeLegacyCustomQuest(definition) : undefined;
  }

  private deleteMigratedLegacyKeys(migration: LegacyNameMigrationResult): void {
    if (!this.legacyDb || migration.migratedKeys.length === 0) return;
    migration.migratedKeys.forEach((key) => this.legacyDb?.delete(key));
    this.legacyDb.save(true);
  }
}

export default new QuestStateRepository();
