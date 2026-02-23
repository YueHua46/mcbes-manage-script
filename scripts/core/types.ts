/**
 * 全局类型定义
 */

import { Player, Dimension } from "@minecraft/server";

// 通用类型
export type Vector3 = {
  x: number;
  y: number;
  z: number;
};

export type DimensionId = "overworld" | "nether" | "the_end";

// 通知类型
export type NotifyType = "chat" | "actionbar" | "title";

// 表单响应类型
export interface IFormResponse<T = any> {
  canceled: boolean;
  selection?: number;
  formValues?: T;
}

// 经济系统类型
export interface IWallet {
  name: string;
  gold: number;
  dailyEarned: number;
  lastResetDate: string;
}

export interface ITransaction {
  from: string;
  to: string;
  amount: number;
  reason: string;
  timestamp: number;
}

// 领地系统类型
export interface ILandVectors {
  start: Vector3;
  end: Vector3;
}

export interface ILandPublicAuth {
  place: boolean;
  break: boolean;
  useBlock: boolean;
  useEntity: boolean;
  isChestOpen: boolean;
  useButton: boolean;
  useSign: boolean;
  explode: boolean;
  useSmelting: boolean;
  useRedstone: boolean;
  burn: boolean;
  attackNeutralMobs: boolean;
  allowEnter: boolean; // 是否允许玩家进入领地
  allowWater: boolean; // 是否允许领地里有水
}

export interface ILand {
  id: string;
  name: string;
  owner: string;
  dimension: string;
  vectors: ILandVectors;
  members: string[];
  public_auth: ILandPublicAuth;
  config_public_auth: ILandPublicAuth; // 权限配置权限
  createdAt: number;
  teleportPoint?: Vector3; // 领地传送点（可选）
}

// 事件处理器类型
export type EventHandler<T = any> = (event: T) => void;

// 服务接口
export interface IService {
  initialize?(): void;
  cleanup?(): void;
}

// 数据库键类型
export type DatabaseKey = string;

export interface IDatabaseItem<T = any> {
  key: DatabaseKey;
  value: T;
}

// 黑名单系统类型
export interface IBlacklistEntry {
  xuid: string;               // 主键，稳定的 Xbox 用户标识
  name: string;               // 当前已知 gamertag（随玩家改名自动同步）
  persistentId?: string;      // 设备级持久标识（重装游戏会变，可选补充）
  reason: string;             // 封禁理由（为空时使用默认提示）
  bannedAt: number;           // 封禁时间戳 Date.now()
  bannedBy: string;           // 执行封禁的管理员名
}
