import {
  EntityEquippableComponent,
  EquipmentSlot,
  ItemEnchantableComponent,
  type ItemStack,
  Player,
} from "@minecraft/server";
import type { QuestEnchantmentSnapshot, QuestItemSnapshot } from "../catalog/selector-registry";
import {
  createEffectsSnapshotSummary,
  createInventorySnapshotSummary,
  type EquipmentSnapshotSummary,
} from "./snapshot-summary";

export const INVENTORY_SNAPSHOT_PROVIDER_VERSION = 2;
export const EQUIPMENT_SNAPSHOT_PROVIDER_VERSION = 2;
export const EFFECTS_SNAPSHOT_PROVIDER_VERSION = 1;

function normalizedNamespacedId(id: string): string {
  return id.includes(":") ? id : `minecraft:${id}`;
}

export function readItemEnchantments(item: ItemStack): QuestEnchantmentSnapshot[] {
  try {
    const enchantable = item.getComponent(ItemEnchantableComponent.componentId) as ItemEnchantableComponent | undefined;
    if (!enchantable) return [];
    return enchantable
      .getEnchantments()
      .filter((entry) => entry.type.id && Number.isFinite(entry.level) && entry.level > 0)
      .map((entry) => ({ typeId: normalizedNamespacedId(entry.type.id), level: entry.level }));
  } catch {
    // Component access can fail for invalid/custom stacks; never infer an enchantment.
    return [];
  }
}

function itemSnapshot(item: ItemStack): QuestItemSnapshot {
  const enchantments = readItemEnchantments(item);
  return {
    typeId: item.typeId,
    amount: item.amount,
    ...(enchantments.length > 0 ? { enchantments } : {}),
  };
}

export function buildPlayerInventorySummary(player: Player, now = Date.now()) {
  const container = player.getComponent("inventory")?.container;
  if (!container) throw new Error(`Cannot read inventory for ${player.name}`);
  const items: QuestItemSnapshot[] = [];
  for (let slot = 0; slot < container.size; slot++) {
    const item = container.getItem(slot);
    if (item) items.push(itemSnapshot(item));
  }
  return createInventorySnapshotSummary(items, now, INVENTORY_SNAPSHOT_PROVIDER_VERSION);
}

export function buildPlayerEquipmentSummary(player: Player, now = Date.now()): EquipmentSnapshotSummary {
  const equippable = player.getComponent("equippable") as EntityEquippableComponent | undefined;
  if (!equippable) throw new Error(`Cannot read equipment for ${player.name}`);
  const slots: Record<string, QuestItemSnapshot | undefined> = {};
  for (const slot of [
    EquipmentSlot.Head,
    EquipmentSlot.Chest,
    EquipmentSlot.Legs,
    EquipmentSlot.Feet,
    EquipmentSlot.Mainhand,
    EquipmentSlot.Offhand,
  ]) {
    const item = equippable.getEquipment(slot);
    slots[slot] = item ? itemSnapshot(item) : undefined;
  }
  return { slots, builtAt: now, providerVersion: EQUIPMENT_SNAPSHOT_PROVIDER_VERSION };
}

export function buildPlayerEffectsSummary(player: Player, now = Date.now()) {
  const effects = player.getEffects().map((effect) => ({
    typeId: normalizedNamespacedId(effect.typeId),
    amplifier: effect.amplifier,
    duration: effect.duration,
  }));
  return createEffectsSnapshotSummary(effects, now, EFFECTS_SNAPSHOT_PROVIDER_VERSION);
}
