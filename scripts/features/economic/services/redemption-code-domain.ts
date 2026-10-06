import type {
  CreateRedemptionCodeInput,
  IRedemptionCode,
  RedemptionClaimCounts,
  RedemptionCodeView,
} from "../models/redemption-code.model";

export const REDEMPTION_CODE_MAX_CHARACTERS = 64;
export const REDEMPTION_CODE_GENERATED_PATTERN =
  /^CM-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/;
export const REDEMPTION_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const REDEMPTION_GOLD_MAX = 2_147_483_647;
export const REDEMPTION_EXPIRY_HOUR_MS = 60 * 60 * 1000;

export type RedemptionCodeValidationResult =
  | { ok: true; code: string }
  | { ok: false; reason: "invalid_code"; message: string };

export type RedemptionCreateValidationResult =
  | {
      ok: true;
      generated: boolean;
      customCode?: string;
      gold: number;
      maxUses: number | null;
      expiresAt: number | null;
    }
  | {
      ok: false;
      reason: "invalid_code" | "invalid_gold" | "invalid_max_uses" | "invalid_expiry";
      message: string;
    };

export type RedemptionAvailability =
  | { ok: true; resumePrepared: boolean }
  | {
      ok: false;
      reason: "already_claimed" | "recovery_required" | "archived" | "disabled" | "expired" | "exhausted";
    };

function isControlCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x00 && codePoint <= 0x1f) ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x2028 ||
    codePoint === 0x2029 ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff)
  );
}

/**
 * 验证明文兑换码。成功时原样返回，绝不 trim、折叠空格或变更大小写。
 */
export function validateRedemptionCode(rawCode: unknown): RedemptionCodeValidationResult {
  if (typeof rawCode !== "string") {
    return { ok: false, reason: "invalid_code", message: "兑换码必须是文本" };
  }

  const characters = Array.from(rawCode);
  if (characters.length === 0 || rawCode.trim().length === 0) {
    return { ok: false, reason: "invalid_code", message: "兑换码不能留空或只包含空白字符" };
  }
  if (characters.length > REDEMPTION_CODE_MAX_CHARACTERS) {
    return {
      ok: false,
      reason: "invalid_code",
      message: `兑换码不能超过 ${REDEMPTION_CODE_MAX_CHARACTERS} 个字符`,
    };
  }
  if (rawCode.includes("§")) {
    return { ok: false, reason: "invalid_code", message: "兑换码不能包含格式控制符 §" };
  }
  if (characters.some((character) => isControlCodePoint(character.codePointAt(0)!))) {
    return { ok: false, reason: "invalid_code", message: "兑换码不能包含换行或控制字符" };
  }

  return { ok: true, code: rawCode };
}

/** 验证创建参数，并把有效小时数转换为绝对过期时间。 */
export function validateCreateRedemptionInput(
  input: CreateRedemptionCodeInput,
  now: number
): RedemptionCreateValidationResult {
  const generated = input.code === undefined || input.code === "";
  let customCode: string | undefined;
  if (!generated) {
    const codeResult = validateRedemptionCode(input.code);
    if (!codeResult.ok) return codeResult;
    customCode = codeResult.code;
  }

  if (!Number.isInteger(input.gold) || input.gold < 1 || input.gold > REDEMPTION_GOLD_MAX) {
    return {
      ok: false,
      reason: "invalid_gold",
      message: `奖励金币必须是 1 至 ${REDEMPTION_GOLD_MAX} 的整数`,
    };
  }

  if (input.maxUses !== null && (!Number.isSafeInteger(input.maxUses) || input.maxUses < 1)) {
    return { ok: false, reason: "invalid_max_uses", message: "限量次数必须是正整数，或设为无限" };
  }

  let expiresAt: number | null = null;
  if (input.expiresInHours !== null) {
    if (!Number.isSafeInteger(input.expiresInHours) || input.expiresInHours < 1) {
      return { ok: false, reason: "invalid_expiry", message: "有效小时数必须是正整数，或设为永久" };
    }
    const duration = input.expiresInHours * REDEMPTION_EXPIRY_HOUR_MS;
    if (!Number.isSafeInteger(duration) || !Number.isSafeInteger(now) || !Number.isSafeInteger(now + duration)) {
      return { ok: false, reason: "invalid_expiry", message: "有效期超出可保存范围" };
    }
    expiresAt = now + duration;
  }

  return {
    ok: true,
    generated,
    customCode,
    gold: input.gold,
    maxUses: input.maxUses,
    expiresAt,
  };
}

function normalizeRandom(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(0.9999999999999999, Math.max(0, value));
}

/**
 * 以时间、tick、调用盐和随机源共同扰动字符流。唯一性仍由持久化服务检查；
 * 注入 random 参数可让领域测试稳定覆盖碰撞重试。
 */
export function generateRedemptionCode(options: {
  now: number;
  tick: number;
  salt: number;
  random?: () => number;
}): string {
  const random = options.random ?? Math.random;
  let state =
    ((options.now & 0xffffffff) ^
      Math.imul(options.tick | 0, 0x9e3779b1) ^
      Math.imul(options.salt | 0, 0x85ebca6b) ^
      Math.floor(normalizeRandom(random()) * 0xffffffff)) >>>
    0;

  const nextIndex = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state = (state ^ Math.floor(normalizeRandom(random()) * 0xffffffff)) >>> 0;
    return state % REDEMPTION_CODE_ALPHABET.length;
  };

  const groups: string[] = [];
  for (let group = 0; group < 3; group++) {
    let value = "";
    for (let index = 0; index < 4; index++) {
      value += REDEMPTION_CODE_ALPHABET[nextIndex()];
    }
    groups.push(value);
  }
  return `CM-${groups.join("-")}`;
}

/** 生成与明文码无关、包含足够随机位的内部记录 id。 */
export function generateRedemptionCodeId(options: {
  now: number;
  tick: number;
  salt: number;
  random?: () => number;
}): string {
  const random = options.random ?? Math.random;
  let suffix = "";
  for (let block = 0; block < 5; block++) {
    const generated = generateRedemptionCode({
      ...options,
      salt: options.salt + block * 7919,
      random,
    }).replace(/CM-|-/g, "");
    suffix += generated.slice(0, 4);
  }
  return `rc_${Math.max(0, Math.floor(options.now)).toString(36)}_${suffix}`;
}

export function getRedemptionClaimCounts(record: IRedemptionCode): RedemptionClaimCounts {
  const counts: RedemptionClaimCounts = {
    prepared: 0,
    granted: 0,
    recoveryRequired: 0,
    reserved: 0,
  };

  for (const claim of Object.values(record.claims ?? {})) {
    if (claim.status === "prepared") counts.prepared++;
    else if (claim.status === "granted") counts.granted++;
    else if (claim.status === "recovery_required") counts.recoveryRequired++;
  }
  counts.reserved = counts.prepared + counts.granted + counts.recoveryRequired;
  return counts;
}

export function isRedemptionCodeExpired(record: IRedemptionCode, now: number): boolean {
  return record.expiresAt !== null && now >= record.expiresAt;
}

export function isRedemptionCodeExhausted(record: IRedemptionCode): boolean {
  return record.maxUses !== null && getRedemptionClaimCounts(record).reserved >= record.maxUses;
}

/**
 * 新领取必须依次通过生命周期、时间和总额度校验。已经 prepared 的领取优先恢复，
 * 因而不会被之后的停用、归档或过期打断。
 */
export function assessRedemptionAvailability(
  record: IRedemptionCode,
  playerIdentityId: string,
  now: number
): RedemptionAvailability {
  const claim = record.claims?.[playerIdentityId];
  if (claim?.status === "granted") return { ok: false, reason: "already_claimed" };
  if (claim?.status === "recovery_required") return { ok: false, reason: "recovery_required" };
  if (claim?.status === "prepared") return { ok: true, resumePrepared: true };

  if (record.status === "archived") return { ok: false, reason: "archived" };
  if (record.status === "disabled") return { ok: false, reason: "disabled" };
  if (isRedemptionCodeExpired(record, now)) return { ok: false, reason: "expired" };
  if (isRedemptionCodeExhausted(record)) return { ok: false, reason: "exhausted" };
  return { ok: true, resumePrepared: false };
}

export function toRedemptionCodeView(record: IRedemptionCode, now: number): RedemptionCodeView {
  const counts = getRedemptionClaimCounts(record);
  const expired = isRedemptionCodeExpired(record, now);
  const exhausted = record.maxUses !== null && counts.reserved >= record.maxUses;
  return {
    ...record,
    claims: Object.fromEntries(
      Object.entries(record.claims ?? {}).map(([identityId, claim]) => [identityId, { ...claim }])
    ),
    recoveryResolutions: record.recoveryResolutions?.map((resolution) => ({ ...resolution })),
    counts,
    remainingUses: record.maxUses === null ? null : Math.max(0, record.maxUses - counts.reserved),
    expired,
    exhausted,
  };
}
