/**
 * 玩家全服红包（经济系统）
 */

export type RedPacketMode = "total" | "per_head";

export interface IRedPacketRecipient {
  amount: number;
  claimed: boolean;
}

export interface IRedPacket {
  id: string;
  senderName: string;
  mode: RedPacketMode;
  /** 玩家设定的红包份数 */
  headCount?: number;
  /** 总金额（均分模式为输入值；按份数为 P*n） */
  totalDeducted: number;
  message: string;
  createdAt: number;
  expiresAt: number;
  /** 已结束：全员领完或已做过期退款处理 */
  finished: boolean;

  /** 新版：每份金额队列（先到先得）；与 claimedBy 顺序对应 */
  shareAmounts?: number[];
  /** 已领取的玩家昵称，顺序即领取顺序 */
  claimedBy?: string[];
  /** 与 claimedBy 同下标：该次领取的时间戳（毫秒），旧存档可无 */
  claimAtMs?: number[];

  /** 旧版：按在线人名锁定领取人（兼容旧存档） */
  recipients?: Record<string, IRedPacketRecipient>;
}
