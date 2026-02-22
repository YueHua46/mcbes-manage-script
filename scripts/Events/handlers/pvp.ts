/**
 * PVP事件处理器
 */

import { world, system, Player, EntityDamageCause } from "@minecraft/server";
import { eventRegistry } from "../registry";
import pvpManager from "../../features/pvp/services/pvp-manager";
import effectManager from "../../features/pvp/services/effect-manager";
import statsManager from "../../features/pvp/services/pvp-stats";
import landManager from "../../features/land/services/land-manager";
import { isAdmin } from "../../shared/utils/common";
import { color } from "../../shared/utils/color";
import { useNotify } from "../../shared/hooks";

// 用于跟踪玩家的战斗状态（用于触发进入战斗特效）
const playerCombatStatus = new Map<string, boolean>();

// PVP 火焰来源追踪：受害玩家 ID → 被玩家攻击的时间戳
// 用于拦截 fireTick（damagingEntity 为空）造成的持续燃烧伤害
const pvpFireSourceMap = new Map<string, number>();
const PVP_FIRE_SOURCE_TIMEOUT_MS = 15_000;

/**
 * 检查是否可以PVP并返回详细原因
 */
function checkPvpWithReason(
  attacker: Player,
  victim: Player
): { canPvp: boolean; reason: string } {
  // 1. 检查全局开关
  const config = pvpManager.getConfig();
  if (!config.enabled) {
    return {
      canPvp: false,
      reason: color.red("⚠ PVP功能未启用！请联系管理员开启"),
    };
  }

  // 2. 管理员可以攻击任何人（直接返回成功）
  if (isAdmin(attacker)) {
    return { canPvp: true, reason: "" };
  }

  // 3. 检查攻击者PVP状态
  const attackerData = pvpManager.getPlayerData(attacker.name);
  if (!attackerData.pvpEnabled) {
    return {
      canPvp: false,
      reason: `${color.red("⚠ 你自己")}${color.yellow("还没有开启PVP！")}\n${color.aqua("→ 打开服务器菜单 → PVP系统 → 开启PVP")}`,
    };
  }

  // 4. 检查被攻击者PVP状态
  const victimData = pvpManager.getPlayerData(victim.name);
  if (!victimData.pvpEnabled) {
    return {
      canPvp: false,
      reason: `${color.red("⚠ 对方")} ${color.yellow(victim.name)} ${color.red("没有开启PVP！")}`,
    };
  }

  // 5. 检查领地保护
  const { isInside, insideLand } = landManager.testLand(victim.location, victim.dimension.id);
  if (isInside) {
    return {
      canPvp: false,
      reason: `${color.red("⚠ 领地内禁止PVP！")}\n${color.yellow("领地主人：")}${color.green(insideLand?.owner || "未知")}`,
    };
  }

  // 所有检查通过
  return { canPvp: true, reason: "" };
}

/**
 * 注册PVP事件处理器
 */
export function registerPvpEvents(): void {
  // ==================== PVP伤害处理 ====================

  /**
   * 处理实体受伤事件（PVP核心逻辑）
   *
   * 覆盖两类场景：
   *   情形一：damagingEntity 为玩家的直接攻击（entityAttack / fire / fireTick）
   *   情形二：fire/fireTick 且 damagingEntity 为空 —— 查 pvpFireSourceMap 兜底拦截
   */
  world.beforeEvents.entityHurt.subscribe((event) => {
    const { hurtEntity, damageSource } = event;
    const cause = damageSource.cause;

    // 只处理玩家受伤
    if (hurtEntity.typeId !== "minecraft:player") return;

    const victim = hurtEntity as Player;
    const isFireDamage =
      cause === EntityDamageCause.fire || cause === EntityDamageCause.fireTick;

    // ===== 情形二：fire/fireTick 且无 damagingEntity（fireTick 兜底）=====
    if (isFireDamage && !damageSource.damagingEntity) {
      const fireTs = pvpFireSourceMap.get(victim.id);
      if (fireTs && Date.now() - fireTs < PVP_FIRE_SOURCE_TIMEOUT_MS) {
        event.cancel = true;
        system.run(() => {
          try {
            victim.extinguishFire(true);
          } catch (_) {}
        });
      } else {
        pvpFireSourceMap.delete(victim.id);
      }
      return;
    }

    // ===== 情形一：伤害来源明确是另一位玩家 =====
    if (damageSource.damagingEntity?.typeId !== "minecraft:player") return;

    const attacker = damageSource.damagingEntity as Player;

    // 防止自己攻击自己
    if (attacker.id === victim.id) {
      event.cancel = true;
      return;
    }

    // 检查是否可以PVP
    const canPvpResult = checkPvpWithReason(attacker, victim);
    if (!canPvpResult.canPvp) {
      event.cancel = true;

      // 记录火焰来源，供后续 fireTick 兜底使用
      pvpFireSourceMap.set(victim.id, Date.now());

      const attackerName = attacker.name;
      const errorMessage = canPvpResult.reason;

      system.run(() => {
        try {
          victim.extinguishFire(true);
          victim.clearVelocity();
        } catch (_) {}
        // 仅在直接攻击时通知，避免 fire/fireTick 事件造成消息刷屏
        if (!isFireDamage) {
          const p = world.getAllPlayers().find((pl) => pl.name === attackerName);
          if (p) {
            useNotify("chat", p, errorMessage);
          }
        }
      });
      return;
    }

    // PVP 合法：进入战斗状态并播放特效
    const attackerWasInCombat = playerCombatStatus.get(attacker.name) || false;
    const victimWasInCombat = playerCombatStatus.get(victim.name) || false;

    pvpManager.enterCombat(attacker, victim);

    system.run(() => {
      try {
        effectManager.playHitEffects(attacker, victim);

        if (!attackerWasInCombat) {
          effectManager.playEnterCombatEffects(attacker);
          playerCombatStatus.set(attacker.name, true);
        }
        if (!victimWasInCombat) {
          effectManager.playEnterCombatEffects(victim);
          playerCombatStatus.set(victim.name, true);
        }
      } catch (error) {
        console.warn("播放PVP战斗特效失败:", error);
      }
    });
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

    // 获取击杀者的数据（用于获取连杀数）
    const killerData = pvpManager.getPlayerData(killer.name);

    // 播放击杀特效（传入当前连杀数+1，因为还没更新统计）
    effectManager.playKillEffects(killer, victim, killerData.killStreak + 1);

    // 处理击杀统计和金币夺取
    statsManager.handleKill(killer, victim);

    // 清除被击杀者的战斗状态标记
    playerCombatStatus.delete(victim.name);
  });

  // ==================== 战斗超时检查和计时器显示 ====================

  /**
   * 定时检查战斗超时并显示战斗计时器（每秒一次）
   */
  system.runInterval(() => {
    const config = pvpManager.getConfig();
    const combatDuration = config.combatTagDuration;

    // 检查所有在线玩家的战斗状态
    world.getAllPlayers().forEach((player) => {
      try {
        const playerData = pvpManager.getPlayerData(player.name);

        if (playerData.inCombat) {
          // 计算剩余战斗时间
          const now = Date.now();
          const timeSinceLastCombat = now - playerData.lastCombatTime;
          const remainingTime = Math.max(
            0,
            combatDuration - Math.floor(timeSinceLastCombat / 1000)
          );

          // 显示战斗计时器
          if (remainingTime > 0) {
            effectManager.showCombatTimer(player, remainingTime);
          }

          // 如果战斗时间结束，播放脱离战斗特效
          if (remainingTime === 0 && playerCombatStatus.get(player.name)) {
            effectManager.playExitCombatEffects(player);
            playerCombatStatus.delete(player.name);
          }
        }
      } catch (error) {
        // 忽略错误，继续处理其他玩家
      }
    });

    // 检查战斗超时
    pvpManager.checkCombatTimeout();
  }, 20); // 20 ticks = 1秒

  // ==================== 玩家离开清理 ====================

  /**
   * 玩家离开时清理战斗状态标记
   */
  world.afterEvents.playerLeave.subscribe((event) => {
    playerCombatStatus.delete(event.playerName);
    // 清理离线受害者的火焰来源记录
    const leavingPlayer = world.getAllPlayers().find((pl) => pl.name === event.playerName);
    if (leavingPlayer) {
      pvpFireSourceMap.delete(leavingPlayer.id);
    }
  });
}

// 注册到事件中心
eventRegistry.register("pvp", registerPvpEvents);

