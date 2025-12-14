/**
 * 怪物击杀奖励服务
 * 完整迁移自 Modules/Economic/MonsterKillReward.ts (44行)
 */

import { world, Player } from "@minecraft/server";
import economic from "./economic";
import setting from "../../system/services/setting";
import { colorCodes } from "../../../shared/utils/color";
import { monsterByGold } from "../data/monster-by-gold";

// 订阅实体死亡事件
world.afterEvents.entityDie.subscribe((event) => {
  // 如果经济系统关闭，直接返回
  if (!setting.getState("economy")) return;
  // 如果杀怪掉金币功能关闭，直接返回
  if (!setting.getState("monsterKillGoldReward")) return;

  const { deadEntity, damageSource } = event;

  // 检查是否是玩家击杀
  if (damageSource.damagingEntity?.typeId === "minecraft:player") {
    const player = damageSource.damagingEntity as Player;
    const entityType = deadEntity.typeId;
    const fullType = deadEntity.typeId;
    const monsterName = fullType.includes(":") ? fullType.split(":")[1] : fullType;

    // 检查是否有对应的金币奖励
    const reward = monsterByGold[monsterName];
    if (reward) {
      // 随机生成奖励金额
      const min = reward[0] || 0;
      const max = reward[1] || min;
      const amount = Math.floor(Math.random() * (max - min + 1)) + min;

      if (amount > 0) {
        // 添加金币（应用每日限制）
        const actualEarned = economic.addGold(player.name, amount, `击杀怪物 ${monsterName}`);
        const wallet = economic.getWallet(player.name);

        // 今日金币获取未达到上限才显示提示
        if (!(wallet.dailyEarned >= economic.getDailyGoldLimit())) {
          player.runCommand(
            `title @s actionbar ${colorCodes.yellow}击杀了 ${colorCodes.materialRedstone}${monsterName} ${colorCodes.yellow}获得了 ${colorCodes.materialGold}${amount} ${colorCodes.yellow}金币`
          );
        }
      }
    }
  }
});

export {};
