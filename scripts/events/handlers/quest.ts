import { Player, PlayerInventoryType, system, world } from "@minecraft/server";
import { eventRegistry } from "../registry";
import questPlayerService from "../../features/quest/services/quest-player";
import { taskScheduler } from "../../features/platform/scheduler";
import { ONLINE_TIME_TICK_INTERVAL } from "../../features/player/services/online-time";
import questSnapshotRuntime from "../../features/quest/snapshots/runtime-snapshot-queue";
import questNotificationService, {
  QUEST_AUTO_ACCEPT_FOLLOW_UP_DELAY_TICKS,
} from "../../features/quest/notifications/quest-notification-service";
import { getOnlineRealPlayers, isRealPlayerEntity } from "../../shared/utils/online-players";
import {
  isSameInteractionItem,
  resolveArchaeologyEvidence,
  resolveTameEvidence,
  resolveVaultUnlockEvidence,
  type QuestInteractionItem,
  type QuestTameOwnershipSnapshot,
} from "../../features/quest/integrations/interaction-evidence";
import { resolveQuestGlideDistance } from "../../features/quest/integrations/glide-distance";

export { resolveQuestGlideDistance };

const pendingItemDeltas = new Map<string, { player: Player; items: Map<string, number> }>();
let itemFlushScheduled = false;
const QUEST_MOVEMENT_SAMPLE_INTERVAL_TICKS = 10;
const QUEST_BIOME_SAMPLE_INTERVAL_TICKS = 40;

// 批量处理破坏方块事件，减少挖矿时的性能开销
const pendingBlockBreaks = new Map<
  string,
  {
    player: Player;
    blocks: Array<{
      blockTypeId: string;
      dimension: string;
      harvest?: { crop: string; block: string; amount: number };
    }>;
  }
>();
let blockBreakFlushScheduled = false;
const BLOCK_BREAK_BATCH_DELAY_TICKS = 2; // 累积2 ticks的破坏方块事件后再处理

type QuestCropStateKey = "growth" | "age";

export interface QuestCropRule {
  crop: string;
  stateKey: QuestCropStateKey;
  matureValue: number;
}

/** Blocks that can only be produced by planting a supported crop/seedling item. */
const QUEST_PLANTED_CROPS: Readonly<Record<string, string>> = {
  "minecraft:wheat": "wheat",
  "minecraft:carrots": "carrots",
  "minecraft:potatoes": "potatoes",
  "minecraft:beetroot": "beetroot",
  "minecraft:nether_wart": "nether_wart",
  "minecraft:sweet_berry_bush": "sweet_berry",
  "minecraft:melon_stem": "melon_stem",
  "minecraft:pumpkin_stem": "pumpkin_stem",
  "minecraft:torchflower_crop": "torchflower",
  "minecraft:pitcher_crop": "pitcher",
  "minecraft:reeds": "sugar_cane",
  "minecraft:kelp": "kelp",
  "minecraft:bamboo": "bamboo",
  "minecraft:cave_vines": "cave_berries",
};

/**
 * Only crops with an authoritative age/growth state are accepted as harvests.
 * State-less plants and fruit blocks are intentionally excluded: breaking one
 * must never masquerade as harvesting a mature crop.
 */
const QUEST_MATURE_CROPS: Readonly<Record<string, QuestCropRule>> = {
  "minecraft:wheat": { crop: "wheat", stateKey: "growth", matureValue: 7 },
  "minecraft:carrots": { crop: "carrots", stateKey: "growth", matureValue: 7 },
  "minecraft:potatoes": { crop: "potatoes", stateKey: "growth", matureValue: 7 },
  "minecraft:beetroot": { crop: "beetroot", stateKey: "growth", matureValue: 3 },
  "minecraft:nether_wart": { crop: "nether_wart", stateKey: "age", matureValue: 3 },
  "minecraft:sweet_berry_bush": { crop: "sweet_berry", stateKey: "growth", matureValue: 3 },
  "minecraft:torchflower_crop": { crop: "torchflower", stateKey: "growth", matureValue: 1 },
  "minecraft:pitcher_crop": { crop: "pitcher", stateKey: "growth", matureValue: 4 },
};

export function resolvePlantedCrop(blockTypeId: string): string | undefined {
  return QUEST_PLANTED_CROPS[blockTypeId];
}

export function resolveMatureCropHarvest(
  blockTypeId: string,
  states: Readonly<Record<string, boolean | number | string>>
): { crop: string; amount: number } | undefined {
  const rule = QUEST_MATURE_CROPS[blockTypeId];
  if (!rule) return undefined;
  const state = states[rule.stateKey];
  if (typeof state !== "number" || !Number.isFinite(state) || state < rule.matureValue) return undefined;
  return { crop: rule.crop, amount: 1 };
}

export function resolveBiomeTransition(
  previousBiomeId: string | undefined,
  currentBiomeId: string | undefined
): boolean {
  return !!currentBiomeId && currentBiomeId !== previousBiomeId;
}

export function resolveBiomeCategory(biomeId: string): string | undefined {
  const path = biomeId.replace(/^minecraft:/, "");
  return path === "ocean" || path.endsWith("_ocean") ? "ocean" : undefined;
}

export interface QuestMovementSample {
  gliding: boolean;
  ridingEntityId?: string;
  ridingEntityTypeId?: string;
  dimensionId?: string;
  location?: { x: number; y: number; z: number };
}

export interface QuestMovementTransitions {
  startedGliding: boolean;
  rideChanged: boolean;
}

/** Pure edge detector used by the low-frequency glide/ride sampler. */
export function resolveQuestMovementTransitions(
  previous: QuestMovementSample | undefined,
  current: QuestMovementSample
): QuestMovementTransitions {
  return {
    startedGliding: current.gliding && !previous?.gliding,
    rideChanged: !!current.ridingEntityId && current.ridingEntityId !== previous?.ridingEntityId,
  };
}

const movementSamples = new Map<string, QuestMovementSample>();
const biomeSamples = new Map<string, string>();

interface PendingEntityInteraction {
  capturedAtTick: number;
  beforeItem?: QuestInteractionItem;
  ownership?: QuestTameOwnershipSnapshot;
}

interface PendingBlockInteraction {
  capturedAtTick: number;
  blockTypeId: string;
  itemTypeId?: string;
}

const pendingEntityInteractions = new Map<string, PendingEntityInteraction>();
const pendingBlockInteractions = new Map<string, PendingBlockInteraction>();
const archaeologyCompletionTicks = new Map<string, number>();

function interactionItem(item: { typeId: string; amount: number } | undefined): QuestInteractionItem | undefined {
  return item ? { typeId: item.typeId, amount: item.amount } : undefined;
}

function entityInteractionKey(playerId: string, entityId: string): string {
  return `${playerId}:${entityId}`;
}

function blockInteractionKey(
  playerId: string,
  dimensionId: string,
  location: { x: number; y: number; z: number }
): string {
  return `${playerId}:${dimensionId}:${location.x},${location.y},${location.z}`;
}

function pruneInteractionEvidence(nowTick: number): void {
  for (const [key, entry] of pendingEntityInteractions) {
    if (nowTick - entry.capturedAtTick > 4) pendingEntityInteractions.delete(key);
  }
  for (const [key, entry] of pendingBlockInteractions) {
    if (nowTick - entry.capturedAtTick > 4) pendingBlockInteractions.delete(key);
  }
  for (const [key, completedAtTick] of archaeologyCompletionTicks) {
    if (nowTick - completedAtTick > 20) archaeologyCompletionTicks.delete(key);
  }
}

function readTameOwnership(target: {
  getComponent(componentId: "minecraft:tameable"):
    | {
        isTamed: boolean;
        tamedToPlayerId?: string;
        tamedToPlayer?: { id: string };
        getTameItems: readonly { typeId: string }[];
      }
    | undefined;
  getComponent(componentId: "minecraft:tamemount"):
    | {
        isTamed: boolean;
        tamedToPlayerId?: string;
        tamedToPlayer?: { id: string };
      }
    | undefined;
}): QuestTameOwnershipSnapshot | undefined {
  try {
    const tameable = target.getComponent("minecraft:tameable");
    if (tameable) {
      return {
        componentKind: "tameable",
        isTamed: tameable.isTamed,
        ownerPlayerId: tameable.tamedToPlayerId ?? tameable.tamedToPlayer?.id,
        tameItemIds: tameable.getTameItems.map((item) => item.typeId),
      };
    }
    const tameMount = target.getComponent("minecraft:tamemount");
    if (tameMount) {
      return {
        componentKind: "tamemount",
        isTamed: tameMount.isTamed,
        ownerPlayerId: tameMount.tamedToPlayerId ?? tameMount.tamedToPlayer?.id,
      };
    }
  } catch {
    // Invalidated/custom entities provide no ownership evidence.
  }
  return undefined;
}

function normalizedDimensionId(id: string): string {
  return id.replace(/^minecraft:/, "");
}

function itemStackChanged(
  before: { typeId: string; amount: number } | undefined,
  after: { typeId: string; amount: number } | undefined
): boolean {
  return before?.typeId !== after?.typeId || before?.amount !== after?.amount;
}

function notifyQuestChanges(player: Player, changes: ReturnType<typeof questPlayerService.recordEvent>): void {
  questNotificationService.notifyProgressChanges(player, changes);
  const autoAccepted = questPlayerService.consumeAutoAccepted(player);
  const followUpDelay = changes.some((change) => change.completedQuest) ? QUEST_AUTO_ACCEPT_FOLLOW_UP_DELAY_TICKS : 0;
  questNotificationService.notifyAutoAccepted(player, autoAccepted, followUpDelay);
}

function addPendingItemDelta(player: Player, itemId: string, amount: number): void {
  if (amount === 0) return;
  const key = player.id;
  const entry = pendingItemDeltas.get(key) ?? { player, items: new Map<string, number>() };
  entry.items.set(itemId, (entry.items.get(itemId) ?? 0) + amount);
  pendingItemDeltas.set(key, entry);

  if (itemFlushScheduled) return;
  itemFlushScheduled = true;
  system.run(() => {
    itemFlushScheduled = false;
    flushPendingItemDeltas();
  });
}

function flushPendingItemDeltas(): void {
  const entries = Array.from(pendingItemDeltas.values());
  pendingItemDeltas.clear();

  entries.forEach(({ player, items }) => {
    items.forEach((amount, itemId) => {
      if (amount <= 0) return;
      notifyQuestChanges(
        player,
        questPlayerService.recordEvent(
          player,
          "item.obtain",
          {
            item: itemId,
            amount,
          },
          { source: "world.afterEvents.playerInventoryItemChange" }
        )
      );
    });
  });
}

function addPendingBlockBreak(
  player: Player,
  blockTypeId: string,
  dimension: string,
  harvest?: { crop: string; block: string; amount: number }
): void {
  const key = player.id;
  const entry = pendingBlockBreaks.get(key) ?? { player, blocks: [] };
  entry.blocks.push({ blockTypeId, dimension, harvest });
  pendingBlockBreaks.set(key, entry);

  if (blockBreakFlushScheduled) return;
  blockBreakFlushScheduled = true;
  system.runTimeout(() => {
    blockBreakFlushScheduled = false;
    flushPendingBlockBreaks();
  }, BLOCK_BREAK_BATCH_DELAY_TICKS);
}

function flushPendingBlockBreaks(): void {
  const entries = Array.from(pendingBlockBreaks.values());
  pendingBlockBreaks.clear();

  entries.forEach(({ player, blocks }) => {
    if (!player.isValid) return;

    // 按维度分组处理方块破坏事件
    const dimensionGroups = new Map<string, typeof blocks>();
    blocks.forEach((block) => {
      const group = dimensionGroups.get(block.dimension) ?? [];
      group.push(block);
      dimensionGroups.set(block.dimension, group);
    });

    // 为每个维度单独处理
    dimensionGroups.forEach((dimensionBlocks, dimension) => {
      const blockCounts = new Map<string, number>();
      const harvestCounts = new Map<string, { crop: string; block: string; amount: number }>();

      dimensionBlocks.forEach(({ blockTypeId, harvest }) => {
        blockCounts.set(blockTypeId, (blockCounts.get(blockTypeId) ?? 0) + 1);
        if (harvest) {
          const key = `${harvest.crop}:${harvest.block}`;
          const existing = harvestCounts.get(key) ?? { ...harvest, amount: 0 };
          existing.amount += harvest.amount;
          harvestCounts.set(key, existing);
        }
      });

      // 为每种方块类型记录一次事件
      blockCounts.forEach((count, blockTypeId) => {
        notifyQuestChanges(
          player,
          questPlayerService.recordEvent(
            player,
            "block.break",
            {
              block: blockTypeId,
              dimension,
            },
            { source: "world.afterEvents.playerBreakBlock.batched" }
          )
        );
      });

      // 批量处理作物收获
      harvestCounts.forEach((harvest) => {
        notifyQuestChanges(
          player,
          questPlayerService.recordEvent(
            player,
            "crop.harvest",
            {
              crop: harvest.crop,
              block: harvest.block,
              amount: harvest.amount,
              dimension,
            },
            { source: "world.afterEvents.playerBreakBlock.batched" }
          )
        );
      });
    });
  });
}

export function registerQuestEvents(): void {
  questSnapshotRuntime.subscribe((player, batch) => {
    notifyQuestChanges(player, questPlayerService.reconcileSnapshots(player, batch));
  });

  // Before-events only capture evidence. Quest progress is emitted exclusively
  // after the corresponding successful interaction has completed.
  world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
    if (!isRealPlayerEntity(event.player)) return;
    const ownership = readTameOwnership(event.target);
    if (!ownership) return;
    pruneInteractionEvidence(system.currentTick);
    pendingEntityInteractions.set(entityInteractionKey(event.player.id, event.target.id), {
      capturedAtTick: system.currentTick,
      beforeItem: interactionItem(event.itemStack),
      ownership,
    });
  });

  world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    if (!isRealPlayerEntity(event.player)) return;
    if (
      event.itemStack?.typeId !== "minecraft:brush" ||
      !["minecraft:suspicious_sand", "minecraft:suspicious_gravel"].includes(event.block.typeId)
    ) {
      return;
    }
    pruneInteractionEvidence(system.currentTick);
    pendingBlockInteractions.set(blockInteractionKey(event.player.id, event.block.dimension.id, event.block.location), {
      capturedAtTick: system.currentTick,
      blockTypeId: event.block.typeId,
      itemTypeId: event.itemStack.typeId,
    });
  });

  world.afterEvents.entityDie.subscribe((event) => {
    const killer = event.damageSource.damagingEntity;
    if (!killer || !isRealPlayerEntity(killer)) return;
    const player = killer as Player;
    const deadEntity = event.deadEntity;
    if (deadEntity.typeId === "minecraft:player") return;

    notifyQuestChanges(
      player,
      questPlayerService.recordEvent(
        player,
        "entity.kill",
        {
          entity: deadEntity.typeId,
          dimension: normalizedDimensionId(deadEntity.dimension.id),
        },
        {
          source: "world.afterEvents.entityDie",
          dedupeKey: `quest:entity.kill:${deadEntity.id}`,
        }
      )
    );
  });

  world.afterEvents.playerBreakBlock.subscribe((event) => {
    if (!isRealPlayerEntity(event.player)) return;
    const blockTypeId = event.brokenBlockPermutation.type.id;
    const dimension = normalizedDimensionId(event.dimension.id);

    let harvest: { crop: string; block: string; amount: number } | undefined;
    try {
      const harvestResult = resolveMatureCropHarvest(blockTypeId, event.brokenBlockPermutation.getAllStates());
      if (harvestResult) {
        harvest = { ...harvestResult, block: blockTypeId };
      }
    } catch {
      // Unknown or version-specific block states are conservatively ignored.
    }

    // 将破坏方块事件加入批处理队列，而不是立即处理
    addPendingBlockBreak(event.player, blockTypeId, dimension, harvest);
  });

  world.afterEvents.playerInventoryItemChange.subscribe((event) => {
    if (!isRealPlayerEntity(event.player)) return;
    if (event.inventoryType !== PlayerInventoryType.Hotbar && event.inventoryType !== PlayerInventoryType.Inventory)
      return;
    questSnapshotRuntime.mark(event.player, "inventory", "inventory_change");
    if (event.beforeItemStack) {
      addPendingItemDelta(event.player, event.beforeItemStack.typeId, -event.beforeItemStack.amount);
    }
    if (event.itemStack) {
      addPendingItemDelta(event.player, event.itemStack.typeId, event.itemStack.amount);
    }
  });

  world.afterEvents.playerPlaceBlock.subscribe((event) => {
    if (!isRealPlayerEntity(event.player)) return;
    questSnapshotRuntime.mark(event.player, "inventory", "block_place");
    const blockTypeId = event.block.typeId;
    notifyQuestChanges(
      event.player,
      questPlayerService.recordEvent(
        event.player,
        "block.place",
        {
          block: blockTypeId,
          dimension: normalizedDimensionId(event.dimension.id),
        },
        { source: "world.afterEvents.playerPlaceBlock" }
      )
    );
    const crop = resolvePlantedCrop(blockTypeId);
    if (crop) {
      notifyQuestChanges(
        event.player,
        questPlayerService.recordEvent(
          event.player,
          "crop.plant",
          {
            crop,
            block: blockTypeId,
            amount: 1,
            dimension: normalizedDimensionId(event.dimension.id),
          },
          { source: "world.afterEvents.playerPlaceBlock" }
        )
      );
    }
  });

  world.afterEvents.itemUse.subscribe((event) => {
    if (!isRealPlayerEntity(event.source)) return;
    // Item use can consume inventory or equip armor/elytra directly, so reconcile both summaries once.
    questSnapshotRuntime.markAll(event.source, "item_use");
    notifyQuestChanges(
      event.source,
      questPlayerService.recordEvent(
        event.source,
        "item.use",
        {
          item: event.itemStack.typeId,
          amount: event.itemStack.amount,
          dimension: normalizedDimensionId(event.source.dimension.id),
        },
        { source: "world.afterEvents.itemUse" }
      )
    );
  });

  world.afterEvents.playerInteractWithBlock.subscribe((event) => {
    if (!isRealPlayerEntity(event.player)) return;
    const interactionKey = blockInteractionKey(event.player.id, event.block.dimension.id, event.block.location);
    const pendingArchaeology = pendingBlockInteractions.get(interactionKey);
    pendingBlockInteractions.delete(interactionKey);
    if (
      pendingArchaeology &&
      system.currentTick - pendingArchaeology.capturedAtTick <= 4 &&
      event.beforeItemStack?.typeId === pendingArchaeology.itemTypeId
    ) {
      const player = event.player;
      const dimension = event.block.dimension;
      const location = { ...event.block.location };
      const completionKey = `${dimension.id}:${location.x},${location.y},${location.z}`;
      system.run(() => {
        try {
          const currentBlockTypeId = dimension.getBlock(location)?.typeId;
          if (!currentBlockTypeId) return;
          const evidence = resolveArchaeologyEvidence(
            pendingArchaeology.blockTypeId,
            currentBlockTypeId,
            pendingArchaeology.itemTypeId
          );
          if (!evidence || archaeologyCompletionTicks.has(completionKey) || !isRealPlayerEntity(player)) return;
          archaeologyCompletionTicks.set(completionKey, system.currentTick);
          notifyQuestChanges(
            player,
            questPlayerService.recordEvent(
              player,
              "archaeology.brush_success",
              {
                block: evidence.suspiciousBlock,
                resultingBlock: evidence.resultingBlock,
                item: pendingArchaeology.itemTypeId,
                dimension: normalizedDimensionId(dimension.id),
              },
              { source: "world.afterEvents.playerInteractWithBlock" }
            )
          );
        } catch {
          // Unloaded/invalid blocks provide no archaeology success evidence.
        }
      });
    }

    if (!event.isFirstEvent) return;
    if (itemStackChanged(event.beforeItemStack, event.itemStack)) {
      questSnapshotRuntime.mark(event.player, "inventory", "interact_block_item_change");
    }
    notifyQuestChanges(
      event.player,
      questPlayerService.recordEvent(
        event.player,
        "player.interact_block",
        {
          block: event.block.typeId,
          item: event.beforeItemStack?.typeId ?? event.itemStack?.typeId,
          dimension: normalizedDimensionId(event.player.dimension.id),
        },
        { source: "world.afterEvents.playerInteractWithBlock" }
      )
    );

    let ominousState: unknown;
    try {
      ominousState = event.block.permutation.getState("ominous");
    } catch {
      // Custom or version-specific vaults must not be inferred.
    }
    const vault = resolveVaultUnlockEvidence(
      event.block.typeId,
      ominousState,
      interactionItem(event.beforeItemStack),
      interactionItem(event.itemStack)
    );
    if (vault) {
      notifyQuestChanges(
        event.player,
        questPlayerService.recordEvent(
          event.player,
          "vault.unlock",
          {
            vaultType: vault.vaultType,
            block: event.block.typeId,
            key: vault.key,
            dimension: normalizedDimensionId(event.block.dimension.id),
          },
          { source: "world.afterEvents.playerInteractWithBlock" }
        )
      );
    }
  });

  world.afterEvents.playerInteractWithEntity.subscribe((event) => {
    if (!isRealPlayerEntity(event.player)) return;
    const interactionKey = entityInteractionKey(event.player.id, event.target.id);
    const pendingTame = pendingEntityInteractions.get(interactionKey);
    pendingEntityInteractions.delete(interactionKey);
    if (itemStackChanged(event.beforeItemStack, event.itemStack)) {
      questSnapshotRuntime.mark(event.player, "inventory", "interact_entity_item_change");
    }
    notifyQuestChanges(
      event.player,
      questPlayerService.recordEvent(
        event.player,
        "player.interact_entity",
        {
          entity: event.target.typeId,
          item: event.beforeItemStack?.typeId ?? event.itemStack?.typeId,
          dimension: normalizedDimensionId(event.player.dimension.id),
        },
        { source: "world.afterEvents.playerInteractWithEntity" }
      )
    );

    if (
      !pendingTame ||
      system.currentTick - pendingTame.capturedAtTick > 4 ||
      !isSameInteractionItem(pendingTame.beforeItem, interactionItem(event.beforeItemStack))
    ) {
      return;
    }
    const tame = resolveTameEvidence(
      event.player.id,
      pendingTame.ownership,
      readTameOwnership(event.target),
      pendingTame.beforeItem,
      interactionItem(event.itemStack)
    );
    if (!tame) return;
    notifyQuestChanges(
      event.player,
      questPlayerService.recordEvent(
        event.player,
        "entity.tame",
        {
          entity: event.target.typeId,
          item: tame.tamingItem,
          ownerPlayerId: event.player.id,
          dimension: normalizedDimensionId(event.player.dimension.id),
        },
        { source: "world.afterEvents.playerInteractWithEntity" }
      )
    );
  });

  world.afterEvents.effectAdd.subscribe((event) => {
    if (!isRealPlayerEntity(event.entity)) return;
    const player = event.entity as Player;
    notifyQuestChanges(
      player,
      questPlayerService.recordEvent(
        player,
        "effect.gain",
        {
          effect: event.effect.typeId,
          amplifier: event.effect.amplifier,
          duration: event.effect.duration,
          dimension: normalizedDimensionId(player.dimension.id),
        },
        { source: "world.afterEvents.effectAdd" }
      )
    );
  });

  world.afterEvents.playerSpawn.subscribe((event) => {
    if (!event.initialSpawn || !isRealPlayerEntity(event.player)) return;
    questSnapshotRuntime.markAll(event.player, "player_join");
  });

  world.afterEvents.playerDimensionChange.subscribe((event) => {
    if (!isRealPlayerEntity(event.player)) return;
    const dimension = normalizedDimensionId(event.toDimension.id);
    notifyQuestChanges(
      event.player,
      questPlayerService.recordEvent(
        event.player,
        "player.dimension_enter",
        { dimension },
        { source: "world.afterEvents.playerDimensionChange" }
      )
    );
  });

  taskScheduler.register({
    id: "quest.onlineTime",
    label: "任务系统在线时长进度",
    category: "player",
    intervalTicks: ONLINE_TIME_TICK_INTERVAL,
    run: () => {
      for (const player of getOnlineRealPlayers()) {
        notifyQuestChanges(
          player,
          questPlayerService.recordEvent(
            player,
            "player.online_time",
            {
              seconds: ONLINE_TIME_TICK_INTERVAL / 20,
              dimension: normalizedDimensionId(player.dimension.id),
            },
            { source: "taskScheduler.quest.onlineTime" }
          )
        );
      }
    },
  });

  taskScheduler.register({
    id: "quest.equipmentSnapshotFallback",
    label: "任务系统装备快照低频校验",
    category: "player",
    intervalTicks: 200,
    run: () => {
      for (const player of getOnlineRealPlayers()) {
        questSnapshotRuntime.mark(player, "equipment", "low_frequency_fallback");
      }
    },
  });

  taskScheduler.register({
    id: "quest.biomeTransitions",
    label: "任务系统生物群系进入检测",
    category: "player",
    intervalTicks: QUEST_BIOME_SAMPLE_INTERVAL_TICKS,
    run: () => {
      const onlineIds = new Set<string>();
      for (const player of getOnlineRealPlayers()) {
        onlineIds.add(player.id);
        try {
          const biomeId = player.dimension.getBiome(player.location).id;
          if (!resolveBiomeTransition(biomeSamples.get(player.id), biomeId)) continue;
          biomeSamples.set(player.id, biomeId);
          const biomeCategory = resolveBiomeCategory(biomeId);
          notifyQuestChanges(
            player,
            questPlayerService.recordEvent(
              player,
              "player.biome_enter",
              {
                biome: biomeId,
                ...(biomeCategory ? { biomeCategory } : {}),
                dimension: normalizedDimensionId(player.dimension.id),
              },
              { source: "taskScheduler.quest.biomeTransitions" }
            )
          );
        } catch {
          // getBiome can fail around unloaded chunks or invalidated players; do not infer a biome.
        }
      }
      for (const playerId of biomeSamples.keys()) {
        if (!onlineIds.has(playerId)) biomeSamples.delete(playerId);
      }
    },
  });

  taskScheduler.register({
    id: "quest.movementTransitions",
    label: "任务系统滑翔与骑乘状态转换",
    category: "player",
    intervalTicks: QUEST_MOVEMENT_SAMPLE_INTERVAL_TICKS,
    run: () => {
      const onlineIds = new Set<string>();
      for (const player of getOnlineRealPlayers()) {
        onlineIds.add(player.id);
        let ridingEntityId: string | undefined;
        let ridingEntityTypeId: string | undefined;
        try {
          const riding = player.getComponent("minecraft:riding");
          if (riding?.entityRidingOn?.isValid) {
            ridingEntityId = riding.entityRidingOn.id;
            ridingEntityTypeId = riding.entityRidingOn.typeId;
          }
        } catch {
          // Entity handles may invalidate between the online-player snapshot and this sample.
        }
        let gliding = false;
        try {
          gliding = player.isGliding;
        } catch {
          movementSamples.delete(player.id);
          continue;
        }
        const dimensionId = normalizedDimensionId(player.dimension.id);
        const current: QuestMovementSample = {
          gliding,
          ridingEntityId,
          ridingEntityTypeId,
          // A non-gliding sample deliberately carries no anchor, so stopping
          // flight breaks the next distance segment even when sampling resumes nearby.
          ...(gliding ? { dimensionId, location: { ...player.location } } : {}),
        };
        const previous = movementSamples.get(player.id);
        const transitions = resolveQuestMovementTransitions(previous, current);
        const glideDistance = resolveQuestGlideDistance(previous, current);
        movementSamples.set(player.id, current);

        if (transitions.startedGliding) {
          notifyQuestChanges(
            player,
            questPlayerService.recordEvent(
              player,
              "player.glide",
              { dimension: dimensionId },
              { source: "taskScheduler.quest.movementTransitions" }
            )
          );
        }
        if (glideDistance > 0) {
          notifyQuestChanges(
            player,
            questPlayerService.recordEvent(
              player,
              "elytra.distance",
              { distance: glideDistance, dimension: dimensionId },
              { source: "taskScheduler.quest.movementTransitions" }
            )
          );
        }
        if (transitions.rideChanged && ridingEntityTypeId) {
          notifyQuestChanges(
            player,
            questPlayerService.recordEvent(
              player,
              "player.ride",
              {
                entity: ridingEntityTypeId,
                dimension: dimensionId,
              },
              { source: "taskScheduler.quest.movementTransitions" }
            )
          );
        }
      }
      for (const playerId of movementSamples.keys()) {
        if (!onlineIds.has(playerId)) movementSamples.delete(playerId);
      }
    },
  });
}

eventRegistry.register("quest", registerQuestEvents);
