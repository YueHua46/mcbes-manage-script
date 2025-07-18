import { Block, BlockVolume, BlockVolumeBase, Entity, Player, system, Vector3, world } from "@minecraft/server";
import { Database } from "../Database";
import { MinecraftDimensionTypes } from "@minecraft/vanilla-data";
import setting from "../System/Setting";
import { defaultSetting } from "../System/Setting";
import { isAdmin } from "../../utils/utils";
import { color } from "@mcbe-mods/utils";
import economic from "../Economic/Economic";
import { colorCodes } from "../../utils/color";
import { openConfirmDialogForm, openDialogForm } from "../Forms/Dialog";

export interface ILand {
  name: string;
  owner: string;
  members: string[];
  dimension: MinecraftDimensionTypes;
  public_auth: {
    break: boolean; // 破坏权限
    place: boolean; // 放置权限
    useBlock: boolean; // 方块交互权限（概括包含所有方块交互权限）
    isChestOpen: boolean; // 箱子权限
    useEntity: boolean; // 实体交互权限
    useButton: boolean; // 按钮权限
    explode: boolean; // 爆炸权限
    burn: boolean; // 燃烧权限
    useSign: boolean; // 告示牌权限
    useSmelting: boolean; // 锻造类功能性方块权限
    useRedstone: boolean; // 红石类功能性方块权限
  };
  // 领地公开权限的配置权限
  config_public_auth: {
    break: boolean;
    place: boolean;
    useBlock: boolean;
    isChestOpen: boolean;
    useEntity: boolean;
    useButton: boolean;
    explode: boolean;
    burn: boolean;
    useSign: boolean; // 告示牌权限
    useSmelting: boolean; // 锻造类功能性方块权限
    useRedstone: boolean; // 红石类功能性方块权限
  };
  vectors: {
    start: Vector3;
    end: Vector3;
  };
}
/**
 * Land module
 */
class Land {
  db!: Database<ILand>;
  constructor() {
    system.run(() => {
      this.db = new Database<ILand>("lands");
    });
  }
  createVector3(str: string): string | Vector3 {
    const [x, y, z] = str.split(" ").map(Number);
    if (isNaN(x) || isNaN(y) || isNaN(z)) {
      return "坐标格式错误";
    }
    return {
      x,
      y,
      z,
    };
  }
  getLand(name: string) {
    if (!this.db.has(name)) return "领地不存在";
    return this.db.get(name);
  }
  removeLand(name: string) {
    if (!this.db.has(name)) return "领地不存在";
    return this.db.delete(name);
  }
  getLandList() {
    return this.db.getAll();
  }
  setLand(name: string, land: ILand) {
    if (!this.db.has(name)) return "领地不存在";
    return this.db.set(name, land);
  }
  addMember(name: string, member: string) {
    if (!this.db.has(name)) return "领地不存在";
    const land = this.db.get(name) as ILand;
    if (land.members.includes(member)) return "成员已存在";
    land.members.push(member);
    return this.db.set(name, land);
  }
  removeMember(name: string, member: string) {
    if (!this.db.has(name)) return "领地不存在";
    const land = this.db.get(name) as ILand;
    if (!land.members.includes(member)) return "成员不存在";
    land.members = land.members.filter((m) => m !== member);
    return this.db.set(name, land);
  }
  setPublicAuth(name: string, auth: ILand["public_auth"]) {
    if (!this.db.has(name)) return "领地不存在";
    const land = this.db.get(name) as ILand;
    land.public_auth = auth;
    return this.db.set(name, land);
  }
  // 检查领地是否重叠
  checkOverlap(land: ILand): ILand[] {
    const lands = this.db.getAll();
    const landArea = new BlockVolume(land.vectors.start, land.vectors.end);
    const overlaps: ILand[] = [];
    for (const key in lands) {
      if (land.dimension !== lands[key].dimension) continue;
      const area = new BlockVolume(lands[key].vectors.start, lands[key].vectors.end);
      console.log(`new area -> ${area.from.x},${area.from.y},${area.from.z} -> ${area.to.x},${area.to.y},${area.to.z}`);
      console.log(
        `loop area -> ${area.from.x},${area.from.y},${area.from.z} -> ${area.to.x},${area.to.y},${area.to.z}`
      );
      if (landArea.doesVolumeTouchFaces(area)) {
        overlaps.push(lands[key]);
      }
    }
    return overlaps;
  }
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
  // 检查某个坐标是否在某个领地内
  testLand(location: Vector3, dimension: MinecraftDimensionTypes | string) {
    const lands = this.db.values();
    const land = lands.find((land) => {
      if (land.dimension != dimension) return false;
      return this.isInsideLand(location, land).isInside;
    });

    return land
      ? {
          isInside: true,
          insideLand: land,
        }
      : {
          isInside: false,
          insideLand: null,
        };
  }
  // 获取所有有领地的玩家
  getLandPlayers() {
    return Array.from(new Set(Object.values(this.db.getAll()).map((land) => land.owner)));
  }

  // 获取指定玩家的所有领地
  getPlayerLands(playerName: string) {
    return Object.values(this.db.getAll()).filter((land) => land.owner === playerName);
  }
  // 领地转让
  transferLand(name: string, playerName: string) {
    if (!this.db.has(name)) return "领地不存在";
    const land = this.db.get(name) as ILand;
    land.owner = playerName;
    return this.db.set(name, land);
  }
  // 获取玩家拥有的领地数量
  getPlayerLandCount(playerName: string) {
    const lands = this.db.values();
    return lands.filter((land) => land.owner === playerName).length;
  }
  // 计算两个坐标点之间的方块数量
  calculateBlockCount(start: Vector3, end: Vector3): number {
    const bv = new BlockVolume(start, end);
    return bv.getCapacity();
  }

  // 创建领地时添加方块数量验证
  async createLand(landData: ILand) {
    const player = world.getPlayers({ name: landData.owner })[0];
    if (this.db.has(landData.name)) return "领地名冲突，已存在，请尝试其他领地名称";
    const overlaps = this.checkOverlap(landData);
    if (overlaps.length > 0) {
      // 只提示第一个重叠的领地，也可以遍历所有重叠领地
      const info = overlaps
        .map(
          (o) =>
            `与玩家 ${color.yellow(o.owner)} ${color.red("的领地")} ${color.yellow(o.name)} ${color.red(
              "重叠"
            )}\n${color.red("位置")}： ${color.yellow(`${o.vectors.start.x}`)},${color.yellow(
              `${o.vectors.start.y}`
            )},${color.yellow(color.yellow(`${o.vectors.start.z}`))} -> ${color.yellow(
              `${o.vectors.end.x}`
            )},${color.yellow(`${o.vectors.end.y}`)},${color.yellow(`${o.vectors.end.z}`)}`
        )
        .join("\n");
      return `领地重叠，请重新设置领地范围。\n${info}`;
    }
    // 检查玩家领地数量是否达到上限
    const maxLandPerPlayer = Number(setting.getState("maxLandPerPlayer") || defaultSetting.maxLandPerPlayer);
    if (!isAdmin(player) && this.getPlayerLandCount(landData.owner) >= maxLandPerPlayer) {
      return `您已达到最大领地数量限制(${maxLandPerPlayer})，无法创建更多领地，请叫管理员去设置里调整上限。`;
    }

    // 获取领地方块上限
    const maxLandBlocks = Number(setting.getState("maxLandBlocks") || "30000");
    // 计算领地方块数量
    const blockCount = this.calculateBlockCount(landData.vectors.start, landData.vectors.end);
    // 验证方块数量是否超过上限
    if (blockCount > maxLandBlocks) {
      return `领地方块数量(${blockCount})超过上限(${maxLandBlocks})，请重新设置领地。确保其不超过系统设置方块上限\n管理员可通过 【服务器设置】 -> 【通用系统设置】 -> 【设置领地方块上限】 来更改上限`;
    }

    const { cost, balance, canAfford, isCancel } = await this.confirmAndCreateLandAsync(
      player,
      landData.vectors.start,
      landData.vectors.end
    );

    if (isCancel) return "领地创建已取消";
    if (!canAfford)
      return `${colorCodes.red}你的余额不足，无法创建领地，需要  ${colorCodes.yellow}${cost} ${colorCodes.red} 金币，你的余额为  ${colorCodes.yellow}${balance}  金币。如需免费创建，练习管理员去设置里调整。`;
    // 支付领地创建费用
    economic.removeGold(player.name, cost, "领地创建费用");
    this.db.set(landData.name, landData);
    return true;
  }

  // 封装成 Promise
  confirmAndCreateLandAsync(
    player: Player,
    start: Vector3,
    end: Vector3
  ): Promise<{ canAfford: boolean; cost: number; balance: number; isCancel: boolean }> {
    return new Promise((resolve) => {
      // 如果经济系统关闭,直接返回可以创建
      if (!setting.getState("economy")) {
        resolve({ canAfford: true, cost: 0, balance: 0, isCancel: false });
        return;
      }

      // 原有逻辑保持不变
      const cost = economic.calculateLandPrice(start, end);
      const balance = economic.getWallet(player.name).gold;
      const canAfford = balance >= cost;
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

export default new Land();
