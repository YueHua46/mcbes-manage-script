/**
 * 领地管理服务
 * 完整迁移自 Modules/Land/Land.ts
 */

import { Block, BlockVolume, Player, system, Vector3, world } from "@minecraft/server";
import { Database } from "../../../shared/database/database";
import type { ILand } from "../../../core/types";
import { isAdmin } from "../../../shared/utils/common";
import { color } from "../../../shared/utils/color";
import setting from "../../system/services/setting";
import { openConfirmDialogForm } from "../../../ui/components/dialog";
import economic from "../../economic/services/economic";
import { useNotify } from "../../../shared/hooks/use-notify";

class LandManager {
  db!: Database<ILand>;

  constructor() {
    system.run(() => {
      this.db = new Database<ILand>("lands");
    });
  }

  /**
   * 创建Vector3坐标
   */
  createVector3(str: string): string | Vector3 {
    const [x, y, z] = str.split(" ").map(Number);
    if (isNaN(x) || isNaN(y) || isNaN(z)) {
      return "坐标格式错误";
    }
    return { x, y, z };
  }

  /**
   * 获取领地
   */
  getLand(name: string): ILand | string {
    if (!this.db.has(name)) return "领地不存在";
    return this.db.get(name);
  }

  /**
   * 删除领地
   */
  removeLand(name: string): boolean | string {
    if (!this.db.has(name)) return "领地不存在";
    return this.db.delete(name);
  }

  /**
   * 获取所有领地
   */
  getLandList(): Record<string, ILand> {
    return this.db.getAll();
  }

  /**
   * 更新领地
   */
  setLand(name: string, land: ILand): void | string {
    if (!this.db.has(name)) return "领地不存在";
    return this.db.set(name, land);
  }

  /**
   * 添加成员
   */
  addMember(name: string, member: string): void | string {
    if (!this.db.has(name)) return "领地不存在";
    const land = this.db.get(name) as ILand;
    if (land.members.includes(member)) return "成员已存在";
    land.members.push(member);
    return this.db.set(name, land);
  }

  /**
   * 移除成员
   */
  removeMember(name: string, member: string): void | string {
    if (!this.db.has(name)) return "领地不存在";
    const land = this.db.get(name) as ILand;
    if (!land.members.includes(member)) return "成员不存在";
    land.members = land.members.filter((m) => m !== member);
    return this.db.set(name, land);
  }

  /**
   * 设置公共权限
   */
  setPublicAuth(name: string, auth: ILand["public_auth"]): void | string {
    if (!this.db.has(name)) return "领地不存在";
    const land = this.db.get(name) as ILand;
    land.public_auth = auth;
    return this.db.set(name, land);
  }

  /**
   * 检查两个区域是否重叠（包括完全包含的情况）
   */
  private volumesOverlap(vol1: BlockVolume, vol2: BlockVolume): boolean {
    // 检查是否重叠或包含
    const vol1Min = vol1.getMin();
    const vol1Max = vol1.getMax();
    const vol2Min = vol2.getMin();
    const vol2Max = vol2.getMax();

    // 检查是否在任意轴上分离
    if (
      vol1Max.x < vol2Min.x ||
      vol2Max.x < vol1Min.x ||
      vol1Max.y < vol2Min.y ||
      vol2Max.y < vol1Min.y ||
      vol1Max.z < vol2Min.z ||
      vol2Max.z < vol1Min.z
    ) {
      return false;
    }

    // 如果有重叠，返回true
    return true;
  }

  /**
   * 检查领地是否重叠（包括完全包含的情况）
   */
  checkOverlap(land: ILand): ILand[] {
    const lands = this.db.getAll();
    const landArea = new BlockVolume(land.vectors.start, land.vectors.end);
    const overlaps: ILand[] = [];

    for (const key in lands) {
      if (land.dimension !== lands[key].dimension) continue;
      const area = new BlockVolume(lands[key].vectors.start, lands[key].vectors.end);
      // 使用新的重叠检查方法，检查是否重叠或包含
      if (this.volumesOverlap(landArea, area)) {
        overlaps.push(lands[key]);
      }
    }
    return overlaps;
  }

  /**
   * 检查位置是否在领地内
   */
  isInsideLand(location: Vector3, land: ILand) {
    const isInside =
      Math.round(location.x) >= Math.min(land.vectors.start.x, land.vectors.end.x) &&
      Math.round(location.x) <= Math.max(land.vectors.start.x, land.vectors.end.x) &&
      Math.round(location.y) >= Math.min(land.vectors.start.y, land.vectors.end.y) - 1 &&
      Math.round(location.y) <= Math.max(land.vectors.start.y, land.vectors.end.y) &&
      Math.round(location.z) >= Math.min(land.vectors.start.z, land.vectors.end.z) &&
      Math.round(location.z) <= Math.max(land.vectors.start.z, land.vectors.end.z);

    return { isInside, insideLand: land };
  }

  /**
   * 测试某个坐标是否在任何领地内
   */
  testLand(location: Vector3, dimension: string) {
    const lands = this.db.values();
    const land = lands.find((land) => {
      if (land.dimension != dimension) return false;
      return this.isInsideLand(location, land).isInside;
    });

    return land ? { isInside: true, insideLand: land } : { isInside: false, insideLand: null };
  }

  /**
   * 获取所有有领地的玩家
   */
  getLandPlayers(): string[] {
    return Array.from(new Set(Object.values(this.db.getAll()).map((land) => land.owner)));
  }

  /**
   * 获取指定玩家的所有领地
   */
  getPlayerLands(playerName: string): ILand[] {
    return Object.values(this.db.getAll()).filter((land) => land.owner === playerName);
  }

  /**
   * 领地转让
   */
  transferLand(name: string, playerName: string): void | string {
    if (!this.db.has(name)) return "领地不存在";

    const maxLandPerPlayer = Number(setting.getState("maxLandPerPlayer") || 5);
    const targetPlayer = world.getPlayers({ name: playerName })[0];
    const targetIsAdmin = targetPlayer ? isAdmin(targetPlayer) : false;

    if (!targetIsAdmin && this.getPlayerLandCount(playerName) >= maxLandPerPlayer) {
      return `玩家 ${playerName} 已达到最大领地数量限制(${maxLandPerPlayer})，无法转让`;
    }

    const land = this.db.get(name) as ILand;
    land.owner = playerName;
    return this.db.set(name, land);
  }

  /**
   * 获取玩家拥有的领地数量
   */
  getPlayerLandCount(playerName: string): number {
    const lands = this.db.values();
    return lands.filter((land) => land.owner === playerName).length;
  }

  /**
   * 删除指定玩家的所有领地
   */
  deletePlayerLands(playerName: string): number {
    const lands = this.getPlayerLands(playerName);
    let count = 0;
    for (const land of lands) {
      this.db.delete(land.name);
      count++;
    }
    return count;
  }

  /**
   * 计算两个坐标点之间的方块数量
   */
  calculateBlockCount(start: Vector3, end: Vector3): number {
    const bv = new BlockVolume(start, end);
    return bv.getCapacity();
  }

  /**
   * 创建领地
   */
  async createLand(landData: ILand): Promise<string | true> {
    const player = world.getPlayers({ name: landData.owner })[0];

    // 检查领地名是否冲突
    if (this.db.has(landData.name)) {
      return "领地名冲突，已存在，请尝试其他领地名称";
    }

    // 检查领地重叠
    const overlaps = this.checkOverlap(landData);
    if (overlaps.length > 0) {
      const info = overlaps
        .map(
          (o) =>
            `与玩家 ${color.yellow(o.owner)} ${color.red("的领地")} ${color.yellow(o.name)} ${color.red(
              "重叠"
            )}\n${color.red("位置")}： ${color.yellow(`${o.vectors.start.x}`)},${color.yellow(
              `${o.vectors.start.y}`
            )},${color.yellow(`${o.vectors.start.z}`)} -> ${color.yellow(
              `${o.vectors.end.x}`
            )},${color.yellow(`${o.vectors.end.y}`)},${color.yellow(`${o.vectors.end.z}`)}`
        )
        .join("\n");
      return `领地重叠，请重新设置领地范围。\n${info}`;
    }

    // 检查玩家领地数量限制
    const maxLandPerPlayer = Number(setting.getState("maxLandPerPlayer") || 5);
    if (!isAdmin(player) && this.getPlayerLandCount(landData.owner) >= maxLandPerPlayer) {
      return `您已达到最大领地数量限制(${maxLandPerPlayer})，无法创建更多领地，请联系管理员调整上限。`;
    }

    // 检查领地方块数量限制
    const maxLandBlocks = Number(setting.getState("maxLandBlocks") || "30000");
    const blockCount = this.calculateBlockCount(landData.vectors.start, landData.vectors.end);
    if (blockCount > maxLandBlocks) {
      return `领地方块数量(${blockCount})超过上限(${maxLandBlocks})，请重新设置领地。管理员可通过【服务器设置】调整上限`;
    }

    // 检查传送点是否在领地范围内
    if (landData.teleportPoint) {
      if (!this.isLocationInLand(landData.teleportPoint, landData)) {
        return "传送点必须在领地范围内！请确保当前位置在您要创建的领地范围内，或取消设置传送点选项";
      }
    }

    // 经济系统检查（如果开启）
    const { cost, balance, canAfford, isCancel } = await this.confirmAndCreateLandAsync(
      player,
      landData.vectors.start,
      landData.vectors.end
    );

    if (isCancel) return "领地创建已取消";
    if (!canAfford) {
      return `余额不足，需要 ${cost} 金币，您的余额为 ${balance} 金币`;
    }

    // 扣除费用并创建领地
    if (cost > 0) {
      economic.removeGold(player.name, cost, "领地创建费用");
    }

    this.db.set(landData.name, landData);
    return true;
  }

  /**
   * 确认并创建领地（异步）
   */
  confirmAndCreateLandAsync(
    player: Player,
    start: Vector3,
    end: Vector3
  ): Promise<{ canAfford: boolean; cost: number; balance: number; isCancel: boolean }> {
    // 如果经济系统关闭，直接返回可以创建
    if (!setting.getState("economy")) {
      return Promise.resolve({ canAfford: true, cost: 0, balance: 0, isCancel: false });
    }

    const cost = economic.calculateLandPrice(start, end);
    const balance = economic.getWallet(player.name).gold;
    const canAfford = balance >= cost;

    // 弹出确认对话框
    return new Promise((resolve) => {
      openConfirmDialogForm(
        player,
        "领地创建确认",
        `你将支付 ${cost} 金币来圈地，是否继续？`,
        () => resolve({ canAfford, cost, balance, isCancel: false }),
        () => resolve({ canAfford, cost, balance, isCancel: true })
      );
    });
  }

  /**
   * 检查位置是否在领地范围内
   */
  isLocationInLand(location: Vector3, land: ILand): boolean {
    return this.isInsideLand(location, land).isInside;
  }

  /**
   * 设置领地传送点
   */
  setTeleportPoint(landName: string, location: Vector3): void | string {
    if (!this.db.has(landName)) return "领地不存在";
    const land = this.db.get(landName) as ILand;

    // 检查传送点是否在领地范围内
    const roundedLocation = {
      x: Math.round(location.x),
      y: Math.round(location.y),
      z: Math.round(location.z),
    };

    if (!this.isLocationInLand(roundedLocation, land)) {
      return "传送点必须在领地范围内！";
    }

    land.teleportPoint = roundedLocation;
    return this.db.set(landName, land);
  }

  /**
   * 删除领地传送点
   */
  removeTeleportPoint(landName: string): void | string {
    if (!this.db.has(landName)) return "领地不存在";
    const land = this.db.get(landName) as ILand;
    delete land.teleportPoint;
    return this.db.set(landName, land);
  }

  /**
   * 传送到领地传送点（复用坐标点传送逻辑）
   */
  teleportToLand(player: Player, landName: string): void | string {
    const land = this.getLand(landName);
    if (typeof land === "string") return land;
    if (!land.teleportPoint) return "该领地未设置传送点";

    // 检查权限：只有领地主人、成员或管理员可以传送
    if (land.owner !== player.name && !isAdmin(player) && !land.members.includes(player.name)) {
      return "您没有权限传送到该领地";
    }

    // 保存传送前的位置和维度
    const startLocation = player.location;
    const startDimension = player.dimension;
    const targetLocation = land.teleportPoint;
    const targetDimension = world.getDimension(land.dimension);

    // 粒子类型（末影人传送的紫色粒子）
    const PARTICLE_TYPES = ["minecraft:mob_portal"];

    /**
     * 创建渐进式传送粒子效果
     */
    const createProgressiveParticles = (
      player: Player,
      location: Vector3,
      intensity: number,
      isPostTeleport: boolean
    ): void => {
      try {
        if (!player || !player.location) return;
      } catch (error) {
        return;
      }

      const particleBaseCount = 10;
      const particleCount = Math.floor(particleBaseCount + particleBaseCount * 10 * intensity);
      const bodyHeight = 1.8;
      const maxRadius = 1.5;

      const currentRadius = isPostTeleport ? maxRadius * intensity : maxRadius;
      const currentHeight = isPostTeleport ? bodyHeight * intensity : bodyHeight;

      for (let i = 0; i < particleCount; i++) {
        const u = Math.random() * 2 - 1;
        const v = Math.random() * 2 * Math.PI;
        const radius = Math.cbrt(Math.random()) * currentRadius;
        const horizontalRadius = radius * Math.sqrt(1 - u * u);
        const x = location.x + horizontalRadius * Math.cos(v);
        const z = location.z + horizontalRadius * Math.sin(v);
        const yOffset = 0.5 + Math.random() * currentHeight;
        const y = location.y + yOffset;

        const particleLocation: Vector3 = { x, y, z };

        try {
          const randomParticleType = PARTICLE_TYPES[Math.floor(Math.random() * PARTICLE_TYPES.length)];
          player.spawnParticle(randomParticleType, particleLocation);
        } catch (error) {
          // 忽略粒子生成错误
        }
      }
    };

    // 粒子效果渐进系统
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

        if (particleIntensity < 1.0) {
          particleIntensity = Math.min(1.0, particleIntensity + particleStep);
          createProgressiveParticles(player, currentLocation, particleIntensity, false);
        } else {
          createProgressiveParticles(player, currentLocation, 1.0, false);
        }
      } catch (error) {
        system.clearRun(particleInterval);
      }
    }, 2);

    // 传送倒计时（3秒）
    let countdown = 3;
    countdownInterval = system.runInterval(() => {
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

      if (countdown > 0) {
        player.runCommand(`title @s times 5 20 5`);
        player.runCommand(`title @s title §e${countdown}`);
        player.onScreenDisplay.setActionBar(`§b正在传送到 §e${landName} §b... §7(请不要移动)`);
        player.playSound("random.click");
        countdown--;
      } else {
        system.clearRun(countdownInterval!);
        system.clearRun(particleInterval);

        createProgressiveParticles(player, startLocation, 1.0, false);

        system.run(() => {
          try {
            player.teleport(targetLocation, {
              dimension: targetDimension,
            });

            system.runTimeout(() => {
              try {
                if (!player || !player.location) return;

                // 传送后的效果
                createProgressiveParticles(player, targetLocation, 1.0, true);

                try {
                  player.playSound("mob.endermen.portal");
                } catch (error) {
                  try {
                    player.playSound("mob.endermen.teleport");
                  } catch (fallbackError) {
                    // 静默处理
                  }
                }

                try {
                  player.runCommand(`title @s times 5 40 5`);
                  player.runCommand(`title @s title §a传送成功！`);
                  player.onScreenDisplay.setActionBar(color.green(`已传送到领地 ${color.yellow(landName)}`));
                  useNotify("chat", player, color.green(`已传送到领地 ${color.yellow(landName)}`));
                } catch (error) {
                  // 忽略UI更新错误
                }

                // 渐进式减少粒子效果
                let fadeIntensity = 1.0;
                const fadeInterval = system.runInterval(() => {
                  try {
                    if (!player || !player.location) {
                      system.clearRun(fadeInterval);
                      return;
                    }

                    createProgressiveParticles(player, targetLocation, fadeIntensity, true);
                    fadeIntensity -= 0.1;

                    if (fadeIntensity <= 0) {
                      system.clearRun(fadeInterval);
                    }
                  } catch (error) {
                    system.clearRun(fadeInterval);
                  }
                }, 10);
              } catch (error) {
                // 静默处理错误
              }
            }, 1);
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
    }, 20);

    return undefined; // 返回undefined，因为传送是异步的
  }
}

export default new LandManager();
