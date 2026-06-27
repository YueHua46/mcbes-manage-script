import {
  Container,
  EnchantmentTypes,
  ItemDurabilityComponent,
  ItemEnchantableComponent,
  ItemStack,
  Player,
} from "@minecraft/server";

export const FAKE_PLAYER_INVENTORY_SLOTS = 36;

export interface PersistedFakeInventorySlot {
  typeId: string;
  amount: number;
  damage?: number;
  enchantments?: Array<{ type: string; level: number }>;
  lore?: string[];
}

export type PersistedFakeInventory = Record<string, PersistedFakeInventorySlot>;

export function serializeItemStack(item: ItemStack): PersistedFakeInventorySlot {
  const data: PersistedFakeInventorySlot = {
    typeId: item.typeId,
    amount: item.amount,
  };

  const durability = item.getComponent(ItemDurabilityComponent.componentId) as ItemDurabilityComponent | undefined;
  if (durability && durability.damage > 0) {
    data.damage = durability.damage;
  }

  const enchantable = item.getComponent(ItemEnchantableComponent.componentId) as ItemEnchantableComponent | undefined;
  if (enchantable) {
    try {
      const enchantments = enchantable
        .getEnchantments()
        .map((enchantment) => ({ type: enchantment.type.id, level: enchantment.level }));
      if (enchantments.length > 0) {
        data.enchantments = enchantments;
      }
    } catch {
      // ignore
    }
  }

  try {
    const lore = item.getLore();
    if (lore.length > 0) {
      data.lore = lore;
    }
  } catch {
    // ignore
  }

  return data;
}

export function deserializeItemStack(data: PersistedFakeInventorySlot): ItemStack {
  const item = new ItemStack(data.typeId, data.amount);

  if (data.damage !== undefined) {
    const durability = item.getComponent(ItemDurabilityComponent.componentId) as ItemDurabilityComponent | undefined;
    if (durability) {
      durability.damage = Math.min(data.damage, durability.maxDurability);
    }
  }

  if (data.enchantments?.length) {
    const enchantable = item.getComponent(ItemEnchantableComponent.componentId) as ItemEnchantableComponent | undefined;
    if (enchantable) {
      for (const enchantment of data.enchantments) {
        try {
          const type = EnchantmentTypes.get(enchantment.type);
          if (!type) continue;
          enchantable.addEnchantment({ type, level: enchantment.level });
        } catch {
          // ignore unsupported enchantment
        }
      }
    }
  }

  if (data.lore?.length) {
    try {
      item.setLore(data.lore);
    } catch {
      // ignore
    }
  }

  return item;
}

export function snapshotContainer(container: Container, slotCount = FAKE_PLAYER_INVENTORY_SLOTS): PersistedFakeInventory {
  const inventory: PersistedFakeInventory = {};
  const limit = Math.min(container.size, slotCount);

  for (let slot = 0; slot < limit; slot++) {
    const item = container.getItem(slot);
    if (!item) continue;
    inventory[String(slot)] = serializeItemStack(item);
  }

  return inventory;
}

export function restoreContainer(container: Container, inventory: PersistedFakeInventory | undefined): void {
  const limit = Math.min(container.size, FAKE_PLAYER_INVENTORY_SLOTS);

  for (let slot = 0; slot < limit; slot++) {
    container.setItem(slot, undefined);
  }

  if (!inventory) return;

  for (const [slotKey, data] of Object.entries(inventory)) {
    const slot = Number.parseInt(slotKey, 10);
    if (!Number.isInteger(slot) || slot < 0 || slot >= limit) continue;
    if (!data?.typeId || data.amount <= 0) continue;

    try {
      container.setItem(slot, deserializeItemStack(data));
    } catch {
      // ignore invalid slot
    }
  }
}

export function snapshotPlayerInventory(player: Player, slotCount = FAKE_PLAYER_INVENTORY_SLOTS): PersistedFakeInventory {
  const container = player.getComponent("inventory")?.container;
  return container ? snapshotContainer(container, slotCount) : {};
}

export function restorePlayerInventory(player: Player, inventory: PersistedFakeInventory | undefined): void {
  const container = player.getComponent("inventory")?.container;
  if (!container) return;
  restoreContainer(container, inventory);
}

export function hasPersistedInventory(inventory: PersistedFakeInventory | undefined): boolean {
  return !!inventory && Object.keys(inventory).length > 0;
}
