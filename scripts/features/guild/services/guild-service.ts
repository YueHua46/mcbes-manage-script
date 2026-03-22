/**
 * 公会核心服务：持久化、经济、索引、展示缓存
 */

import { Player, system } from "@minecraft/server";
import { Database } from "../../../shared/database/database";
import { color } from "../../../shared/utils/color";
import { isAdmin, SystemLog } from "../../../shared/utils/common";
import { usePlayerByName } from "../../../shared/hooks/use-player";
import { economic } from "../../economic";
import setting from "../../system/services/setting";
import { memberManager } from "../../system/services/trial-mode";
import behaviorLog, {
  GUILD_HISTORY_EVENT_TYPES,
  type BehaviorLogEntry,
} from "../../behavior-log/services/behavior-log";
import landManager from "../../land/services/land-manager";
import nameDisplay from "../../player/services/name-display";
import onlineTimeService, { formatOnlineDuration } from "../../player/services/online-time";
import wayPoint from "../../waypoint/services/waypoint";
import type { ILand } from "../../../core/types";
import type { IGuild, GuildRole, IPendingGuildInvite } from "../models/guild.model";
import { CURRENT_GUILD_SCHEMA_VERSION } from "../models/guild.model";
import { getGuildPlayerIndexDb } from "./guild-player-index-db";

const DB_GUILDS = "guilds";
const DB_INVITES = "guild_pending_invites";

const DISPLAY_CACHE_TTL_MS = 20000;
/** 与 behavior-log MAX_META_LENGTH 对齐 */
const GUILD_LOG_META_MAX = 80;

function genGuildId(): string {
  return `guild_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function stripSection(s: string): string {
  return s.replace(/§./g, "");
}

function parseWaypointDbKey(key: string): { playerName: string; pointName: string } | undefined {
  const i = key.indexOf(":");
  if (i < 1 || i >= key.length - 1) return undefined;
  return { playerName: key.slice(0, i), pointName: key.slice(i + 1) };
}

class GuildService {
  private guildsDb!: Database<IGuild>;
  private invitesDb!: Database<IPendingGuildInvite>;
  private displayCache = new Map<string, { guildId: string; tag: string; exp: number }>();

  /** 与 land-manager 等模块共用同一索引库实例 */
  private get indexDb(): Database<string> {
    return getGuildPlayerIndexDb();
  }

  constructor() {
    system.run(() => {
      this.guildsDb = new Database<IGuild>(DB_GUILDS);
      this.invitesDb = new Database<IPendingGuildInvite>(DB_INVITES);
    });
  }

  private ensureDbs(): boolean {
    return !!(this.guildsDb && this.indexDb && this.invitesDb);
  }

  isModuleEnabled(): boolean {
    return setting.getState("guild") === true;
  }

  private isEconomyOk(): boolean {
    return setting.getState("economy") === true;
  }

  private trialBlocksGuildFeatures(player: Player): boolean {
    if (!setting.getState("trialMode")) return false;
    if (isAdmin(player)) return false;
    if (player.hasTag("vip")) return false;
    if (memberManager.isMember(player.name)) return false;
    return true;
  }

  private numSetting(
    key:
      | "guildCreateCost"
      | "guildMaxMembers"
      | "guildTagMaxLen"
      | "guildNameMaxLen"
      | "guildInviteExpireSec"
      | "guildMaxLandsPerGuild"
      | "guildMaxWaypointsPerGuild"
  ): number {
    const raw = Number(setting.getState(key));
    if (!Number.isFinite(raw) || raw < 0) {
      const defaults: Record<typeof key, number> = {
        guildCreateCost: 100000,
        guildMaxMembers: 50,
        guildTagMaxLen: 6,
        guildNameMaxLen: 16,
        guildInviteExpireSec: 86400,
        guildMaxLandsPerGuild: 5,
        guildMaxWaypointsPerGuild: 20,
      };
      return defaults[key];
    }
    return Math.floor(raw);
  }

  invalidateDisplayCache(playerName?: string): void {
    if (playerName === undefined) {
      this.displayCache.clear();
      return;
    }
    this.displayCache.delete(playerName);
  }

  private cacheGet(name: string): { guildId: string; tag: string } | undefined {
    const row = this.displayCache.get(name);
    if (!row) return undefined;
    if (Date.now() > row.exp) {
      this.displayCache.delete(name);
      return undefined;
    }
    return { guildId: row.guildId, tag: row.tag };
  }

  private cacheSet(name: string, guildId: string, tag: string): void {
    this.displayCache.set(name, { guildId, tag, exp: Date.now() + DISPLAY_CACHE_TTL_MS });
  }

  getGuildIdForPlayerName(playerName: string): string | undefined {
    if (!this.ensureDbs() || !this.isModuleEnabled()) return undefined;
    const cached = this.cacheGet(playerName);
    if (cached) return cached.guildId;
    const gid = this.indexDb.get(playerName);
    if (typeof gid === "string" && gid.length > 0) {
      const g = this.guildsDb.get(gid);
      if (g && g.members[playerName]) {
        const mig = this.migrateGuild(g);
        if (mig) {
          this.cacheSet(playerName, gid, mig.tag);
          return gid;
        }
      }
      this.indexDb.delete(playerName);
    }
    return undefined;
  }

  private buildBracketTag(tag: string): string {
    return `${color.aqua("[")}${color.yellow(tag)}${color.aqua("]")}`;
  }

  /** 聊天行前缀用（受 guildShowTagInChat） */
  getGuildTagPrefixForChat(playerName: string): string | undefined {
    if (!this.ensureDbs() || !this.isModuleEnabled()) return undefined;
    if (setting.getState("guildShowTagInChat") !== true) return undefined;
    const cached = this.cacheGet(playerName);
    if (cached) return this.buildBracketTag(cached.tag);
    const gid = this.indexDb.get(playerName);
    if (typeof gid !== "string" || !gid) return undefined;
    const g = this.migrateGuild(this.guildsDb.get(gid));
    if (!g || !g.members[playerName]) {
      this.invalidateDisplayCache(playerName);
      return undefined;
    }
    this.cacheSet(playerName, gid, g.tag);
    return this.buildBracketTag(g.tag);
  }

  /** 头顶名称用（受 guildShowTagInName） */
  getGuildTagPrefixForNameTag(playerName: string): string | undefined {
    if (!this.ensureDbs() || !this.isModuleEnabled()) return undefined;
    if (setting.getState("guildShowTagInName") !== true) return undefined;
    const cached = this.cacheGet(playerName);
    if (cached) return this.buildBracketTag(cached.tag);
    const gid = this.indexDb.get(playerName);
    if (typeof gid !== "string" || !gid) return undefined;
    const g = this.migrateGuild(this.guildsDb.get(gid));
    if (!g || !g.members[playerName]) {
      this.invalidateDisplayCache(playerName);
      return undefined;
    }
    this.cacheSet(playerName, gid, g.tag);
    return this.buildBracketTag(g.tag);
  }

  private migrateGuild(raw: IGuild | undefined): IGuild | undefined {
    if (!raw) return undefined;
    let g = { ...raw };
    if (g.schemaVersion == null) g.schemaVersion = 1;
    if (g.treasuryGold == null || !Number.isFinite(g.treasuryGold)) g.treasuryGold = 0;
    if (g.treasuryGold < 0) g.treasuryGold = 0;
    if (g.members == null) g.members = {};
    for (const name of Object.keys(g.members)) {
      const m = g.members[name];
      if (m.treasuryContributedGold == null || !Number.isFinite(m.treasuryContributedGold)) {
        m.treasuryContributedGold = 0;
      } else if (m.treasuryContributedGold < 0) {
        m.treasuryContributedGold = 0;
      }
      if (m.lastDailyRedPacketDay != null && typeof m.lastDailyRedPacketDay !== "string") {
        delete m.lastDailyRedPacketDay;
      }
    }
    if (g.joinRequests == null) g.joinRequests = {};
    if (g.dailyRedPacketEnabled == null) g.dailyRedPacketEnabled = false;
    if (g.dailyRedPacketGoldPerMember == null || !Number.isFinite(g.dailyRedPacketGoldPerMember)) {
      g.dailyRedPacketGoldPerMember = 0;
    } else if (g.dailyRedPacketGoldPerMember < 0) {
      g.dailyRedPacketGoldPerMember = 0;
    } else {
      g.dailyRedPacketGoldPerMember = Math.floor(g.dailyRedPacketGoldPerMember);
    }
    if (g.dailyRedPacketBudgetDay != null && typeof g.dailyRedPacketBudgetDay !== "string") {
      delete g.dailyRedPacketBudgetDay;
    }
    if (g.dailyRedPacketBudgetSkipped != null && typeof g.dailyRedPacketBudgetSkipped !== "boolean") {
      g.dailyRedPacketBudgetSkipped = false;
    }
    if (g.schemaVersion < CURRENT_GUILD_SCHEMA_VERSION) {
      g.schemaVersion = CURRENT_GUILD_SCHEMA_VERSION;
      this.guildsDb.set(g.id, g);
    }
    return g;
  }

  private getGuild(gid: string): IGuild | undefined {
    return this.migrateGuild(this.guildsDb.get(gid));
  }

  /** UI：按公会 ID 读取（无则 undefined） */
  getGuildById(gid: string): IGuild | undefined {
    if (!this.ensureDbs()) return undefined;
    return this.getGuild(gid);
  }

  private saveGuild(g: IGuild): void {
    g.schemaVersion = CURRENT_GUILD_SCHEMA_VERSION;
    this.guildsDb.set(g.id, g);
  }

  private isNameTaken(nameNorm: string): boolean {
    const all = this.guildsDb.getAll() as Record<string, IGuild>;
    for (const g of Object.values(all)) {
      const gg = this.migrateGuild(g);
      if (gg && stripSection(gg.name).toLowerCase() === nameNorm.toLowerCase()) return true;
    }
    return false;
  }

  private isTagTaken(tagNorm: string): boolean {
    const all = this.guildsDb.getAll() as Record<string, IGuild>;
    for (const g of Object.values(all)) {
      const gg = this.migrateGuild(g);
      if (gg && gg.tag.toLowerCase() === tagNorm.toLowerCase()) return true;
    }
    return false;
  }

  private getRole(g: IGuild, name: string): GuildRole | undefined {
    return g.members[name]?.role;
  }

  /** 行为日志 meta：固定带 gid=，总长度截断 */
  private guildMeta(g: IGuild, tail: string): string {
    const t = stripSection(tail).trim();
    const base = `gid=${g.id}`;
    if (!t) return base.slice(0, GUILD_LOG_META_MAX);
    const s = `${base} ${t}`;
    return s.slice(0, GUILD_LOG_META_MAX);
  }

  /** 玩家加入任一公会后，从所有公会的待审申请中移除该玩家 */
  private removePendingJoinRequestsForPlayer(playerName: string): void {
    if (!this.ensureDbs()) return;
    const all = this.guildsDb.getAll() as Record<string, IGuild>;
    for (const raw of Object.values(all)) {
      const g = this.migrateGuild(raw);
      if (!g?.joinRequests?.[playerName]) continue;
      delete g.joinRequests[playerName];
      if (Object.keys(g.joinRequests).length === 0) delete g.joinRequests;
      this.saveGuild(g);
    }
  }

  private refreshNameTagsForGuild(guildId: string): void {
    const g = this.getGuild(guildId);
    if (!g) return;
    for (const n of Object.keys(g.members)) {
      this.invalidateDisplayCache(n);
      const p = usePlayerByName(n);
      if (p) nameDisplay.forceUpdatePlayerNameDisplay(p);
    }
  }

  private logGuild(
    playerName: string,
    type:
      | "guildCreate"
      | "guildJoin"
      | "guildLeave"
      | "guildKick"
      | "guildDisband"
      | "guildTreasuryDeposit"
      | "guildTreasuryWithdraw"
      | "guildPromote"
      | "guildInvite"
      | "guildApply"
      | "guildApplyApprove"
      | "guildApplyReject"
      | "guildDailyRedPacketGrant"
      | "guildDailyRedPacketSkipped",
    meta?: string
  ): void {
    try {
      behaviorLog.logGuildEvent(playerName, type, meta);
    } catch (_) {
      /* ignore */
    }
  }

  createGuild(player: Player, displayName: string, tag: string): string {
    if (!this.ensureDbs()) return "公会系统未就绪";
    if (!this.isModuleEnabled()) return "公会功能已关闭";
    if (!this.isEconomyOk()) return "经济系统已关闭，无法创建公会";

    const nameMax = this.numSetting("guildNameMaxLen");
    const tagMax = this.numSetting("guildTagMaxLen");
    const maxMembers = this.numSetting("guildMaxMembers");

    const nameClean = stripSection(displayName.trim()).slice(0, nameMax);
    const tagClean = stripSection(tag.trim()).slice(0, tagMax);
    if (nameClean.length < 1) return "公会名称无效";
    if (tagClean.length < 1) return "公会标签无效";
    if (this.trialBlocksGuildFeatures(player)) return "试玩期间无法创建公会";

    if (this.indexDb.has(player.name)) return "你已在公会中，请先退出";

    const minOnlineHours = Number(setting.getState("guildCreateMinOnlineHours" as never));
    const minH =
      Number.isFinite(minOnlineHours) && minOnlineHours > 0 ? Math.floor(minOnlineHours) : 0;
    if (minH > 0) {
      const needSec = minH * 3600;
      const haveSec = onlineTimeService.getDisplayTotalSeconds(player);
      if (haveSec < needSec) {
        return `累计在线不足，需要至少 ${minH} 小时（当前约 ${formatOnlineDuration(haveSec)}，含本段在线）`;
      }
    }

    const cost = this.numSetting("guildCreateCost");
    if (cost > 0) {
      if (!economic.hasEnoughGold(player.name, cost)) return `金币不足，需要 ${cost}`;
    }

    if (this.isNameTaken(nameClean)) return "该公会展示名已被使用";
    if (this.isTagTaken(tagClean)) return "该标签已被使用";

    const id = genGuildId();
    if (cost > 0) {
      const ok = economic.removeGold(player.name, cost, "guild:create");
      if (!ok) return "扣除创建费用失败";
    }

    const now = Date.now();
    const g: IGuild = {
      id,
      schemaVersion: CURRENT_GUILD_SCHEMA_VERSION,
      name: nameClean,
      tag: tagClean,
      ownerName: player.name,
      members: {
        [player.name]: { role: "owner", joinedAt: now },
      },
      treasuryGold: 0,
      createdAt: now,
      joinRequests: {},
    };
    this.saveGuild(g);
    this.indexDb.set(player.name, id);
    this.invalidateDisplayCache(player.name);
    nameDisplay.forceUpdatePlayerNameDisplay(player);
    this.logGuild(player.name, "guildCreate", this.guildMeta(g, `name=${nameClean} tag=${tagClean}`));
    return "";
  }

  /** 删除公会数据（坐标、领地绑定、成员索引、公会库）；不记行为日志 */
  private disbandGuildDataCore(g: IGuild): void {
    this.removeAllGuildWaypointsForGuild(g);
    this.clearAllLandsBoundToGuild(g);

    for (const n of Object.keys(g.members)) {
      this.indexDb.delete(n);
      this.invalidateDisplayCache(n);
      const p = usePlayerByName(n);
      if (p) nameDisplay.forceUpdatePlayerNameDisplay(p);
    }

    this.guildsDb.delete(g.id);
  }

  disbandGuild(player: Player): string {
    if (!this.ensureDbs()) return "公会系统未就绪";
    if (!this.isModuleEnabled()) return "公会功能已关闭";

    const gid = this.indexDb.get(player.name);
    if (!gid) return "你不在任何公会中";
    const g = this.getGuild(gid);
    if (!g) {
      this.indexDb.delete(player.name);
      return "公会数据异常，已清理你的索引";
    }
    if (g.ownerName !== player.name) return "只有会长可以解散公会";

    this.disbandGuildDataCore(g);
    this.logGuild(player.name, "guildDisband", this.guildMeta(g, ""));
    return "";
  }

  /** 管理员从服务器菜单强制解散公会（不检查公会模块总开关） */
  adminForceDisbandGuild(admin: Player, guildId: string): string {
    if (!isAdmin(admin)) return "只有管理员可操作";
    if (!this.ensureDbs()) return "公会系统未就绪";

    const gid = stripSection(guildId.trim());
    if (!gid) return "无效的公会 ID";
    const g = this.getGuild(gid);
    if (!g) return "公会不存在";

    this.disbandGuildDataCore(g);
    this.logGuild(admin.name, "guildDisband", this.guildMeta(g, "adminForce"));
    return "";
  }

  /** 管理员 UI：列出全部公会（按标签排序） */
  listAllGuildsForAdmin(): IGuild[] {
    if (!this.ensureDbs()) return [];
    const all = this.guildsDb.getAll() as Record<string, IGuild>;
    const list: IGuild[] = [];
    for (const raw of Object.values(all)) {
      const g = this.migrateGuild(raw);
      if (g) list.push(g);
    }
    list.sort((a, b) => a.tag.localeCompare(b.tag, undefined, { sensitivity: "base" }));
    return list;
  }

  invite(player: Player, targetName: string): string {
    if (!this.ensureDbs()) return "公会系统未就绪";
    if (!this.isModuleEnabled()) return "公会功能已关闭";

    const tname = stripSection(targetName.trim());
    if (!tname) return "请指定玩家名";
    if (tname === player.name) return "不能邀请自己";

    const gid = this.indexDb.get(player.name);
    if (!gid) return "你不在任何公会中";
    const g = this.getGuild(gid);
    if (!g) return "公会不存在";

    const role = this.getRole(g, player.name);
    if (role !== "owner" && role !== "officer") return "你没有邀请权限";

    if (Object.keys(g.members).length >= this.numSetting("guildMaxMembers")) return "公会人数已满";

    if (this.indexDb.has(tname)) return "该玩家已在其他公会中";

    const expSec = this.numSetting("guildInviteExpireSec");
    const inv: IPendingGuildInvite = {
      guildId: gid,
      byName: player.name,
      expiresAt: Date.now() + expSec * 1000,
    };
    this.invitesDb.set(tname, inv);
    this.logGuild(player.name, "guildInvite", this.guildMeta(g, `target=${tname}`));

    const online = usePlayerByName(tname);
    if (online) {
      online.sendMessage(
        `${color.green(`你收到来自 ${player.name} 的公会邀请`)} ${color.yellow(`[${g.tag}] ${g.name}`)} ${color.gray("请打开「服务器菜单」→「公会」处理邀请")}`
      );
    }
    return "";
  }

  acceptInvite(player: Player): string {
    if (!this.ensureDbs()) return "公会系统未就绪";
    if (!this.isModuleEnabled()) return "公会功能已关闭";

    const inv = this.invitesDb.get(player.name);
    if (!inv) return "没有待处理的公会邀请";
    if (Date.now() > inv.expiresAt) {
      this.invitesDb.delete(player.name);
      return "邀请已过期";
    }

    if (this.indexDb.has(player.name)) {
      this.invitesDb.delete(player.name);
      return "你已在公会中";
    }

    const g = this.getGuild(inv.guildId);
    if (!g) {
      this.invitesDb.delete(player.name);
      return "公会已不存在";
    }

    this.clearAllInvitesForPlayer(player.name);

    if (Object.keys(g.members).length >= this.numSetting("guildMaxMembers")) return "公会人数已满";

    g.members[player.name] = { role: "member", joinedAt: Date.now() };
    this.saveGuild(g);
    this.indexDb.set(player.name, g.id);
    this.invalidateDisplayCache(player.name);
    nameDisplay.forceUpdatePlayerNameDisplay(player);
    this.removePendingJoinRequestsForPlayer(player.name);
    this.logGuild(player.name, "guildJoin", this.guildMeta(g, ""));
    return "";
  }

  private clearAllInvitesForPlayer(inviteeName: string): void {
    this.invitesDb.delete(inviteeName);
  }

  declineInvite(player: Player): string {
    if (!this.ensureDbs()) return "公会系统未就绪";
    if (!this.invitesDb.has(player.name)) return "没有待处理的邀请";
    this.invitesDb.delete(player.name);
    return "";
  }

  leaveGuild(player: Player): string {
    if (!this.ensureDbs()) return "公会系统未就绪";
    const gid = this.indexDb.get(player.name);
    if (!gid) return "你不在任何公会中";
    const g = this.getGuild(gid);
    if (!g) {
      this.indexDb.delete(player.name);
      return "公会数据异常";
    }
    if (g.ownerName === player.name) return "会长请先转让会长或解散公会";

    delete g.members[player.name];
    this.saveGuild(g);
    this.indexDb.delete(player.name);
    this.invalidateDisplayCache(player.name);
    nameDisplay.forceUpdatePlayerNameDisplay(player);
    this.logGuild(player.name, "guildLeave", this.guildMeta(g, ""));
    return "";
  }

  kick(player: Player, targetName: string): string {
    if (!this.ensureDbs()) return "公会系统未就绪";
    const tname = stripSection(targetName.trim());
    if (!tname) return "请指定玩家";
    const gid = this.indexDb.get(player.name);
    if (!gid) return "你不在任何公会中";
    const g = this.getGuild(gid);
    if (!g) return "公会不存在";

    const actorRole = this.getRole(g, player.name);
    if (actorRole !== "owner" && actorRole !== "officer") return "无权踢人";

    if (!g.members[tname]) return "该成员不在本会";
    if (tname === g.ownerName) return "不能踢出会长";

    const targetRole = this.getRole(g, tname);
    if (actorRole === "officer" && targetRole !== "member") return "副会长只能踢出普通成员";

    delete g.members[tname];
    this.saveGuild(g);
    this.indexDb.delete(tname);
    this.invalidateDisplayCache(tname);
    const tp = usePlayerByName(tname);
    if (tp) nameDisplay.forceUpdatePlayerNameDisplay(tp);
    this.logGuild(player.name, "guildKick", this.guildMeta(g, `target=${tname}`));
    return "";
  }

  promote(player: Player, targetName: string): string {
    if (!this.ensureDbs()) return "公会系统未就绪";
    const tname = stripSection(targetName.trim());
    const gid = this.indexDb.get(player.name);
    if (!gid) return "你不在任何公会中";
    const g = this.getGuild(gid);
    if (!g || g.ownerName !== player.name) return "只有会长可以任免副会长";
    if (!g.members[tname]) return "该成员不存在";
    if (tname === g.ownerName) return "会长无需晋升";
    g.members[tname].role = "officer";
    this.saveGuild(g);
    this.logGuild(player.name, "guildPromote", this.guildMeta(g, `target=${tname} -> officer`));
    return "";
  }

  demote(player: Player, targetName: string): string {
    if (!this.ensureDbs()) return "公会系统未就绪";
    const tname = stripSection(targetName.trim());
    const gid = this.indexDb.get(player.name);
    if (!gid) return "你不在任何公会中";
    const g = this.getGuild(gid);
    if (!g || g.ownerName !== player.name) return "只有会长可以任免副会长";
    if (!g.members[tname]) return "该成员不存在";
    if (tname === g.ownerName) return "不能降职会长";
    g.members[tname].role = "member";
    this.saveGuild(g);
    this.logGuild(player.name, "guildPromote", this.guildMeta(g, `target=${tname} -> member`));
    return "";
  }

  transferOwnership(player: Player, targetName: string): string {
    if (!this.ensureDbs()) return "公会系统未就绪";
    const tname = stripSection(targetName.trim());
    if (!tname) return "请指定玩家";
    const gid = this.indexDb.get(player.name);
    if (!gid) return "你不在任何公会中";
    const g = this.getGuild(gid);
    if (!g) return "公会不存在";
    if (g.ownerName !== player.name) return "只有会长可以转让";
    if (!g.members[tname]) return "目标必须是本公会成员";
    if (tname === player.name) return "不能转让给自己";

    g.ownerName = tname;
    g.members[player.name].role = "officer";
    g.members[tname].role = "owner";
    this.saveGuild(g);
    this.refreshNameTagsForGuild(g.id);
    this.logGuild(player.name, "guildPromote", this.guildMeta(g, `transfer owner -> ${tname}`));
    return "";
  }

  treasuryDeposit(player: Player, amount: number): string {
    if (!this.ensureDbs()) return "公会系统未就绪";
    if (!this.isModuleEnabled()) return "公会功能已关闭";
    if (!this.isEconomyOk()) return "经济系统已关闭";

    if (!Number.isFinite(amount) || amount <= 0) return "金额无效";
    if (this.trialBlocksGuildFeatures(player)) return "试玩期间无法使用公会金库";

    const gid = this.indexDb.get(player.name);
    if (!gid) return "你不在任何公会中";
    const g = this.getGuild(gid);
    if (!g) return "公会不存在";

    if (!economic.hasEnoughGold(player.name, amount)) return "余额不足";

    const ok = economic.removeGold(player.name, amount, "guild:treasury:deposit");
    if (!ok) return "扣款失败";

    try {
      g.treasuryGold += amount;
      const mem = g.members[player.name];
      if (mem) {
        mem.treasuryContributedGold = (mem.treasuryContributedGold ?? 0) + amount;
      }
      this.saveGuild(g);
    } catch (e) {
      economic.addGold(player.name, amount, "guild:treasury:deposit:rollback", true);
      SystemLog.error("公会金库存入失败，已回滚", e);
      return "金库写入失败，已退款";
    }
    this.logGuild(player.name, "guildTreasuryDeposit", this.guildMeta(g, `+${amount}`));
    return "";
  }

  treasuryWithdraw(player: Player, amount: number): string {
    if (!this.ensureDbs()) return "公会系统未就绪";
    if (!this.isModuleEnabled()) return "公会功能已关闭";
    if (!this.isEconomyOk()) return "经济系统已关闭";

    if (!Number.isFinite(amount) || amount <= 0) return "金额无效";
    if (this.trialBlocksGuildFeatures(player)) return "试玩期间无法使用公会金库";

    const gid = this.indexDb.get(player.name);
    if (!gid) return "你不在任何公会中";
    const g = this.getGuild(gid);
    if (!g) return "公会不存在";

    const role = this.getRole(g, player.name);
    const allowOfficer = setting.getState("guildBankOfficerWithdraw") === true;
    if (role !== "owner" && !(allowOfficer && role === "officer")) return "无权取出金库";

    if (g.treasuryGold < amount) return "金库余额不足";

    g.treasuryGold -= amount;
    this.saveGuild(g);

    const added = economic.addGold(player.name, amount, "guild:treasury:withdraw", true);
    if (added <= 0) {
      g.treasuryGold += amount;
      this.saveGuild(g);
      return "发放金币失败，已恢复金库余额";
    }
    this.logGuild(player.name, "guildTreasuryWithdraw", this.guildMeta(g, `-${amount}`));
    return "";
  }

  /** 只读：某公会金库余额（无公会或异常时 0） */
  getTreasuryGoldByGuildId(guildId: string): number {
    if (!this.ensureDbs()) return 0;
    const g = this.getGuild(guildId);
    if (!g) return 0;
    return g.treasuryGold;
  }

  /**
   * 从公会金库扣款（系统用途：领地/坐标等），不经过个人钱包。
   * @returns 空串成功；否则错误提示
   */
  spendTreasuryForGuild(guildId: string, amount: number, actorName: string, meta: string): string {
    if (!this.ensureDbs()) return "公会系统未就绪";
    if (!this.isModuleEnabled()) return "公会功能已关闭";
    if (!Number.isFinite(amount) || amount <= 0) return "";
    const g = this.getGuild(guildId);
    if (!g) return "公会不存在";
    if (g.treasuryGold < amount) return `金库余额不足，需要 ${amount} 金币，当前 ${g.treasuryGold}`;
    g.treasuryGold -= amount;
    this.saveGuild(g);
    this.logGuild(actorName, "guildTreasuryWithdraw", this.guildMeta(g, meta));
    return "";
  }

  /** 扣款失败或领地写入失败后的回充（仅内部与 land-manager 动态调用） */
  refundTreasuryForGuild(guildId: string, amount: number): void {
    if (!this.ensureDbs() || !Number.isFinite(amount) || amount <= 0) return;
    const g = this.getGuild(guildId);
    if (!g) return;
    g.treasuryGold += amount;
    this.saveGuild(g);
  }

  private treasuryFeeSetting(
    key: "guildTreasuryCostLandCreate" | "guildTreasuryCostLandBind" | "guildTreasuryCostWaypointCreate"
  ): number {
    const raw = Number(setting.getState(key));
    if (!Number.isFinite(raw) || raw < 0) return 0;
    return Math.floor(raw);
  }

  printInfo(player: Player, query?: string): void {
    if (!this.ensureDbs()) return;
    let g: IGuild | undefined;
    if (query && query.trim()) {
      const q = stripSection(query.trim());
      const all = this.guildsDb.getAll() as Record<string, IGuild>;
      for (const gg of Object.values(all)) {
        const mig = this.migrateGuild(gg);
        if (mig && (mig.id === q || mig.tag.toLowerCase() === q.toLowerCase())) {
          g = mig;
          break;
        }
      }
      if (!g) {
        player.sendMessage(color.red("未找到该公会"));
        return;
      }
    } else {
      const gid = this.indexDb.get(player.name);
      if (!gid) {
        player.sendMessage(color.yellow("你不在任何公会中"));
        return;
      }
      g = this.getGuild(gid);
    }
    if (!g) return;

    const lines = [
      `${color.green("=== 公会信息 ===")}`,
      `${color.gold("名称:")} ${g.name} ${color.gray(`[${g.tag}]`)}`,
      `${color.gold("会长:")} ${g.ownerName}`,
      `${color.gold("成员:")} ${Object.keys(g.members).length}`,
      `${color.gold("金库:")} ${g.treasuryGold}`,
      `${color.gold("ID:")} ${g.id}`,
    ];
    if (g.announcement) lines.push(`${color.gold("公告:")} ${g.announcement}`);
    player.sendMessage(lines.join("\n"));
  }

  /**
   * 供表单 UI 展示成员列表（不写入聊天）
   */
  getMemberListSnapshot(
    player: Player
  ): {
    tag: string;
    name: string;
    rows: Array<{
      playerName: string;
      role: GuildRole;
      contribution: number;
      joinedAt: number;
    }>;
    total: number;
  } | null {
    if (!this.ensureDbs()) return null;
    const gid = this.indexDb.get(player.name);
    if (!gid) return null;
    const g = this.getGuild(gid);
    if (!g) return null;
    const rows = Object.entries(g.members).map(([playerName, m]) => ({
      playerName,
      role: m.role,
      contribution: m.treasuryContributedGold ?? 0,
      joinedAt: m.joinedAt,
    }));
    rows.sort((a, b) => b.contribution - a.contribution || a.playerName.localeCompare(b.playerName, undefined, { sensitivity: "base" }));
    return { tag: g.tag, name: g.name, rows, total: rows.length };
  }

  /** 公会累计贡献：全体成员捐入金库的金币总和（与成员列表「贡献度」口径一致） */
  private sumGuildTreasuryContributed(g: IGuild): number {
    let s = 0;
    for (const m of Object.values(g.members)) {
      const c = m.treasuryContributedGold;
      if (Number.isFinite(c) && (c as number) > 0) {
        s += Math.floor(c as number);
      }
    }
    return s;
  }

  /**
   * 供表单 UI 展示全服公会列表（分页，含 id 供点选跳转）
   */
  getGuildsListSnapshot(
    page: number = 1,
    pageSize: number = 10
  ): {
    rows: Array<{
      id: string;
      tag: string;
      name: string;
      memberCount: number;
      /** 成员累计捐入金库金币之和 */
      totalContribution: number;
    }>;
    total: number;
    page: number;
    totalPages: number;
  } {
    if (!this.ensureDbs()) return { rows: [], total: 0, page: 1, totalPages: 1 };
    const all = this.guildsDb.getAll() as Record<string, IGuild>;
    const list = Object.values(all)
      .map((x) => this.migrateGuild(x))
      .filter((x): x is IGuild => !!x);
    list.sort(
      (a, b) =>
        this.sumGuildTreasuryContributed(b) - this.sumGuildTreasuryContributed(a) ||
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
    const total = list.length;
    const ps = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 10;
    const totalPages = Math.max(1, Math.ceil(total / ps));
    const pageClamped = Math.min(Math.max(1, Math.floor(page)), totalPages);
    const start = (pageClamped - 1) * ps;
    const rows = list.slice(start, start + ps).map((g) => ({
      id: g.id,
      tag: g.tag,
      name: g.name,
      memberCount: Object.keys(g.members).length,
      totalContribution: this.sumGuildTreasuryContributed(g),
    }));
    return { rows, total, page: pageClamped, totalPages };
  }

  setAnnouncement(player: Player, text: string): string {
    if (!this.ensureDbs()) return "公会系统未就绪";
    const gid = this.indexDb.get(player.name);
    if (!gid) return "你不在任何公会中";
    const g = this.getGuild(gid);
    if (!g) return "公会不存在";
    if (g.ownerName !== player.name && this.getRole(g, player.name) !== "officer") return "无权修改公告";
    g.announcement = stripSection(text).slice(0, 200);
    this.saveGuild(g);
    return "";
  }

  /**
   * 将领地登记为公会领地：仅写入 guildId；成员进出权限由「同公会」在领地逻辑中动态判定，不向领地 members 同步名单。
   */
  trustGuildMembersInLand(player: Player, landName: string): string {
    if (!this.ensureDbs()) return "公会系统未就绪";
    const ln = stripSection(landName.trim());
    if (!ln) return "请指定领地名";

    const land = landManager.getLand(ln);
    if (typeof land === "string") return land;

    if (land.owner !== player.name && !isAdmin(player)) return "只有领地主人或管理员可操作";

    const gid = this.indexDb.get(player.name);
    if (!gid) return "你不在任何公会中";
    const g = this.getGuild(gid);
    if (!g) return "公会不存在";

    const role = this.getRole(g, player.name);
    if (role !== "owner" && role !== "officer") return "只有会长或副会长可将领地设为公会领地";

    if (land.guildId && land.guildId !== g.id) {
      return "本领地已绑定其他公会，请先解除后再绑定本会";
    }

    if (!land.guildId) {
      const maxGuildLands = this.numSetting("guildMaxLandsPerGuild");
      if (landManager.getGuildLandCountForGuild(g.id) >= maxGuildLands) {
        return `本会登记的公会领地已达上限(${maxGuildLands})，可先解除部分登记，或由管理员提高「每公会最大公会领地数」`;
      }

      const bindCost = this.treasuryFeeSetting("guildTreasuryCostLandBind");
      if (bindCost > 0) {
        const err = this.spendTreasuryForGuild(
          g.id,
          bindCost,
          player.name,
          `登记公会领地 ${ln} -${bindCost} [${g.tag}]`
        );
        if (err) return err;
      }
    }

    const next: ILand = { ...land, guildId: g.id };
    delete next.guildBoundMemberNames;
    landManager.setLand(ln, next);
    return "";
  }

  /** 列出已绑定到指定公会的领地（用于公会菜单） */
  getLandsBoundToGuild(guildId: string): ILand[] {
    const lands = landManager.getLandList();
    return Object.values(lands).filter((l) => l.guildId === guildId);
  }

  /**
   * 会长/副会长从公会菜单解除某块领地的公会绑定（不要求操作者是领主）
   */
  unbindGuildLandByOfficer(player: Player, landName: string): string {
    if (!this.ensureDbs()) return "公会系统未就绪";
    const ln = stripSection(landName.trim());
    if (!ln) return "请指定领地名";

    const landRaw = landManager.getLand(ln);
    if (typeof landRaw === "string") return landRaw;
    if (!landRaw.guildId) return "该领地未绑定公会";

    const gid = this.indexDb.get(player.name);
    if (!gid) return "你不在任何公会中";
    if (landRaw.guildId !== gid) return "该领地未绑定你的公会";

    const g = this.getGuild(gid);
    if (!g) return "公会不存在";

    const role = this.getRole(g, player.name);
    if (role !== "owner" && role !== "officer") return "只有会长或副会长可解除公会领地绑定";

    this.releaseLandGuildBindingCore(ln, g);
    return "";
  }

  /**
   * 解除领地与公会的数据绑定（内部复用：解散、封禁会长、解绑等）
   * 旧存档若曾写入 guildBoundMemberNames（历史同步名单），解绑时从领地成员中移除这些名字。
   */
  private releaseLandGuildBindingCore(landName: string, g: IGuild | undefined): void {
    const landRaw = landManager.getLand(landName);
    if (typeof landRaw === "string") return;
    if (!landRaw.guildId) return;

    if (!g) {
      const next: ILand = { ...landRaw };
      delete next.guildId;
      delete next.guildBoundMemberNames;
      landManager.setLand(landName, next);
      return;
    }

    if (landRaw.guildBoundMemberNames !== undefined && landRaw.guildBoundMemberNames.length > 0) {
      for (const memberName of landRaw.guildBoundMemberNames) {
        const r = landManager.removeMember(landName, memberName);
        if (typeof r === "string" && r !== "成员不存在") {
          SystemLog.warn(`[Guild] releaseLandGuildBindingCore remove ${memberName} from ${landName}: ${r}`);
        }
      }
    }

    const landAfter = landManager.getLand(landName);
    if (typeof landAfter === "string") return;
    const cleared: ILand = { ...landAfter };
    delete cleared.guildId;
    delete cleared.guildBoundMemberNames;
    landManager.setLand(landName, cleared);
  }

  private clearAllLandsBoundToGuild(g: IGuild): void {
    const lands = landManager.getLandList();
    for (const key in lands) {
      const land = lands[key];
      if (land.guildId === g.id) {
        this.releaseLandGuildBindingCore(land.name, g);
      }
    }
  }

  /**
   * 解除领地与公会的绑定：按领地所存 guildId 对应公会名册，从成员列表移除这些玩家，并清除 guildId。
   * 仅领地主人或管理员可操作；未加入公会时也可解除（仍按 land.guildId 清理）。
   */
  unbindLandFromGuild(player: Player, landName: string): string {
    if (!this.ensureDbs()) return "公会系统未就绪";
    const ln = stripSection(landName.trim());
    if (!ln) return "请指定领地名";

    const landRaw = landManager.getLand(ln);
    if (typeof landRaw === "string") return landRaw;

    if (landRaw.owner !== player.name && !isAdmin(player)) return "只有领地主人或管理员可操作";
    if (!landRaw.guildId) return "该领地未绑定公会";

    const g = this.getGuild(landRaw.guildId);
    this.releaseLandGuildBindingCore(ln, g);
    return "";
  }

  removeMemberDueToBlacklist(playerName: string): void {
    if (!this.ensureDbs()) return;
    if (setting.getState("guildLeaveOnBlacklist") !== true) return;

    const gid = this.indexDb.get(playerName);
    if (!gid) return;
    const g = this.getGuild(gid);
    if (!g) {
      this.indexDb.delete(playerName);
      return;
    }

    if (g.ownerName === playerName) {
      this.disbandGuildDataCore(g);
      SystemLog.info(`[Guild] 会长 ${playerName} 被封禁，公会 ${g.tag} 已解散`);
      return;
    }

    delete g.members[playerName];
    this.saveGuild(g);
    this.indexDb.delete(playerName);
    this.invalidateDisplayCache(playerName);
    const p = usePlayerByName(playerName);
    if (p) nameDisplay.forceUpdatePlayerNameDisplay(p);
  }

  /** 菜单/UI：当前玩家所在公会完整数据 */
  getGuildForPlayer(player: Player): IGuild | undefined {
    if (!this.ensureDbs()) return undefined;
    const gid = this.indexDb.get(player.name);
    if (!gid) return undefined;
    return this.getGuild(gid);
  }

  /** 菜单/UI：当前玩家在公会中的职位 */
  getMemberRole(player: Player): GuildRole | undefined {
    const g = this.getGuildForPlayer(player);
    if (!g) return undefined;
    return this.getRole(g, player.name);
  }

  /** 菜单/UI：待处理邀请摘要（无邀请或已过期返回 undefined） */
  getPendingInviteSummary(
    playerName: string
  ): { guildId: string; guildTag: string; guildName: string; inviterName: string } | undefined {
    if (!this.ensureDbs()) return undefined;
    const inv = this.invitesDb.get(playerName);
    if (!inv) return undefined;
    if (Date.now() > inv.expiresAt) {
      this.invitesDb.delete(playerName);
      return undefined;
    }
    const g = this.getGuild(inv.guildId);
    if (!g) {
      this.invitesDb.delete(playerName);
      return undefined;
    }
    return { guildId: inv.guildId, guildTag: g.tag, guildName: g.name, inviterName: inv.byName };
  }

  /**
   * 从公会列表申请加入（无公会时）；可同时保留多个公会的待审申请。
   */
  requestJoinGuild(player: Player, targetGuildId: string): string {
    if (!this.ensureDbs()) return "公会系统未就绪";
    if (!this.isModuleEnabled()) return "公会功能已关闭";
    if (this.trialBlocksGuildFeatures(player)) return "试玩期间无法申请加入公会";

    if (this.indexDb.has(player.name)) return "你已在公会中，无法申请";

    const g = this.getGuild(targetGuildId);
    if (!g) return "公会不存在";
    if (Object.keys(g.members).length >= this.numSetting("guildMaxMembers")) return "公会人数已满";

    if (!g.joinRequests) g.joinRequests = {};
    const isUpdate = !!g.joinRequests[player.name];
    g.joinRequests[player.name] = { requestedAt: Date.now() };
    this.saveGuild(g);
    if (!isUpdate) this.logGuild(player.name, "guildApply", this.guildMeta(g, ""));
    return "";
  }

  /** 会长/副会长菜单：待审申请列表（按时间新在前） */
  listJoinRequests(guildId: string): Array<{ playerName: string; requestedAt: number }> {
    if (!this.ensureDbs()) return [];
    const g = this.getGuild(guildId);
    if (!g?.joinRequests) return [];
    return Object.entries(g.joinRequests)
      .map(([playerName, v]) => ({ playerName, requestedAt: v.requestedAt }))
      .sort((a, b) => b.requestedAt - a.requestedAt);
  }

  approveJoinRequest(actor: Player, applicantName: string): string {
    if (!this.ensureDbs()) return "公会系统未就绪";
    if (!this.isModuleEnabled()) return "公会功能已关闭";

    const aname = stripSection(applicantName.trim());
    if (!aname) return "请指定玩家";

    const gid = this.indexDb.get(actor.name);
    if (!gid) return "你不在任何公会中";
    const g = this.getGuild(gid);
    if (!g) return "公会不存在";

    const role = this.getRole(g, actor.name);
    if (role !== "owner" && role !== "officer") return "无权处理申请";

    if (!g.joinRequests?.[aname]) return "该玩家没有待处理的申请";

    if (this.indexDb.has(aname)) {
      delete g.joinRequests[aname];
      if (Object.keys(g.joinRequests).length === 0) delete g.joinRequests;
      this.saveGuild(g);
      return "该玩家已在其他公会中";
    }

    if (Object.keys(g.members).length >= this.numSetting("guildMaxMembers")) return "公会人数已满";

    delete g.joinRequests[aname];
    if (Object.keys(g.joinRequests).length === 0) delete g.joinRequests;

    g.members[aname] = { role: "member", joinedAt: Date.now() };
    this.saveGuild(g);
    this.indexDb.set(aname, g.id);
    this.invalidateDisplayCache(aname);
    const ap = usePlayerByName(aname);
    if (ap) nameDisplay.forceUpdatePlayerNameDisplay(ap);

    this.removePendingJoinRequestsForPlayer(aname);
    this.logGuild(actor.name, "guildApplyApprove", this.guildMeta(g, `target=${aname}`));
    this.logGuild(aname, "guildJoin", this.guildMeta(g, ""));
    return "";
  }

  rejectJoinRequest(actor: Player, applicantName: string): string {
    if (!this.ensureDbs()) return "公会系统未就绪";
    if (!this.isModuleEnabled()) return "公会功能已关闭";

    const aname = stripSection(applicantName.trim());
    if (!aname) return "请指定玩家";

    const gid = this.indexDb.get(actor.name);
    if (!gid) return "你不在任何公会中";
    const g = this.getGuild(gid);
    if (!g) return "公会不存在";

    const role = this.getRole(g, actor.name);
    if (role !== "owner" && role !== "officer") return "无权处理申请";

    if (!g.joinRequests?.[aname]) return "该玩家没有待处理的申请";

    delete g.joinRequests[aname];
    if (Object.keys(g.joinRequests).length === 0) delete g.joinRequests;
    this.saveGuild(g);
    this.logGuild(actor.name, "guildApplyReject", this.guildMeta(g, `target=${aname}`));
    return "";
  }

  /** 本会成员查看公会历史（行为日志子集） */
  getGuildHistory(
    player: Player,
    guildId: string,
    opts: { limit: number; offset: number }
  ): { total: number; items: BehaviorLogEntry[] } | null {
    if (!this.ensureDbs()) return null;
    if (this.indexDb.get(player.name) !== guildId) return null;
    const g = this.getGuild(guildId);
    if (!g) return null;
    return behaviorLog.query({
      eventTypes: GUILD_HISTORY_EVENT_TYPES,
      guildId,
      guildTagForLegacy: g.tag,
      limit: opts.limit,
      offset: opts.offset,
    });
  }

  private removeAllGuildWaypointsForGuild(g: IGuild): void {
    for (const key of this.getGuildWaypointDbKeys(g)) {
      const p = parseWaypointDbKey(key);
      if (p) {
        wayPoint.deletePoint(p.pointName, p.playerName);
      }
    }
    g.guildWaypointKeys = undefined;
    g.homeWaypointKey = undefined;
  }

  /** 合并 guildWaypointKeys 与旧版 homeWaypointKey（只读视图） */
  getGuildWaypointDbKeys(g: IGuild): string[] {
    const out: string[] = [];
    if (g.guildWaypointKeys?.length) {
      for (const k of g.guildWaypointKeys) {
        if (k && !out.includes(k)) out.push(k);
      }
    }
    if (g.homeWaypointKey && !out.includes(g.homeWaypointKey)) {
      out.push(g.homeWaypointKey);
    }
    return out;
  }

  /**
   * 迁移旧版单点 homeWaypointKey 到公会虚拟路点，并清理失效键
   */
  ensureGuildWaypointsNormalized(g: IGuild): void {
    let changed = false;

    const pruneKeys = (keys: string[] | undefined): string[] | undefined => {
      if (!keys?.length) return undefined;
      const next = keys.filter((k) => {
        const wp = wayPoint.getPointByDbKey(k);
        return !!wp;
      });
      if (next.length !== keys.length) changed = true;
      return next.length ? next : undefined;
    };

    g.guildWaypointKeys = pruneKeys(g.guildWaypointKeys);
    if (g.homeWaypointKey && !wayPoint.getPointByDbKey(g.homeWaypointKey)) {
      g.homeWaypointKey = undefined;
      changed = true;
    }

    if (g.homeWaypointKey && (!g.guildWaypointKeys || g.guildWaypointKeys.length === 0)) {
      const legacyKey = g.homeWaypointKey;
      const wp = wayPoint.getPointByDbKey(legacyKey);
      if (!wp) {
        g.homeWaypointKey = undefined;
        changed = true;
      } else {
        const parsed = parseWaypointDbKey(legacyKey);
        if (parsed?.playerName.startsWith("__guild_")) {
          g.guildWaypointKeys = [legacyKey];
          g.homeWaypointKey = undefined;
          changed = true;
        } else if (parsed) {
          const err = wayPoint.copyGuildPointFromLegacyWaypoint({
            guildId: g.id,
            pointName: parsed.pointName,
            source: wp,
          });
          if (typeof err !== "string") {
            wayPoint.deletePoint(parsed.pointName, parsed.playerName);
            const newKey = wayPoint.getGuildWaypointDbKey(g.id, parsed.pointName);
            g.guildWaypointKeys = [newKey];
            g.homeWaypointKey = undefined;
            changed = true;
          } else {
            g.guildWaypointKeys = [legacyKey];
            g.homeWaypointKey = undefined;
            changed = true;
          }
        }
      }
    } else if (g.homeWaypointKey && g.guildWaypointKeys?.length) {
      if (!g.guildWaypointKeys.includes(g.homeWaypointKey)) {
        g.guildWaypointKeys.push(g.homeWaypointKey);
      }
      g.homeWaypointKey = undefined;
      changed = true;
    }

    if (changed) {
      this.saveGuild(g);
    }
  }

  /**
   * 公会主菜单一行：公会坐标集合摘要
   */
  getGuildHomeSummaryLine(g: IGuild): string {
    this.ensureGuildWaypointsNormalized(g);
    const keys = this.getGuildWaypointDbKeys(g);
    const cap = this.numSetting("guildMaxWaypointsPerGuild");
    if (keys.length === 0) {
      return `§7公会坐标: §8无 §7(会长/副会长可在「公会坐标」中添加，上限 §b${cap} §7个)`;
    }
    return `§7公会坐标: §a${keys.length} §7个 §7/ §b${cap}`;
  }

  /**
   * 公会主菜单一行：公会领地登记摘要（与个人领地上限独立）
   */
  getGuildLandSummaryLine(g: IGuild): string {
    const n = this.getLandsBoundToGuild(g.id).length;
    const cap = this.numSetting("guildMaxLandsPerGuild");
    if (n === 0) {
      return `§7公会领地: §8无 §7(会长/副会长可在「公会领地」中登记，上限 §b${cap} §7块)`;
    }
    return `§7公会领地: §a${n} §7块 §7/ §b${cap}`;
  }

  /**
   * 添加公会坐标：与私人坐标相同（当前位置 + 自定义名称），不占成员私人路点名额。
   */
  addGuildWaypoint(player: Player, rawName: string): string {
    if (!this.ensureDbs()) return "公会系统未就绪";
    if (!this.isModuleEnabled()) return "公会功能已关闭";
    if (this.trialBlocksGuildFeatures(player)) return "试玩期间无法设置公会坐标";

    const gid = this.indexDb.get(player.name);
    if (!gid) return "你不在任何公会中";
    const g = this.getGuild(gid);
    if (!g) return "公会不存在";

    const role = this.getRole(g, player.name);
    if (role !== "owner" && role !== "officer") return "只有会长或副会长可以添加公会坐标";

    this.ensureGuildWaypointsNormalized(g);

    const name = stripSection(rawName).trim();
    if (!name) return "请输入坐标点名称";

    const wpCost = this.treasuryFeeSetting("guildTreasuryCostWaypointCreate");
    if (wpCost > 0) {
      const spendErr = this.spendTreasuryForGuild(
        g.id,
        wpCost,
        player.name,
        `添加公会坐标 ${name} -${wpCost} [${g.tag}]`
      );
      if (spendErr) return spendErr;
    }

    const err = wayPoint.createGuildPointAtLocation({
      guildId: g.id,
      pointName: name,
      location: player.location,
      dimension: player.dimension.id,
    });
    if (typeof err === "string") {
      if (wpCost > 0) this.refundTreasuryForGuild(g.id, wpCost);
      return err;
    }

    const dbKey = wayPoint.getGuildWaypointDbKey(g.id, name);
    if (!g.guildWaypointKeys) g.guildWaypointKeys = [];
    if (!g.guildWaypointKeys.includes(dbKey)) {
      g.guildWaypointKeys.push(dbKey);
    }
    this.saveGuild(g);
    this.logGuild(player.name, "guildPromote", this.guildMeta(g, `wpAdd ${name}`));
    return "";
  }

  /**
   * 删除某一公会坐标（会长或副会长）
   */
  removeGuildWaypointByDbKey(player: Player, dbKey: string): string {
    if (!this.ensureDbs()) return "公会系统未就绪";
    if (!this.isModuleEnabled()) return "公会功能已关闭";

    const gid = this.indexDb.get(player.name);
    if (!gid) return "你不在任何公会中";
    const g = this.getGuild(gid);
    if (!g) return "公会不存在";

    const role = this.getRole(g, player.name);
    if (role !== "owner" && role !== "officer") return "只有会长或副会长可以删除公会坐标";

    this.ensureGuildWaypointsNormalized(g);
    const keys = this.getGuildWaypointDbKeys(g);
    if (!keys.includes(dbKey)) return "该坐标不属于本会";

    const parsed = parseWaypointDbKey(dbKey);
    if (!parsed) return "坐标数据无效";
    wayPoint.deletePoint(parsed.pointName, parsed.playerName);
    g.guildWaypointKeys = g.guildWaypointKeys?.filter((k) => k !== dbKey);
    if (!g.guildWaypointKeys?.length) g.guildWaypointKeys = undefined;
    g.homeWaypointKey = g.homeWaypointKey === dbKey ? undefined : g.homeWaypointKey;
    this.saveGuild(g);
    this.logGuild(player.name, "guildPromote", this.guildMeta(g, "wpDel"));
    return "";
  }

  /**
   * 传送到本会某一公会坐标（全体成员）
   */
  teleportToGuildWaypointDbKey(player: Player, dbKey: string): string {
    if (!this.ensureDbs()) return "公会系统未就绪";
    if (!this.isModuleEnabled()) return "公会功能已关闭";
    if (this.trialBlocksGuildFeatures(player)) return "试玩期间无法使用公会坐标";

    const g = this.getGuildForPlayer(player);
    if (!g) return "你不在任何公会中";
    this.ensureGuildWaypointsNormalized(g);
    if (!this.getGuildWaypointDbKeys(g).includes(dbKey)) return "该坐标不属于本会";

    const parsed = parseWaypointDbKey(dbKey);
    if (!parsed) return "公会坐标数据无效";
    const wp = wayPoint.getPoint(parsed.pointName, parsed.playerName);
    if (!wp) return "公会坐标已失效，请会长或副会长删除后重新添加";

    const r = wayPoint.teleport(player, parsed.pointName, parsed.playerName);
    if (typeof r === "string") return r;
    return "";
  }

  /**
   * 将某一公会坐标更新为当前站立位置（会长或副会长）
   */
  relocateGuildWaypointToHere(player: Player, dbKey: string): string {
    if (!this.ensureDbs()) return "公会系统未就绪";
    if (!this.isModuleEnabled()) return "公会功能已关闭";
    if (this.trialBlocksGuildFeatures(player)) return "试玩期间无法设置公会坐标";

    const gid = this.indexDb.get(player.name);
    if (!gid) return "你不在任何公会中";
    const g = this.getGuild(gid);
    if (!g) return "公会不存在";

    const role = this.getRole(g, player.name);
    if (role !== "owner" && role !== "officer") return "只有会长或副会长可以修改公会坐标";

    this.ensureGuildWaypointsNormalized(g);
    if (!this.getGuildWaypointDbKeys(g).includes(dbKey)) return "该坐标不属于本会";

    const err = wayPoint.updatePointLocationByDbKey(dbKey, player);
    if (typeof err === "string") return err;
    this.logGuild(player.name, "guildPromote", this.guildMeta(g, "wpMove"));
    return "";
  }

  /**
   * 会长或副会长配置每日红包开关与每人金额
   */
  setDailyRedPacketSettings(player: Player, enabled: boolean, goldPerMember: number): string {
    if (!this.ensureDbs()) return "公会系统未就绪";
    if (!this.isModuleEnabled()) return "公会功能已关闭";
    if (!this.isEconomyOk()) return "经济系统已关闭";
    if (this.trialBlocksGuildFeatures(player)) return "试玩期间无法修改公会设置";

    const gid = this.indexDb.get(player.name);
    if (!gid) return "你不在任何公会中";
    const g = this.getGuild(gid);
    if (!g) return "公会不存在";

    const role = this.getRole(g, player.name);
    if (role !== "owner" && role !== "officer") return "只有会长或副会长可以修改每日红包";

    if (enabled) {
      const amt = Math.floor(Number(goldPerMember));
      if (!Number.isFinite(amt) || amt < 1) return "开启时每人金币须为正整数";
      g.dailyRedPacketGoldPerMember = amt;
    }
    g.dailyRedPacketEnabled = enabled;
    this.saveGuild(g);
    return "";
  }

  /**
   * 玩家主动领取公会每日红包（由 UI 领取按钮调用）
   */
  claimDailyRedPacket(player: Player): string {
    if (!this.ensureDbs()) return "公会系统未就绪";
    if (!this.isModuleEnabled()) return "公会功能已关闭";
    if (!this.isEconomyOk()) return "经济系统已关闭";
    if (this.trialBlocksGuildFeatures(player)) return "试玩期间无法领取公会每日红包";

    const gid = this.indexDb.get(player.name);
    if (!gid) return "你不在任何公会中";
    const g = this.getGuild(gid);
    if (!g) return "公会不存在";

    if (!g.dailyRedPacketEnabled) return "未开启每日红包";
    const perMember = Math.floor(g.dailyRedPacketGoldPerMember ?? 0);
    if (!Number.isFinite(perMember) || perMember <= 0) {
      return "每人每日金币无效，请会长或副会长在红包设置中配置";
    }

    const today = economic.getCalendarDateString();
    const mem = g.members[player.name];
    if (!mem) return "你不是本会成员";

    if (mem.lastDailyRedPacketDay === today) return "今日已领取过公会每日红包";

    /** 单次领取：仅判断当前金库是否够发本成员这一笔（不预留「每人×全员」整日门闩） */
    if (g.treasuryGold < perMember) {
      return "公会金库余额不足，无法领取本次红包";
    }

    g.treasuryGold -= perMember;
    try {
      const added = economic.addGold(player.name, perMember, "guild:daily:redpacket", true);
      if (added <= 0) {
        g.treasuryGold += perMember;
        this.saveGuild(g);
        return "发放金币失败，请稍后重试";
      }
      mem.lastDailyRedPacketDay = today;
      this.saveGuild(g);
      this.logGuild(player.name, "guildDailyRedPacketGrant", this.guildMeta(g, `+${perMember}`));
      player.sendMessage(
        `${color.green("公会每日红包")} ${color.gold(`+${perMember}`)} ${color.gray("金币已存入钱包")}`
      );
    } catch (e) {
      g.treasuryGold += perMember;
      this.saveGuild(g);
      SystemLog.error("公会每日红包发放失败", e);
      return "公会每日红包发放失败";
    }
    return "";
  }

  /**
   * 进服时可扩展：同步改名（基岩脚本无可靠改名事件时仅保留占位）
   */
  reconcilePlayerNameOnJoin(_player: Player): void {
    if (!this.ensureDbs() || !this.isModuleEnabled()) return;
  }
}

const guildService = new GuildService();
export default guildService;
