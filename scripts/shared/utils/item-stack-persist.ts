import {
  EnchantmentTypes,
  ItemBookComponent,
  ItemDurabilityComponent,
  ItemDyeableComponent,
  ItemEnchantableComponent,
  ItemInventoryComponent,
  ItemStack,
  RawMessage,
} from "@minecraft/server";

type PersistedDynamicPropertyValue = boolean | number | string | { x: number; y: number; z: number };

/**
 * JSON 快照只能覆盖 Script API 暴露出来的物品数据。
 * 以下物品的关键数据在 @minecraft/server 2.11.0-beta（1.26.5x）中无法读取或无法写回，
 * 从快照恢复时会丢失，需要依赖实体容器 / 结构备份保存完整 NBT：
 * - 潜影盒：物品上没有 minecraft:inventory 组件（该组件只存在于带 Storage Item 组件的物品，如收纳袋）
 * - 药水/药箭：ItemPotionComponent 只读，且无法通过构造函数指定药水类型
 * - 烟花、旗帜、地图、山羊角、迷之炖菜、不祥之瓶、弩的已装填弹药、蜂巢中的蜜蜂、饰纹陶罐等
 */
const LOSSY_ITEM_RULES: Array<{ reason: string; match: (typeId: string) => boolean }> = [
  { reason: "shulker_box_contents", match: (id) => id.endsWith("shulker_box") },
  {
    reason: "potion_type",
    match: (id) =>
      id === "minecraft:potion" ||
      id === "minecraft:splash_potion" ||
      id === "minecraft:lingering_potion" ||
      id === "minecraft:tipped_arrow",
  },
  { reason: "firework_data", match: (id) => id === "minecraft:firework_rocket" || id === "minecraft:firework_star" },
  { reason: "banner_patterns", match: (id) => id.endsWith("_banner") || id === "minecraft:shield" },
  { reason: "map_data", match: (id) => id === "minecraft:filled_map" },
  { reason: "goat_horn_variant", match: (id) => id === "minecraft:goat_horn" },
  { reason: "stew_effect", match: (id) => id === "minecraft:suspicious_stew" },
  { reason: "ominous_level", match: (id) => id === "minecraft:ominous_bottle" },
  { reason: "crossbow_projectile", match: (id) => id === "minecraft:crossbow" },
  { reason: "bee_data", match: (id) => id === "minecraft:beehive" || id === "minecraft:bee_nest" },
  { reason: "pot_sherds", match: (id) => id === "minecraft:decorated_pot" },
];

export interface PersistedItemStack {
  typeId: string;
  amount: number;
  nameTag?: string;
  lockMode?: string;
  keepOnDeath?: boolean;
  damage?: number;
  unbreakable?: boolean;
  dyeColor?: { red: number; green: number; blue: number };
  book?: {
    pages: Array<string | RawMessage | null>;
    title?: string;
    author?: string;
    signed?: boolean;
  };
  enchantments?: Array<{ type: string; level: number }>;
  lore?: string[];
  canDestroy?: string[];
  canPlaceOn?: string[];
  dynamicProperties?: Record<string, PersistedDynamicPropertyValue>;
  container?: Record<string, PersistedItemStack>;
  containerTruncated?: boolean;
  /**
   * 这个快照无法完整还原的数据类别（见 LOSSY_ITEM_RULES）。
   * 仅作提示用途：存在时说明从快照恢复会丢失部分 NBT。
   */
  lossy?: string[];
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
  try {
    if (durability?.unbreakable) data.unbreakable = true;
  } catch {
    // ignore
  }

  try {
    const dyeable = item.getComponent(ItemDyeableComponent.componentId) as ItemDyeableComponent | undefined;
    const color = dyeable?.color;
    if (color) data.dyeColor = { red: color.red, green: color.green, blue: color.blue };
  } catch {
    // ignore
  }

  try {
    const book = item.getComponent(ItemBookComponent.componentId) as ItemBookComponent | undefined;
    if (book && (book.pageCount > 0 || book.isSigned)) {
      const contents = book.contents;
      const rawContents = book.rawContents;
      const pages: Array<string | RawMessage | null> = [];
      for (let i = 0; i < book.pageCount; i++) {
        const text = contents[i];
        if (typeof text === "string") {
          pages.push(text);
        } else {
          pages.push(rawContents[i] ?? null);
        }
      }
      data.book = { pages };
      if (book.isSigned) {
        data.book.signed = true;
        if (book.title !== undefined) data.book.title = book.title;
        if (book.author !== undefined) data.book.author = book.author;
      }
    }
  } catch {
    // ignore
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

  const lossy = LOSSY_ITEM_RULES.filter((rule) => rule.match(item.typeId)).map((rule) => rule.reason);

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
        // 能读到容器内容（如收纳袋或未来暴露了 inventory 的潜影盒），就不再视为丢失。
        const index = lossy.indexOf("shulker_box_contents");
        if (index >= 0) lossy.splice(index, 1);
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

  if (lossy.length > 0) data.lossy = lossy;

  return data;
}

/**
 * 递归收集快照（含嵌套容器）中无法完整还原的数据类别。
 */
export function collectLossyReasons(data: PersistedItemStack | undefined, out: Set<string> = new Set()): Set<string> {
  if (!data) return out;
  for (const reason of data.lossy ?? []) out.add(reason);
  if (data.containerTruncated) out.add("container_truncated");
  for (const child of Object.values(data.container ?? {})) collectLossyReasons(child, out);
  return out;
}

const LOSSY_REASON_LABELS: Record<string, string> = {
  shulker_box_contents: "潜影盒内容",
  potion_type: "药水类型",
  firework_data: "烟花数据",
  banner_patterns: "旗帜图案",
  map_data: "地图数据",
  goat_horn_variant: "山羊角音色",
  stew_effect: "炖菜效果",
  ominous_level: "不祥等级",
  crossbow_projectile: "弩装填物",
  bee_data: "蜜蜂数据",
  pot_sherds: "陶罐纹饰",
  container_truncated: "容器内容（超出深度/数量上限）",
};

export function describeLossyReasons(reasons: Iterable<string>): string {
  return Array.from(reasons, (reason) => LOSSY_REASON_LABELS[reason] ?? reason).join("、");
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

  if (data.damage !== undefined || data.unbreakable) {
    const durability = item.getComponent(ItemDurabilityComponent.componentId) as ItemDurabilityComponent | undefined;
    if (durability) {
      if (data.damage !== undefined) {
        durability.damage = Math.min(data.damage, durability.maxDurability);
      }
      if (data.unbreakable) {
        try {
          durability.unbreakable = true;
        } catch {
          // ignore
        }
      }
    }
  }

  if (data.dyeColor) {
    try {
      const dyeable = item.getComponent(ItemDyeableComponent.componentId) as ItemDyeableComponent | undefined;
      if (dyeable) dyeable.color = { ...data.dyeColor };
    } catch {
      // ignore
    }
  }

  if (data.book) {
    try {
      const book = item.getComponent(ItemBookComponent.componentId) as ItemBookComponent | undefined;
      if (book) {
        book.setContents(data.book.pages.map((page) => page ?? ""));
        if (data.book.signed) {
          book.signBook(data.book.title ?? "", data.book.author ?? "");
        }
      }
    } catch {
      // ignore
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
