/**
 * 从玩家采集装备 + 背包快照（用于订阅物品行为日志）
 * 潜影盒、收纳袋等含 minecraft:inventory 的物品会递归序列化子物品（有深度与条数上限）。
 */

import {
  EntityEquippableComponent,
  EquipmentSlot,
  ItemInventoryComponent,
  ItemStack,
  Player,
} from "@minecraft/server";
import type { ItemWatchNestedSlot, ItemWatchSlotLine, ItemWatchSnapshotPayload } from "./item-watch-snapshot-store";

const MAX_NEST_DEPTH = 4;
const MAX_SLOTS_PER_CONTAINER = 27;
const MAX_TOTAL_ITEM_NODES = 400;

interface SerializeCtx {
  totalNodes: number;
}

function serializeItemStack(stack: ItemStack, depth: number, ctx: SerializeCtx): ItemWatchSlotLine | null {
  if (ctx.totalNodes >= MAX_TOTAL_ITEM_NODES) return null;
  ctx.totalNodes++;

  const base: ItemWatchSlotLine = {
    typeId: stack.typeId,
    amount: stack.amount,
    localizationKey: stack.localizationKey,
  };

  if (depth >= MAX_NEST_DEPTH) {
    return base;
  }

  try {
    const invComp = stack.getComponent(ItemInventoryComponent.componentId) as ItemInventoryComponent | undefined;
    const container = invComp?.container;
    if (!container) {
      return base;
    }

    const contents: ItemWatchNestedSlot[] = [];
    const cap = Math.min(container.size, MAX_SLOTS_PER_CONTAINER);
    let truncated = container.size > cap;

    for (let i = 0; i < cap; i++) {
      if (ctx.totalNodes >= MAX_TOTAL_ITEM_NODES) {
        truncated = true;
        break;
      }
      const inner = container.getItem(i);
      if (!inner?.typeId) continue;

      const child = serializeItemStack(inner, depth + 1, ctx);
      if (child) {
        contents.push({ ...child, slotIndex: i });
      }
    }

    if (contents.length > 0) {
      base.contents = contents;
    }
    if (truncated) {
      base.contentsTruncated = true;
    }
  } catch {
    // 部分版本或物品无 inventory 组件
  }

  return base;
}

/** 列表/标题展示用：优先已存 key，否则尝试用 typeId 构造 ItemStack 取 localizationKey */
export function resolveItemLocalizationKey(typeId: string, storedLocalizationKey?: string): string | undefined {
  const stored = storedLocalizationKey?.trim();
  if (stored) return stored;
  const id = typeId?.trim();
  if (!id) return undefined;
  try {
    const stack = new ItemStack(id, 1);
    return stack.localizationKey?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function collectPlayerItemWatchSnapshot(
  player: Player,
  acquiredTypeId: string,
  acquiredLocalizationKey?: string
): ItemWatchSnapshotPayload {
  const ctx: SerializeCtx = { totalNodes: 0 };

  const equipment: ItemWatchSnapshotPayload["equipment"] = [];
  const equippable = player.getComponent(EntityEquippableComponent.componentId) as EntityEquippableComponent | undefined;
  if (equippable) {
    const slots: [EquipmentSlot, string][] = [
      [EquipmentSlot.Mainhand, "主手"],
      [EquipmentSlot.Offhand, "副手"],
      [EquipmentSlot.Head, "头盔"],
      [EquipmentSlot.Chest, "胸甲"],
      [EquipmentSlot.Legs, "护腿"],
      [EquipmentSlot.Feet, "靴子"],
    ];
    for (const [slot, label] of slots) {
      const es = equippable.getEquipmentSlot(slot);
      const stack = es?.getItem();
      const line = stack ? serializeItemStack(stack, 0, ctx) : null;
      equipment.push({ label, slot: line });
    }
  }

  const slots: ItemWatchNestedSlot[] = [];
  const container = player.getComponent("inventory")?.container;
  if (container) {
    for (let i = 0; i < container.size; i++) {
      if (ctx.totalNodes >= MAX_TOTAL_ITEM_NODES) break;
      const item = container.getItem(i);
      if (!item?.typeId) continue;
      const line = serializeItemStack(item, 0, ctx);
      if (line) {
        slots.push({ ...line, slotIndex: i });
      }
    }
  }

  const payload: ItemWatchSnapshotPayload = {
    t: Date.now(),
    playerName: player.name,
    acquiredTypeId,
    equipment,
    slots,
  };
  const loc = acquiredLocalizationKey?.trim();
  if (loc) {
    payload.acquiredLocalizationKey = loc;
  }
  return payload;
}
