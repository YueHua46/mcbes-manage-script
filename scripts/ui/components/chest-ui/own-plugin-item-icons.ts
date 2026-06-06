/**
 * 本插件自定义物品图标：Chest UI 固定使用资源包贴图路径。
 * 与 resource_packs/.../textures/item_texture.json 中 sm、log_inspector 一致。
 */
export const OWN_PLUGIN_ITEM_ICON_TEXTURES = {
  "yuehua:sm": "textures/items/sm",
  "yuehua:log_inspector": "textures/items/log_inspector",
} as const satisfies Record<string, string>;

export type OwnPluginItemTypeId = keyof typeof OWN_PLUGIN_ITEM_ICON_TEXTURES;

export function isOwnPluginItemTypeId(typeId: string): typeId is OwnPluginItemTypeId {
  return Object.prototype.hasOwnProperty.call(OWN_PLUGIN_ITEM_ICON_TEXTURES, typeId);
}

export function resolveOwnPluginItemIconTexture(typeId: string): string | undefined {
  if (!isOwnPluginItemTypeId(typeId)) return undefined;
  return OWN_PLUGIN_ITEM_ICON_TEXTURES[typeId];
}
