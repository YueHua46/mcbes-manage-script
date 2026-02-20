/**
 * 通知系统服务
 * 完整迁移自 Modules/Notify/Notify.ts (74行)
 */

import { system, world } from '@minecraft/server';
import { Database } from '../../../shared/database/database';

interface INotify {
  id: string;
  title: string;
  content: string;
  interval: number;
  time: string;
}

/**
 * 获取当前日期时间字符串
 */
function getNowDate(): string {
  const now = new Date();
  return now.toLocaleString('zh-CN');
}

class Notify {
  private db!: Database<INotify>;
  /** 当前进程的定时器 ID 映射（仅内存）。通知内容、间隔等仍持久化在 db，重启后会从 db 加载并重新创建定时器。runId 不存库是因为重启后旧进程的 runId 已无效。 */
  private runIdMap = new Map<string, number>();

  constructor() {
    system.run(() => {
      this.db = new Database<INotify>('notify');
      this.init();
    });
  }

  init(): void {
    this.getNotifys().forEach((n) => {
      const id = n.id;
      const oldRunId = this.runIdMap.get(id);
      if (oldRunId != null) {
        system.clearRun(oldRunId);
        this.runIdMap.delete(id);
      }
      // 旧数据迁移：去掉可能被持久化过的 runId，并修正非法 interval 写回库
      const obj = n as unknown as Record<string, unknown>;
      if (obj.runId !== undefined) {
        delete obj.runId;
      }
      const intervalTicks = this.normalizeIntervalTicks(n.interval);
      if (n.interval !== intervalTicks) {
        n.interval = intervalTicks;
        this.db.set(id, n);
      }
      const runId = system.runInterval(() => {
        world.sendMessage({
          rawtext: [
            { text: '§r§l§e[§6通知§e]§r§f ' + n.title + '§r\n' },
            { text: n.content },
          ],
        });
      }, intervalTicks);
      this.runIdMap.set(id, runId);
    });
  }

  /** 将间隔规范为合法 tick 数，避免 0/NaN 导致极频繁触发（如两三分钟就发） */
  private normalizeIntervalTicks(interval: number): number {
    const minTicks = 20; // 最少 1 秒
    const defaultTicks = 72000; // 默认 1 小时
    if (typeof interval !== 'number' || !Number.isFinite(interval) || interval < minTicks) {
      return defaultTicks;
    }
    return Math.max(minTicks, Math.floor(interval));
  }

  getNotifys(): INotify[] {
    return this.db.values();
  }

  /** 清空所有通知（初始化），用于删除旧遗留数据并停止所有定时器 */
  clearAllNotifys(): void {
    this.runIdMap.forEach((runId) => system.clearRun(runId));
    this.runIdMap.clear();
    this.db.clear();
    this.init();
  }

  createNotify(notify: Omit<INotify, 'id' | 'time'>): void | string {
    if (!notify.title || !notify.content) return '参数错误';
    const id = Date.now().toString();
    const interval = this.normalizeIntervalTicks(notify.interval);
    this.db.set(id, {
      id,
      time: getNowDate(),
      ...notify,
      interval,
    });
    return this.init();
  }

  deleteNotify(id: string): void | string {
    if (!this.db.has(id)) return '该通知不存在';
    const oldRunId = this.runIdMap.get(id);
    if (oldRunId != null) {
      system.clearRun(oldRunId);
      this.runIdMap.delete(id);
    }
    this.db.delete(id);
    return this.init();
  }

  updateNotify(id: string, notify: Partial<INotify>): void | string {
    if (!this.db.has(id)) return '该通知不存在';
    const oldRunId = this.runIdMap.get(id);
    if (oldRunId != null) {
      system.clearRun(oldRunId);
      this.runIdMap.delete(id);
    }
    const oldNotify = this.db.get(id);
    const next = { ...oldNotify, ...notify };
    if (typeof notify.interval === 'number') {
      next.interval = this.normalizeIntervalTicks(notify.interval);
    }
    this.db.set(id, next);
    return this.init();
  }
}

export default new Notify();

