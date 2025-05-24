// 经济系统
/**
 * 金币获取方式
 *  1. 击杀怪物，按照对应怪物获得不同区间的击杀金币奖励
 *  2. 玩家交易，玩家之间可以进行交易，作为卖方，将会按照交易金额来获得金币
 *  3. 出售物品，玩家可以出售物品，按照物品的价格获得对应金币奖励
 * 金币消耗方式
 *  1. 申请领地时，按照每个领地格子10金币来收取（每格多少金币可配置）'
 *  2. 玩家交易，玩家之间可以进行交易，作为买方，将会按照交易金额来消耗金币
 *  3. 商店，玩家可以在商店购买管理员上架的物品，按照购买物品的价格消耗金币
 */

import { Entity, Player, system, Vector3, world } from "@minecraft/server";
import { Database } from "../Database";
import { monsterByGold } from "./data/monsterByGold";
import { usePlayerByName } from "../../hooks/hooks";
import "./MonsterKillReward";
import setting from "../System/Setting";
import { Vector3Utils } from "@minecraft/math";
import { colorCodes } from "../../utils/color";

export interface IUserWallet {
  dailyEarned: number;
  lastResetDate: string;
  name: string;
  gold: number;
}

// 新增接口，包含每日金币获取记录
export interface IUserWalletWithDailyLimit extends IUserWallet {
  dailyEarned: number; // 今日已获得的金币数量
  lastResetDate: string; // 上次重置日期 (YYYY-MM-DD 格式)
  dailyLimitNotifyCount: number; // 今日已提示达到上限的次数
}

// 交易记录接口
export interface ITransaction {
  from: string;
  to: string;
  amount: number;
  reason: string;
  timestamp: number;
}

export class Economic {
  private db!: Database<IUserWallet>;
  private logDb!: Database<ITransaction[]>;
  private static instance: Economic;
  private DEFAULT_GOLD = 500; // 玩家初始金币，默认500
  private DAILY_GOLD_LIMIT = 100000; // 每日金币获取上限，默认10万

  private constructor() {
    system.run(() => {
      this.db = new Database<IUserWallet>("eco_wallets");
      this.logDb = new Database<ITransaction[]>("eco_transactions");

      // 初始化配置
      this.DAILY_GOLD_LIMIT = Number(setting.getState("daily_gold_limit"));
      this.DEFAULT_GOLD = Number(setting.getState("startingGold"));
    });

    // 设置每日重置定时器
    this.setupDailyReset();
  }

  static getInstance(): Economic {
    if (!Economic.instance) {
      Economic.instance = new Economic();
    }
    return Economic.instance;
  }

  /**
   * 设置每日重置定时器
   */
  private setupDailyReset(): void {
    // 每分钟检查一次是否需要重置
    system.runInterval(() => {
      this.checkAndResetDailyLimits();
    }, 1200); // 每分钟检查一次 (20 ticks/s * 60s = 1200 ticks)
  }

  /**
   * 检查并重置所有玩家的每日限制
   */
  private checkAndResetDailyLimits(): void {
    const today = this.getCurrentDateString();
    const allWallets = this.db.getAll() as Record<string, IUserWalletWithDailyLimit>;

    for (const [name, wallet] of Object.entries(allWallets)) {
      if (wallet.lastResetDate !== today) {
        wallet.dailyEarned = 0;
        wallet.lastResetDate = today;
        wallet.dailyLimitNotifyCount = 0; // 重置提示次数
        this.db.set(name, wallet);
      }
    }
  }

  /**
   * 获取当前日期字符串 (YYYY-MM-DD)
   */
  private getCurrentDateString(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(
      2,
      "0"
    )}`;
  }

  /**
   * 初始化玩家钱包
   */
  initWallet(name: string): IUserWalletWithDailyLimit {
    const wallet: IUserWalletWithDailyLimit = {
      name,
      gold: this.DEFAULT_GOLD,
      dailyEarned: 0,
      lastResetDate: this.getCurrentDateString(),
      dailyLimitNotifyCount: 0,
    };
    this.db.set(name, wallet);
    return wallet;
  }

  /**
   * 获取玩家钱包
   */
  getWallet(playerName: string): IUserWalletWithDailyLimit {
    let wallet = this.db.get(playerName) as IUserWalletWithDailyLimit;
    if (!wallet) {
      wallet = this.initWallet(playerName);
    }

    // 兼容旧数据，添加每日限制字段
    if (wallet.dailyEarned === undefined) {
      wallet.dailyEarned = 0;
      wallet.lastResetDate = this.getCurrentDateString();
      this.db.set(playerName, wallet);
    }

    // 检查是否需要重置每日限制
    if (wallet.lastResetDate !== this.getCurrentDateString()) {
      wallet.dailyEarned = 0;
      wallet.lastResetDate = this.getCurrentDateString();
      this.db.set(playerName, wallet);
    }

    return wallet;
  }

  // 获取所有玩家钱包
  getAllWallets(): IUserWallet[] {
    const allPlayerWallets = this.db.getAll();
    return Object.values(allPlayerWallets);
  }

  // 获得排名前十的玩家钱包
  getTopWallets(limit: number = 10): IUserWallet[] {
    const allWallets = this.getAllWallets();
    return allWallets.sort((a, b) => b.gold - a.gold).slice(0, limit);
  }

  /**
   * 检查经济系统是否启用
   */
  private isEconomyEnabled(): boolean {
    return setting.getState("economy") === true;
  }

  /**
   * 添加金币
   * @param name 玩家名称
   * @param amount 金额
   * @param reason 原因
   * @param ignoreDailyLimit 是否忽略每日限制（默认为false）
   * @returns 实际添加的金额
   */
  addGold(playerName: string, amount: number, reason: string, ignoreDailyLimit: boolean = false): number {
    if (!this.isEconomyEnabled()) return 0;

    if (amount <= 0) return 0;

    const wallet = this.getWallet(playerName);

    // 检查是否达到每日上限（如果不忽略限制）
    if (!ignoreDailyLimit) {
      // 如果是玩家之间的转账，忽略每日限制
      if (reason.includes("玩家转账") || reason.includes("购买玩家商店物品")) {
        ignoreDailyLimit = true;
      }
      if (!ignoreDailyLimit && wallet.dailyEarned >= this.DAILY_GOLD_LIMIT) {
        // 检查今日提示次数是否已达到3次
        if (wallet.dailyLimitNotifyCount < 3) {
          const player = usePlayerByName(playerName);
          if (player) {
            player.sendMessage({
              rawtext: [
                {
                  text: `${colorCodes.red}您已达到今日金币获取上限 ${colorCodes.gold}${this.DAILY_GOLD_LIMIT} ${colorCodes.red}金币，无法获得更多金币！`,
                },
              ],
            });
            // 增加提示次数
            wallet.dailyLimitNotifyCount++;
            this.db.set(playerName, wallet);
          }
        }
        return 0;
      }

      // 计算可以添加的金额（不超过每日上限）
      const remainingLimit = this.DAILY_GOLD_LIMIT - wallet.dailyEarned;
      if (!ignoreDailyLimit && amount > remainingLimit) {
        amount = remainingLimit;

        // 检查今日提示次数是否已达到3次
        if (wallet.dailyLimitNotifyCount < 3) {
          const player = usePlayerByName(playerName);
          if (player) {
            player.sendMessage({
              rawtext: [
                {
                  text: `${colorCodes.yellow}您已达到今日金币获取上限 ${colorCodes.gold}${this.DAILY_GOLD_LIMIT} ${colorCodes.yellow}金币！`,
                },
              ],
            });
            // 增加提示次数
            wallet.dailyLimitNotifyCount++;
            this.db.set(playerName, wallet);
          }
        }
      }
    }

    // 更新钱包
    wallet.gold += amount;

    // 如果不忽略限制，更新每日获取量
    if (!ignoreDailyLimit) {
      wallet.dailyEarned += amount;
    }

    this.db.set(playerName, wallet);

    // 记录交易
    this.logTransaction("system", playerName, amount, reason);

    return amount;
  }

  // 扣除金币
  removeGold(playerName: string, amount: number, reason: string = "系统消费"): boolean {
    if (!this.isEconomyEnabled()) return true;

    if (amount <= 0) return false;

    const wallet = this.getWallet(playerName);
    if (wallet.gold < amount) return false;

    wallet.gold -= amount;
    this.db.set(playerName, wallet);

    // 记录交易
    this.logTransaction(playerName, "system", amount, reason);

    return true;
  }

  // 检查余额是否足够
  hasEnoughGold(playerName: string, amount: number): boolean {
    return this.getWallet(playerName).gold >= amount;
  }

  // 转账
  transfer(fromPlayer: string, toPlayer: string, amount: number, reason: string = "转账"): string | boolean {
    if (!this.isEconomyEnabled()) return true;

    if (amount <= 0) return "无效金额";
    if (fromPlayer === toPlayer) return "不能给自己转账";

    const fromWallet = this.getWallet(fromPlayer);
    if (fromWallet.gold < amount) return "余额不足";

    const toWallet = this.getWallet(toPlayer);

    // 扣除发送方金币
    fromWallet.gold -= amount;
    this.db.set(fromPlayer, fromWallet);

    // 增加接收方金币
    toWallet.gold += amount;
    this.db.set(toPlayer, toWallet);

    // 记录交易
    this.logTransaction(fromPlayer, toPlayer, amount, reason);

    return true;
  }

  // 计算领地价格
  calculateLandPrice(start: Vector3, end: Vector3): number {
    const xSize = Math.abs(end.x - start.x) + 1;
    const ySize = Math.abs(end.y - start.y) + 1;
    const zSize = Math.abs(end.z - start.z) + 1;

    const totalBlocks = xSize * ySize * zSize;
    console.warn(`计算领地价格: ${totalBlocks} * ${Number(setting.getState("land1BlockPerPrice"))}`);
    return totalBlocks * Number(setting.getState("land1BlockPerPrice"));
  }

  // 记录交易日志
  private logTransaction(from: string, to: string, amount: number, reason: string): void {
    const transaction: ITransaction = {
      timestamp: Date.now(),
      from,
      to,
      amount,
      reason,
    };

    // 获取现有日志
    let logs = this.logDb.get("transactions") || [];
    logs.push(transaction);

    // 限制日志大小，防止过大
    if (logs.length > 1000) {
      logs = logs.slice(logs.length - 1000);
    }

    this.logDb.set("transactions", logs);
  }

  // 设置玩家金币
  setPlayerGold(playerName: string, amount: number): boolean {
    if (amount < 0) return false;

    const wallet = this.getWallet(playerName);
    wallet.gold = amount;
    this.db.set(playerName, wallet);

    return true;
  }

  // 获取玩家交易记录
  getPlayerTransactions(playerName: string, limit: number = 10): ITransaction[] {
    const allLogs = this.logDb.get("transactions") || [];

    return allLogs
      .filter((log) => log.from === playerName || log.to === playerName)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * 获取玩家今日已获得的金币数量
   */
  getDailyEarned(name: string): number {
    const wallet = this.getWallet(name);
    return wallet.dailyEarned;
  }

  /**
   * 获取每日金币获取上限
   */
  getDailyGoldLimit(): number {
    return this.DAILY_GOLD_LIMIT;
  }

  /**
   * 获取玩家今日剩余可获得的金币数量
   */
  getRemainingDailyLimit(name: string): number {
    const wallet = this.getWallet(name);
    return Math.max(0, this.DAILY_GOLD_LIMIT - wallet.dailyEarned);
  }

  /**
   * 设置全局每日金币获取上限
   * @param limit 新的上限值
   */
  setGlobalDailyLimit(limit: number): void {
    if (limit < 0) return;
    this.DAILY_GOLD_LIMIT = limit;

    // 将此设置保存到配置数据库中，以便服务器重启后保持设置
    setting.setState("daily_gold_limit", limit.toString());
  }

  /**
   * 重置所有玩家的每日金币获取记录
   */
  resetAllDailyEarnings(): void {
    const allWallets = this.db.getAll() as Record<string, IUserWallet>;
    const today = this.getCurrentDateString();

    for (const [name, wallet] of Object.entries(allWallets)) {
      wallet.dailyEarned = 0;
      wallet.lastResetDate = today;
      this.db.set(name, wallet);
    }
  }

  /**
   * 重置特定玩家的每日金币获取记录
   * @param playerName 玩家名称
   */
  resetPlayerDailyEarnings(playerName: string): void {
    const wallet = this.getWallet(playerName);
    wallet.dailyEarned = 0;
    wallet.lastResetDate = this.getCurrentDateString();
    this.db.set(playerName, wallet);
  }
}

const economic = Economic.getInstance();
export default economic;
