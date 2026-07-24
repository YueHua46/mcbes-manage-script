/**
 * 将不受 Realms 支持的新版模拟玩家记录降级为旧版实体假人。
 *
 * 保持为纯函数，方便在没有 Minecraft 运行时的 Node 测试中验证数据迁移。
 */

const SIMULATED_ONLY_KEYS = [
  "entityId",
  "isDead",
  "diedAt",
  "deathReason",
  "deathSourceLocalizationKey",
  "deathSourceName",
  "deathCause",
  "gameMode",
  "inventory",
  "behavior",
  "program",
] as const;

function normalizeLegacySkinId(value: unknown): number {
  const skinId = Math.floor(Number(value));
  return Number.isFinite(skinId) && skinId >= 0 && skinId <= 15 ? skinId : 0;
}

export function migrateFakePlayerRecordForRealms<T extends { type?: unknown; skinId?: unknown }>(
  source: T
): { record: T; changed: boolean } {
  if (source.type === "entity") {
    return { record: source, changed: false };
  }

  const migrated: Record<string, unknown> = {
    ...source,
    type: "entity",
    skinId: normalizeLegacySkinId(source.skinId),
  };
  for (const key of SIMULATED_ONLY_KEYS) {
    delete migrated[key];
  }
  return { record: migrated as T, changed: true };
}
