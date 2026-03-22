/**
 * 玩家全服红包：扣款、持久化、领取、过期退回
 * 份数与在线人数无关；有效期内任意玩家可各领一份，先到先得。
 */

import { Player, system, world } from "@minecraft/server";
import { Database } from "../../../shared/database/database";
import { color } from "../../../shared/utils/color";
import { formatDateTimeBeijing } from "../../../shared/utils/datetime-beijing";
import { SystemLog } from "../../../shared/utils/common";
import setting from "../../system/services/setting";
import economic from "./economic";
import type { IRedPacket, RedPacketMode } from "../models/red-packet.model";

/** 未配置时的默认有效时长：24 小时（毫秒） */
export const DEFAULT_RED_PACKET_EXPIRY_MS = 24 * 60 * 60 * 1000;

/** @deprecated 请使用 getRedPacketExpiryMs()，保留导出以兼容旧引用 */
export const RED_PACKET_EXPIRY_MS = DEFAULT_RED_PACKET_EXPIRY_MS;

const MIN_EXPIRY_HOURS = 1;
const MAX_EXPIRY_HOURS = 8760;

/**
 * 从系统设置读取红包有效时长（毫秒），由管理员在「系统设置」中配置小时数
 */
export function getRedPacketExpiryMs(): number {
  const raw = Number(setting.getState("redPacketExpiryHours"));
  let hours = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 24;
  if (hours < MIN_EXPIRY_HOURS) hours = MIN_EXPIRY_HOURS;
  if (hours > MAX_EXPIRY_HOURS) hours = MAX_EXPIRY_HOURS;
  return hours * 60 * 60 * 1000;
}

/** 扫描过期红包间隔（tick），60 秒 */
const SCAN_INTERVAL_TICKS = 1200;

export const MAX_SHARE_COUNT = 500;

export interface PendingRedPacketView {
  id: string;
  senderName: string;
  amount: number;
  expiresAt: number;
  message: string;
  mode: RedPacketMode;
  totalDeducted: number;
}

export interface CreateRedPacketInput {
  mode: RedPacketMode;
  /** 红包份数（与是否在线无关） */
  headCount: number;
  /** total 模式为总金额；per_head 为每份金额 */
  amount: number;
  message: string;
}

/** 红包列表（领取详细入口） */
export interface RedPacketListItem {
  id: string;
  senderName: string;
  mode: RedPacketMode;
  totalDeducted: number;
  expiresAt: number;
  createdAt: number;
  finished: boolean;
  message: string;
  shareCount: number;
  claimedCount: number;
  expired: boolean;
  /** 队列型（shareAmounts）；否则为旧版 recipients */
  isQueue: boolean;
}

export interface RedPacketClaimRow {
  playerName: string;
  amount: number;
  at?: number;
}

export interface RedPacketClaimDetailResult {
  item: RedPacketListItem;
  claims: RedPacketClaimRow[];
  /** 队列型：尚未被领走的份数 */
  remainingCount: number;
}

function generatePacketId(): string {
  return `${Date.now()}_${Math.floor(rngUniform01() * 1e9)}`;
}

/**
 * 基岩脚本里 Math.random() 在部分环境下会异常（近似恒为 0），拼手气拆份会退化成「每份都是 1」。
 * 用 tick、时间、调用盐与 Math.random 混合，避免单源失效。
 */
let __redPacketRngSalt = 0;

function rngUniform01(): number {
  __redPacketRngSalt = (__redPacketRngSalt + 1) % 2147483647;
  const a = Math.random();
  const b = (Date.now() % 1000000001) / 1000000001;
  const c = (system.currentTick % 100000) / 100000;
  const d = (__redPacketRngSalt % 100000) / 100000;
  const mix = a * 0.25 + b * 0.25 + c * 0.25 + d * 0.25;
  return mix - Math.floor(mix);
}

/**
 * 将总金额 T 均分给 names（排序后前 r 人多 1 金币）— 仅旧版/预览用
 */
export function splitTotalEqually(total: number, names: string[]): Record<string, number> {
  const n = names.length;
  if (n === 0) return {};
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  const base = Math.floor(total / n);
  const rem = total - base * n;
  const result: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    result[sorted[i]] = base + (i < rem ? 1 : 0);
  }
  return result;
}

/** Fisher–Yates 打乱「第 k 次领取」对应的金额（与 shareAmounts 下标顺序一致） */
function shuffleShareAmounts(shares: number[]): void {
  for (let i = shares.length - 1; i > 0; i--) {
    const j = Math.floor(rngUniform01() * (i + 1));
    const t = shares[i]!;
    shares[i] = shares[j]!;
    shares[j] = t;
  }
}

function randomIntInclusive(min: number, max: number): number {
  if (max < min) return min;
  const span = max - min + 1;
  return Math.floor(rngUniform01() * span) + min;
}

/**
 * 拼手气：总额 T 拆成 n 份正整数，每份 ≥1，总和为 T；再打乱顺序。
 * （与「整除余数」不同，可产生多种单份金额，更符合拼手气预期。）
 */
function buildRandomTotalShares(T: number, n: number): number[] {
  const shares: number[] = [];
  let remaining = T;
  for (let i = 0; i < n - 1; i++) {
    const maxShare = remaining - (n - i - 1);
    const share = randomIntInclusive(1, maxShare);
    shares.push(share);
    remaining -= share;
  }
  shares.push(remaining);
  shuffleShareAmounts(shares);
  return shares;
}

/**
 * 按份数生成每份金额（拼手气随机拆总额，或按份固定金额）
 * 发放时不绑定任何玩家；领取队列先到先得，与发放时谁在线无关。
 */
export function buildShareAmounts(
  mode: RedPacketMode,
  amount: number,
  shareCount: number
): { ok: true; totalDeducted: number; shares: number[] } | { ok: false; error: string } {
  const n = Math.floor(shareCount);
  if (!Number.isFinite(n) || n < 1) {
    return { ok: false, error: "红包份数须为正整数" };
  }
  if (n > MAX_SHARE_COUNT) {
    return { ok: false, error: `红包份数不能超过 ${MAX_SHARE_COUNT}` };
  }

  if (mode === "total") {
    const T = amount;
    if (T < n) {
      return {
        ok: false,
        error: `拼手气时总金额须不少于份数（每份至少 1 金币），当前 ${T} 金币 / ${n} 份`,
      };
    }
    const shares = buildRandomTotalShares(T, n);
    return { ok: true, totalDeducted: T, shares };
  }

  const per = amount;
  const totalDeducted = per * n;
  if (totalDeducted > Number.MAX_SAFE_INTEGER) {
    return { ok: false, error: "金额过大" };
  }
  return { ok: true, totalDeducted, shares: Array(n).fill(per) };
}

function isQueuePacket(packet: IRedPacket): boolean {
  return Array.isArray(packet.shareAmounts) && packet.shareAmounts.length > 0;
}

function isEconomyEnabled(): boolean {
  return setting.getState("economy") === true;
}

class RedPacketService {
  private db?: Database<IRedPacket>;

  constructor() {
    system.run(() => {
      this.db = new Database<IRedPacket>("eco_red_packets");
      system.runInterval(() => {
        try {
          this.processExpiredPackets();
        } catch (e) {
          SystemLog.error("红包过期处理失败", e);
        }
      }, SCAN_INTERVAL_TICKS);
    });
  }

  createPacket(sender: Player, input: CreateRedPacketInput): string | undefined {
    if (!isEconomyEnabled()) {
      return "经济系统未开启";
    }

    const db = this.db;
    if (!db) {
      return "数据未就绪，请稍后再试";
    }

    const rawAmount = Math.floor(Number(input.amount));
    if (!Number.isFinite(rawAmount) || rawAmount < 1) {
      return "请输入有效的正整数金额";
    }

    const built = buildShareAmounts(input.mode, rawAmount, input.headCount);
    if (!built.ok) {
      return built.error;
    }

    const totalDeducted = built.totalDeducted;

    if (!economic.hasEnoughGold(sender.name, totalDeducted)) {
      return `余额不足，需要 ${totalDeducted} 金币`;
    }

    const removed = economic.removeGold(sender.name, totalDeducted, "玩家红包发放");
    if (!removed) {
      return "扣款失败，请稍后重试";
    }

    const now = Date.now();
    const id = generatePacketId();
    const msg = (input.message ?? "").trim().slice(0, 80);
    const packet: IRedPacket = {
      id,
      senderName: sender.name,
      mode: input.mode,
      headCount: built.shares.length,
      totalDeducted,
      shareAmounts: built.shares,
      claimedBy: [],
      message: msg,
      createdAt: now,
      expiresAt: now + getRedPacketExpiryMs(),
      finished: false,
    };

    try {
      db.set(id, packet);
    } catch (e) {
      SystemLog.error("红包持久化失败", e);
      economic.addGold(sender.name, totalDeducted, "玩家红包发放失败回退", true);
      return "保存失败，金币已退回";
    }

    this.broadcastNewPacket(packet);
    return undefined;
  }

  private broadcastNewPacket(packet: IRedPacket): void {
    const n = packet.headCount ?? packet.shareAmounts?.length ?? Object.keys(packet.recipients ?? {}).length;
    const modeLine =
      packet.mode === "total"
        ? `${color.gray("模式:")} ${color.white("总金额均分")} ${color.gray("· 总金额")} ${color.gold(String(packet.totalDeducted))} ${color.gray("金币")}`
        : `${color.gray("模式:")} ${color.white("按份")} ${color.gray("· 每份")} ${color.gold(String(Math.floor(packet.totalDeducted / Math.max(1, n))))} ${color.gray("· 共扣")} ${color.gold(String(packet.totalDeducted))} ${color.gray("金币")}`;

    const expireStr = formatDateTimeBeijing(packet.expiresAt);
    const lines: string[] = [
      `${color.gold("§l═══════════════ §6全服红包 §e═══════════════§r")}`,
      `${color.yellow("§l【红包】§r")} ${color.aqua(packet.senderName)} ${color.gray("发了红包！")}`,
      modeLine,
      `${color.gray("份数:")} ${color.white(String(n))} ${color.gray("· 截止:")} ${color.green(expireStr)}`,
      `${color.gray("规则:")} ${color.white("不指定领取人，有效期内谁先领谁得")}`,
      `${color.gray("说明:")} ${color.white("每人每包限领一份；发时不必有人在线")}`,
    ];
    if (packet.message.length > 0) {
      lines.push(`${color.lightPurple("寄语:")} ${color.white(packet.message)}`);
    }
    lines.push(`${color.gray("────────────────────────────────")}`);
    lines.push(`${color.gray("领取方式:")} ${color.green("服务器菜单:")} ${color.white("经济系统 → 红包 → 待领红包")}`);
    lines.push(`${color.gold("§l═══════════════════════════════════§r")}`);

    const text = lines.join("\n");
    for (const p of world.getPlayers()) {
      p.sendMessage(text);
    }
  }

  /** 领取成功后在聊天里轻量广播一条（全服可见） */
  private broadcastClaimNotice(params: {
    claimerName: string;
    senderName: string;
    amount: number;
    packetFinished: boolean;
  }): void {
    const { claimerName, senderName, amount, packetFinished } = params;
    const tail = packetFinished ? ` ${color.gray("（该包已领完）")}` : "";
    const line = `${color.red("【红包】")} ${color.aqua(claimerName)} ${color.gray("领取了")} ${color.yellow(senderName)} ${color.gray("的红包 ·")} ${color.gold(String(amount))} ${color.gray("金币")}${tail}`;
    for (const p of world.getPlayers()) {
      p.sendMessage(line);
    }
  }

  private packetToListItem(packet: IRedPacket, now: number): RedPacketListItem | undefined {
    if (isQueuePacket(packet)) {
      const shares = packet.shareAmounts!;
      const claimed = packet.claimedBy ?? [];
      return {
        id: packet.id,
        senderName: packet.senderName,
        mode: packet.mode,
        totalDeducted: packet.totalDeducted,
        expiresAt: packet.expiresAt,
        createdAt: packet.createdAt,
        finished: packet.finished,
        message: packet.message,
        shareCount: shares.length,
        claimedCount: claimed.length,
        expired: now > packet.expiresAt,
        isQueue: true,
      };
    }
    if (packet.recipients && Object.keys(packet.recipients).length > 0) {
      const recs = Object.values(packet.recipients);
      const claimedCount = recs.filter((r) => r.claimed).length;
      return {
        id: packet.id,
        senderName: packet.senderName,
        mode: packet.mode,
        totalDeducted: packet.totalDeducted,
        expiresAt: packet.expiresAt,
        createdAt: packet.createdAt,
        finished: packet.finished,
        message: packet.message,
        shareCount: recs.length,
        claimedCount,
        expired: now > packet.expiresAt,
        isQueue: false,
      };
    }
    return undefined;
  }

  /** 领取详细：最近若干条红包（含已领完、已过期），按创建时间倒序 */
  listRedPacketsForDetail(limit = 40): RedPacketListItem[] {
    const db = this.db;
    if (!db) return [];
    const now = Date.now();
    const items: RedPacketListItem[] = [];
    for (const id of db.keys()) {
      const packet = db.get(id);
      if (!packet) continue;
      const item = this.packetToListItem(packet, now);
      if (item) items.push(item);
    }
    items.sort((a, b) => b.createdAt - a.createdAt);
    return items.slice(0, Math.max(1, Math.min(80, limit)));
  }

  /** 单包领取明细（谁领了多少；未领份数仅显示数量，不公开剩余每份金额） */
  getRedPacketClaimDetail(
    packetId: string
  ): { ok: true; data: RedPacketClaimDetailResult } | { ok: false; error: string } {
    const db = this.db;
    if (!db) return { ok: false, error: "数据未就绪" };
    const packet = db.get(packetId);
    if (!packet) return { ok: false, error: "记录不存在" };
    const now = Date.now();
    const item = this.packetToListItem(packet, now);
    if (!item) return { ok: false, error: "无法解析该红包" };

    if (isQueuePacket(packet)) {
      const shares = packet.shareAmounts!;
      const claimed = packet.claimedBy ?? [];
      const atMs = packet.claimAtMs ?? [];
      const claims: RedPacketClaimRow[] = [];
      for (let i = 0; i < claimed.length; i++) {
        claims.push({
          playerName: claimed[i]!,
          amount: shares[i]!,
          at: atMs[i],
        });
      }
      return {
        ok: true,
        data: {
          item,
          claims,
          remainingCount: Math.max(0, shares.length - claimed.length),
        },
      };
    }

    if (packet.recipients) {
      const claims: RedPacketClaimRow[] = [];
      for (const [name, r] of Object.entries(packet.recipients)) {
        if (r.claimed && r.amount >= 1) {
          claims.push({ playerName: name, amount: r.amount });
        }
      }
      claims.sort((a, b) => a.playerName.localeCompare(b.playerName));
      const remainingCount = Object.values(packet.recipients).filter((r) => !r.claimed && r.amount >= 1).length;
      return {
        ok: true,
        data: {
          item,
          claims,
          remainingCount,
        },
      };
    }

    return { ok: false, error: "无法解析该红包" };
  }

  getPendingPacketsFor(playerName: string): PendingRedPacketView[] {
    const db = this.db;
    if (!db) return [];

    const now = Date.now();
    const out: PendingRedPacketView[] = [];

    for (const id of db.keys()) {
      const packet = db.get(id);
      if (!packet || packet.finished) continue;
      if (now > packet.expiresAt) continue;

      if (isQueuePacket(packet)) {
        const shares = packet.shareAmounts!;
        const claimed = packet.claimedBy ?? [];
        if (claimed.length >= shares.length) continue;
        if (claimed.includes(playerName)) continue;
        const nextAmt = shares[claimed.length];
        out.push({
          id: packet.id,
          senderName: packet.senderName,
          amount: nextAmt,
          expiresAt: packet.expiresAt,
          message: packet.message,
          mode: packet.mode,
          totalDeducted: packet.totalDeducted,
        });
        continue;
      }

      const r = packet.recipients?.[playerName];
      if (!r || r.claimed || r.amount < 1) continue;

      out.push({
        id: packet.id,
        senderName: packet.senderName,
        amount: r.amount,
        expiresAt: packet.expiresAt,
        message: packet.message,
        mode: packet.mode,
        totalDeducted: packet.totalDeducted,
      });
    }

    return out.sort((a, b) => a.expiresAt - b.expiresAt);
  }

  countPendingFor(playerName: string): number {
    return this.getPendingPacketsFor(playerName).length;
  }

  claim(player: Player, packetId: string): string | undefined {
    if (!isEconomyEnabled()) {
      return "经济系统未开启";
    }

    const db = this.db;
    if (!db) {
      return "数据未就绪，请稍后再试";
    }

    const packet = db.get(packetId);
    if (!packet) return "红包不存在或已失效";

    if (packet.finished) return "该红包已结束";

    const now = Date.now();
    if (now > packet.expiresAt) return "该红包已过期";

    if (isQueuePacket(packet)) {
      const shares = packet.shareAmounts!;
      let claimed = packet.claimedBy ?? [];
      if (claimed.length >= shares.length) return "该红包已领完";
      if (claimed.includes(player.name)) return "你已领过该红包";

      const amt = shares[claimed.length];
      if (amt < 1) return "该份金额为 0";

      const added = economic.addGold(player.name, amt, "玩家红包领取", true);
      if (added < amt) {
        return "领取失败，请稍后重试";
      }

      claimed = [...claimed, player.name];
      packet.claimedBy = claimed;
      packet.claimAtMs = [...(packet.claimAtMs ?? []), Date.now()];

      if (claimed.length >= shares.length) {
        packet.finished = true;
      }

      db.set(packetId, packet);

      player.sendMessage(
        `${color.gold("§l【红包到账】§r")} ${color.gray("来自")} ${color.aqua(packet.senderName)} ${color.gray("·")} ${color.green("+")}${color.gold(String(amt))} ${color.gray("金币")}`
      );

      this.broadcastClaimNotice({
        claimerName: player.name,
        senderName: packet.senderName,
        amount: amt,
        packetFinished: claimed.length >= shares.length,
      });

      return undefined;
    }

    const rec = packet.recipients?.[player.name];
    if (!rec) return "该红包为旧版数据，你不在当时分配名单内，无法领取";

    if (rec.claimed) return "你已经领过该红包";

    const amt = rec.amount;
    if (amt < 1) return "可领取金额为 0";

    const added = economic.addGold(player.name, amt, "玩家红包领取", true);
    if (added < amt) {
      return "领取失败，请稍后重试";
    }

    rec.claimed = true;

    const allDone = Object.values(packet.recipients!).every((x) => x.claimed);
    if (allDone) {
      packet.finished = true;
    }

    db.set(packetId, packet);

    player.sendMessage(
      `${color.gold("§l【红包到账】§r")} ${color.gray("来自")} ${color.aqua(packet.senderName)} ${color.gray("·")} ${color.green("+")}${color.gold(String(amt))} ${color.gray("金币")}`
    );

    this.broadcastClaimNotice({
      claimerName: player.name,
      senderName: packet.senderName,
      amount: amt,
      packetFinished: allDone,
    });

    return undefined;
  }

  processExpiredPackets(): void {
    const db = this.db;
    if (!db) return;

    const now = Date.now();

    for (const id of db.keys()) {
      const packet = db.get(id);
      if (!packet || packet.finished) continue;
      if (now <= packet.expiresAt) continue;

      let unclaimed = 0;

      if (isQueuePacket(packet)) {
        const shares = packet.shareAmounts!;
        const claimed = packet.claimedBy ?? [];
        for (let i = claimed.length; i < shares.length; i++) {
          unclaimed += shares[i];
        }
      } else if (packet.recipients) {
        for (const rec of Object.values(packet.recipients)) {
          if (!rec.claimed) {
            unclaimed += rec.amount;
          }
        }
      }

      if (unclaimed > 0) {
        economic.addGold(packet.senderName, unclaimed, "玩家红包过期退回", true);
      }

      packet.finished = true;
      db.set(id, packet);
    }
  }
}

const redPacketService = new RedPacketService();
export default redPacketService;
