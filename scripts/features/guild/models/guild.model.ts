/**
 * 公会系统数据模型
 */

export const CURRENT_GUILD_SCHEMA_VERSION = 3;

export type GuildRole = "owner" | "officer" | "member";

export interface IGuildMemberEntry {
  role: GuildRole;
  joinedAt: number;
  /** 累计捐入本会金库的金币（仅 treasuryDeposit 成功时累加） */
  treasuryContributedGold?: number;
  /** 上次成功领取公会每日红包的日历日 YYYY-MM-DD */
  lastDailyRedPacketDay?: string;
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
  /** 是否开启公会每日红包（会长/副会长配置） */
  dailyRedPacketEnabled?: boolean;
  /** 每人每日红包金币数（正整数） */
  dailyRedPacketGoldPerMember?: number;
  /** @deprecated 旧版整日门闩字段，已不再写入；可忽略 */
  dailyRedPacketBudgetDay?: string;
  /** @deprecated 旧版整日门闩字段，已不再写入；可忽略 */
  dailyRedPacketBudgetSkipped?: boolean;
}

export interface IPendingGuildInvite {
  guildId: string;
  byName: string;
  expiresAt: number;
}
