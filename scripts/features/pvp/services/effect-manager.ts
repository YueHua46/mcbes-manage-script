/**
 * PVP效果管理器
 * 处理击杀特效（粒子效果和音效）
 */

import { Player, world, system } from "@minecraft/server";
import type { Vector3 } from "../../../core/types";

class EffectManager {
  /**
   * 播放击杀特效（粒子效果和音效）
   */
  playKillEffects(killer: Player, victim: Player): void {
    const location = victim.location;
    const dimension = victim.dimension;

    // 使用 system.run 延迟执行，确保在正确的时机播放
    system.run(() => {
      try {
        // 生成多种粒子效果增强视觉冲击
        // 1. 大爆炸粒子（主要效果）
        try {
          dimension.spawnParticle("minecraft:huge_explosion", location);
        } catch (error) {
          // 忽略粒子错误
        }

        // 2. 爆炸粒子（增强效果）
        try {
          dimension.spawnParticle("minecraft:explosion", location);
        } catch (error) {
          // 忽略粒子错误
        }

        // 3. 火焰粒子（增加视觉冲击）
        try {
          dimension.spawnParticle("minecraft:flame_particle", location);
        } catch (error) {
          // 忽略粒子错误
        }

        // 4. 烟雾粒子（增加氛围）
        try {
          dimension.spawnParticle("minecraft:smoke_particle", location);
        } catch (error) {
          // 忽略粒子错误
        }

        // 为击杀者播放音效
        try {
          // 使用爆炸音效
          killer.playSound("random.explode");
          // 也可以播放雷鸣音效作为补充
          system.runTimeout(() => {
            try {
              killer.playSound("ambient.weather.thunder");
            } catch (error) {
              // 忽略音效错误
            }
          }, 5);
        } catch (error) {
          console.warn(`为击杀者播放音效失败:`, error);
        }

        // 为周围50格内的所有玩家播放音效
        const nearbyPlayers = world.getAllPlayers().filter((p) => {
          if (p.dimension.id !== dimension.id) return false;
          return this.getDistance(p.location, location) < 50;
        });

        nearbyPlayers.forEach((p) => {
          try {
            p.playSound("random.explode");
            // 延迟播放雷鸣音效
            system.runTimeout(() => {
              try {
                p.playSound("ambient.weather.thunder");
              } catch (error) {
                // 忽略音效错误
              }
            }, 5);
          } catch (error) {
            // 忽略音效错误
          }
        });
      } catch (error) {
        console.warn("播放击杀特效失败:", error);
      }
    });
  }

  /**
   * 计算两点之间的距离
   */
  private getDistance(loc1: Vector3, loc2: Vector3): number {
    return Math.sqrt(Math.pow(loc1.x - loc2.x, 2) + Math.pow(loc1.y - loc2.y, 2) + Math.pow(loc1.z - loc2.z, 2));
  }
}

export default new EffectManager();
