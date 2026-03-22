/**
 * 经济系统服务导出
 */

export { default as economic } from "./economic";
export { default as itemPriceDatabase } from "./item-price-database";
export { default as itemDatabase } from "./item-database";
export { default as auctionHouse } from "./auction-house";
export { default as officeShop } from "./office-shop";
export {
  default as redPacketService,
  splitTotalEqually,
  buildShareAmounts,
  getRedPacketExpiryMs,
  DEFAULT_RED_PACKET_EXPIRY_MS,
  RED_PACKET_EXPIRY_MS,
  MAX_SHARE_COUNT,
} from "./red-packet";
export type {
  PendingRedPacketView,
  CreateRedPacketInput,
  RedPacketListItem,
  RedPacketClaimRow,
  RedPacketClaimDetailResult,
} from "./red-packet";

// 导入怪物击杀奖励（自动注册事件）
import "./monster-kill-reward";
// red-packet 由上方 export from "./red-packet" 加载并注册定时器

// 导出类型从models
export type { IUserWallet, IUserWalletWithDailyLimit, ITransaction } from "../models/economic.model";
export type { ShopItem, ShopItemData } from "./auction-house";
export type { ICategory, OfficeShopItemData, OfficeShopItemMetaData } from "./office-shop";
