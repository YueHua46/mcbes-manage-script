/**
 * 经济系统服务导出
 */

export { default as economic } from "./economic";
export { default as itemPriceDatabase } from "./item-price-database";
export { default as itemDatabase } from "./item-database";
export { default as auctionHouse } from "./auction-house";
export { default as officeShop } from "./office-shop";

// 导入怪物击杀奖励（自动注册事件）
import "./monster-kill-reward";

// 导出类型从models
export type { IUserWallet, IUserWalletWithDailyLimit, ITransaction } from "../models/economic.model";
export type { ShopItem, ShopItemData } from "./auction-house";
export type { ICategory, OfficeShopItemData, OfficeShopItemMetaData } from "./office-shop";
