import { Dimension, ItemStack, Player, system, Vector3, world } from "@minecraft/server";
import { Database } from "../Database";
import { MinecraftDimensionTypes } from "../../types";
import { useNotify } from "../../hooks/hooks";
import { getNowDate, isAdmin } from "../../utils/utils";
import { color } from "../../utils/color";
import setting from "../System/Setting";

export interface IWayPoint {
  name: string;
  location: Vector3;
  playerName: string;
  dimension: MinecraftDimensionTypes;
  created: string;
  modified: string;
  type: "public" | "private";
  isStarred?: boolean; // 新增属性
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

class WayPoint {
  private db!: Database<IWayPoint>;

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

  createPoint(pointOption: ICreateWayPoint) {
    const { pointName, location, player, type = "private" } = pointOption;
    const maxPoints = setting.getState("maxPointsPerPlayer");
    const playerPoints = this.getPointsByPlayer(player.name);
    if (!isAdmin(player) && playerPoints.length >= Number(maxPoints)) return "您的坐标点数量已达到服务器设置上限";
    if (!pointName || !location || !player) return "参数错误";
    if (this.db.get(pointName)) return "该坐标点名称已存在，请换一个名称";

    const time = getNowDate();
    const wayPoint: IWayPoint = {
      name: pointName,
      location: this.formatLocation(location),
      playerName: player.name,
      dimension: player.dimension.id as MinecraftDimensionTypes,
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

  deletePoint(pointName: string) {
    if (this.db.get(pointName)) {
      return this.db.delete(pointName);
    }
    return "坐标点不存在";
  }

  updatePoint(updateArgs: IUpdateWayPoint) {
    const { pointName, updatePointName, player, isUpdateLocation } = updateArgs;
    const wayPoint = this.db.get(pointName);
    if (!wayPoint) return "坐标点不存在";

    // 仅在名称被更新且与现有名称不同的情况下，检查新名称是否已存在
    if (updatePointName && updatePointName !== pointName && this.db.get(updatePointName)) {
      return "新的坐标点名称已存在，请换一个名称";
    }

    // 更新位置和维度
    if (isUpdateLocation) {
      wayPoint.location = this.formatLocation(player.location);
      wayPoint.dimension = player.dimension.id as MinecraftDimensionTypes;
    }

    // 更新名称
    if (updatePointName && updatePointName !== pointName) {
      this.db.delete(pointName); // 删除旧名称的条目
      wayPoint.name = updatePointName;
    }

    wayPoint.modified = getNowDate();
    return this.db.set(wayPoint.name, wayPoint);
  }

  checkOwner(player: Player, pointName: string) {
    const _wayPoint = this.db.get(pointName);
    if (!_wayPoint) return false;
    return _wayPoint.playerName === player.name;
  }

  teleport(player: Player, pointName: string) {
    const wayPoint = this.db.get(pointName);
    if (!wayPoint) return "坐标点不存在";
    player.teleport(wayPoint.location, {
      dimension: world.getDimension(wayPoint.dimension),
    });
    return useNotify("chat", player, color.green(`已传送到坐标点 ${color.yellow(`${pointName}`)}`));
  }

  getPointsByPlayer(playerName: string) {
    return this.db.values().filter((p) => p.playerName === playerName);
  }

  // 获取所有存有坐标点的用户
  getWayPointPlayers() {
    return Array.from(new Set(this.db.values().map((p) => p.playerName)));
  }

  // 切换坐标点是否收藏
  toggleStar(pointName: string, isStarred: boolean) {
    const wayPoint = this.db.get(pointName);
    if (!wayPoint) return "坐标点不存在";

    wayPoint.isStarred = isStarred;
    wayPoint.modified = getNowDate();
    return this.db.set(wayPoint.name, wayPoint);
  }
}

export default new WayPoint();
