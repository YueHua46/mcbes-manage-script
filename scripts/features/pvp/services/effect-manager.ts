/**
 * PVP效果管理器
 * 处理所有PVP相关的视觉和听觉效果
 */

import { Player, world, system } from "@minecraft/server";
import type { Vector3 } from "../../../core/types";
import { color } from "../../../shared/utils/color";

class EffectManager {
  private combatStatusTimers = new Map<string, number>();

  /**
   * 播放击杀特效（根据连杀数调整效果强度）
   */
  playKillEffects(killer: Player, victim: Player, killStreak: number): void {
    const location = victim.location;
    const dimension = victim.dimension;

    system.run(() => {
      try {
        // 根据连杀数确定效果级别
        const effectLevel = this.getEffectLevel(killStreak);

        // 播放粒子效果
        this.spawnKillParticles(dimension, location, effectLevel);

        // 播放音效
        this.playKillSounds(killer, location, dimension, effectLevel);

        // 显示击杀Title
        this.showKillTitle(killer, victim, killStreak);

        // 播放连杀特效
        if (killStreak >= 3) {
          this.playStreakEffects(killer, killStreak);
        }
      } catch (error) {
        console.warn("播放击杀特效失败:", error);
      }
    });
  }

  /**
   * 播放攻击命中特效
   */
  playHitEffects(attacker: Player, victim: Player): void {
    system.run(() => {
      try {
        const location = victim.location;
        const dimension = victim.dimension;

        // 血液粒子效果
        try {
          dimension.spawnParticle("minecraft:redstone_dust", {
            x: location.x,
            y: location.y + 1,
            z: location.z,
          });
        } catch (error) {
          // 忽略粒子错误
        }

        // 打击音效（较轻的音效）
        try {
          attacker.playSound("random.break", { pitch: 1.2, volume: 0.5 });
          victim.playSound("game.player.hurt", { volume: 0.8 });
        } catch (error) {
          // 忽略音效错误
        }

        // 显示伤害反馈（Actionbar）
        try {
          attacker.onScreenDisplay.setActionBar(
            `${color.red("⚔")} ${color.yellow("命中")} ${color.red(victim.name)}`
          );
        } catch (error) {
          // 忽略显示错误
        }
      } catch (error) {
        console.warn("播放攻击特效失败:", error);
      }
    });
  }

  /**
   * 播放进入战斗特效
   */
  playEnterCombatEffects(player: Player): void {
    system.run(() => {
      try {
        // 播放警告音效
        player.playSound("note.bass", { pitch: 0.5, volume: 1.0 });

        // 显示战斗状态Title
        player.onScreenDisplay.setTitle(`${color.red("⚔ 进入战斗 ⚔")}`, {
          fadeInDuration: 5,
          fadeOutDuration: 10,
          stayDuration: 20,
          subtitle: `${color.yellow("战斗中无法切换PVP状态")}`,
        });

        // 播放红色粒子环绕效果（持续2秒）
        this.spawnCombatAura(player, 40); // 40 ticks = 2秒
      } catch (error) {
        console.warn("播放进入战斗特效失败:", error);
      }
    });
  }

  /**
   * 播放脱离战斗特效
   */
  playExitCombatEffects(player: Player): void {
    system.run(() => {
      try {
        // 播放舒缓音效
        player.playSound("random.levelup", { pitch: 1.5, volume: 0.8 });

        // 显示脱离战斗提示
        player.onScreenDisplay.setActionBar(
          `${color.green("✓")} ${color.aqua("已脱离战斗状态")}`
        );

        // 播放绿色粒子效果
        const location = player.location;
        try {
          player.dimension.spawnParticle("minecraft:villager_happy", {
            x: location.x,
            y: location.y + 1,
            z: location.z,
          });
        } catch (error) {
          // 忽略粒子错误
        }
      } catch (error) {
        console.warn("播放脱离战斗特效失败:", error);
      }
    });
  }

  /**
   * 显示战斗状态计时器（在Actionbar持续显示）
   */
  showCombatTimer(player: Player, remainingSeconds: number): void {
    try {
      const bars = "█".repeat(Math.ceil(remainingSeconds));
      player.onScreenDisplay.setActionBar(
        `${color.red("⚔")} ${color.yellow("战斗中")} ${color.red(bars)} ${color.yellow(remainingSeconds + "s")}`
      );
    } catch (error) {
      // 忽略显示错误
    }
  }

  /**
   * 根据连杀数获取效果级别
   */
  private getEffectLevel(killStreak: number): number {
    if (killStreak >= 10) return 5; // 传奇
    if (killStreak >= 7) return 4; // 史诗
    if (killStreak >= 5) return 3; // 疯狂
    if (killStreak >= 3) return 2; // 连杀
    return 1; // 普通
  }

  /**
   * 生成击杀粒子效果
   */
  private spawnKillParticles(dimension: any, location: Vector3, level: number): void {
    try {
      // 基础爆炸效果
      dimension.spawnParticle("minecraft:huge_explosion", location);

      if (level >= 2) {
        // 2级：添加火焰
        dimension.spawnParticle("minecraft:flame_particle", location);
        dimension.spawnParticle("minecraft:lava_particle", location);
      }

      if (level >= 3) {
        // 3级：添加闪电效果的替代（使用末影人粒子）
        for (let i = 0; i < 5; i++) {
          system.runTimeout(() => {
            try {
              dimension.spawnParticle("minecraft:endrod", {
                x: location.x,
                y: location.y + i * 0.5,
                z: location.z,
              });
            } catch (error) {
              // 忽略粒子错误
            }
          }, i * 2);
        }
      }

      if (level >= 4) {
        // 4级：添加龙息粒子
        dimension.spawnParticle("minecraft:dragon_breath", location);
        dimension.spawnParticle("minecraft:wither_explosion", location);
      }

      if (level >= 5) {
        // 5级：添加图腾效果
        dimension.spawnParticle("minecraft:totem_particle", location);
        // 环绕粒子效果
        for (let angle = 0; angle < 360; angle += 30) {
          const rad = (angle * Math.PI) / 180;
          const x = location.x + Math.cos(rad) * 2;
          const z = location.z + Math.sin(rad) * 2;
          try {
            dimension.spawnParticle("minecraft:sonic_explosion", {
              x,
              y: location.y + 1,
              z,
            });
          } catch (error) {
            // 忽略粒子错误
          }
        }
      }
    } catch (error) {
      console.warn("生成击杀粒子失败:", error);
    }
  }

  /**
   * 播放击杀音效
   */
  private playKillSounds(
    killer: Player,
    location: Vector3,
    dimension: any,
    level: number
  ): void {
    try {
      // 基础击杀音效
      killer.playSound("random.explode", { volume: 1.0 });

      if (level >= 2) {
        // 2级：添加雷鸣
        system.runTimeout(() => {
          try {
            killer.playSound("ambient.weather.thunder", { volume: 1.0 });
          } catch (error) {
            // 忽略音效错误
          }
        }, 3);
      }

      if (level >= 3) {
        // 3级：添加末影龙咆哮
        system.runTimeout(() => {
          try {
            killer.playSound("mob.enderdragon.growl", { pitch: 1.2, volume: 0.8 });
          } catch (error) {
            // 忽略音效错误
          }
        }, 8);
      }

      if (level >= 4) {
        // 4级：添加凋零音效
        system.runTimeout(() => {
          try {
            killer.playSound("mob.wither.spawn", { pitch: 1.5, volume: 0.7 });
          } catch (error) {
            // 忽略音效错误
          }
        }, 12);
      }

      if (level >= 5) {
        // 5级：添加升级音效和钟声
        system.runTimeout(() => {
          try {
            killer.playSound("random.levelup", { pitch: 0.8, volume: 1.0 });
            killer.playSound("block.bell.hit", { pitch: 0.5, volume: 1.0 });
          } catch (error) {
            // 忽略音效错误
          }
        }, 15);
      }

      // 为周围玩家播放音效
      this.playNearbySound(location, dimension, "random.explode", 50, {
        volume: 0.8,
      });
    } catch (error) {
      console.warn("播放击杀音效失败:", error);
    }
  }

  /**
   * 显示击杀Title
   */
  private showKillTitle(killer: Player, victim: Player, killStreak: number): void {
    try {
      let title = `${color.red("☠")} ${color.yellow("击杀")} ${color.red("☠")}`;
      let subtitle = `${color.gold(victim.name)}`;

      if (killStreak >= 3) {
        const streakText = this.getStreakText(killStreak);
        subtitle = `${color.gold(victim.name)} ${color.aqua("·")} ${streakText}`;
      }

      killer.onScreenDisplay.setTitle(title, {
        fadeInDuration: 5,
        fadeOutDuration: 15,
        stayDuration: 30,
        subtitle,
      });
    } catch (error) {
      console.warn("显示击杀Title失败:", error);
    }
  }

  /**
   * 播放连杀特效
   */
  private playStreakEffects(killer: Player, killStreak: number): void {
    try {
      const location = killer.location;
      const dimension = killer.dimension;

      // 连杀光环效果
      for (let i = 0; i < 3; i++) {
        system.runTimeout(() => {
          try {
            for (let angle = 0; angle < 360; angle += 45) {
              const rad = (angle * Math.PI) / 180;
              const radius = 1.5 + i * 0.3;
              const x = location.x + Math.cos(rad) * radius;
              const z = location.z + Math.sin(rad) * radius;
              dimension.spawnParticle("minecraft:critical_hit_emitter", {
                x,
                y: location.y + 1 + i * 0.3,
                z,
              });
            }
          } catch (error) {
            // 忽略粒子错误
          }
        }, i * 5);
      }

      // 播放特殊音效
      if (killStreak === 3) {
        killer.playSound("random.orb", { pitch: 1.2, volume: 1.0 });
      } else if (killStreak === 5) {
        killer.playSound("mob.enderdragon.flap", { pitch: 1.5, volume: 0.8 });
      } else if (killStreak >= 10) {
        killer.playSound("ui.toast.challenge_complete", { volume: 1.0 });
      }
    } catch (error) {
      console.warn("播放连杀特效失败:", error);
    }
  }

  /**
   * 生成战斗光环（环绕玩家）
   */
  private spawnCombatAura(player: Player, duration: number): void {
    let tick = 0;
    const intervalId = system.runInterval(() => {
      try {
        if (tick >= duration) {
          system.clearRun(intervalId);
          return;
        }

        const location = player.location;
        const angle = (tick * 18) % 360; // 每tick旋转18度
        const rad = (angle * Math.PI) / 180;
        const radius = 1.2;

        const x = location.x + Math.cos(rad) * radius;
        const z = location.z + Math.sin(rad) * radius;

        try {
          player.dimension.spawnParticle("minecraft:dust_particle", {
            x,
            y: location.y + 1,
            z,
          });
        } catch (error) {
          // 忽略粒子错误
        }

        tick++;
      } catch (error) {
        system.clearRun(intervalId);
      }
    }, 1);
  }

  /**
   * 为附近玩家播放音效
   */
  private playNearbySound(
    location: Vector3,
    dimension: any,
    soundId: string,
    radius: number,
    options?: any
  ): void {
    try {
      const nearbyPlayers = world.getAllPlayers().filter((p) => {
        if (p.dimension.id !== dimension.id) return false;
        return this.getDistance(p.location, location) < radius;
      });

      nearbyPlayers.forEach((p) => {
        try {
          p.playSound(soundId, options);
        } catch (error) {
          // 忽略音效错误
        }
      });
    } catch (error) {
      console.warn("为附近玩家播放音效失败:", error);
    }
  }

  /**
   * 获取连杀文本
   */
  private getStreakText(killStreak: number): string {
    if (killStreak >= 10) return `${color.minecoinGold("传奇连杀")} ${color.red(killStreak.toString())}`;
    if (killStreak >= 7) return `${color.lightPurple("史诗连杀")} ${color.red(killStreak.toString())}`;
    if (killStreak >= 5) return `${color.gold("疯狂连杀")} ${color.red(killStreak.toString())}`;
    if (killStreak >= 3) return `${color.aqua("连杀")} ${color.yellow(killStreak.toString())}`;
    return "";
  }

  /**
   * 计算两点之间的距离
   */
  private getDistance(loc1: Vector3, loc2: Vector3): number {
    return Math.sqrt(
      Math.pow(loc1.x - loc2.x, 2) +
        Math.pow(loc1.y - loc2.y, 2) +
        Math.pow(loc1.z - loc2.z, 2)
    );
  }
}

export default new EffectManager();
