/**
 * 经济系统服务导出
 */

export { default as economic, MONEY_SCOREBOARD_MAX, MONEY_SCOREBOARD_OBJECTIVE } from "./economic";
export { default as itemPriceDatabase } from "./item-price-database";
export { default as itemDatabase } from "./item-database";
export { default as playerMarket } from "./player-market";
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
export { default as redemptionCodeService } from "./redemption-code";
export type {
  CreateRedemptionCodeInput,
  CreateRedemptionCodeResult,
  IRedemptionCode,
  IRedemptionCodeClaim,
  RedemptionCodeView,
  RedemptionMutationResult,
  RedemptionRecoveryResolutionAction,
  RedemptionRecoverySummary,
  RedemptionResult,
} from "./redemption-code";

// 导入怪物击杀奖励（自动注册事件）
import "./monster-kill-reward";
// red-packet 由上方 export from "./red-packet" 加载并注册定时器
// redemption-code 由上方 export 加载；统一启动器也会显式加载，以恢复 prepared 领取。

// 导出类型从models
export type { IUserWallet, IUserWalletWithDailyLimit, ITransaction } from "../models/economic.model";
export type { MarketItem, MarketItemData } from "./player-market";
export type { ICategory, OfficeShopItemData, OfficeShopItemMetaData } from "./office-shop";
