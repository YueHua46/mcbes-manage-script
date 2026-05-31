import { resolveOwnPluginItemIconTexture } from "../../../ui/components/chest-ui/own-plugin-item-icons";
import { custom_content, custom_content_keys } from "../../../ui/components/chest-ui/constants";
import { getRememberedItemIconKey } from "./item-icon-key-cache";
import { resolveVanillaItemIconTexture } from "./vanilla-item-icon-paths";

/** 附加包物品约定贴图路径：textures/items/{shortname} */
export function resolveAddonItemConventionTexture(typeId: string): string | undefined {
  if (!typeId.includes(":") || typeId.startsWith("minecraft:")) return undefined;
  const name = typeId.slice(typeId.indexOf(":") + 1);
  if (!name) return undefined;
  return `textures/items/${name}`;
}

function isTexturePath(texture: string): boolean {
  return texture.startsWith("textures/");
}

function normalizeTexturePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\.png$/i, "");
}

/**
 * 将 item_texture 短 key 转为 Chest UI 可用的贴图路径。
 * 无文件系统时只能猜 textures/items/{key}；typeId 形 key 走 typeId 解析链。
 */
export function resolveIconKeyToDisplayTexture(iconKey: string, typeId?: string): string | undefined {
  const trimmed = iconKey.trim();
  if (!trimmed) return undefined;

  if (trimmed.startsWith("textures/")) return normalizeTexturePath(trimmed);

  if (trimmed.includes(":")) {
    return resolveChestUiItemDisplayTexture(trimmed, { skipIconKeyLookup: true });
  }

  const vanillaByKey = resolveVanillaItemIconTexture(`minecraft:${trimmed}`);
  if (vanillaByKey) return vanillaByKey;

  if (typeId && !typeId.startsWith("minecraft:")) {
    const short = typeId.slice(typeId.indexOf(":") + 1);
    if (trimmed === short) {
      return resolveAddonItemConventionTexture(typeId);
    }
  }

  return `textures/items/${trimmed.replace(/^items\//, "")}`;
}

/** Chest UI 按钮图标：统一解析为 textures/... 贴图路径 */
export function resolveChestUiItemDisplayTexture(
  texture: string,
  options?: { skipIconKeyLookup?: boolean }
): string {
  if (isTexturePath(texture)) return normalizeTexturePath(texture);

  const ownPluginTexture = resolveOwnPluginItemIconTexture(texture);
  if (ownPluginTexture) return ownPluginTexture;

  const vanillaTexture = resolveVanillaItemIconTexture(texture);
  if (vanillaTexture) return vanillaTexture;

  if (!options?.skipIconKeyLookup && texture.includes(":") && !texture.startsWith("minecraft:")) {
    const rememberedKey = getRememberedItemIconKey(texture);
    if (rememberedKey) {
      const fromKey = resolveIconKeyToDisplayTexture(rememberedKey, texture);
      if (fromKey) return fromKey;
    }
  }

  const customContentTexture = custom_content_keys.has(texture) ? custom_content[texture]?.texture : undefined;
  if (customContentTexture && isTexturePath(customContentTexture)) return customContentTexture;

  const addonConvention = resolveAddonItemConventionTexture(texture);
  if (addonConvention) return addonConvention;

  if (texture.includes(":")) {
    const shortname = texture.slice(texture.indexOf(":") + 1);
    if (shortname) return `textures/items/${shortname}`;
  }

  return texture;
}
