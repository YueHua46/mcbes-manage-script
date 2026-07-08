import {
  EnchantmentTypes,
  ItemDurabilityComponent,
  ItemEnchantableComponent,
  ItemInventoryComponent,
  ItemStack,
} from "@minecraft/server";

type PersistedDynamicPropertyValue = boolean | number | string | { x: number; y: number; z: number };

export interface PersistedItemStack {
  typeId: string;
  amount: number;
  nameTag?: string;
  lockMode?: string;
  keepOnDeath?: boolean;
  damage?: number;
  enchantments?: Array<{ type: string; level: number }>;
  lore?: string[];
  canDestroy?: string[];
  canPlaceOn?: string[];
  dynamicProperties?: Record<string, PersistedDynamicPropertyValue>;
  container?: Record<string, PersistedItemStack>;
  containerTruncated?: boolean;
}

interface SerializeContext {
  depth: number;
  totalNodes: number;
  maxDepth: number;
  maxTotalNodes: number;
}

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_TOTAL_NODES = 400;

function serializeDynamicPropertyValue(value: unknown): PersistedDynamicPropertyValue | undefined {
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const vector = value as { x?: unknown; y?: unknown; z?: unknown };
    if (typeof vector.x === "number" && typeof vector.y === "number" && typeof vector.z === "number") {
      return { x: vector.x, y: vector.y, z: vector.z };
    }
  }
  return undefined;
}

function serializeItemStackInternal(item: ItemStack, ctx: SerializeContext): PersistedItemStack {
  ctx.totalNodes++;
  const data: PersistedItemStack = {
    typeId: item.typeId,
    amount: item.amount,
  };

  try {
    if (item.nameTag) data.nameTag = item.nameTag;
  } catch {
    // ignore
  }

  try {
    if (item.lockMode !== "none") data.lockMode = item.lockMode;
  } catch {
    // ignore
  }

  try {
    if (item.keepOnDeath) data.keepOnDeath = true;
  } catch {
    // ignore
  }

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

  try {
    const canDestroy = item.getCanDestroy();
    if (canDestroy.length > 0) data.canDestroy = canDestroy;
  } catch {
    // ignore
  }

  try {
    const canPlaceOn = item.getCanPlaceOn();
    if (canPlaceOn.length > 0) data.canPlaceOn = canPlaceOn;
  } catch {
    // ignore
  }

  try {
    const dynamicProperties: Record<string, PersistedDynamicPropertyValue> = {};
    for (const id of item.getDynamicPropertyIds()) {
      const value = serializeDynamicPropertyValue(item.getDynamicProperty(id));
      if (value !== undefined) dynamicProperties[id] = value;
    }
    if (Object.keys(dynamicProperties).length > 0) data.dynamicProperties = dynamicProperties;
  } catch {
    // ignore
  }

  if (ctx.depth < ctx.maxDepth && ctx.totalNodes < ctx.maxTotalNodes) {
    try {
      const inventory = item.getComponent(ItemInventoryComponent.componentId) as ItemInventoryComponent | undefined;
      const container = inventory?.container;
      if (container) {
        const contents: Record<string, PersistedItemStack> = {};
        for (let slot = 0; slot < container.size; slot++) {
          if (ctx.totalNodes >= ctx.maxTotalNodes) {
            data.containerTruncated = true;
            break;
          }
          const child = container.getItem(slot);
          if (!child) continue;
          ctx.depth++;
          try {
            contents[String(slot)] = serializeItemStackInternal(child, ctx);
          } finally {
            ctx.depth--;
          }
        }
        if (Object.keys(contents).length > 0) data.container = contents;
      }
    } catch {
      // 部分物品或版本没有可写的物品容器。
    }
  } else if (ctx.depth >= ctx.maxDepth) {
    try {
      const inventory = item.getComponent(ItemInventoryComponent.componentId) as ItemInventoryComponent | undefined;
      if (inventory?.container?.size) data.containerTruncated = true;
    } catch {
      // ignore
    }
  }

  return data;
}

export function serializeItemStack(item: ItemStack): PersistedItemStack {
  return serializeItemStackInternal(item, {
    depth: 0,
    totalNodes: 0,
    maxDepth: DEFAULT_MAX_DEPTH,
    maxTotalNodes: DEFAULT_MAX_TOTAL_NODES,
  });
}

export function deserializeItemStack(data: PersistedItemStack): ItemStack {
  const item = new ItemStack(data.typeId, data.amount);

  if (data.nameTag !== undefined) {
    try {
      item.nameTag = data.nameTag;
    } catch {
      // ignore
    }
  }

  if (data.lockMode !== undefined) {
    try {
      item.lockMode = data.lockMode as typeof item.lockMode;
    } catch {
      // ignore
    }
  }

  if (data.keepOnDeath !== undefined) {
    try {
      item.keepOnDeath = data.keepOnDeath;
    } catch {
      // ignore
    }
  }

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

  if (data.canDestroy?.length) {
    try {
      item.setCanDestroy(data.canDestroy);
    } catch {
      // ignore
    }
  }

  if (data.canPlaceOn?.length) {
    try {
      item.setCanPlaceOn(data.canPlaceOn);
    } catch {
      // ignore
    }
  }

  if (data.dynamicProperties) {
    try {
      item.setDynamicProperties(data.dynamicProperties);
    } catch {
      for (const [key, value] of Object.entries(data.dynamicProperties)) {
        try {
          item.setDynamicProperty(key, value);
        } catch {
          // ignore unsupported dynamic property
        }
      }
    }
  }

  if (data.container) {
    try {
      const inventory = item.getComponent(ItemInventoryComponent.componentId) as ItemInventoryComponent | undefined;
      const container = inventory?.container;
      if (container) {
        for (let slot = 0; slot < container.size; slot++) {
          container.setItem(slot, undefined);
        }
        for (const [slotKey, childData] of Object.entries(data.container)) {
          const slot = Number.parseInt(slotKey, 10);
          if (!Number.isInteger(slot) || slot < 0 || slot >= container.size) continue;
          container.setItem(slot, deserializeItemStack(childData));
        }
      }
    } catch {
      // ignore invalid nested item
    }
  }

  return item;
}
