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

import { Entity, Player } from '@minecraft/server'
import { Database } from '../Database'
import { SystemLog } from '../../utils/utils'

export interface IUserWallet {
  name: string
  gold: number
}

export interface ITransactionLog {
  timestamp: number
  from: string
  to: string
  amount: number
  reason: string
}

class Economic {
  private readonly db: Database<IUserWallet>
  private readonly logDb: Database<ITransactionLog[]>
  private static instance: Economic

  // 默认配置
  public config = {
    startingGold: 500,         // 新玩家初始金币
    landPricePerBlock: 10,     // 每格领地价格
    mobKillRewards: {          // 不同怪物击杀奖励
      'minecraft:zombie': { min: 5, max: 10 },
      'minecraft:skeleton': { min: 7, max: 12 },
      'minecraft:creeper': { min: 10, max: 15 },
      'default': { min: 3, max: 8 }
    }
  }

  private constructor() {
    this.db = new Database<IUserWallet>('eco_wallets')
    this.logDb = new Database<ITransactionLog[]>('eco_transactions')
  }

  static getInstance(): Economic {
    if (!Economic.instance) {
      Economic.instance = new Economic()
    }
    return Economic.instance
  }

  // 获取玩家钱包，不存在则创建
  getWallet(playerName: string): IUserWallet {
    let wallet = this.db.get(playerName)

    if (!wallet) {
      wallet = {
        name: playerName,
        gold: this.config.startingGold
      }
      this.db.set(playerName, wallet)
    }

    return wallet
  }

  // 添加金币
  addGold(playerName: string, amount: number, reason: string = '系统奖励'): boolean {
    if (amount <= 0) return false

    const wallet = this.getWallet(playerName)
    wallet.gold += amount
    this.db.set(playerName, wallet)

    // 记录交易
    this.logTransaction('system', playerName, amount, reason)

    return true
  }

  // 扣除金币
  removeGold(playerName: string, amount: number, reason: string = '系统消费'): boolean {
    if (amount <= 0) return false

    const wallet = this.getWallet(playerName)
    if (wallet.gold < amount) return false

    wallet.gold -= amount
    this.db.set(playerName, wallet)

    // 记录交易
    this.logTransaction(playerName, 'system', amount, reason)

    return true
  }

  // 检查余额是否足够
  hasEnoughGold(playerName: string, amount: number): boolean {
    return this.getWallet(playerName).gold >= amount
  }

  // 转账
  transfer(fromPlayer: string, toPlayer: string, amount: number, reason: string = '转账'): boolean {
    if (amount <= 0 || fromPlayer === toPlayer) return false

    const fromWallet = this.getWallet(fromPlayer)
    if (fromWallet.gold < amount) return false

    const toWallet = this.getWallet(toPlayer)

    // 扣除发送方金币
    fromWallet.gold -= amount
    this.db.set(fromPlayer, fromWallet)

    // 增加接收方金币
    toWallet.gold += amount
    this.db.set(toPlayer, toWallet)

    // 记录交易
    this.logTransaction(fromPlayer, toPlayer, amount, reason)

    return true
  }

  // 计算领地价格
  calculateLandPrice(start: { x: number, y: number, z: number }, end: { x: number, y: number, z: number }): number {
    const xSize = Math.abs(end.x - start.x) + 1
    const ySize = Math.abs(end.y - start.y) + 1
    const zSize = Math.abs(end.z - start.z) + 1

    const totalBlocks = xSize * ySize * zSize
    return totalBlocks * this.config.landPricePerBlock
  }

  // 记录交易日志
  private logTransaction(from: string, to: string, amount: number, reason: string): void {
    const transaction: ITransactionLog = {
      timestamp: Date.now(),
      from,
      to,
      amount,
      reason
    }

    // 获取现有日志
    let logs = this.logDb.get('transactions') || []
    logs.push(transaction)

    // 限制日志大小，防止过大
    if (logs.length > 1000) {
      logs = logs.slice(logs.length - 1000)
    }

    this.logDb.set('transactions', logs)
  }

  // 获取玩家交易记录
  getPlayerTransactions(playerName: string, limit: number = 10): ITransactionLog[] {
    const allLogs = this.logDb.get('transactions') || []

    return allLogs
      .filter(log => log.from === playerName || log.to === playerName)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit)
  }
}

const economic = Economic.getInstance()
export default economic
