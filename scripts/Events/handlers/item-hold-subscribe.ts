/**
 * 全服登记的物品 typeId：任意玩家净获得时写入行为日志 + 背包快照库
 */

import { system, world } from "@minecraft/server";
import { eventRegistry } from "../registry";
import behaviorLog from "../../features/behavior-log/services/behavior-log";
import { collectPlayerItemWatchSnapshot } from "../../features/behavior-log/services/item-watch-collect";
import { matchesItemWatchSubscribedType } from "../../features/item-watch/item-watch-subscription";

const DEBOUNCE_MS = 450;
const debounceAt = new Map<string, number>();

function debounceKey(playerId: string, typeId: string): string {
  return `${playerId}:${typeId}`;
}

export function registerItemHoldSubscribeEvents(): void {
  const sig = world.afterEvents.playerInventoryItemChange;
  if (typeof sig?.subscribe !== "function") {
    console.warn("[itemWatch] playerInventoryItemChange 不可用，跳过订阅物品快照监听");
    return;
  }

  sig.subscribe((event) => {
    const { player, itemStack, beforeItemStack } = event;
    if (!itemStack?.typeId) return;

    if (!matchesItemWatchSubscribedType(itemStack.typeId)) return;

    const before = beforeItemStack;
    const gain =
      !before ||
      before.typeId !== itemStack.typeId ||
      itemStack.amount > before.amount;
    if (!gain) return;

    const dk = debounceKey(player.id, itemStack.typeId);
    const now = Date.now();
    const last = debounceAt.get(dk) ?? 0;
    if (now - last < DEBOUNCE_MS) return;
    debounceAt.set(dk, now);

    const acquiredTypeId = itemStack.typeId;

    system.run(() => {
      const payload = collectPlayerItemWatchSnapshot(player, acquiredTypeId, itemStack.localizationKey);
      behaviorLog.logItemWatchSnapshot(player, acquiredTypeId, payload);
    });
  });
}

eventRegistry.register("itemHoldSubscribe", registerItemHoldSubscribeEvents);
