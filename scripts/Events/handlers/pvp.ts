/**
 * PVP事件处理器
 */

import { world, system, Player } from "@minecraft/server";
import { eventRegistry } from "../registry";
import pvpManager from "../../features/pvp/services/pvp-manager";
import effectManager from "../../features/pvp/services/effect-manager";
import statsManager from "../../features/pvp/services/pvp-stats";
import { color } from "../../shared/utils/color";
import { useNotify } from "../../shared/hooks";

/**
 * 注册PVP事件处理器
 */
export function registerPvpEvents(): void {
  // ==================== PVP伤害处理 ====================

  /**
   * 处理实体受伤事件（PVP核心逻辑）
   */
  world.beforeEvents.entityHurt.subscribe((event) => {
    const { hurtEntity, damageSource } = event;

    // 只处理玩家攻击玩家
    if (hurtEntity.typeId !== "minecraft:player") return;
    if (damageSource.damagingEntity?.typeId !== "minecraft:player") return;

    const attacker = damageSource.damagingEntity as Player;
    const victim = hurtEntity as Player;

    // 防止自己攻击自己
    if (attacker.id === victim.id) {
      event.cancel = true;
      return;
    }

    // 检查是否可以PVP
    if (!pvpManager.canPvp(attacker, victim)) {
      event.cancel = true;

      // 延迟发送消息（beforeEvents中不能直接发送）
      const attackerName = attacker.name;
      system.run(() => {
        const p = world.getAllPlayers().find((pl) => pl.name === attackerName);
        if (p) {
          useNotify("chat", p, color.red("该玩家未开启PVP或PVP功能未启用"));
        }
      });
      return;
    }

    // 进入战斗状态
    pvpManager.enterCombat(attacker, victim);
  });

  // ==================== PVP击杀处理 ====================

  /**
   * 处理玩家死亡事件（PVP击杀统计）
   */
  world.afterEvents.entityDie.subscribe((event) => {
    const { deadEntity, damageSource } = event;

    // 只处理玩家死亡
    if (deadEntity.typeId !== "minecraft:player") return;

    // 检查是否是玩家击杀
    if (damageSource.damagingEntity?.typeId !== "minecraft:player") return;

    const killer = damageSource.damagingEntity as Player;
    const victim = deadEntity as Player;

    // 防止自己击杀自己
    if (killer.id === victim.id) return;

    // 检查PVP是否启用（额外验证）
    const config = pvpManager.getConfig();
    if (!config.enabled) return;

    // 播放击杀特效
    effectManager.playKillEffects(killer, victim);

    // 处理击杀统计和金币夺取
    statsManager.handleKill(killer, victim);
  });

  // ==================== 战斗超时检查 ====================

  /**
   * 定时检查战斗超时（每秒一次）
   */
  system.runInterval(() => {
    pvpManager.checkCombatTimeout();
  }, 20); // 20 ticks = 1秒
}

// 注册到事件中心
eventRegistry.register("pvp", registerPvpEvents);

