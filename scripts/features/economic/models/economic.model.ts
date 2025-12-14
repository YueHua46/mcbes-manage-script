/**
 * 经济系统数据模型
 * 从services/economic.ts中提取的接口定义
 */

export interface IUserWallet {
  dailyEarned: number;
  lastResetDate: string;
  name: string;
  gold: number;
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

export interface IAuctionItem {
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
