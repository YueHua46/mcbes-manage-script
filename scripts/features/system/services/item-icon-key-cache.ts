import { ItemStack, ItemTypes, system } from "@minecraft/server";

/** typeId → item_texture.json 中的 icon 短 key（运行时从 ItemStack 学习） */
const iconKeyByTypeId = new Map<string, string>();

type IconComponentLike = {
  texture?: string;
  textures?: { default?: string; [variant: string]: string | undefined };
};

/** 从 ItemStack 读取 minecraft:icon（支持 string / texture / textures.default） */
export function extractItemIconKey(item: ItemStack): string | undefined {
  try {
    const icon = item.getComponent("minecraft:icon") as IconComponentLike | undefined;
    if (!icon || typeof icon !== "object") return undefined;

    let raw: string | undefined;
    if (typeof icon.texture === "string") {
      raw = icon.texture;
    } else if (icon.textures && typeof icon.textures.default === "string") {
      raw = icon.textures.default;
    }

    const trimmed = raw?.trim();
    return trimmed || undefined;
  } catch {
    return undefined;
  }
}

export function rememberItemIconKeyFromStack(item: ItemStack): void {
  const iconKey = extractItemIconKey(item);
  if (iconKey) iconKeyByTypeId.set(item.typeId, iconKey);
}

export function getRememberedItemIconKey(typeId: string): string | undefined {
  return iconKeyByTypeId.get(typeId);
}

/** 启动后扫描已注册自定义物品，填充 typeId → iconKey（无需读资源包文件） */
export function warmupItemIconKeyCache(): void {
  for (const type of ItemTypes.getAll()) {
    if (type.id.startsWith("minecraft:")) continue;
    try {
      rememberItemIconKeyFromStack(new ItemStack(type, 1));
    } catch {
      // 部分 type 无法实例化为 ItemStack
    }
  }
}

export function scheduleItemIconKeyCacheWarmup(): void {
  system.runTimeout(() => {
    try {
      warmupItemIconKeyCache();
    } catch {
      // 非致命
    }
  }, 40);
}
