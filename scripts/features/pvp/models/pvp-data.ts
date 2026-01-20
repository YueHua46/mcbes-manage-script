/**
 * PVP系统数据模型
 */

import type { Vector3 } from "../../../core/types";

/**
 * 玩家PVP状态数据
 */
export interface IPvpPlayerData {
  pvpEnabled: boolean;              // 是否开启PVP
  lastToggleTime: number;           // 上次切换时间
  inCombat: boolean;                // 是否在战斗中
  lastCombatTime: number;           // 最后战斗时间
  
  // 统计数据
  kills: number;                    // 击杀数
  deaths: number;                   // 死亡数
  killStreak: number;               // 当前连杀数
  bestKillStreak: number;           // 最佳连杀数
  totalSeized: number;              // 总夺取金币
  totalLost: number;                // 总被夺取金币
}

/**
 * PVP全局配置
 */
export interface IPvpConfig {
  enabled: boolean;                 // 全局PVP开关
  seizeAmount: number;              // 固定夺取金额
  minGoldProtection: number;        // 最低金币保护
  toggleCooldown: number;           // 切换冷却时间（秒）
  combatTagDuration: number;        // 战斗标签持续时间（秒）
}

/**
 * 击杀记录
 */
export interface IPvpKillLog {
  killer: string;                   // 击杀者
  victim: string;                   // 被击杀者
  seizeAmount: number;              // 夺取金额
  killStreak: number;               // 连杀数
  timestamp: number;                // 时间戳
  location: Vector3;                // 位置
  dimension: string;                // 维度
}

