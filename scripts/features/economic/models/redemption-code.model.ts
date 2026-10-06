/**
 * 金币兑换码持久化模型。
 *
 * 兑换码本身按内部 id 存入 eco_redemption_codes；claims 与兑换码聚合保存，
 * 这样同一兑换码的额度检查、占位和状态推进可以在一个同步临界区内完成。
 */

export type RedemptionCodeStatus = "active" | "disabled" | "archived";

export type RedemptionClaimStatus = "prepared" | "granted" | "recovery_required";

export interface IRedemptionCodeClaim {
  /** 稳定玩家身份（cmid），也是 claims 的键。 */
  playerIdentityId: string;
  /** 操作时的玩家名，仅用于展示；重复领取判断不依赖玩家名。 */
  playerName: string;
  status: RedemptionClaimStatus;
  preparedAt: number;
  updatedAt: number;
  grantedAt?: number;
  recoveryReason?: string;
}

export type RedemptionRecoveryResolutionAction = "mark_granted" | "release";

export interface IRedemptionRecoveryResolution {
  playerIdentityId: string;
  playerName: string;
  action: RedemptionRecoveryResolutionAction;
  resolvedAt: number;
  resolvedById: string;
  resolvedByName: string;
}

export interface IRedemptionCode {
  /** 不向玩家公开、不可从明文兑换码推导的内部 id。 */
  id: string;
  /** 原样保存并精确匹配；不做 trim 或大小写归一化。 */
  code: string;
  gold: number;
  /** null 表示全服使用次数无限。 */
  maxUses: number | null;
  /** null 表示永久；now >= expiresAt 时过期。 */
  expiresAt: number | null;
  status: RedemptionCodeStatus;
  createdAt: number;
  createdById: string;
  createdByName: string;
  claims: Record<string, IRedemptionCodeClaim>;
  /** 人工解除异常占位也保留审计记录，但不会继续占用额度。 */
  recoveryResolutions?: IRedemptionRecoveryResolution[];
}

export interface RedemptionClaimCounts {
  prepared: number;
  granted: number;
  recoveryRequired: number;
  reserved: number;
}

export interface RedemptionCodeView extends IRedemptionCode {
  counts: RedemptionClaimCounts;
  remainingUses: number | null;
  expired: boolean;
  exhausted: boolean;
}

export interface CreateRedemptionCodeInput {
  /** undefined 或空字符串表示自动生成；其他值按原样验证。 */
  code?: string;
  gold: number;
  maxUses: number | null;
  expiresInHours: number | null;
}

export type RedemptionFailureReason =
  | "economy_disabled"
  | "not_ready"
  | "not_found"
  | "already_claimed"
  | "expired"
  | "disabled"
  | "archived"
  | "exhausted"
  | "balance_limit_exceeded"
  | "recovery_required"
  | "busy"
  | "rejected"
  | "conflict"
  | "retryable_error"
  | "persistence_error";

export type RedemptionResult =
  | {
      ok: true;
      codeId: string;
      code: string;
      gold: number;
      balance: number;
      alreadyCredited: boolean;
      /** 钱包已经确认到账，但领取状态的立即落库失败；幂等收据仍能安全恢复。 */
      persistencePending?: boolean;
    }
  | {
      ok: false;
      reason: RedemptionFailureReason;
      message: string;
    };

export type RedemptionAdminFailureReason =
  | "forbidden"
  | "not_ready"
  | "not_found"
  | "invalid_code"
  | "duplicate_code"
  | "invalid_gold"
  | "invalid_max_uses"
  | "invalid_expiry"
  | "invalid_state"
  | "expired"
  | "exhausted"
  | "claim_not_found"
  | "claim_not_recoverable"
  | "busy"
  | "persistence_error"
  | "identity_unavailable";

export type CreateRedemptionCodeResult =
  | {
      ok: true;
      code: RedemptionCodeView;
      generated: boolean;
      message: string;
    }
  | {
      ok: false;
      reason: RedemptionAdminFailureReason;
      message: string;
    };

export type RedemptionMutationResult =
  | {
      ok: true;
      code: RedemptionCodeView;
      message: string;
    }
  | {
      ok: false;
      reason: RedemptionAdminFailureReason;
      message: string;
    };

export interface RedemptionRecoverySummary {
  inspected: number;
  granted: number;
  alreadyCredited: number;
  released: number;
  recoveryRequired: number;
  skipped: number;
}
