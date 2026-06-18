/**
 * 随机传送服务
 * 完整迁移自 Modules/OtherFun/RandomTp.ts (36行)
 */

import { Dimension, Player, Vector3 } from "@minecraft/server";
import { useNotify } from "../../../shared/hooks/use-notify";
import { MinecraftEffectTypes } from "@minecraft/vanilla-data";
import setting from "../../system/services/setting";
import landManager from "../../land/services/land-manager";

/**
 * 生成指定范围的随机数
 */
export const RandomNumber = (min: number, max: number): number => {
  return Math.floor(Math.random() * (max - min + 1) + min);
};

const MAX_RANDOM_TP_ATTEMPTS = 48;
const UNSAFE_SURFACE_BLOCK_KEYWORDS = ["water", "lava", "fire", "cactus", "magma", "powder_snow"];

function isUnsafeSurface(typeId: string): boolean {
  return UNSAFE_SURFACE_BLOCK_KEYWORDS.some((keyword) => typeId.includes(keyword));
}

function findSafeRandomLocation(player: Player, range: number): Vector3 | undefined {
  const dimension = player.dimension as Dimension;
  const minY = dimension.heightRange.min;
  const maxY = dimension.heightRange.max;

  for (let attempt = 0; attempt < MAX_RANDOM_TP_ATTEMPTS; attempt++) {
    const x = RandomNumber(-range, range);
    const z = RandomNumber(-range, range);

    for (let y = maxY - 1; y > minY + 1; y--) {
      const ground = dimension.getBlock({ x, y, z });
      if (!ground || ground.isAir || isUnsafeSurface(ground.typeId)) continue;

      const feet = dimension.getBlock({ x, y: y + 1, z });
      const head = dimension.getBlock({ x, y: y + 2, z });
      if (!feet?.isAir || !head?.isAir) continue;

      const target = { x: x + 0.5, y: y + 1, z: z + 0.5 };
      const { isInside } = landManager.testLand(target, dimension.id);
      if (isInside) break;

      return target;
    }
  }

  return undefined;
}

/**
 * 随机传送玩家
 */
export const RandomTp = (player: Player): void => {
  const randomTeleport = setting.getState("randomTeleport");
  if (!randomTeleport) return;

  const range = setting.getState("randomTpRange");
  const normalizedRange = Math.max(1, Math.floor(Math.abs(Number(range))));
  const target = findSafeRandomLocation(player, normalizedRange);
  if (!target) {
    useNotify("actionbar", player, "§c随机传送失败：未找到安全且不在领地内的落点，请稍后重试。");
    return;
  }

  player.teleport(target);

  const addEffects: MinecraftEffectTypes[] = [
    MinecraftEffectTypes.FireResistance,
    MinecraftEffectTypes.NightVision,
    MinecraftEffectTypes.Resistance,
  ];

  addEffects.forEach((effect) => {
    player.addEffect(effect, 600, {
      showParticles: false,
      amplifier: 255,
    });
  });

  useNotify("actionbar", player, `§a你已传送到了坐标: §e${Math.floor(target.x)} ${Math.floor(target.y)} ${Math.floor(target.z)}`);
};
