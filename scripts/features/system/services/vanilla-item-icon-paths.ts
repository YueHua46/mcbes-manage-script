import { vanillaItemIconPaths, VANILLA_ITEM_ICON_PATHS_VERSION } from "../../../assets/vanilla-item-icon-paths.js";

const vanillaItemIconPathMap = new Map(Object.entries(vanillaItemIconPaths));

const vanillaItemIconOverrides: Readonly<Record<string, string>> = {
  // The shield entity texture is a model atlas and renders as scattered pieces in UI buttons.
  "minecraft:shield": "textures/ui/empty_armor_slot_shield",
};

export function getVanillaItemIconPathsVersion(): string {
  return VANILLA_ITEM_ICON_PATHS_VERSION;
}

/** 原版 minecraft:* 物品的 Chest UI 贴图路径（不依赖 runtime 数字 id / 偏移） */
export function resolveVanillaItemIconTexture(typeId: string): string | undefined {
  if (!typeId.startsWith("minecraft:")) return undefined;
  return vanillaItemIconOverrides[typeId] ?? vanillaItemIconPathMap.get(typeId);
}

export function hasVanillaItemIconTexture(typeId: string): boolean {
  return vanillaItemIconPathMap.has(typeId);
}

export function getVanillaItemIconPathCount(): number {
  return vanillaItemIconPathMap.size;
}
