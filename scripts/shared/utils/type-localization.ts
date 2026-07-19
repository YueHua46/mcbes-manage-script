import { BlockTypes, EntityTypes, ItemStack, type RawMessage } from "@minecraft/server";

function normalizeTypeId(typeId: string): string {
  const id = typeId.trim();
  if (!id) return "";
  return id.includes(":") ? id : `minecraft:${id}`;
}

/** 按方块、实体、物品顺序解析原版客户端本地化键。 */
export function resolveTypeLocalizationKey(typeId: string | undefined): string | undefined {
  if (!typeId) return undefined;
  const normalized = normalizeTypeId(typeId);
  if (!normalized) return undefined;

  try {
    const key = BlockTypes.get(normalized)?.localizationKey?.trim();
    if (key) return key;
  } catch {
    /* try other registries */
  }
  try {
    const key = EntityTypes.get(normalized as any)?.localizationKey?.trim();
    if (key) return key;
  } catch {
    /* try item registry */
  }
  try {
    const key = new ItemStack(normalized, 1).localizationKey?.trim();
    return key || undefined;
  } catch {
    return undefined;
  }
}

export function typeNameRawMessage(typeId: string, storedLocalizationKey?: string): RawMessage {
  const localizationKey = storedLocalizationKey?.trim() || resolveTypeLocalizationKey(typeId);
  return localizationKey ? { translate: localizationKey } : { text: typeId.replace(/^minecraft:/, "") };
}
