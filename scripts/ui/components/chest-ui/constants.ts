/**
 * ChestUI 常量配置
 * 移植自 Chest-UI/BP/scripts/extensions/constants.js
 */

/**
 * 是否启用物品栏显示功能
 * 仅当在 RP/ui/_global_variables.json 中也禁用时才设为 false
 */
export const inventory_enabled = false;

/**
 * 自定义方块和物品ID定义
 * 可以引用原版纹理图标或纹理路径
 */
export interface CustomContentItem {
  texture: string;
  type: "block" | "item";
}

export const custom_content: { [key: string]: CustomContentItem } = {
  // 示例:
  "yuehua:sm": {
    texture: "textures/items/sm",
    type: "item",
  },
};

/**
 * 自定义物品数量（方块不计入，因为它们不会偏移原版ID）
 */
export const number_of_custom_items = Object.values(custom_content).filter((v) => v.type === "item").length;

/**
 * 自定义内容键集合
 */
export const custom_content_keys = new Set(Object.keys(custom_content));

/**
 * 箱子UI尺寸映射
 * 格式: [key, [ui_flag, slot_count]]
 */
export const CHEST_UI_SIZES = new Map<string | number, [string, number]>([
  // 字符串键
  ["single", ["§c§h§e§s§t§2§7§r", 27]],
  ["small", ["§c§h§e§s§t§2§7§r", 27]],
  ["double", ["§c§h§e§s§t§5§4§r", 54]],
  ["large", ["§c§h§e§s§t§5§4§r", 54]],
  ["shop", ["§c§h§e§s§t§5§4§r", 54]], // 向后兼容别名
  ["1", ["§c§h§e§s§t§0§1§r", 1]],
  ["5", ["§c§h§e§s§t§0§5§r", 5]],
  ["9", ["§c§h§e§s§t§0§9§r", 9]],
  ["18", ["§c§h§e§s§t§1§8§r", 18]],
  ["27", ["§c§h§e§s§t§2§7§r", 27]],
  ["36", ["§c§h§e§s§t§3§6§r", 36]],
  ["45", ["§c§h§e§s§t§4§5§r", 45]],
  ["54", ["§c§h§e§s§t§5§4§r", 54]],
  // 数字键
  [1, ["§c§h§e§s§t§0§1§r", 1]],
  [5, ["§c§h§e§s§t§0§5§r", 5]],
  [9, ["§c§h§e§s§t§0§9§r", 9]],
  [18, ["§c§h§e§s§t§1§8§r", 18]],
  [27, ["§c§h§e§s§t§2§7§r", 27]],
  [36, ["§c§h§e§s§t§3§6§r", 36]],
  [45, ["§c§h§e§s§t§4§5§r", 45]],
  [54, ["§c§h§e§s§t§5§4§r", 54]],
]);

/**
 * 箱子UI尺寸类型
 */
export type ChestUISize =
  | "single"
  | "small"
  | "double"
  | "large"
  | "shop"
  | "1"
  | "5"
  | "9"
  | "18"
  | "27"
  | "36"
  | "45"
  | "54"
  | 1
  | 5
  | 9
  | 18
  | 27
  | 36
  | 45
  | 54;
