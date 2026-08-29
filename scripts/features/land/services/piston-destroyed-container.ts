/** 原版活塞会直接破坏并掉落这些带物品数据的方块，而不是把它们作为普通移动方块。 */
export function isPistonDestroyedContainerType(typeId: string): boolean {
  return typeId === "minecraft:shulker_box" || typeId.endsWith("_shulker_box");
}
