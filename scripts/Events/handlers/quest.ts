import { Player, PlayerInventoryType, system, world } from "@minecraft/server";
import { eventRegistry } from "../registry";
import questPlayerService from "../../features/quest/services/quest-player";
import { taskScheduler } from "../../features/platform/scheduler";
import { ONLINE_TIME_TICK_INTERVAL } from "../../features/player/services/online-time";
import { getOnlineRealPlayers } from "../../shared/utils/online-players";

const pendingItemDeltas = new Map<string, { player: Player; items: Map<string, number> }>();
let itemFlushScheduled = false;

function notifyQuestChanges(player: Player, changes: ReturnType<typeof questPlayerService.recordEvent>): void {
  const completedNotified = new Set<string>();
  changes.forEach((change) => {
    if (change.completedQuest) {
      if (completedNotified.has(change.quest.id)) return;
      completedNotified.add(change.quest.id);
      player.sendMessage(`§a任务完成：§e${change.quest.title}§a。打开 §e任务系统 §a领取奖励。`);
      return;
    }
    player.sendMessage(`§e任务进度：§f${change.quest.title} §7${change.current}/${change.target}`);
  });
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
        questPlayerService.recordEvent(player, "item.obtain", {
          item: itemId,
          amount,
        })
      );
    });
  });
}

export function registerQuestEvents(): void {
  world.afterEvents.entityDie.subscribe((event) => {
    const killer = event.damageSource.damagingEntity;
    if (killer?.typeId !== "minecraft:player") return;
    const player = killer as Player;
    const deadEntity = event.deadEntity;
    if (deadEntity.typeId === "minecraft:player") return;

    notifyQuestChanges(
      player,
      questPlayerService.recordEvent(player, "entity.kill", {
        entity: deadEntity.typeId,
        dimension: deadEntity.dimension.id,
      })
    );
  });

  world.afterEvents.playerBreakBlock.subscribe((event) => {
    notifyQuestChanges(
      event.player,
      questPlayerService.recordEvent(event.player, "block.break", {
        block: event.brokenBlockPermutation.type.id,
        dimension: event.dimension.id,
      })
    );
  });

  world.afterEvents.playerInventoryItemChange.subscribe((event) => {
    if (event.inventoryType !== PlayerInventoryType.Hotbar && event.inventoryType !== PlayerInventoryType.Inventory) return;
    if (event.beforeItemStack) {
      addPendingItemDelta(event.player, event.beforeItemStack.typeId, -event.beforeItemStack.amount);
    }
    if (event.itemStack) {
      addPendingItemDelta(event.player, event.itemStack.typeId, event.itemStack.amount);
    }
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
          questPlayerService.recordEvent(player, "player.online_time", {
            seconds: ONLINE_TIME_TICK_INTERVAL / 20,
            dimension: player.dimension.id,
          })
        );
      }
    },
  });
}

eventRegistry.register("quest", registerQuestEvents);
