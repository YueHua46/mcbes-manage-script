/**
 * 全局常量定义
 */

// 品牌与入口常量
export const BRANDING = {
  PRODUCT_NAME: "苦力怕菜单",
  MENU_TITLE: "§w苦力怕菜单",
  MENU_ITEM_LABEL: "苦力怕菜单",
  LEGACY_MENU_ITEM_LABEL: "服务器菜单",
  MENU_CHAT_TRIGGERS: ["苦力怕菜单", "服务器菜单"] as readonly string[],
} as const;

export function isMenuChatTrigger(message: string): boolean {
  return BRANDING.MENU_CHAT_TRIGGERS.includes(message.trim());
}

// 经济系统常量
export const ECONOMIC_CONSTANTS = {
  MAX_DAILY_GOLD_LIMIT: 10000,
  DEFAULT_START_GOLD: 0,
  MIN_TRANSFER_AMOUNT: 1,
} as const;

// 领地系统常量
export const LAND_CONSTANTS = {
  MAX_LAND_PER_PLAYER: 5,
  MIN_LAND_SIZE: 16,
  MAX_LAND_SIZE: 256,
  LAND_MARK_EXPIRE_TIME: 600000, // 10分钟
} as const;

// 系统常量
export const SYSTEM_CONSTANTS = {
  TPS_UPDATE_INTERVAL: 20,
  ITEM_CLEANUP_WARNING_TIME: 25,
  ITEM_CLEANUP_COUNTDOWN_TIME: 5,
} as const;

// 玩家常量
export const PLAYER_CONSTANTS = {
  MAX_PREFIX_LENGTH: 20,
} as const;
