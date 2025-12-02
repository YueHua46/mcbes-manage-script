/**
 * 物品实体钩子
 */

import { world, Entity } from '@minecraft/server';

/**
 * 获取所有掉落物实体
 */
export function useItems(): Entity[] {
  const items: Entity[] = [];
  const dimensions = ['overworld', 'nether', 'the_end'] as const;

  dimensions.forEach(dimId => {
    const dimension = world.getDimension(dimId);
    const dimItems = dimension.getEntities({ type: 'minecraft:item' });
    items.push(...dimItems);
  });

  return items;
}

/**
 * 获取掉落物数量
 */
export function useItemsCount(): number {
  return useItems().length;
}


