/**
 * 经济系统服务
 * 完整迁移自 Modules/Economic/Economic.ts (564行)
 */

import { Player, system, Vector3, world } from "@minecraft/server";
import { Database } from "../../../shared/database/database";
import { usePlayerByName } from "../../../shared/hooks/use-player";
import setting from "../../system/services/setting";
import { colorCodes } from "../../../shared/utils/color";
import type { IUserWallet, IUserWalletWithDailyLimit, ITransaction } from "../models/economic.model";

export class Economic {
  private db!: Database<IUserWallet>;
  private logDb!: Database<ITransaction[]>;
  private static instance: Economic;
  private DEFAULT_GOLD = 500;
  private DAILY_GOLD_LIMIT = 100000;

  private constructor() {
    system.run(() => {
      this.db = new Database<IUserWallet>("eco_wallets");
      this.logDb = new Database<ITransaction[]>("eco_transactions");

      this.DAILY_GOLD_LIMIT = Number(setting.getState("daily_gold_limit"));
      this.DEFAULT_GOLD = Number(setting.getState("startingGold"));

      this.fixInvalidGoldData();
    });

    this.setupDailyReset();
  }

  static getInstance(): Economic {
    if (!Economic.instance) {
      Economic.instance = new Economic();
    }
    return Economic.instance;
  }

  private setupDailyReset(): void {
    system.runInterval(() => {
      this.checkAndResetDailyLimits();
    }, 1200);
  }

  private checkAndResetDailyLimits(): void {
    const today = this.getCurrentDateString();
    const allWallets = this.db.getAll() as Record<string, IUserWalletWithDailyLimit>;

    for (const [name, wallet] of Object.entries(allWallets)) {
      if (wallet.lastResetDate !== today) {
        wallet.dailyEarned = 0;
        wallet.lastResetDate = today;
        wallet.dailyLimitNotifyCount = 0;
        this.db.set(name, wallet);
      }
    }
  }

  private getCurrentDateString(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

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

  getWallet(playerName: string): IUserWalletWithDailyLimit {
    let wallet = this.db.get(playerName) as IUserWalletWithDailyLimit;
    if (!wallet) {
      wallet = this.initWallet(playerName);
    }

    if (wallet.dailyEarned === undefined) {
      wallet.dailyEarned = 0;
      wallet.lastResetDate = this.getCurrentDateString();
      this.db.set(playerName, wallet);
    }

    if (wallet.lastResetDate !== this.getCurrentDateString()) {
      wallet.dailyEarned = 0;
      wallet.lastResetDate = this.getCurrentDateString();
      this.db.set(playerName, wallet);
    }

    let needsFix = false;
    if (isNaN(wallet.gold) || !isFinite(wallet.gold) || wallet.gold === null || wallet.gold === undefined) {
      console.warn(`检测到玩家 ${playerName} 的金币数据无效，将重置为默认值`);
      wallet.gold = this.DEFAULT_GOLD;
      needsFix = true;
    }

    if (
      isNaN(wallet.dailyEarned) ||
      !isFinite(wallet.dailyEarned) ||
      wallet.dailyEarned === null ||
      wallet.dailyEarned === undefined
    ) {
      console.warn(`检测到玩家 ${playerName} 的每日获取量数据无效，将重置为0`);
      wallet.dailyEarned = 0;
      needsFix = true;
    }

    if (wallet.gold < 0) {
      wallet.gold = this.DEFAULT_GOLD;
      needsFix = true;
    }

    if (wallet.dailyEarned < 0) {
      wallet.dailyEarned = 0;
      needsFix = true;
    }

    if (needsFix) {
      this.db.set(playerName, wallet);
    }

    return wallet;
  }

  getAllWallets(): IUserWallet[] {
    const allPlayerWallets = this.db.getAll();
    return Object.values(allPlayerWallets);
  }

  getTopWallets(limit: number = 10): IUserWallet[] {
    const allWallets = this.getAllWallets();
    return allWallets.sort((a, b) => b.gold - a.gold).slice(0, limit);
  }

  private isEconomyEnabled(): boolean {
    return setting.getState("economy") === true;
  }

  addGold(playerName: string, amount: number, reason: string, ignoreDailyLimit: boolean = false): number {
    if (!this.isEconomyEnabled()) return 0;

    if (isNaN(amount) || !isFinite(amount) || amount <= 0) {
      console.warn(`尝试添加无效的金币数量: ${amount} 给玩家: ${playerName}`);
      return 0;
    }

    const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
    if (amount > MAX_SAFE_INTEGER) {
      console.warn(`添加金币数量超过最大安全整数范围: ${amount}`);
      return 0;
    }

    const wallet = this.getWallet(playerName);

    if (!ignoreDailyLimit) {
      if (reason.includes("玩家转账") || reason.includes("购买玩家商店物品")) {
        ignoreDailyLimit = true;
      }

      if (!ignoreDailyLimit && wallet.dailyEarned >= this.DAILY_GOLD_LIMIT) {
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
            wallet.dailyLimitNotifyCount++;
            this.db.set(playerName, wallet);
          }
        }
        return 0;
      }

      const remainingLimit = this.DAILY_GOLD_LIMIT - wallet.dailyEarned;
      if (!ignoreDailyLimit && amount > remainingLimit) {
        amount = remainingLimit;
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
            wallet.dailyLimitNotifyCount++;
            this.db.set(playerName, wallet);
          }
        }
      }
    }

    wallet.gold += amount;

    if (!ignoreDailyLimit) {
      wallet.dailyEarned += amount;
    }

    this.db.set(playerName, wallet);
    this.logTransaction("system", playerName, amount, reason);

    return amount;
  }

  removeGold(playerName: string, amount: number, reason: string = "系统消费"): boolean {
    if (!this.isEconomyEnabled()) return true;

    if (isNaN(amount) || !isFinite(amount) || amount <= 0) {
      console.warn(`尝试扣除无效的金币数量: ${amount} 从玩家: ${playerName}`);
      return false;
    }

    const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
    if (amount > MAX_SAFE_INTEGER) {
      console.warn(`扣除金币数量超过最大安全整数范围: ${amount}`);
      return false;
    }

    const wallet = this.getWallet(playerName);
    if (wallet.gold < amount) return false;

    wallet.gold -= amount;
    this.db.set(playerName, wallet);
    this.logTransaction(playerName, "system", amount, reason);

    return true;
  }

  hasEnoughGold(playerName: string, amount: number): boolean {
    return this.getWallet(playerName).gold >= amount;
  }

  transfer(fromPlayer: string, toPlayer: string, amount: number, reason: string = "转账"): string | boolean {
    if (!this.isEconomyEnabled()) return true;

    if (isNaN(amount) || !isFinite(amount) || amount <= 0) {
      console.warn(`尝试转账无效的金币数量: ${amount}`);
      return "无效金额";
    }

    const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
    if (amount > MAX_SAFE_INTEGER) {
      console.warn(`转账金币数量超过最大安全整数范围: ${amount}`);
      return "转账金额过大";
    }

    if (fromPlayer === toPlayer) return "不能给自己转账";

    const fromWallet = this.getWallet(fromPlayer);
    if (fromWallet.gold < amount) return "余额不足";

    const toWallet = this.getWallet(toPlayer);

    fromWallet.gold -= amount;
    this.db.set(fromPlayer, fromWallet);

    toWallet.gold += amount;
    this.db.set(toPlayer, toWallet);

    this.logTransaction(fromPlayer, toPlayer, amount, reason);

    return true;
  }

  calculateLandPrice(start: Vector3, end: Vector3): number {
    const xSize = Math.abs(end.x - start.x) + 1;
    const ySize = Math.abs(end.y - start.y) + 1;
    const zSize = Math.abs(end.z - start.z) + 1;

    const totalBlocks = xSize * ySize * zSize;
    return totalBlocks * Number(setting.getState("land1BlockPerPrice"));
  }

  private logTransaction(from: string, to: string, amount: number, reason: string): void {
    const transaction: ITransaction = {
      timestamp: Date.now(),
      from,
      to,
      amount,
      reason,
    };

    let logs = this.logDb.get("transactions") || [];
    logs.push(transaction);

    if (logs.length > 1000) {
      logs = logs.slice(logs.length - 1000);
    }

    this.logDb.set("transactions", logs);
  }

  setPlayerGold(playerName: string, amount: number): boolean {
    if (isNaN(amount) || !isFinite(amount) || amount < 0) {
      console.warn(`尝试设置无效的金币数量: ${amount}`);
      return false;
    }

    const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
    if (amount > MAX_SAFE_INTEGER) {
      console.warn(`金币数量超过最大安全整数范围: ${amount}`);
      return false;
    }

    if (!Number.isInteger(amount)) {
      console.warn(`金币数量必须为整数: ${amount}`);
      return false;
    }

    const wallet = this.getWallet(playerName);
    wallet.gold = amount;
    this.db.set(playerName, wallet);

    return true;
  }

  getPlayerTransactions(playerName: string, limit: number = 10): ITransaction[] {
    const allLogs = this.logDb.get("transactions") || [];

    return allLogs
      .filter((log) => log.from === playerName || log.to === playerName)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  getDailyEarned(name: string): number {
    const wallet = this.getWallet(name);
    return wallet.dailyEarned;
  }

  getDailyGoldLimit(): number {
    return this.DAILY_GOLD_LIMIT;
  }

  getRemainingDailyLimit(name: string): number {
    const wallet = this.getWallet(name);
    return Math.max(0, this.DAILY_GOLD_LIMIT - wallet.dailyEarned);
  }

  setGlobalDailyLimit(limit: number): void {
    if (limit < 0) return;
    this.DAILY_GOLD_LIMIT = limit;
    setting.setState("daily_gold_limit", limit.toString());
  }

  resetAllDailyEarnings(): void {
    const allWallets = this.db.getAll() as Record<string, IUserWallet>;
    const today = this.getCurrentDateString();

    for (const [name, wallet] of Object.entries(allWallets)) {
      wallet.dailyEarned = 0;
      wallet.lastResetDate = today;
      this.db.set(name, wallet);
    }
  }

  resetPlayerDailyEarnings(playerName: string): void {
    const wallet = this.getWallet(playerName);
    wallet.dailyEarned = 0;
    wallet.lastResetDate = this.getCurrentDateString();
    this.db.set(playerName, wallet);
  }

  fixInvalidGoldData(): void {
    const allWallets = this.db.getAll() as Record<string, IUserWalletWithDailyLimit>;
    let fixedCount = 0;

    for (const [name, wallet] of Object.entries(allWallets)) {
      let needsFix = false;

      if (isNaN(wallet.gold) || !isFinite(wallet.gold) || wallet.gold === null || wallet.gold === undefined) {
        console.warn(`检测到玩家 ${name} 的金币数据无效，将重置为默认值`);
        wallet.gold = this.DEFAULT_GOLD;
        needsFix = true;
      }

      if (
        isNaN(wallet.dailyEarned) ||
        !isFinite(wallet.dailyEarned) ||
        wallet.dailyEarned === null ||
        wallet.dailyEarned === undefined
      ) {
        console.warn(`检测到玩家 ${name} 的每日获取量数据无效，将重置为0`);
        wallet.dailyEarned = 0;
        needsFix = true;
      }

      if (wallet.gold < 0) {
        wallet.gold = this.DEFAULT_GOLD;
        needsFix = true;
      }

      if (wallet.dailyEarned < 0) {
        wallet.dailyEarned = 0;
        needsFix = true;
      }

      if (needsFix) {
        this.db.set(name, wallet);
        fixedCount++;
      }
    }

    if (fixedCount > 0) {
      console.warn(`修复了 ${fixedCount} 个玩家的无效金币数据`);
    }
  }
}

const economic = Economic.getInstance();
export default economic;
