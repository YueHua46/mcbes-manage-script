/**
 * 经济系统服务
 * 完整迁移自 Modules/Economic/Economic.ts (564行)
 */

import { Player, ScoreboardObjective, system, Vector3, world } from "@minecraft/server";
import { taskScheduler } from "../../platform/scheduler";
import { Database } from "../../../shared/database/database";
import { usePlayerByName } from "../../../shared/hooks/use-player";
import setting from "../../system/services/setting";
import { filterRealPlayerRecords, getOnlineRealPlayers } from "../../../shared/utils/online-players";
import { colorCodes } from "../../../shared/utils/color";
import { formatDateOnlyBeijing } from "../../../shared/utils/datetime-beijing";
import identityService from "../../player/services/identity-service";
import type { IUserWallet, IUserWalletWithDailyLimit, ITransaction } from "../models/economic.model";

export const PLAYER_MARKET_PURCHASE_REASON = "购买玩家交易市场商品";
export const MONEY_SCOREBOARD_OBJECTIVE = "yuehua_money";
export const MONEY_SCOREBOARD_MAX = 2_147_483_647;
export const MONEY_SCOREBOARD_MIN = -2_147_483_648;

const MONEY_SCOREBOARD_ADJUST_REASON = "原版计分板调整";

export class Economic {
  private db!: Database<IUserWallet>;
  private logDb!: Database<ITransaction[]>;
  private static instance: Economic;
  private DEFAULT_GOLD = 500;
  private DAILY_GOLD_LIMIT = 100000;
  private readonly lastSyncedScores = new Map<string, number>();

  private constructor() {
    system.run(() => {
      this.db = new Database<IUserWallet>("eco_wallets");
      this.logDb = new Database<ITransaction[]>("eco_transactions");

      this.DAILY_GOLD_LIMIT = Number(setting.getState("daily_gold_limit"));
      this.DEFAULT_GOLD = Number(setting.getState("startingGold"));
      this.syncDailyGoldLimitFromSetting();

      this.fixInvalidGoldData();
    });

    this.setupDailyReset();
    this.setupScoreboardBridge();
  }

  static getInstance(): Economic {
    if (!Economic.instance) {
      Economic.instance = new Economic();
    }
    return Economic.instance;
  }

  /** 金币余额属于交易数据，写入后必须立即落库。 */
  private saveWallet(key: string, wallet: IUserWallet): void {
    this.db.set(key, wallet);
    this.db.save();
    this.syncWalletToOnlinePlayer(wallet.name, wallet.gold);
  }

  private setupScoreboardBridge(): void {
    taskScheduler.register({
      id: "economy.moneyScoreboardBridge",
      label: "金币计分板双向同步",
      category: "economy",
      intervalTicks: 1,
      when: () => setting.getState("economy") === true,
      run: () => this.reconcileMoneyScoreboard(),
    });
  }

  private ensureMoneyObjective(): ScoreboardObjective {
    return (
      world.scoreboard.getObjective(MONEY_SCOREBOARD_OBJECTIVE) ??
      world.scoreboard.addObjective(MONEY_SCOREBOARD_OBJECTIVE, "金币")
    );
  }

  private toScoreboardGold(gold: number): number {
    return Math.max(this.getMinimumGold(), Math.min(MONEY_SCOREBOARD_MAX, Math.floor(gold)));
  }

  private getMinimumGold(): number {
    return setting.getState("deathGoldPenaltyAllowNegativeBalance") === true ? MONEY_SCOREBOARD_MIN : 0;
  }

  private syncWalletToOnlinePlayer(playerName: string, gold: number): void {
    const player = usePlayerByName(playerName);
    if (!player?.isValid) return;

    try {
      const score = this.toScoreboardGold(gold);
      this.ensureMoneyObjective().setScore(player, score);
      this.lastSyncedScores.set(player.id, score);
    } catch (error) {
      console.warn(`[Economy] 同步 ${playerName} 的金币计分板失败`, error);
    }
  }

  private importScoreboardGold(player: Player, observedScore: number): void {
    const nextGold = this.toScoreboardGold(observedScore);
    const storageKey = this.resolveWalletKey(player.name);
    const wallet = this.getWallet(player.name);
    const previousGold = wallet.gold;

    if (previousGold !== nextGold) {
      wallet.gold = nextGold;
      this.db.set(storageKey, wallet);
      this.db.save();

      const amount = Math.abs(nextGold - previousGold);
      if (amount > 0) {
        this.logTransaction(
          nextGold > previousGold ? "system" : player.name,
          nextGold > previousGold ? player.name : "system",
          amount,
          MONEY_SCOREBOARD_ADJUST_REASON
        );
      }
    }

    const objective = this.ensureMoneyObjective();
    if (observedScore !== nextGold) objective.setScore(player, nextGold);
    this.lastSyncedScores.set(player.id, nextGold);
  }

  private reconcileMoneyScoreboard(): void {
    if (!this.db || !this.logDb) return;

    const objective = this.ensureMoneyObjective();
    const onlineIds = new Set<string>();

    for (const player of getOnlineRealPlayers()) {
      onlineIds.add(player.id);
      const wallet = this.getWallet(player.name);
      const walletScore = this.toScoreboardGold(wallet.gold);
      const lastSyncedScore = this.lastSyncedScores.get(player.id);
      let observedScore: number | undefined;

      try {
        observedScore = objective.getScore(player);
      } catch {
        observedScore = undefined;
      }

      // 首次加入、计分板目标被重置或分数被删除时，以持久化钱包恢复分数。
      if (lastSyncedScore === undefined || observedScore === undefined) {
        objective.setScore(player, walletScore);
        this.lastSyncedScores.set(player.id, walletScore);
        continue;
      }

      // 与模组最后写入值不同，说明原版命令修改了分数；将变化导入钱包。
      if (observedScore !== lastSyncedScore) {
        this.importScoreboardGold(player, observedScore);
        continue;
      }

      // 计分板未被外部修改，但钱包发生了变化，将最新钱包余额导出。
      if (walletScore !== lastSyncedScore) {
        objective.setScore(player, walletScore);
        this.lastSyncedScores.set(player.id, walletScore);
      }
    }

    for (const playerId of this.lastSyncedScores.keys()) {
      if (!onlineIds.has(playerId)) this.lastSyncedScores.delete(playerId);
    }
  }

  private setupDailyReset(): void {
    taskScheduler.register({
      id: "economy.dailyReset",
      label: "经济每日限额重置",
      category: "economy",
      intervalTicks: 1200,
      when: () => setting.getState("economy") === true,
      run: () => this.checkAndResetDailyLimits(),
    });
  }

  private checkAndResetDailyLimits(): void {
    const today = this.getCurrentDateString();
    const allWallets = this.db.getAll() as Record<string, IUserWalletWithDailyLimit>;

    let changed = false;
    for (const [name, wallet] of Object.entries(allWallets)) {
      if (wallet.lastResetDate !== today) {
        wallet.dailyEarned = 0;
        wallet.lastResetDate = today;
        wallet.dailyLimitNotifyCount = 0;
        this.db.set(name, wallet);
        changed = true;
      }
    }
    if (changed) this.db.save();
  }

  private getCurrentDateString(): string {
    return formatDateOnlyBeijing(Date.now());
  }

  /** 与钱包每日重置、公会每日红包使用同一日历日（北京时间 YYYY-MM-DD） */
  getCalendarDateString(): string {
    return this.getCurrentDateString();
  }

  private resolveWalletKey(playerName: string): string {
    const profile = identityService.getProfileByName(playerName);
    if (!profile) return playerName;
    const identityKey = profile.id;
    if (this.db.get(identityKey)) return identityKey;

    const legacyKeys = [profile.currentName, ...profile.knownNames, playerName];
    const legacyKey = legacyKeys.find((key) => key !== identityKey && this.db.get(key));
    if (!legacyKey) return identityKey;

    const legacyWallet = this.db.get(legacyKey) as IUserWalletWithDailyLimit | undefined;
    if (!legacyWallet) return identityKey;

    const migratedWallet: IUserWalletWithDailyLimit = {
      ...legacyWallet,
      name: profile.currentName,
      identityId: identityKey,
    };
    this.db.set(identityKey, migratedWallet);
    for (const key of legacyKeys) {
      if (key !== identityKey && this.db.has(key)) {
        this.db.delete(key);
      }
    }
    this.db.save();
    return identityKey;
  }

  private getTransactionLookupKeys(playerName: string): Set<string> {
    const keys = new Set<string>([playerName]);
    const profile = identityService.getProfileByName(playerName);
    if (profile) {
      keys.add(profile.id);
      keys.add(profile.currentName);
      profile.knownNames.forEach((name) => keys.add(name));
    }
    return keys;
  }

  initWallet(name: string, storageKey: string = name): IUserWalletWithDailyLimit {
    const profile = identityService.getProfileByName(name);
    const wallet: IUserWalletWithDailyLimit = {
      name: profile?.currentName ?? name,
      identityId: profile?.id,
      gold: this.toScoreboardGold(this.DEFAULT_GOLD),
      dailyEarned: 0,
      lastResetDate: this.getCurrentDateString(),
      dailyLimitNotifyCount: 0,
    };
    this.saveWallet(storageKey, wallet);
    return wallet;
  }

  /**
   * 检查玩家是否有钱包数据（不自动创建）
   */
  hasWallet(playerName: string): boolean {
    const wallet = this.db.get(this.resolveWalletKey(playerName));
    return wallet !== undefined && wallet !== null;
  }

  getWallet(playerName: string): IUserWalletWithDailyLimit {
    const storageKey = this.resolveWalletKey(playerName);
    const profile = identityService.getProfileByName(playerName);
    let wallet = this.db.get(storageKey) as IUserWalletWithDailyLimit;
    if (!wallet) {
      wallet = this.initWallet(playerName, storageKey);
    }

    if (profile && (wallet.identityId !== profile.id || wallet.name !== profile.currentName)) {
      wallet.identityId = profile.id;
      wallet.name = profile.currentName;
      this.saveWallet(storageKey, wallet);
    }

    if (wallet.dailyEarned === undefined) {
      wallet.dailyEarned = 0;
      wallet.lastResetDate = this.getCurrentDateString();
      this.saveWallet(storageKey, wallet);
    }

    if (wallet.lastResetDate !== this.getCurrentDateString()) {
      wallet.dailyEarned = 0;
      wallet.lastResetDate = this.getCurrentDateString();
      this.saveWallet(storageKey, wallet);
    }

    let needsFix = false;
    if (isNaN(wallet.gold) || !isFinite(wallet.gold) || wallet.gold === null || wallet.gold === undefined) {
      console.warn(`检测到玩家 ${playerName} 的金币数据无效，将重置为默认值`);
      wallet.gold = this.toScoreboardGold(this.DEFAULT_GOLD);
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

    if (wallet.gold < this.getMinimumGold()) {
      wallet.gold = this.getMinimumGold();
      needsFix = true;
    }

    if (wallet.gold > MONEY_SCOREBOARD_MAX) {
      console.warn(`玩家 ${playerName} 的金币超过计分板整数上限，将调整为 ${MONEY_SCOREBOARD_MAX}`);
      wallet.gold = MONEY_SCOREBOARD_MAX;
      needsFix = true;
    }

    if (wallet.dailyEarned < 0) {
      wallet.dailyEarned = 0;
      needsFix = true;
    }

    if (needsFix) {
      this.saveWallet(storageKey, wallet);
    }

    return wallet;
  }

  getAllWallets(): IUserWallet[] {
    const allPlayerWallets = this.db.getAll();
    return filterRealPlayerRecords(Object.values(allPlayerWallets));
  }

  getTopWallets(limit: number = 10): IUserWallet[] {
    const allWallets = this.getAllWallets();
    return allWallets.sort((a, b) => b.gold - a.gold).slice(0, limit);
  }

  isEconomyEnabled(): boolean {
    return setting.getState("economy") === true;
  }

  private syncDailyGoldLimitFromSetting(): number {
    const configured = Number(setting.getState("daily_gold_limit"));
    const nextLimit = Number.isFinite(configured) && configured >= 0 ? Math.floor(configured) : 100000;
    this.DAILY_GOLD_LIMIT = nextLimit;
    return nextLimit;
  }

  addGold(playerName: string, amount: number, reason: string, ignoreDailyLimit: boolean = false): number {
    if (!this.isEconomyEnabled()) return 0;
    const dailyGoldLimit = this.syncDailyGoldLimitFromSetting();

    if (isNaN(amount) || !isFinite(amount) || amount <= 0) {
      console.warn(`尝试添加无效的金币数量: ${amount} 给玩家: ${playerName}`);
      return 0;
    }

    if (amount > MONEY_SCOREBOARD_MAX) {
      console.warn(`添加金币数量超过计分板整数上限: ${amount}`);
      return 0;
    }

    const wallet = this.getWallet(playerName);
    const remainingCapacity = MONEY_SCOREBOARD_MAX - wallet.gold;
    if (remainingCapacity <= 0) {
      console.warn(`玩家 ${playerName} 的金币已达到计分板整数上限`);
      return 0;
    }
    amount = Math.min(amount, remainingCapacity);

    if (!ignoreDailyLimit) {
      if (reason.includes("玩家转账") || reason.includes(PLAYER_MARKET_PURCHASE_REASON)) {
        ignoreDailyLimit = true;
      }

      if (!ignoreDailyLimit && wallet.dailyEarned >= this.DAILY_GOLD_LIMIT) {
        if (wallet.dailyLimitNotifyCount < 3) {
          const player = usePlayerByName(playerName);
          if (player) {
            player.sendMessage({
              rawtext: [
                {
                  text: `${colorCodes.red}您已达到今日金币获取上限 ${colorCodes.gold}${dailyGoldLimit} ${colorCodes.red}金币，无法获得更多金币！`,
                },
              ],
            });
            wallet.dailyLimitNotifyCount++;
            this.db.set(this.resolveWalletKey(playerName), wallet);
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
                  text: `${colorCodes.yellow}您已达到今日金币获取上限 ${colorCodes.gold}${dailyGoldLimit} ${colorCodes.yellow}金币！`,
                },
              ],
            });
            wallet.dailyLimitNotifyCount++;
            this.db.set(this.resolveWalletKey(playerName), wallet);
          }
        }
      }
    }

    wallet.gold += amount;

    if (!ignoreDailyLimit) {
      wallet.dailyEarned += amount;
    }

    this.saveWallet(this.resolveWalletKey(playerName), wallet);
    this.logTransaction("system", playerName, amount, reason);

    return amount;
  }

  removeGold(
    playerName: string,
    amount: number,
    reason: string = "系统消费",
    allowNegativeBalance: boolean = false
  ): boolean {
    if (!this.isEconomyEnabled()) return true;

    if (isNaN(amount) || !isFinite(amount) || amount <= 0) {
      console.warn(`尝试扣除无效的金币数量: ${amount} 从玩家: ${playerName}`);
      return false;
    }

    if (amount > MONEY_SCOREBOARD_MAX) {
      console.warn(`扣除金币数量超过计分板整数上限: ${amount}`);
      return false;
    }

    const wallet = this.getWallet(playerName);
    const canUseNegativeBalance =
      allowNegativeBalance && setting.getState("deathGoldPenaltyAllowNegativeBalance") === true;
    const minimumGold = canUseNegativeBalance ? MONEY_SCOREBOARD_MIN : 0;
    if (!canUseNegativeBalance && wallet.gold < amount) return false;

    const deductedAmount = Math.min(amount, wallet.gold - minimumGold);
    if (deductedAmount <= 0) return false;

    wallet.gold -= deductedAmount;
    this.saveWallet(this.resolveWalletKey(playerName), wallet);
    this.logTransaction(playerName, "system", deductedAmount, reason);

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

    if (amount > MONEY_SCOREBOARD_MAX) {
      console.warn(`转账金币数量超过计分板整数上限: ${amount}`);
      return "转账金额过大";
    }

    if (fromPlayer === toPlayer) return "不能给自己转账";

    const fromWallet = this.getWallet(fromPlayer);
    if (fromWallet.gold < amount) return "余额不足";

    const toWallet = this.getWallet(toPlayer);
    if (toWallet.gold > MONEY_SCOREBOARD_MAX - amount) return "收款方余额将超过金币上限";
    const fromKey = this.resolveWalletKey(fromPlayer);
    const toKey = this.resolveWalletKey(toPlayer);
    const fromGoldBefore = fromWallet.gold;
    const toGoldBefore = toWallet.gold;

    fromWallet.gold -= amount;
    try {
      this.db.set(fromKey, fromWallet);
      toWallet.gold += amount;
      this.db.set(toKey, toWallet);
      this.db.save();
      this.syncWalletToOnlinePlayer(fromPlayer, fromWallet.gold);
      this.syncWalletToOnlinePlayer(toPlayer, toWallet.gold);
    } catch (error) {
      fromWallet.gold = fromGoldBefore;
      toWallet.gold = toGoldBefore;
      try {
        this.db.set(fromKey, fromWallet);
        this.db.set(toKey, toWallet);
        this.db.save();
      } catch (rollbackError) {
        console.warn(`转账失败且回滚付款方失败: ${fromPlayer} -> ${toPlayer}`, rollbackError);
      }
      console.warn(`转账写入失败，已尝试回滚: ${fromPlayer} -> ${toPlayer}`, error);
      return "转账失败，请稍后重试";
    }

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

    try {
      this.logDb.set("transactions", logs);
      this.logDb.save();
    } catch (error) {
      // 余额已经成功落库时，日志失败不能让上层误判交易失败并重复退款。
      console.warn("交易日志持久化失败", error);
    }
  }

  setPlayerGold(playerName: string, amount: number): boolean {
    // 检查玩家是否有钱包数据（是否进过服务器）
    if (!this.hasWallet(playerName)) {
      console.warn(`玩家 ${playerName} 没有钱包数据，可能从未进入过服务器`);
      return false;
    }

    if (isNaN(amount) || !isFinite(amount) || amount < 0) {
      console.warn(`尝试设置无效的金币数量: ${amount}`);
      return false;
    }

    if (amount > MONEY_SCOREBOARD_MAX) {
      console.warn(`金币数量超过计分板整数上限: ${amount}`);
      return false;
    }

    if (!Number.isInteger(amount)) {
      console.warn(`金币数量必须为整数: ${amount}`);
      return false;
    }

    const wallet = this.getWallet(playerName);
    wallet.gold = amount;
    this.saveWallet(this.resolveWalletKey(playerName), wallet);

    return true;
  }

  getPlayerTransactions(playerName: string, limit: number = 10): ITransaction[] {
    const allLogs = this.logDb.get("transactions") || [];
    const lookupKeys = this.getTransactionLookupKeys(playerName);

    return allLogs
      .filter((log) => lookupKeys.has(log.from) || lookupKeys.has(log.to))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  getDailyEarned(name: string): number {
    const wallet = this.getWallet(name);
    return wallet.dailyEarned;
  }

  getDailyGoldLimit(): number {
    return this.syncDailyGoldLimitFromSetting();
  }

  getRemainingDailyLimit(name: string): number {
    const wallet = this.getWallet(name);
    return Math.max(0, this.syncDailyGoldLimitFromSetting() - wallet.dailyEarned);
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
    this.db.save();
  }

  resetPlayerDailyEarnings(playerName: string): void {
    const wallet = this.getWallet(playerName);
    wallet.dailyEarned = 0;
    wallet.lastResetDate = this.getCurrentDateString();
    this.saveWallet(this.resolveWalletKey(playerName), wallet);
  }

  fixInvalidGoldData(): void {
    const allWallets = this.db.getAll() as Record<string, IUserWalletWithDailyLimit>;
    let fixedCount = 0;

    for (const [name, wallet] of Object.entries(allWallets)) {
      let needsFix = false;

      if (isNaN(wallet.gold) || !isFinite(wallet.gold) || wallet.gold === null || wallet.gold === undefined) {
        console.warn(`检测到玩家 ${name} 的金币数据无效，将重置为默认值`);
        wallet.gold = this.toScoreboardGold(this.DEFAULT_GOLD);
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

      if (wallet.gold < this.getMinimumGold()) {
        wallet.gold = this.getMinimumGold();
        needsFix = true;
      }

      if (wallet.gold > MONEY_SCOREBOARD_MAX) {
        console.warn(`玩家 ${wallet.name || name} 的金币超过计分板整数上限，将调整为 ${MONEY_SCOREBOARD_MAX}`);
        wallet.gold = MONEY_SCOREBOARD_MAX;
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
      this.db.save();
      console.warn(`修复了 ${fixedCount} 个玩家的无效金币数据`);
    }
  }
}

const economic = Economic.getInstance();
export default economic;
