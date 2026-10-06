/**
 * 经济系统数据模型
 * 从services/economic.ts中提取的接口定义
 */

export interface IUserWallet {
  dailyEarned: number;
  lastResetDate: string;
  name: string;
  /** 新版内部身份 ID；旧数据没有该字段时仍按玩家名兼容读取 */
  identityId?: string;
  gold: number;
  /** 已成功发放的幂等加币收据；需要永久保留，不得按数量淘汰。 */
  appliedCredits?: Record<string, IAppliedCreditReceipt>;
}

export interface IUserWalletWithDailyLimit extends IUserWallet {
  dailyEarned: number;
  lastResetDate: string;
  dailyLimitNotifyCount: number;
}

export interface ITransaction {
  from: string;
  to: string;
  amount: number;
  reason: string;
  timestamp: number;
}

export interface IAppliedCreditReceipt {
  amount: number;
  appliedAt: number;
  reason: string;
}

export interface ICreditGoldOnceInput {
  playerName: string;
  playerIdentityId: string;
  amount: number;
  reason: string;
  idempotencyKey: string;
  ignoreDailyLimit?: boolean;
}

export type CreditGoldOnceRejectedReason =
  | "economy_disabled"
  | "invalid_player"
  | "invalid_identity"
  | "invalid_amount"
  | "invalid_idempotency_key"
  | "daily_limit_exceeded"
  | "balance_limit_exceeded";

export type CreditGoldOnceRetryableReason =
  | "identity_unavailable"
  | "wallet_unavailable"
  | "wallet_receipt_invalid"
  | "wallet_save_failed";

export type ICreditGoldOnceResult =
  | {
      status: "credited" | "already_credited";
      amount: number;
      balance: number;
    }
  | {
      status: "rejected";
      reason: CreditGoldOnceRejectedReason;
    }
  | {
      status: "conflict";
      requestedAmount: number;
      appliedAmount: number;
      balance: number;
    }
  | {
      status: "retryable_error";
      reason: CreditGoldOnceRetryableReason;
    };

export interface IPlayerMarketItem {
  id: string;
  seller: string;
  itemTypeId: string;
  amount: number;
  price: number;
  createdAt: number;
  expiresAt: number;
}

export interface IShopItem {
  id: string;
  name: string;
  itemTypeId: string;
  price: number;
  stock: number;
  description?: string;
}

export interface IItemPrice {
  itemTypeId: string;
  basePrice: number;
  sellPrice: number;
}
