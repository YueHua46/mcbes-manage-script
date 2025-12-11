/**
 * 物品ID配置与管理系统
 * 移植自 Chest-UI/BP/scripts/extensions/itemIdConfig.js
 *
 * 该系统管理自定义物品的ID偏移，无需修改使用该扩展的模块。
 * 添加自定义物品时，只需更新此处的计数配置。
 */

/**
 * 自定义物品偏移追踪
 */
export interface CustomItemVersion {
  count: number;
  timestamp: number;
  description: string;
}

export const CUSTOM_ITEM_OFFSET: { [key: string]: CustomItemVersion } = {
  // 添加自定义物品时，更新当前版本的计数
  // 或创建新版本以便更好地追踪
  v1: {
    count: 8, // <-- 添加自定义物品时更新此数字
    timestamp: Date.now(),
    description: "初始版本，无自定义物品",
  },
  // v2: {
  //   count: 10,
  //   timestamp: Date.now(),
  //   description: '添加了10个自定义物品 (diamond_gun, emerald_sword等)'
  // },
};

/**
 * 获取所有注册自定义物品的总偏移ID
 * @returns 用于ID计算的总偏移量
 */
export function getTotalCustomItemOffset(): number {
  return Object.values(CUSTOM_ITEM_OFFSET).reduce((sum, version) => sum + version.count, 0);
}

/**
 * 通过考虑自定义物品偏移安全计算ID
 * @param ID - 来自 typeIdToID 或 typeIdToDataId 的ID
 * @param number_of_custom_items - 自定义物品数量（备用）
 * @returns 偏移后的ID，如果ID无效则返回undefined
 */
export function calculateSafeItemID(ID: number | undefined, number_of_custom_items: number): number | undefined {
  if (ID === undefined) return undefined;

  // 优先使用追踪偏移，备用参数作为后备
  const totalOffset = getTotalCustomItemOffset();
  const offset = totalOffset > 0 ? totalOffset : number_of_custom_items;

  // 原版物品 (ID < 256) 不需要偏移
  // 自定义物品 (ID >= 256) 需要偏移
  if (ID < 256) {
    return ID;
  }

  return ID + offset;
}

/**
 * 计算用于ChestUI的最终纹理ID（带偏移）
 * @param ID - 来自 typeIdToID 或 typeIdToDataId 的ID
 * @param number_of_custom_items - 自定义物品数量（备用）
 * @param enchanted - 物品是否附魔
 * @returns 用于表单按钮的最终纹理ID
 */
export function calculateFinalTextureID(
  ID: number | undefined,
  number_of_custom_items: number,
  enchanted: boolean = false
): number | undefined {
  if (ID === undefined) return undefined;

  const totalOffset = getTotalCustomItemOffset();
  const offset = totalOffset > 0 ? totalOffset : number_of_custom_items;
  const safeID = ID < 256 ? ID : ID + offset;

  return safeID * 65536 + (enchanted ? 32768 : 0);
}

/**
 * 验证并记录当前偏移状态
 * 用于添加自定义物品时的调试
 */
export function logOffsetState(): number {
  const totalOffset = getTotalCustomItemOffset();
  console.warn(`[ItemID Config] 自定义物品总偏移: ${totalOffset}`);
  console.warn("[ItemID Config] 偏移历史:", CUSTOM_ITEM_OFFSET);
  return totalOffset;
}
