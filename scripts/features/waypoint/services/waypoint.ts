/**
 * 路径点系统服务
 * 完整迁移自 Modules/WayPoint/WayPoint.ts (167行)
 */

import { Player, system, Vector3, world } from "@minecraft/server";
import { Database } from "../../../shared/database/database";
import { useNotify } from "../../../shared/hooks/use-notify";
import { isAdmin } from "../../../shared/utils/common";
import { color } from "../../../shared/utils/color";
import setting, { IValueType } from "../../system/services/setting";

export interface IWayPoint {
  name: string;
  location: Vector3;
  playerName: string;
  dimension: string;
  created: string;
  modified: string;
  type: "public" | "private";
  isStarred?: boolean;
}

interface ICreateWayPoint {
  pointName: string;
  location: Vector3;
  player: Player;
  type?: "public" | "private";
}

interface IUpdateWayPoint {
  pointName: string;
  updatePointName?: string;
  player: Player;
  isUpdateLocation: boolean;
}

/**
 * 获取当前日期时间字符串
 */
function getNowDate(): string {
  const now = new Date();
  return now.toLocaleString("zh-CN");
}

class WayPoint {
  private db!: Database<IWayPoint>;

  /**
   * 粒子类型列表，可以定义多个粒子类型，生成时会随机从列表中均匀选择
   */
  private readonly PARTICLE_TYPES = ["minecraft:mob_portal"];

  constructor() {
    system.run(() => {
      this.db = new Database<IWayPoint>("waypoint");
    });
  }

  private formatLocation(location: Vector3): Vector3 {
    return {
      x: Number(location.x.toFixed(0)),
      y: Number(location.y.toFixed(0)),
      z: Number(location.z.toFixed(0)),
    };
  }

  createPoint(pointOption: ICreateWayPoint): void | string {
    const { pointName, location, player, type = "private" } = pointOption;
    let maxPoints: IValueType = "10";
    if (type === "private") {
      maxPoints = setting.getState("maxPrivatePointsPerPlayer");
    } else {
      maxPoints = setting.getState("maxPublicPointsPerPlayer");
    }
    const playerPoints = this.getPointsByPlayer(player.name).filter((p) => p.type === type);

    if (!isAdmin(player) && playerPoints.length >= Number(maxPoints)) {
      return type === "private" ? "您的私人坐标点数量已达到服务器设置上限" : "您的公开坐标点数量已达到服务器设置上限";
    }

    if (!pointName || !location || !player) return "参数错误";
    if (this.db.get(pointName)) return "该坐标点名称已存在，请换一个名称";

    const time = getNowDate();
    const wayPoint: IWayPoint = {
      name: pointName,
      location: this.formatLocation(location),
      playerName: player.name,
      dimension: player.dimension.id,
      created: time,
      modified: time,
      type: type,
    };
    return this.db.set(wayPoint.name, wayPoint);
  }

  getPoint(pointName: string): IWayPoint | undefined {
    return this.db.get(pointName);
  }

  getPoints(): IWayPoint[] {
    return this.db.values();
  }

  getPlayerPoints(player: Player): IWayPoint[] {
    return this.db.values().filter((p) => p.playerName === player.name && p.type === "private");
  }

  getPublicPoints(): IWayPoint[] {
    return this.db.values().filter((p) => p.type === "public");
  }

  deletePoint(pointName: string): boolean | string {
    if (this.db.get(pointName)) {
      return this.db.delete(pointName);
    }
    return "坐标点不存在";
  }

  updatePoint(updateArgs: IUpdateWayPoint): void | string {
    const { pointName, updatePointName, player, isUpdateLocation } = updateArgs;
    const wayPoint = this.db.get(pointName);
    if (!wayPoint) return "坐标点不存在";

    if (updatePointName && updatePointName !== pointName && this.db.get(updatePointName)) {
      return "新的坐标点名称已存在，请换一个名称";
    }

    if (isUpdateLocation) {
      wayPoint.location = this.formatLocation(player.location);
      wayPoint.dimension = player.dimension.id;
    }

    if (updatePointName && updatePointName !== pointName) {
      this.db.delete(pointName);
      wayPoint.name = updatePointName;
    }

    wayPoint.modified = getNowDate();
    return this.db.set(wayPoint.name, wayPoint);
  }

  checkOwner(player: Player, pointName: string): boolean {
    const _wayPoint = this.db.get(pointName);
    if (!_wayPoint) return false;
    return _wayPoint.playerName === player.name;
  }

  teleport(player: Player, pointName: string): void | string {
    const wayPoint = this.db.get(pointName);
    if (!wayPoint) return "坐标点不存在";

    // 保存传送前的位置和维度
    const startLocation = player.location;
    const startDimension = player.dimension;
    const targetLocation = wayPoint.location;
    const targetDimension = world.getDimension(wayPoint.dimension);

    // 粒子效果渐进系统（独立于倒计时）
    let particleIntensity = 0.0;
    const particleStep = 0.03;
    let countdownInterval: number | undefined;
    const particleInterval = system.runInterval(() => {
      try {
        if (!player || !player.location) {
          system.clearRun(particleInterval);
          if (countdownInterval !== undefined) {
            system.clearRun(countdownInterval);
          }
          return;
        }

        // 检查玩家是否移动（如果移动则取消传送）
        const currentLocation = player.location;
        const moved =
          Math.abs(currentLocation.x - startLocation.x) > 0.5 ||
          Math.abs(currentLocation.y - startLocation.y) > 0.5 ||
          Math.abs(currentLocation.z - startLocation.z) > 0.5;

        if (moved && particleIntensity > 0.1) {
          system.clearRun(particleInterval);
          if (countdownInterval !== undefined) {
            system.clearRun(countdownInterval);
          }
          player.onScreenDisplay.setTitle("");
          player.onScreenDisplay.setActionBar(color.red("传送已取消：检测到移动"));
          player.playSound("random.pop");
          return;
        }

        // 渐进式增加粒子强度（最多到1.0）
        const currentPlayerLocation = player.location;
        if (particleIntensity < 1.0) {
          particleIntensity = Math.min(1.0, particleIntensity + particleStep);
          this.createProgressiveParticles(player, currentPlayerLocation, particleIntensity, false);
        } else {
          // 达到最大强度后保持
          this.createProgressiveParticles(player, currentPlayerLocation, 1.0, false);
        }
      } catch (error) {
        system.clearRun(particleInterval);
      }
    }, 2); // 每2 ticks执行一次（约0.1秒），分成约60步，更平滑

    // 传送倒计时（3秒，独立于粒子效果）
    let countdown = 3;
    countdownInterval = system.runInterval(() => {
      // 检查玩家是否还在线（使用 try-catch）
      try {
        if (!player || !player.location) {
          system.clearRun(countdownInterval!);
          system.clearRun(particleInterval);
          return;
        }
      } catch (error) {
        system.clearRun(countdownInterval!);
        system.clearRun(particleInterval);
        return;
      }

      // 检查玩家是否移动（如果移动则取消传送）
      try {
        const currentLocation = player.location;
        const moved =
          Math.abs(currentLocation.x - startLocation.x) > 0.5 ||
          Math.abs(currentLocation.y - startLocation.y) > 0.5 ||
          Math.abs(currentLocation.z - startLocation.z) > 0.5;

        if (moved && countdown < 3) {
          system.clearRun(countdownInterval!);
          system.clearRun(particleInterval);
          player.onScreenDisplay.setTitle("");
          player.onScreenDisplay.setActionBar(color.red("传送已取消：检测到移动"));
          player.playSound("random.pop");
          return;
        }
      } catch (error) {
        // 忽略移动检测错误
      }

      // 显示倒计时
      if (countdown > 0) {
        // 屏幕标题显示倒计时（使用 runCommand 实现淡入淡出效果）
        player.runCommand(`title @s times 5 20 5`);
        player.runCommand(`title @s title §e${countdown}`);

        // 动作栏显示提示
        player.onScreenDisplay.setActionBar(`§b正在传送到 §e${pointName} §b... §7(请不要移动)`);

        // 播放倒计时音效
        player.playSound("random.click");

        countdown--;
      } else {
        // 倒计时结束，执行传送
        system.clearRun(countdownInterval!);
        system.clearRun(particleInterval);

        // 传送前的最后粒子效果（最大强度）
        this.createProgressiveParticles(player, startLocation, 1.0, false);

        // 执行传送
        system.run(() => {
          try {
            player.teleport(targetLocation, {
              dimension: targetDimension,
            });

            // 延迟一小段时间确保传送完成后再播放音效和效果
            system.runTimeout(() => {
              try {
                // 再次检查玩家是否有效
                if (!player || !player.location) return;

                // 传送后的效果（渐进式消失）
                this.startPostTeleportEffects(player, targetLocation, pointName);
              } catch (error) {
                // 静默处理错误，避免影响传送
              }
            }, 1); // 延迟1 tick确保传送完成
          } catch (error) {
            player.onScreenDisplay.setTitle("");
            player.onScreenDisplay.setActionBar(color.red("传送失败！"));
            try {
              player.playSound("random.break");
            } catch (soundError) {
              // 忽略音效错误
            }
          }
        });
      }
    }, 20); // 每1秒执行一次（20 ticks = 1秒）

    return undefined; // 返回undefined，因为传送是异步的
  }

  /**
   * 粒子类型（末影人传送的紫色粒子）
   */
  private readonly particleType = "minecraft:mob_portal";

  /**
   * 创建渐进式传送粒子效果
   * @param player 玩家
   * @param location 位置
   * @param intensity 强度 (0.0 - 1.0)，0.0为最少，1.0为最多
   * @param isPostTeleport 是否为传送后效果
   */
  private createProgressiveParticles(
    player: Player,
    location: Vector3,
    intensity: number,
    isPostTeleport: boolean
  ): void {
    // 检查玩家是否有效
    try {
      if (!player || !player.location) return;
    } catch (error) {
      return;
    }

    if (isPostTeleport) {
      // 传送后效果：随机分布在身体周围（从脚到头的范围内）
      this.createPostTeleportParticles(player, location, intensity);
    } else {
      // 传送前效果：从脚到头的螺旋环绕效果
      this.createPreTeleportParticles(player, location, intensity);
    }
  }

  /**
   * 创建传送前的粒子效果：随机分布在玩家周围（与传送后效果一致，只有数量从少到多）
   * @param player 玩家
   * @param location 位置
   * @param intensity 强度 (0.0 - 1.0)，0.0为最少，1.0为最多
   */
  private createPreTeleportParticles(player: Player, location: Vector3, intensity: number): void {
    const particleBaseCount = 10; // 每 tick 基础发射量
    const particleCount = Math.floor(particleBaseCount + particleBaseCount * 10 * intensity); // 强度越高，粒子越多（最多 110 个）
    const bodyHeight = 1.8; // 玩家身体高度
    const maxRadius = 1.5; // 最大分布半径

    // 分布范围和高度始终保持最大值（与传送后强度为1.0时一致）
    // 只有粒子数量随强度变化
    const currentRadius = maxRadius; // 始终使用最大半径
    const currentHeight = bodyHeight; // 始终使用最大高度

    for (let i = 0; i < particleCount; i++) {
      // 随机生成球形坐标
      // 使用球形随机分布算法，确保粒子均匀分布在玩家周围
      const u = Math.random() * 2 - 1; // -1 到 1
      const v = Math.random() * 2 * Math.PI; // 0 到 2π

      // 使用立方根分布，使粒子更集中在中心
      const radius = Math.cbrt(Math.random()) * currentRadius;

      // 计算 X 和 Z 坐标（水平面）
      const horizontalRadius = radius * Math.sqrt(1 - u * u);
      const x = location.x + horizontalRadius * Math.cos(v);
      const z = location.z + horizontalRadius * Math.sin(v);

      // Y 坐标：在玩家身体高度范围内随机分布（固定分布范围）
      const yOffset = 0.5 + Math.random() * currentHeight; // 从身体中部开始，始终使用最大高度范围
      const y = location.y + yOffset;

      const particleLocation: Vector3 = { x: x, y: y, z: z };

      try {
        // 从粒子列表中随机选择一个粒子类型生成
        const randomParticleType = this.PARTICLE_TYPES[Math.floor(Math.random() * this.PARTICLE_TYPES.length)];
        player.spawnParticle(randomParticleType, particleLocation);
      } catch (error) {
        // 忽略粒子生成错误
      }
    }
  }

  /**
   * 创建传送后的粒子效果：随机分布在玩家周围（与传送前效果一致，但强度递减）
   * @param player 玩家
   * @param location 位置
   * @param intensity 强度 (0.0 - 1.0)，0.0为最少，1.0为最多（从1.0递减到0.0）
   */
  private createPostTeleportParticles(player: Player, location: Vector3, intensity: number): void {
    const particleBaseCount = 10; // 每 tick 基础发射量（与传送前一致）
    const particleCount = Math.floor(particleBaseCount + particleBaseCount * 10 * intensity); // 强度越高，粒子越多（最多 110 个，与传送前一致）
    const bodyHeight = 1.8; // 玩家身体高度
    const maxRadius = 1.5; // 最大分布半径

    // 强度影响：
    // 1. 分布半径：强度越高，分布范围越大
    const currentRadius = maxRadius * intensity;
    // 2. 分布高度：强度越高，粒子分布高度越高
    const currentHeight = bodyHeight * intensity;

    for (let i = 0; i < particleCount; i++) {
      // 随机生成球形坐标
      // 使用球形随机分布算法，确保粒子均匀分布在玩家周围
      const u = Math.random() * 2 - 1; // -1 到 1
      const v = Math.random() * 2 * Math.PI; // 0 到 2π

      // 使用立方根分布，使粒子更集中在中心
      const radius = Math.cbrt(Math.random()) * currentRadius;

      // 计算 X 和 Z 坐标（水平面）
      const horizontalRadius = radius * Math.sqrt(1 - u * u);
      const x = location.x + horizontalRadius * Math.cos(v);
      const z = location.z + horizontalRadius * Math.sin(v);

      // Y 坐标：在玩家身体高度范围内随机分布
      const yOffset = 0.5 + Math.random() * currentHeight; // 从身体中部开始
      const y = location.y + yOffset;

      const particleLocation: Vector3 = { x: x, y: y, z: z };

      try {
        // 从粒子列表中随机选择一个粒子类型生成
        const randomParticleType = this.PARTICLE_TYPES[Math.floor(Math.random() * this.PARTICLE_TYPES.length)];
        player.spawnParticle(randomParticleType, particleLocation);
      } catch (error) {
        // 忽略粒子生成错误
      }
    }
  }

  /**
   * 启动传送后的渐进式消失效果
   */
  private startPostTeleportEffects(player: Player, location: Vector3, pointName: string): void {
    // 检查玩家是否有效
    try {
      if (!player || !player.location) return;
    } catch (error) {
      return;
    }

    // 先显示最大强度的粒子效果
    this.createProgressiveParticles(player, location, 1.0, true);

    // 播放传送音效（添加错误处理）
    try {
      player.playSound("mob.endermen.portal");
    } catch (error) {
      // 如果音效播放失败，尝试使用备用音效
      try {
        player.playSound("mob.endermen.teleport");
      } catch (fallbackError) {
        // 如果备用音效也失败，静默处理
      }
    }

    // 显示成功消息
    try {
      player.runCommand(`title @s times 5 40 5`);
      player.runCommand(`title @s title §a传送成功！`);
      player.onScreenDisplay.setActionBar(color.green(`已传送到坐标点 ${color.yellow(pointName)}`));
      useNotify("chat", player, color.green(`已传送到坐标点 ${color.yellow(pointName)}`));
    } catch (error) {
      // 忽略UI更新错误
    }

    // 渐进式减少粒子效果（从1.0到0.0，持续2秒）
    let fadeIntensity = 1.0;
    const fadeInterval = system.runInterval(() => {
      try {
        if (!player || !player.location) {
          system.clearRun(fadeInterval);
          return;
        }

        // 生成当前强度的粒子
        this.createProgressiveParticles(player, location, fadeIntensity, true);

        // 减少强度
        fadeIntensity -= 0.1; // 每0.5秒减少0.1（共10次，5秒）

        // 当强度降到0或以下时停止
        if (fadeIntensity <= 0) {
          system.clearRun(fadeInterval);
        }
      } catch (error) {
        system.clearRun(fadeInterval);
      }
    }, 10); // 每0.5秒执行一次（10 ticks = 0.5秒）
  }

  getPointsByPlayer(playerName: string): IWayPoint[] {
    return this.db.values().filter((p) => p.playerName === playerName);
  }

  getWayPointPlayers(): string[] {
    return Array.from(new Set(this.db.values().map((p) => p.playerName)));
  }

  deletePlayerPoints(playerName: string): number {
    const points = this.getPointsByPlayer(playerName);
    let count = 0;
    for (const point of points) {
      this.db.delete(point.name);
      count++;
    }
    return count;
  }

  toggleStar(pointName: string, isStarred: boolean): void | string {
    const wayPoint = this.db.get(pointName);
    if (!wayPoint) return "坐标点不存在";

    wayPoint.isStarred = isStarred;
    wayPoint.modified = getNowDate();
    return this.db.set(wayPoint.name, wayPoint);
  }
}

export default new WayPoint();
