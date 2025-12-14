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
   * 检查领地是否重叠
   */
  checkOverlap(land: ILand): ILand[] {
    const lands = this.db.getAll();
    const landArea = new BlockVolume(land.vectors.start, land.vectors.end);
    const overlaps: ILand[] = [];

    for (const key in lands) {
      if (land.dimension !== lands[key].dimension) continue;
      const area = new BlockVolume(lands[key].vectors.start, lands[key].vectors.end);
      if (landArea.doesVolumeTouchFaces(area)) {
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
}

export default new LandManager();
