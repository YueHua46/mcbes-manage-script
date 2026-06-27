import {
  EnchantmentTypes,
  ItemDurabilityComponent,
  ItemEnchantableComponent,
  ItemStack,
} from "@minecraft/server";

export interface PersistedItemStack {
  typeId: string;
  amount: number;
  damage?: number;
  enchantments?: Array<{ type: string; level: number }>;
  lore?: string[];
}

export function serializeItemStack(item: ItemStack): PersistedItemStack {
  const data: PersistedItemStack = {
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

export function deserializeItemStack(data: PersistedItemStack): ItemStack {
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
