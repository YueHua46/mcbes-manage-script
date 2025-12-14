/**
 * 领地粒子效果服务
 * 完整迁移自 Modules/Particle.ts
 */

import { Player, system, Vector3 } from '@minecraft/server';
import { color } from '../../../shared/utils/color';

class LandParticle {
  /**
   * 在指定位置创建领地标记粒子
   */
  createLandParticle(player: Player, pos: Vector3): void {
    system.run(() => {
      try {
        player.spawnParticle('minecraft:endrod', {
          x: pos.x + 0.5,
          y: pos.y + 0.3,
          z: pos.z + 0.5,
        });
      } catch (error) {
        // 忽略粒子生成错误
      }
    });
  }

  /**
   * 创建领地区域粒子效果（方框）
   */
  createLandParticleArea(player: Player, pos: Vector3[]): void {
    system.run(() => {
      const startPos = pos[0];
      const endPos = pos[1];

      if (startPos.y === endPos.y) {
        // 如果Y值相同，创建XZ平面上的2D矩形
        const corners = [
          { x: startPos.x, y: startPos.y, z: startPos.z },
          { x: endPos.x, y: startPos.y, z: startPos.z },
          { x: startPos.x, y: startPos.y, z: endPos.z },
          { x: endPos.x, y: startPos.y, z: endPos.z },
        ];

        const edges = [
          [corners[0], corners[1]],
          [corners[1], corners[3]],
          [corners[3], corners[2]],
          [corners[2], corners[0]],
        ];

        for (const [start, end] of edges) {
          this.createParticleLine(player, start, end);
        }
      } else {
        // 创建3D立方体
        const corners = [
          { x: startPos.x, y: startPos.y, z: startPos.z },
          { x: endPos.x, y: startPos.y, z: startPos.z },
          { x: startPos.x, y: endPos.y, z: startPos.z },
          { x: endPos.x, y: endPos.y, z: startPos.z },
          { x: startPos.x, y: startPos.y, z: endPos.z },
          { x: endPos.x, y: startPos.y, z: endPos.z },
          { x: startPos.x, y: endPos.y, z: endPos.z },
          { x: endPos.x, y: endPos.y, z: endPos.z },
        ];

        const edges = [
          [corners[0], corners[1]],
          [corners[1], corners[3]],
          [corners[3], corners[2]],
          [corners[2], corners[0]], // 底部
          [corners[4], corners[5]],
          [corners[5], corners[7]],
          [corners[7], corners[6]],
          [corners[6], corners[4]], // 顶部
          [corners[0], corners[4]],
          [corners[1], corners[5]],
          [corners[2], corners[6]],
          [corners[3], corners[7]], // 垂直边
        ];

        for (const [start, end] of edges) {
          this.createParticleLine(player, start, end);
        }
      }
    });
  }

  /**
   * 在两点之间创建粒子线
   */
  createParticleLine(player: Player, startPos: Vector3, endPos: Vector3): void {
    const distance = Math.sqrt(
      Math.pow(endPos.x - startPos.x, 2) +
      Math.pow(endPos.y - startPos.y, 2) +
      Math.pow(endPos.z - startPos.z, 2)
    );

    if (distance === 0) {
      return; // 起始点和结束点相同
    }

    const steps = Math.ceil(distance / 1.5); // 调整粒子间距
    const step = {
      x: (endPos.x - startPos.x) / steps,
      y: (endPos.y - startPos.y) / steps,
      z: (endPos.z - startPos.z) / steps,
    };

    for (let i = 0; i <= steps; i++) {
      const pos = {
        x: startPos.x + step.x * i,
        y: startPos.y + step.y * i,
        z: startPos.z + step.z * i,
      };

      if (isNaN(pos.x) || isNaN(pos.y) || isNaN(pos.z)) {
        player.sendMessage(color.red('错误：生成粒子时出现无效坐标'));
        return;
      }

      try {
        player.spawnParticle('minecraft:endrod', {
          x: pos.x + 0.5,
          y: pos.y + 0.3,
          z: pos.z + 0.5,
        });
      } catch (error) {
        // 忽略粒子生成错误
      }
    }
  }

  /**
   * 计算区域方块数量
   */
  getAreaBlocks(startPos: Vector3, endPos: Vector3): number {
    const x = Math.abs(startPos.x - endPos.x);
    const y = Math.abs(startPos.y - endPos.y);
    const z = Math.abs(startPos.z - endPos.z);
    return x * y * z;
  }
}

export default new LandParticle();


