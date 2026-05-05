/**
 * 领地粒子效果服务
 * 完整迁移自 Modules/Particle.ts
 */

import { Player, system, Vector3 } from '@minecraft/server';
import { color } from '../../../shared/utils/color';

/** 与原先一致的粒子间距（方块距离 / 步数） */
const PARTICLE_SPACING = 1.5;
/** 单次 runJob 时间片内最多生成的粒子数，避免单 tick 过重触发 Watchdog */
const PARTICLES_PER_JOB_SLICE = 72;
/** 单条边上采样步数上限（含端点共 steps+1 个粒子）；过大领地防止刷爆脚本 */
const MAX_STEPS_PER_LINE = 512;
/** 单次 createLandParticleArea 粒子总数上限（跨所有边） */
/** 12 条边 × (MAX_STEPS_PER_LINE+1) 端点粒子时的上界约 6156，略留余量 */
const MAX_PARTICLES_PER_AREA_CALL = 6200;

type Edge = readonly [Vector3, Vector3];

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
      if (!player.isValid) {
        return;
      }
      const startPos = pos[0];
      const endPos = pos[1];
      const edges = this.getLandAreaEdges(startPos, endPos);
      if (edges.length === 0) {
        return;
      }
      system.runJob(this.areaParticleGenerator(player, edges));
    });
  }

  /**
   * 在两点之间创建粒子线（异步分片，不阻塞当前 tick）
   */
  createParticleLine(player: Player, startPos: Vector3, endPos: Vector3): void {
    system.run(() => {
      if (!player.isValid) {
        return;
      }
      system.runJob(this.lineParticleGenerator(player, startPos, endPos, MAX_STEPS_PER_LINE));
    });
  }

  private getLandAreaEdges(startPos: Vector3, endPos: Vector3): Edge[] {
    if (startPos.y === endPos.y) {
      const corners = [
        { x: startPos.x, y: startPos.y, z: startPos.z },
        { x: endPos.x, y: startPos.y, z: startPos.z },
        { x: startPos.x, y: startPos.y, z: endPos.z },
        { x: endPos.x, y: startPos.y, z: endPos.z },
      ];
      return [
        [corners[0], corners[1]],
        [corners[1], corners[3]],
        [corners[3], corners[2]],
        [corners[2], corners[0]],
      ];
    }

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
    return [
      [corners[0], corners[1]],
      [corners[1], corners[3]],
      [corners[3], corners[2]],
      [corners[2], corners[0]],
      [corners[4], corners[5]],
      [corners[5], corners[7]],
      [corners[7], corners[6]],
      [corners[6], corners[4]],
      [corners[0], corners[4]],
      [corners[1], corners[5]],
      [corners[2], corners[6]],
      [corners[3], corners[7]],
    ];
  }

  private *areaParticleGenerator(player: Player, edges: Edge[]): Generator<void, void, void> {
    let spawnedTotal = 0;
    let sliceCount = 0;

    for (const [startPos, endPos] of edges) {
      for (const particle of this.iterLineParticles(player, startPos, endPos, MAX_STEPS_PER_LINE)) {
        if (spawnedTotal >= MAX_PARTICLES_PER_AREA_CALL) {
          return;
        }
        if (!player.isValid) {
          return;
        }
        this.spawnEndrod(player, particle);
        spawnedTotal++;
        sliceCount++;
        if (sliceCount >= PARTICLES_PER_JOB_SLICE) {
          sliceCount = 0;
          yield;
        }
      }
    }
  }

  private *lineParticleGenerator(
    player: Player,
    startPos: Vector3,
    endPos: Vector3,
    maxSteps: number
  ): Generator<void, void, void> {
    let sliceCount = 0;
    for (const particle of this.iterLineParticles(player, startPos, endPos, maxSteps)) {
      if (!player.isValid) {
        return;
      }
      this.spawnEndrod(player, particle);
      sliceCount++;
      if (sliceCount >= PARTICLES_PER_JOB_SLICE) {
        sliceCount = 0;
        yield;
      }
    }
  }

  private *iterLineParticles(
    player: Player,
    startPos: Vector3,
    endPos: Vector3,
    maxSteps: number
  ): Generator<Vector3, void, void> {
    const distance = Math.sqrt(
      Math.pow(endPos.x - startPos.x, 2) +
        Math.pow(endPos.y - startPos.y, 2) +
        Math.pow(endPos.z - startPos.z, 2)
    );

    if (distance === 0) {
      return;
    }

    let steps = Math.ceil(distance / PARTICLE_SPACING);
    if (steps > maxSteps) {
      steps = maxSteps;
    }
    if (steps < 1) {
      steps = 1;
    }

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

      yield pos;
    }
  }

  private spawnEndrod(player: Player, pos: Vector3): void {
    try {
      player.spawnParticle('minecraft:endrod', {
        x: pos.x + 0.5,
        y: pos.y + 0.3,
        z: pos.z + 0.5,
      });
    } catch {
      // 忽略粒子生成错误
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
