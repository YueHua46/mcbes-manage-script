import { Container, ItemStack, Player } from "@minecraft/server";
import {
  deserializeItemStack,
  PersistedItemStack,
  serializeItemStack,
} from "../../../shared/utils/item-stack-persist";

export const FAKE_PLAYER_INVENTORY_SLOTS = 36;

export type PersistedFakeInventorySlot = PersistedItemStack;
export type PersistedFakeInventory = Record<string, PersistedFakeInventorySlot>;

export { deserializeItemStack, serializeItemStack };

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
