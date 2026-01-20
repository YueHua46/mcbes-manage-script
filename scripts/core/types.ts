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
