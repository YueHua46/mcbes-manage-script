/**
 * 怪物击杀奖励服务
 * 完整迁移自 Modules/Economic/MonsterKillReward.ts (44行)
 */

import { world, Player } from "@minecraft/server";
import economic from "./economic";
import setting from "../../system/services/setting";
import { colorCodes } from "../../../shared/utils/color";
import {
  getMonsterLocalizationKey,
  getMonsterRewardOverrides,
  monsterByGold,
} from "../data/monster-by-gold";
import { isRealPlayerEntity } from "../../../shared/utils/online-players";

// 订阅实体死亡事件
world.afterEvents.entityDie.subscribe((event) => {
  // 如果经济系统关闭，直接返回
  if (!setting.getState("economy")) return;
  // 如果杀怪掉金币功能关闭，直接返回
  if (!setting.getState("monsterKillGoldReward")) return;

  const { deadEntity, damageSource } = event;
  // Bedrock 1.26 can invalidate a dead entity before later entityDie
  // subscribers run. Never dereference dimension/type data after invalidation.
  if (!deadEntity.isValid) return;

  // 检查是否是玩家击杀
  if (damageSource.damagingEntity?.typeId === "minecraft:player") {
    const player = damageSource.damagingEntity as Player;
    if (!isRealPlayerEntity(player)) return;
    const fullType = deadEntity.typeId;
    const monsterName = fullType.includes(":") ? fullType.split(":")[1] : fullType;

    // 检查是否有对应的金币奖励
    const customRanges = getMonsterRewardOverrides(setting.getState("monsterKillRewardRanges"));
    const reward = customRanges[monsterName] ?? monsterByGold[monsterName];
    if (reward) {
      // 随机生成奖励金额
      const min = reward[0] || 0;
      const max = reward[1] || min;
      const amount = Math.floor(Math.random() * (max - min + 1)) + min;

      if (amount > 0) {
        // 添加金币（应用每日限制）
        const actualEarned = economic.addGold(player.name, amount, `击杀怪物 ${monsterName}`);
        // 按实际到账金额显示，避免每日上限截断后提示比到账更多。
        if (actualEarned > 0) {
          const localizationKey = getMonsterLocalizationKey(fullType);
          player.onScreenDisplay.setActionBar({
            rawtext: [
              { text: `${colorCodes.yellow}击杀了 ${colorCodes.materialRedstone}` },
              localizationKey ? { translate: localizationKey } : { text: monsterName },
              {
                text: ` ${colorCodes.yellow}获得了 ${colorCodes.materialGold}${actualEarned} ${colorCodes.yellow}金币`,
              },
            ],
          });
        }
      }
    }
  }
});

export {};
