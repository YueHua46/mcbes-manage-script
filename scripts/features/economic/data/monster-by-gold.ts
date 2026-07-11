/**
 * 怪物击杀金币奖励配置
 * 迁移自 Modules/Economic/data/monsterByGold.ts
 */

import { EntityTypes } from "@minecraft/server";

export const monsterByGold: Record<string, [number, number]> = {
  zombie: [1, 10],
  zombie_pigman: [2, 20],
  zombie_villager: [1, 10],
  zombie_villager_v2: [1, 10],
  zoglin: [3, 30],
  wither: [1000, 3000],
  wither_skeleton: [20, 50],
  witch: [10, 20],
  warden: [1000, 3000],
  vindicator: [10, 20],
  vex: [10, 20],
  stray: [10, 20],
  spider: [1, 5],
  slime: [1, 5],
  skeleton: [5, 10],
  silverfish: [1, 5],
  shulker: [10, 20],
  ravager: [10, 20],
  pillager: [10, 20],
  piglin: [5, 10],
  piglin_brute: [5, 10],
  phantom: [10, 15],
  magma_cube: [5, 20],
  husk: [5, 10],
  guardian: [10, 20],
  ghast: [10, 20],
  evocation_illager: [20, 30],
  enderman: [10, 20],
  ender_dragon: [1000, 5000],
  elder_guardian: [300, 1000],
  elder_guardian_ghost: [100, 300],
  drowned: [5, 10],
  creeper: [5, 10],
  cave_spider: [10, 10],
  breeze: [100, 200],
  bogged: [10, 20],
  blaze: [10, 20],
  endermite: [1, 5],
  evocation_fang: [5, 10],
  hoglin: [5, 15],
};

export function getMonsterLocalizationKey(monsterId: string): string | undefined {
  const typeId = monsterId.includes(":") ? monsterId : `minecraft:${monsterId}`;
  return EntityTypes.get(typeId as any)?.localizationKey;
}

export function normalizeMonsterRewardRange(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const first = Math.floor(Number(value[0]));
  const second = Math.floor(Number(value[1]));
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(second) || first < 0 || second < 0) return undefined;
  return first <= second ? [first, second] : [second, first];
}

export function getMonsterRewardOverrides(raw: unknown): Record<string, [number, number]> {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string, [number, number]> = {};
    for (const [monster, value] of Object.entries(parsed)) {
      const range = normalizeMonsterRewardRange(value);
      if (range) result[monster] = range;
    }
    return result;
  } catch {
    return {};
  }
}

