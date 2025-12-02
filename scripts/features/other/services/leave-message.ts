/**
 * 留言系统服务
 * 完整迁移自 Modules/OtherFun/LeaveMessage.ts (46行)
 */

import { Player, system } from "@minecraft/server";
import { Database } from "../../../shared/database/database";

interface ILeaveMessage {
  id: string;
  title: string;
  content: string;
  creator: string;
  time: string;
}

/**
 * 获取当前日期时间字符串
 */
function getNowDate(): string {
  const now = new Date();
  return now.toLocaleString("zh-CN");
}

class LeaveMessage {
  private db!: Database<ILeaveMessage>;

  constructor() {
    system.run(() => {
      this.db = new Database<ILeaveMessage>("leaveMessage");
    });
  }

  getLeaveMessages(): ILeaveMessage[] {
    return this.db.values();
  }

  getPlayerLeaveMessages(player: Player): ILeaveMessage[] {
    return this.getLeaveMessages().filter((lm) => lm.creator === player.name);
  }

  createLeaveMessage(leaveMessage: Omit<ILeaveMessage, "id" | "time">): void | string {
    if (!leaveMessage.title || !leaveMessage.content) return "参数错误";
    const id = Date.now().toString();
    return this.db.set(id, {
      id,
      time: getNowDate(),
      ...leaveMessage,
    });
  }

  deleteLeaveMessage(id: string): boolean | string {
    if (!this.db.has(id)) return "该留言不存在";
    return this.db.delete(id);
  }
}

export default new LeaveMessage();
