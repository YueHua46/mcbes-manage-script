/**
 * 随机传送服务
 * 完整迁移自 Modules/OtherFun/RandomTp.ts (36行)
 */

import { Player } from "@minecraft/server";
import { useNotify } from "../../../shared/hooks/use-notify";
import { MinecraftEffectTypes } from "@minecraft/vanilla-data";
import setting from "../../system/services/setting";

/**
 * 生成指定范围的随机数
 */
export const RandomNumber = (min: number, max: number): number => {
  return Math.floor(Math.random() * (max - min + 1) + min);
};

/**
 * 随机传送玩家
 */
export const RandomTp = (player: Player): void => {
  const randomTeleport = setting.getState("randomTeleport");
  if (!randomTeleport) return;

  const range = setting.getState("randomTpRange");
  const x = RandomNumber(-Math.abs(Number(range)), Math.abs(Number(range)));
  const z = RandomNumber(-Math.abs(Number(range)), Math.abs(Number(range)));
  let y = player.dimension.heightRange.max;

  player.teleport({ x, y, z });

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

  useNotify("actionbar", player, `§a你已传送到了坐标: §e${x} ${y} ${z}`);
};
