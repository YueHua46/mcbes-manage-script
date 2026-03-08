/**
 * 黑名单服务
 *
 * 数据库 key = xuid（稳定标识），value = IBlacklistEntry
 * 按名字查找时线性遍历（黑名单数量通常极小，可接受）
 */

import { system } from "@minecraft/server";
import { Database } from "../../../shared/database/database";
import { IBlacklistEntry } from "../../../core/types";
import { SystemLog } from "../../../shared/utils/common";

class BlacklistService {
  private db!: Database<IBlacklistEntry>;

  constructor() {
    system.run(() => {
      this.db = new Database<IBlacklistEntry>("blacklist");
    });
  }

  /**
   * 将玩家加入黑名单
   */
  add(name: string, xuid: string, persistentId: string | null, reason: string, bannedBy: string): void {
    const entry: IBlacklistEntry = {
      xuid,
      name,
      ...(persistentId ? { persistentId } : {}),
      reason: reason.trim(),
      bannedAt: Date.now(),
      bannedBy,
    };
    this.db.set(xuid, entry);
    SystemLog.info(`[Blacklist] 已将玩家 ${name}(xuid:${xuid}, persistentId:${persistentId ?? "未知"}) 加入黑名单，操作人: ${bannedBy}`);
  }

  /**
   * 按 xuid 移除黑名单记录
   */
  remove(xuid: string): boolean {
    if (!this.db.has(xuid)) return false;
    this.db.delete(xuid);
    SystemLog.info(`[Blacklist] 已移除 xuid: ${xuid} 的黑名单记录`);
    return true;
  }

  /**
   * 按玩家名移除黑名单记录（遍历查找对应 xuid 后删除）
   */
  removeByName(name: string): boolean {
    const entry = this.getByName(name);
    if (!entry) return false;
    return this.remove(entry.xuid);
  }

  /**
   * 按玩家名查找黑名单条目（O(n) 遍历）
   */
  getByName(name: string): IBlacklistEntry | undefined {
    const lowerName = name.toLowerCase();
    return this.db.values().find((entry) => entry.name.toLowerCase() === lowerName);
  }

  /**
   * 按 xuid 查找黑名单条目（O(1) 直接读取）
   */
  getByXuid(xuid: string): IBlacklistEntry | undefined {
    return this.db.has(xuid) ? this.db.get(xuid) : undefined;
  }

  /**
   * 更新黑名单中玩家的最新名字（玩家改名后同步）
   */
  updateName(xuid: string, newName: string): void {
    const entry = this.getByXuid(xuid);
    if (!entry) return;
    const updated: IBlacklistEntry = { ...entry, name: newName };
    this.db.set(xuid, updated);
    SystemLog.info(`[Blacklist] 已将 xuid: ${xuid} 的名字从 ${entry.name} 同步为 ${newName}`);
  }

  /**
   * 同步玩家的最新名字和 persistentId（改名或重装游戏后同步）
   */
  syncEntry(xuid: string, newName: string, newPersistentId: string | null): void {
    const entry = this.getByXuid(xuid);
    if (!entry) return;
    const nameChanged = entry.name !== newName;
    const pidChanged = newPersistentId !== null && entry.persistentId !== newPersistentId;
    if (!nameChanged && !pidChanged) return;
    const updated: IBlacklistEntry = {
      ...entry,
      name: newName,
      ...(newPersistentId ? { persistentId: newPersistentId } : {}),
    };
    this.db.set(xuid, updated);
    if (nameChanged) SystemLog.info(`[Blacklist] xuid:${xuid} 名字同步: ${entry.name} → ${newName}`);
    if (pidChanged) SystemLog.info(`[Blacklist] xuid:${xuid} persistentId 同步: ${entry.persistentId ?? "无"} → ${newPersistentId}`);
  }

  /**
   * 按 persistentId 查找黑名单条目（O(n) 遍历）
   */
  getByPersistentId(persistentId: string): IBlacklistEntry | undefined {
    return this.db.values().find((entry) => entry.persistentId === persistentId);
  }

  /**
   * 检查 persistentId 是否在黑名单中
   */
  isBlacklistedByPersistentId(persistentId: string): IBlacklistEntry | undefined {
    return this.getByPersistentId(persistentId);
  }

  /**
   * 获取所有黑名单条目
   */
  getAll(): IBlacklistEntry[] {
    return this.db.values();
  }

  /**
   * 检查 xuid 是否在黑名单中
   */
  isBlacklistedByXuid(xuid: string): IBlacklistEntry | undefined {
    return this.getByXuid(xuid);
  }

  /**
   * 检查玩家名是否在黑名单中
   */
  isBlacklistedByName(name: string): IBlacklistEntry | undefined {
    return this.getByName(name);
  }

  /**
   * 黑名单是否已有该 xuid 记录
   */
  has(xuid: string): boolean {
    return this.db.has(xuid);
  }
}

export default new BlacklistService();
