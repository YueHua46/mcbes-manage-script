import { Player, system } from "@minecraft/server";
import { Database } from "../../../shared/database/database";
import { isAdmin, SystemLog } from "../../../shared/utils/common";
import { taskScheduler } from "../../platform/scheduler";
import identityService from "../../player/services/identity-service";
import setting from "../../system/services/setting";
import type { ICreditGoldOnceResult } from "../models/economic.model";
import type {
  CreateRedemptionCodeInput,
  CreateRedemptionCodeResult,
  IRedemptionCode,
  IRedemptionCodeClaim,
  RedemptionAdminFailureReason,
  RedemptionCodeView,
  RedemptionFailureReason,
  RedemptionMutationResult,
  RedemptionRecoveryResolutionAction,
  RedemptionRecoverySummary,
  RedemptionResult,
} from "../models/redemption-code.model";
import economic, { MONEY_SCOREBOARD_MAX } from "./economic";
import {
  assessRedemptionAvailability,
  generateRedemptionCode,
  generateRedemptionCodeId,
  isRedemptionCodeExhausted,
  isRedemptionCodeExpired,
  toRedemptionCodeView,
  validateCreateRedemptionInput,
} from "./redemption-code-domain";

export const REDEMPTION_CODE_DATABASE = "eco_redemption_codes";

const GENERATED_CODE_ATTEMPTS = 128;
const GENERATED_ID_ATTEMPTS = 64;
const RECOVERY_INTERVAL_TICKS = 20 * 60;
const RECOVERY_BATCH_SIZE = 32;

type PreparedCompletionOutcome = "granted" | "already_credited" | "released" | "recovery_required" | "skipped";

interface PreparedCompletionResult {
  result: RedemptionResult;
  outcome: PreparedCompletionOutcome;
}

function cloneRecord(record: IRedemptionCode): IRedemptionCode {
  return {
    ...record,
    claims: Object.fromEntries(
      Object.entries(record.claims ?? {}).map(([identityId, claim]) => [identityId, { ...claim }])
    ),
    recoveryResolutions: record.recoveryResolutions?.map((resolution) => ({ ...resolution })),
  };
}

function redemptionFailure(reason: RedemptionFailureReason, message: string): RedemptionResult {
  return { ok: false, reason, message };
}

function adminFailure(
  reason: RedemptionAdminFailureReason,
  message: string
): Extract<CreateRedemptionCodeResult, { ok: false }> {
  return { ok: false, reason, message };
}

function availabilityMessage(reason: Exclude<RedemptionFailureReason, "not_ready" | "not_found">): string {
  switch (reason) {
    case "already_claimed":
      return "你已经兑换过该兑换码";
    case "expired":
      return "该兑换码已过期";
    case "disabled":
      return "该兑换码已停用";
    case "archived":
      return "该兑换码已归档";
    case "exhausted":
      return "该兑换码已领完";
    case "balance_limit_exceeded":
      return "领取后金币将超过余额上限";
    case "recovery_required":
      return "该次领取状态需要管理员核对，请勿重复操作";
    case "economy_disabled":
      return "经济系统未开启";
    case "busy":
      return "兑换码正在处理中，请稍后重试";
    case "rejected":
      return "金币发放被拒绝，未消耗兑换资格";
    case "conflict":
      return "幂等发放记录冲突，需要管理员核对";
    case "retryable_error":
      return "金币发放结果暂时无法确认，需要管理员核对";
    case "persistence_error":
      return "兑换记录保存失败，请稍后重试";
  }
}

export class RedemptionCodeService {
  private db?: Database<IRedemptionCode>;
  private readonly codeLocks = new Set<string>();
  private recoveryCursor = 0;

  constructor() {
    system.run(() => {
      this.db = new Database<IRedemptionCode>(REDEMPTION_CODE_DATABASE);
      // 等经济、设置和身份数据库完成各自的首轮初始化后，再恢复 prepared 记录。
      system.run(() => {
        try {
          this.recoverPreparedClaims();
        } catch (error) {
          SystemLog.error("[RedemptionCode] 启动恢复失败", error);
        }
      });
    });

    taskScheduler.register({
      id: "economy.redemptionCodeRecovery",
      label: "兑换码待完成领取恢复",
      category: "economy",
      intervalTicks: RECOVERY_INTERVAL_TICKS,
      skipIfRunning: true,
      when: () => this.isReady(),
      run: () => {
        this.recoverPreparedClaims(RECOVERY_BATCH_SIZE);
      },
    });
  }

  isReady(): boolean {
    return this.db !== undefined;
  }

  isEconomyEnabled(): boolean {
    return setting.getState("economy") === true;
  }

  private currentTick(): number {
    try {
      return Number.isFinite(system.currentTick) ? system.currentTick : 0;
    } catch {
      return 0;
    }
  }

  private saveRecord(record: IRedemptionCode): void {
    if (!this.db) throw new Error("redemption code database is not ready");
    this.db.set(record.id, record);
    this.db.save();
  }

  private findRecordByCode(rawCode: string): IRedemptionCode | undefined {
    const db = this.db;
    if (!db) return undefined;
    return db.values().find((record) => record?.code === rawCode);
  }

  private acquireCodeLock(codeId: string): boolean {
    if (this.codeLocks.has(codeId)) return false;
    this.codeLocks.add(codeId);
    return true;
  }

  private releaseCodeLock(codeId: string): void {
    this.codeLocks.delete(codeId);
  }

  private generateUniqueCode(now: number): string | undefined {
    for (let attempt = 0; attempt < GENERATED_CODE_ATTEMPTS; attempt++) {
      const code = generateRedemptionCode({
        now,
        tick: this.currentTick(),
        salt: attempt,
      });
      if (!this.findRecordByCode(code)) return code;
    }
    return undefined;
  }

  private generateUniqueId(now: number): string | undefined {
    const db = this.db;
    if (!db) return undefined;
    for (let attempt = 0; attempt < GENERATED_ID_ATTEMPTS; attempt++) {
      const id = generateRedemptionCodeId({
        now,
        tick: this.currentTick(),
        salt: attempt,
      });
      if (!db.has(id)) return id;
    }
    return undefined;
  }

  create(admin: Player, input: CreateRedemptionCodeInput): CreateRedemptionCodeResult {
    if (!isAdmin(admin)) return adminFailure("forbidden", "只有管理员可以创建兑换码");
    if (!this.db) return adminFailure("not_ready", "兑换码数据尚未就绪");

    const now = Date.now();
    const validated = validateCreateRedemptionInput(input, now);
    if (!validated.ok) return validated;

    const code = validated.generated ? this.generateUniqueCode(now) : validated.customCode;
    if (!code) {
      return adminFailure("duplicate_code", "自动生成兑换码失败，请重试");
    }
    if (this.findRecordByCode(code)) {
      return adminFailure("duplicate_code", "该兑换码已存在；归档兑换码也不能复用");
    }

    const id = this.generateUniqueId(now);
    if (!id) return adminFailure("persistence_error", "无法生成安全的兑换码记录编号，请重试");

    let createdById: string;
    try {
      createdById = identityService.resolvePlayerKeyForPlayer(admin);
    } catch (error) {
      SystemLog.error("[RedemptionCode] 无法解析管理员身份", error);
      return adminFailure("identity_unavailable", "管理员身份数据尚未就绪");
    }

    const record: IRedemptionCode = {
      id,
      code,
      gold: validated.gold,
      maxUses: validated.maxUses,
      expiresAt: validated.expiresAt,
      status: "active",
      createdAt: now,
      createdById,
      createdByName: admin.name,
      claims: {},
    };

    try {
      this.saveRecord(record);
    } catch (error) {
      // Database.set 会先改缓存；移除失败创建的记录，避免本轮运行误认为创建成功。
      this.db.delete(id);
      SystemLog.error("[RedemptionCode] 创建记录保存失败", error);
      return adminFailure("persistence_error", "兑换码保存失败，请稍后重试");
    }

    return {
      ok: true,
      code: toRedemptionCodeView(record, now),
      generated: validated.generated,
      message: validated.generated ? "兑换码已生成" : "兑换码已创建",
    };
  }

  list(options: { archived?: boolean } = {}): RedemptionCodeView[] {
    const db = this.db;
    if (!db) return [];
    const archived = options.archived === true;
    const now = Date.now();
    return db
      .values()
      .filter((record) => record && (archived ? record.status === "archived" : record.status !== "archived"))
      .sort((left, right) => right.createdAt - left.createdAt)
      .map((record) => toRedemptionCodeView(record, now));
  }

  getById(id: string): RedemptionCodeView | undefined {
    const record = this.db?.get(id);
    return record ? toRedemptionCodeView(record, Date.now()) : undefined;
  }

  redeem(player: Player, rawCode: string): RedemptionResult {
    if (!this.isEconomyEnabled()) {
      return redemptionFailure("economy_disabled", availabilityMessage("economy_disabled"));
    }
    if (!this.db) return redemptionFailure("not_ready", "兑换码数据尚未就绪");
    if (typeof rawCode !== "string") return redemptionFailure("not_found", "兑换码不存在");

    const found = this.findRecordByCode(rawCode);
    if (!found) return redemptionFailure("not_found", "兑换码不存在");
    if (!this.acquireCodeLock(found.id)) {
      return redemptionFailure("busy", availabilityMessage("busy"));
    }

    try {
      const record = this.db.get(found.id);
      if (!record || record.code !== rawCode) return redemptionFailure("not_found", "兑换码不存在");

      let playerIdentityId: string;
      try {
        playerIdentityId = identityService.resolvePlayerKeyForPlayer(player);
      } catch (error) {
        SystemLog.error("[RedemptionCode] 无法解析兑换玩家身份", error);
        return redemptionFailure("not_ready", "玩家身份数据尚未就绪");
      }

      const availability = assessRedemptionAvailability(record, playerIdentityId, Date.now());
      if (!availability.ok) {
        return redemptionFailure(availability.reason, availabilityMessage(availability.reason));
      }

      if (availability.resumePrepared) {
        return this.completePreparedClaim(record, playerIdentityId, false).result;
      }

      // 额度占位前先检查完整容量；creditGoldOnce 会在提交钱包时再次校验。
      try {
        const wallet = economic.getWallet(player.name);
        if (wallet.gold > MONEY_SCOREBOARD_MAX - record.gold) {
          return redemptionFailure("balance_limit_exceeded", availabilityMessage("balance_limit_exceeded"));
        }
      } catch (error) {
        SystemLog.error("[RedemptionCode] 读取钱包容量失败", error);
        return redemptionFailure("not_ready", "钱包数据尚未就绪");
      }

      const prepared = cloneRecord(record);
      const now = Date.now();
      prepared.claims[playerIdentityId] = {
        playerIdentityId,
        playerName: player.name,
        status: "prepared",
        preparedAt: now,
        updatedAt: now,
      };

      try {
        // prepared 必须先立即落库，之后才允许触碰钱包。
        this.saveRecord(prepared);
      } catch (error) {
        // 恢复到占位前的缓存快照；旧记录已经是最近一次持久化状态。
        this.db.set(record.id, record);
        SystemLog.error("[RedemptionCode] 领取占位保存失败", error);
        return redemptionFailure("persistence_error", availabilityMessage("persistence_error"));
      }

      return this.completePreparedClaim(prepared, playerIdentityId, false).result;
    } finally {
      this.releaseCodeLock(found.id);
    }
  }

  private completePreparedClaim(
    record: IRedemptionCode,
    playerIdentityId: string,
    recoveryRun: boolean
  ): PreparedCompletionResult {
    const claim = record.claims[playerIdentityId];
    if (!claim || claim.status !== "prepared") {
      return {
        result: redemptionFailure("recovery_required", availabilityMessage("recovery_required")),
        outcome: "recovery_required",
      };
    }

    const playerName = identityService.getProfileById(playerIdentityId)?.currentName ?? claim.playerName;
    let creditResult: ICreditGoldOnceResult;
    try {
      creditResult = economic.creditGoldOnce({
        playerName,
        playerIdentityId,
        amount: record.gold,
        reason: "兑换码金币奖励",
        idempotencyKey: `redeem:v1:${record.id}:${playerIdentityId}`,
        ignoreDailyLimit: true,
      });
    } catch (error) {
      SystemLog.error("[RedemptionCode] 幂等发奖调用异常", error);
      creditResult = { status: "retryable_error", reason: "wallet_unavailable" };
    }

    if (creditResult.status === "credited" || creditResult.status === "already_credited") {
      const latest = this.db?.get(record.id) ?? record;
      const granted = cloneRecord(latest);
      const currentClaim = granted.claims[playerIdentityId] ?? claim;
      const now = Date.now();
      granted.claims[playerIdentityId] = {
        ...currentClaim,
        playerName,
        status: "granted",
        grantedAt: currentClaim.grantedAt ?? now,
        updatedAt: now,
        recoveryReason: undefined,
      };

      let persistencePending = false;
      try {
        this.saveRecord(granted);
      } catch (error) {
        // 钱包余额与收据已经确认提交。保留 granted 缓存并依靠 Database 的脏库重试；
        // 若此刻重启，持久化的 prepared 会凭同一收据安全推进。
        persistencePending = true;
        SystemLog.error("[RedemptionCode] 到账后的领取状态保存失败", error);
      }

      return {
        result: {
          ok: true,
          codeId: record.id,
          code: record.code,
          gold: creditResult.amount,
          balance: creditResult.balance,
          alreadyCredited: creditResult.status === "already_credited",
          ...(persistencePending ? { persistencePending: true } : {}),
        },
        outcome: creditResult.status === "already_credited" ? "already_credited" : "granted",
      };
    }

    if (creditResult.status === "rejected") {
      // 启动恢复时经济关闭属于临时状态：保留 prepared，等待下次正常恢复，
      // 但仍允许 creditGoldOnce 在系统关闭时先识别已存在的幂等收据。
      if (recoveryRun && creditResult.reason === "economy_disabled") {
        return {
          result: redemptionFailure("economy_disabled", availabilityMessage("economy_disabled")),
          outcome: "skipped",
        };
      }

      const latest = this.db?.get(record.id) ?? record;
      const released = cloneRecord(latest);
      delete released.claims[playerIdentityId];
      try {
        this.saveRecord(released);
      } catch (error) {
        SystemLog.error("[RedemptionCode] 拒绝发奖后的占位释放失败", error);
        this.markRecoveryRequired(latest, playerIdentityId, `release_persistence_failed:${creditResult.reason}`);
        return {
          result: redemptionFailure("persistence_error", availabilityMessage("persistence_error")),
          outcome: "recovery_required",
        };
      }

      const reason: RedemptionFailureReason =
        creditResult.reason === "balance_limit_exceeded"
          ? "balance_limit_exceeded"
          : creditResult.reason === "economy_disabled"
            ? "economy_disabled"
            : "rejected";
      return {
        result: redemptionFailure(reason, availabilityMessage(reason)),
        outcome: "released",
      };
    }

    const failureReason: RedemptionFailureReason = creditResult.status === "conflict" ? "conflict" : "retryable_error";
    const detail =
      creditResult.status === "conflict"
        ? `idempotency_conflict:${creditResult.appliedAmount}->${creditResult.requestedAmount}`
        : creditResult.status === "retryable_error"
          ? `credit_retryable:${creditResult.reason}`
          : "credit_result_unknown";
    this.markRecoveryRequired(this.db?.get(record.id) ?? record, playerIdentityId, detail);
    return {
      result: redemptionFailure(failureReason, availabilityMessage(failureReason)),
      outcome: "recovery_required",
    };
  }

  private markRecoveryRequired(record: IRedemptionCode, playerIdentityId: string, reason: string): void {
    const claim = record.claims[playerIdentityId];
    if (!claim) return;
    const recovery = cloneRecord(record);
    recovery.claims[playerIdentityId] = {
      ...claim,
      status: "recovery_required",
      recoveryReason: reason,
      updatedAt: Date.now(),
    };
    try {
      this.saveRecord(recovery);
    } catch (error) {
      // Database.set 已将 recovery_required 留在缓存，并会继续参与自动保存。
      SystemLog.error("[RedemptionCode] 异常领取状态保存失败", error);
    }
  }

  recoverPreparedClaims(limit: number = RECOVERY_BATCH_SIZE): RedemptionRecoverySummary {
    const summary: RedemptionRecoverySummary = {
      inspected: 0,
      granted: 0,
      alreadyCredited: 0,
      released: 0,
      recoveryRequired: 0,
      skipped: 0,
    };
    const db = this.db;
    if (!db) return summary;

    const allWork = db.values().flatMap((record) =>
      Object.values(record.claims ?? {})
        .filter((claim) => claim.status === "prepared")
        .map((claim) => ({ codeId: record.id, playerIdentityId: claim.playerIdentityId }))
    );

    if (allWork.length === 0) {
      this.recoveryCursor = 0;
      return summary;
    }

    const boundedLimit = Math.max(1, Math.min(allWork.length, Math.floor(limit) || RECOVERY_BATCH_SIZE));
    const start = this.recoveryCursor % allWork.length;
    const work = Array.from({ length: boundedLimit }, (_, offset) => allWork[(start + offset) % allWork.length]!);
    this.recoveryCursor = (start + boundedLimit) % allWork.length;

    for (const item of work) {
      summary.inspected++;
      if (!this.acquireCodeLock(item.codeId)) {
        summary.skipped++;
        continue;
      }
      try {
        const latest = db.get(item.codeId);
        if (!latest || latest.claims[item.playerIdentityId]?.status !== "prepared") {
          summary.skipped++;
          continue;
        }
        const completed = this.completePreparedClaim(latest, item.playerIdentityId, true);
        if (completed.outcome === "granted") summary.granted++;
        else if (completed.outcome === "already_credited") summary.alreadyCredited++;
        else if (completed.outcome === "released") summary.released++;
        else if (completed.outcome === "recovery_required") summary.recoveryRequired++;
        else summary.skipped++;
      } finally {
        this.releaseCodeLock(item.codeId);
      }
    }
    return summary;
  }

  setEnabled(admin: Player, id: string, enabled: boolean): RedemptionMutationResult {
    if (!isAdmin(admin)) return adminFailure("forbidden", "只有管理员可以修改兑换码状态");
    const db = this.db;
    if (!db) return adminFailure("not_ready", "兑换码数据尚未就绪");
    if (!this.acquireCodeLock(id)) return adminFailure("busy", "兑换码正在处理中，请稍后重试");

    try {
      const record = db.get(id);
      if (!record) return adminFailure("not_found", "兑换码不存在");
      if (record.status === "archived") return adminFailure("invalid_state", "归档兑换码不能恢复或停用");
      if (enabled && isRedemptionCodeExpired(record, Date.now())) {
        return adminFailure("expired", "过期兑换码不能恢复启用");
      }
      if (enabled && isRedemptionCodeExhausted(record)) {
        return adminFailure("exhausted", "已领完的兑换码不能恢复启用");
      }

      const next = cloneRecord(record);
      next.status = enabled ? "active" : "disabled";
      try {
        this.saveRecord(next);
      } catch (error) {
        db.set(id, record);
        SystemLog.error("[RedemptionCode] 状态保存失败", error);
        return adminFailure("persistence_error", "兑换码状态保存失败");
      }
      return {
        ok: true,
        code: toRedemptionCodeView(next, Date.now()),
        message: enabled ? "兑换码已恢复" : "兑换码已停用",
      };
    } finally {
      this.releaseCodeLock(id);
    }
  }

  archive(admin: Player, id: string): RedemptionMutationResult {
    if (!isAdmin(admin)) return adminFailure("forbidden", "只有管理员可以归档兑换码");
    const db = this.db;
    if (!db) return adminFailure("not_ready", "兑换码数据尚未就绪");
    if (!this.acquireCodeLock(id)) return adminFailure("busy", "兑换码正在处理中，请稍后重试");

    try {
      const record = db.get(id);
      if (!record) return adminFailure("not_found", "兑换码不存在");
      if (record.status === "archived") return adminFailure("invalid_state", "兑换码已经归档");
      const next = cloneRecord(record);
      next.status = "archived";
      try {
        this.saveRecord(next);
      } catch (error) {
        db.set(id, record);
        SystemLog.error("[RedemptionCode] 归档保存失败", error);
        return adminFailure("persistence_error", "兑换码归档失败");
      }
      return {
        ok: true,
        code: toRedemptionCodeView(next, Date.now()),
        message: "兑换码已永久归档",
      };
    } finally {
      this.releaseCodeLock(id);
    }
  }

  resolveRecovery(
    admin: Player,
    id: string,
    playerIdentityId: string,
    action: RedemptionRecoveryResolutionAction
  ): RedemptionMutationResult {
    if (!isAdmin(admin)) return adminFailure("forbidden", "只有管理员可以处理异常领取");
    const db = this.db;
    if (!db) return adminFailure("not_ready", "兑换码数据尚未就绪");
    if (action !== "mark_granted" && action !== "release") {
      return adminFailure("invalid_state", "未知的异常处理操作");
    }
    if (!this.acquireCodeLock(id)) return adminFailure("busy", "兑换码正在处理中，请稍后重试");

    try {
      const record = db.get(id);
      if (!record) return adminFailure("not_found", "兑换码不存在");
      const claim = record.claims[playerIdentityId];
      if (!claim) return adminFailure("claim_not_found", "领取记录不存在");
      if (claim.status !== "recovery_required") {
        return adminFailure("claim_not_recoverable", "只有异常领取记录可以人工处理");
      }

      let resolvedById: string;
      try {
        resolvedById = identityService.resolvePlayerKeyForPlayer(admin);
      } catch (error) {
        SystemLog.error("[RedemptionCode] 无法解析异常处理管理员身份", error);
        return adminFailure("identity_unavailable", "管理员身份数据尚未就绪");
      }

      const now = Date.now();
      const next = cloneRecord(record);
      if (action === "mark_granted") {
        next.claims[playerIdentityId] = {
          ...claim,
          status: "granted",
          grantedAt: claim.grantedAt ?? now,
          updatedAt: now,
          recoveryReason: undefined,
        };
      } else {
        delete next.claims[playerIdentityId];
      }
      next.recoveryResolutions = [
        ...(next.recoveryResolutions ?? []),
        {
          playerIdentityId,
          playerName: claim.playerName,
          action,
          resolvedAt: now,
          resolvedById,
          resolvedByName: admin.name,
        },
      ];

      try {
        // 人工处理只改变领取状态与占位，绝不直接改钱包。
        this.saveRecord(next);
      } catch (error) {
        db.set(id, record);
        SystemLog.error("[RedemptionCode] 异常领取处理保存失败", error);
        return adminFailure("persistence_error", "异常领取处理保存失败");
      }

      return {
        ok: true,
        code: toRedemptionCodeView(next, now),
        message: action === "mark_granted" ? "已标记为到账（未修改金币）" : "已撤销占位（未修改金币）",
      };
    } finally {
      this.releaseCodeLock(id);
    }
  }
}

const redemptionCodeService = new RedemptionCodeService();
export default redemptionCodeService;

export type {
  CreateRedemptionCodeInput,
  CreateRedemptionCodeResult,
  IRedemptionCode,
  IRedemptionCodeClaim,
  RedemptionCodeView,
  RedemptionMutationResult,
  RedemptionRecoveryResolutionAction,
  RedemptionRecoverySummary,
  RedemptionResult,
} from "../models/redemption-code.model";
