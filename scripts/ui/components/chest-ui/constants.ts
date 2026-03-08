/**
 * ChestUI 常量配置
 * 对齐 Herobrine643928/Chest-UI BP/scripts/extensions/constants.js
 * 与 RP/ui/_global_variables.json 中 $show_inventory 需一致
 */

/**
 * 是否在表单中显示玩家物品栏
 * 设为 false 时需在 RP/ui/_global_variables.json 中也将 $show_inventory 设为 false
 */
export const inventory_enabled = false;

/**
 * 自定义 typeId → 纹理（可选），用于 getDisplayTexture / resolveTextureAndId 的纹理解析
 * 物品 ID 由外部脚本提供，此处仅做纹理映射
 */
export interface CustomContentItem {
  texture: string;
  type: "block" | "item";
}

export const custom_content: { [key: string]: CustomContentItem } = {};
export const custom_content_keys = new Set<string>(Object.keys(custom_content));

/**
 * 箱子UI尺寸映射
 * 格式: [key, [ui_flag, slot_count]]
 */
/** 与开源 Chest-UI 一致，并保留 shop 别名 */
export const CHEST_UI_SIZES = new Map<string | number, [string, number]>([
  ["single", ["§c§h§e§s§t§2§7§r", 27]],
  ["small", ["§c§h§e§s§t§2§7§r", 27]],
  ["double", ["§c§h§e§s§t§5§4§r", 54]],
  ["large", ["§c§h§e§s§t§5§4§r", 54]],
  ["shop", ["§c§h§e§s§t§5§4§r", 54]],
  ["1", ["§c§h§e§s§t§0§1§r", 1]],
  ["5", ["§c§h§e§s§t§0§5§r", 5]],
  ["9", ["§c§h§e§s§t§0§9§r", 9]],
  ["18", ["§c§h§e§s§t§1§8§r", 18]],
  ["27", ["§c§h§e§s§t§2§7§r", 27]],
  ["36", ["§c§h§e§s§t§3§6§r", 36]],
  ["45", ["§c§h§e§s§t§4§5§r", 45]],
  ["45_inv", ["§c§h§e§s§t§i§n§v§4§5§r", 45]],
  ["54", ["§c§h§e§s§t§5§4§r", 54]],
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
  | "45_inv"
  | "54"
  | 1
  | 5
  | 9
  | 18
  | 27
  | 36
  | 45
  | 54;
