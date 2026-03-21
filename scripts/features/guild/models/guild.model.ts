/**
 * 公会系统数据模型
 */

export const CURRENT_GUILD_SCHEMA_VERSION = 2;

export type GuildRole = "owner" | "officer" | "member";

export interface IGuildMemberEntry {
  role: GuildRole;
  joinedAt: number;
  /** 累计捐入本会金库的金币（仅 treasuryDeposit 成功时累加） */
  treasuryContributedGold?: number;
}

export interface IGuild {
  id: string;
  schemaVersion: number;
  name: string;
  tag: string;
  ownerName: string;
  members: Record<string, IGuildMemberEntry>;
  treasuryGold: number;
  createdAt: number;
  announcement?: string;
  /** 公会坐标集合（路点库完整键；新数据为 `__guild_<公会id>:<名称>`，不占成员私人名额） */
  guildWaypointKeys?: string[];
  /** @deprecated 旧版单点公会坐标，读取后迁移至 guildWaypointKeys */
  homeWaypointKey?: string;
  /** 待审加入申请（申请人名 → 申请时间） */
  joinRequests?: Record<string, { requestedAt: number }>;
}

export interface IPendingGuildInvite {
  guildId: string;
  byName: string;
  expiresAt: number;
}
