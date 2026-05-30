import { Player, world, system } from "@minecraft/server";
import { Database } from "../../../shared/database/database";
import { formatDateTimeBeijing } from "../../../shared/utils/datetime-beijing";
import { generateId, isAdmin } from "../../../shared/utils/common";
import { color } from "../../../shared/utils/color";
import setting from "../../system/services/setting";
import economic from "../../economic/services/economic";

export type FeedbackType = "report" | "ticket";
export type FeedbackStatus = "open" | "processing" | "closed";

export interface IFeedbackEntry {
  id: string;
  type: FeedbackType;
  status: FeedbackStatus;
  submitter: string;
  title: string;
  content: string;
  targetPlayer?: string;
  createdAt: number;
  updatedAt: number;
  handler?: string;
  reply?: string;
}

export interface ICreateFeedbackInput {
  type: FeedbackType;
  submitter: Player;
  title: string;
  content: string;
  targetPlayer?: string;
}

const STAFF_TAG = "feedback_staff";

function getIntSetting(key: any, fallback: number, min: number, max: number): number {
  const parsed = Math.floor(Number(setting.getState(key)));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function normalizeText(value: string, maxLength: number): string {
  return Array.from(value.replace(/\r/g, "").trim()).slice(0, maxLength).join("");
}

function typeLabel(type: FeedbackType): string {
  return type === "report" ? "举报" : "工单";
}

class FeedbackService {
  private db!: Database<IFeedbackEntry>;

  constructor() {
    system.run(() => {
      this.db = new Database<IFeedbackEntry>("feedback_entries");
    });
  }

  canManage(player: Player): boolean {
    return isAdmin(player) || player.hasTag(STAFF_TAG) || setting.getState("feedbackAllowPublicView") === true;
  }

  getSubmitCost(): number {
    return getIntSetting("feedbackSubmitCost", 0, 0, 100000000);
  }

  getMaxContentLength(): number {
    return getIntSetting("feedbackMaxContentLength", 200, 20, 2000);
  }

  getMaxEntries(): number {
    return getIntSetting("feedbackMaxEntries", 300, 20, 2000);
  }

  getStaffTag(): string {
    return STAFF_TAG;
  }

  create(input: ICreateFeedbackInput): { ok: true; entry: IFeedbackEntry } | { ok: false; message: string } {
    if (setting.getState("feedback") !== true) {
      return { ok: false, message: "举报/工单系统暂未开启。" };
    }

    const maxContentLength = this.getMaxContentLength();
    const title = normalizeText(input.title, 40);
    const content = normalizeText(input.content, maxContentLength);
    const targetPlayer = normalizeText(input.targetPlayer ?? "", 32);

    if (!title) return { ok: false, message: "请填写标题。" };
    if (!content) return { ok: false, message: "请填写内容。" };
    if (input.type === "report" && !targetPlayer) return { ok: false, message: "举报需要填写被举报玩家。" };

    const cost = this.getSubmitCost();
    if (cost > 0 && !economic.removeGold(input.submitter.name, cost, `提交${typeLabel(input.type)}`)) {
      return { ok: false, message: `金币不足，提交一次需要 ${cost} 金币。` };
    }

    const now = Date.now();
    const entry: IFeedbackEntry = {
      id: generateId(),
      type: input.type,
      status: "open",
      submitter: input.submitter.name,
      title,
      content,
      targetPlayer: targetPlayer || undefined,
      createdAt: now,
      updatedAt: now,
    };

    this.db.set(entry.id, entry);
    this.pruneOldEntries();
    this.notifyManagers(entry);
    return { ok: true, entry };
  }

  listAll(): IFeedbackEntry[] {
    return this.db
      .values()
      .filter(Boolean)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  listBySubmitter(playerName: string): IFeedbackEntry[] {
    return this.listAll().filter((entry) => entry.submitter === playerName);
  }

  listForManage(type?: FeedbackType, status?: FeedbackStatus): IFeedbackEntry[] {
    return this.listAll().filter((entry) => {
      if (type && entry.type !== type) return false;
      if (status && entry.status !== status) return false;
      return true;
    });
  }

  get(id: string): IFeedbackEntry | undefined {
    return this.db.get(id);
  }

  setStatus(id: string, status: FeedbackStatus, handler: string, reply?: string): IFeedbackEntry | undefined {
    const entry = this.db.get(id);
    if (!entry) return undefined;

    const next: IFeedbackEntry = {
      ...entry,
      status,
      handler,
      updatedAt: Date.now(),
      reply: reply !== undefined ? normalizeText(reply, this.getMaxContentLength()) : entry.reply,
    };
    this.db.set(id, next);
    this.notifySubmitter(next);
    return next;
  }

  delete(id: string): boolean {
    return this.db.delete(id);
  }

  formatTime(timestamp: number): string {
    return formatDateTimeBeijing(timestamp);
  }

  formatType(type: FeedbackType): string {
    return typeLabel(type);
  }

  formatStatus(status: FeedbackStatus): string {
    switch (status) {
      case "open":
        return "待处理";
      case "processing":
        return "处理中";
      case "closed":
        return "已关闭";
    }
  }

  private notifyManagers(entry: IFeedbackEntry): void {
    const title = typeLabel(entry.type);
    for (const player of world.getAllPlayers()) {
      if (!this.canManage(player) || player.name === entry.submitter) continue;
      player.onScreenDisplay.setActionBar(`§e新的${title}: §f${entry.title} §7来自 ${entry.submitter}`);
      player.sendMessage(color.yellow(`[${title}] ${entry.submitter} 提交了新的${title}: ${entry.title}`));
    }
  }

  private notifySubmitter(entry: IFeedbackEntry): void {
    const player = world.getAllPlayers().find((p) => p.name === entry.submitter);
    if (!player) return;
    player.onScreenDisplay.setActionBar(
      `§e你的${typeLabel(entry.type)}已更新: §f${this.formatStatus(entry.status)}`
    );
    if (entry.reply) {
      player.sendMessage(color.green(`[${typeLabel(entry.type)}回复] ${entry.reply}`));
    }
  }

  private pruneOldEntries(): void {
    const maxEntries = this.getMaxEntries();
    const all = this.listAll();
    if (all.length <= maxEntries) return;

    all.slice(maxEntries).forEach((entry) => this.db.delete(entry.id));
  }
}

export default new FeedbackService();
