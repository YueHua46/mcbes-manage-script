/**
 * BDS 服务器性能诊断服务
 * 基于实际 BDS 性能影响因素进行综合诊断
 */

import { world, system, Dimension, Vector3 } from "@minecraft/server";
import {
  collectDebugRuntimeStats,
  collectDebugPluginStats,
  isDebugUtilitiesAvailable,
} from "../../../features/platform/sapi-capabilities";

/**
 * 性能问题严重程度
 */
export enum PerformanceSeverity {
  /** 正常 */
  NORMAL = "normal",
  /** 注意 */
  NOTICE = "notice",
  /** 警告 */
  WARNING = "warning",
  /** 严重 */
  CRITICAL = "critical",
  /** 极严重 */
  SEVERE = "severe",
}

/**
 * 性能问题类型
 */
export enum PerformanceIssueType {
  /** 集中区域实体过载（刷怪塔） */
  ENTITY_CLUSTER = "entity_cluster",
  /** 掉落物累积 */
  ITEM_ENTITIES = "item_entities",
  /** 红石电路负载 */
  REDSTONE_LOAD = "redstone_load",
  /** 漏斗系统 */
  HOPPER_SYSTEM = "hopper_system",
  /** 快速跑图 */
  CHUNK_LOADING = "chunk_loading",
  /** 村民过多 */
  VILLAGER_COUNT = "villager_count",
  /** 经验球累积 */
  XP_ORB_COUNT = "xp_orb_count",
  /** 装饰实体过多 */
  DECORATION_ENTITIES = "decoration_entities",
  /** TNT 爆炸 */
  TNT_EXPLOSION = "tnt_explosion",
  /** 脚本性能 */
  SCRIPT_PERFORMANCE = "script_performance",
}

/**
 * 性能诊断结果项
 */
export interface PerformanceIssue {
  /** 问题类型 */
  type: PerformanceIssueType;
  /** 严重程度 */
  severity: PerformanceSeverity;
  /** 问题描述 */
  description: string;
  /** 具体数值 */
  value: number;
  /** 阈值 */
  threshold: number;
  /** 位置信息（如果适用） */
  location?: Vector3;
  /** 维度 */
  dimension?: string;
}

/**
 * 完整的性能诊断报告
 */
export interface PerformanceDiagnosticReport {
  /** 诊断时间戳 */
  timestamp: number;
  /** 当前 TPS */
  currentTPS: number;
  /** 在线玩家数 */
  playerCount: number;
  /** 总实体数 */
  totalEntities: number;
  /** 发现的性能问题列表 */
  issues: PerformanceIssue[];
  /** 综合性能评级 */
  overallRating: "excellent" | "good" | "fair" | "poor" | "critical";
  /** Debug Utilities 统计（如果可用） */
  debugStats?: {
    runtime?: any;
    plugins?: any;
  };
}

/**
 * 区块坐标
 */
interface ChunkCoord {
  x: number;
  z: number;
}

/**
 * 性能诊断服务类
 */
class PerformanceDiagnosticsService {
  private isRunning = false;
  private samplingInterval = 100; // 5秒采样一次（100 ticks）
  private samplingDuration = 1200; // 持续1分钟（1200 ticks = 60秒）
  private currentSampleTick = 0;
  private sampleData: PerformanceDiagnosticReport[] = [];

  /**
   * 开始性能诊断采样
   * @param durationSeconds 采样持续时间（秒）
   * @param intervalSeconds 采样间隔（秒）
   */
  startDiagnostics(durationSeconds: number = 60, intervalSeconds: number = 5): void {
    if (this.isRunning) {
      throw new Error("诊断已在运行中");
    }

    this.samplingInterval = intervalSeconds * 20; // 转换为 ticks
    this.samplingDuration = durationSeconds * 20;
    this.currentSampleTick = 0;
    this.sampleData = [];
    this.isRunning = true;

    this.runSampling();
  }

  /**
   * 停止性能诊断
   */
  stopDiagnostics(): void {
    this.isRunning = false;
  }

  /**
   * 获取诊断状态
   */
  isRunningDiagnostics(): boolean {
    return this.isRunning;
  }

  /**
   * 获取当前采样进度（0-1）
   */
  getProgress(): number {
    if (!this.isRunning) return 1;
    return Math.min(this.currentSampleTick / this.samplingDuration, 1);
  }

  /**
   * 获取采样数据
   */
  getSampleData(): PerformanceDiagnosticReport[] {
    return this.sampleData;
  }

  /**
   * 执行采样循环
   */
  private runSampling(): void {
    const intervalId = system.runInterval(() => {
      if (!this.isRunning || this.currentSampleTick >= this.samplingDuration) {
        system.clearRun(intervalId);
        this.isRunning = false;
        return;
      }

      // 执行一次诊断采样
      const report = this.performDiagnostic();
      this.sampleData.push(report);
      this.currentSampleTick += this.samplingInterval;
    }, this.samplingInterval);
  }

  /**
   * 执行一次完整的性能诊断
   */
  performDiagnostic(): PerformanceDiagnosticReport {
    const issues: PerformanceIssue[] = [];
    const overworld = world.getDimension("overworld");
    const nether = world.getDimension("nether");
    const theEnd = world.getDimension("the_end");

    // 1. 检测各维度的性能问题
    issues.push(...this.checkDimension(overworld, "overworld"));
    issues.push(...this.checkDimension(nether, "nether"));
    issues.push(...this.checkDimension(theEnd, "the_end"));

    // 2. 检测全局性能问题
    issues.push(...this.checkGlobalIssues());

    // 3. 收集 Debug Utilities 数据（如果可用）
    let debugStats: any = undefined;
    if (isDebugUtilitiesAvailable()) {
      debugStats = {
        runtime: undefined,
        plugins: undefined,
      };

      // 异步收集，不阻塞主诊断
      void collectDebugRuntimeStats().then((stats) => {
        debugStats.runtime = stats;
      });
      void collectDebugPluginStats().then((stats) => {
        debugStats.plugins = stats;
      });
    }

    // 4. 计算综合评级
    const overallRating = this.calculateOverallRating(issues);

    // 5. 获取当前 TPS（从 serverInfo 服务）
    const currentTPS = this.getCurrentTPS();

    // 6. 统计总实体数
    const totalEntities = this.getTotalEntityCount();

    // 7. 统计在线玩家
    const playerCount = world.getAllPlayers().length;

    return {
      timestamp: Date.now(),
      currentTPS,
      playerCount,
      totalEntities,
      issues,
      overallRating,
      debugStats,
    };
  }

  /**
   * 检测单个维度的性能问题
   */
  private checkDimension(dimension: Dimension, dimensionName: string): PerformanceIssue[] {
    const issues: PerformanceIssue[] = [];

    try {
      // 获取所有实体
      const allEntities = dimension.getEntities();

      // 1. 检测集中区域实体过载（刷怪塔问题）- 严重级别 1
      const entityClusterIssues = this.detectEntityClusters(allEntities, dimensionName);
      issues.push(...entityClusterIssues);

      // 2. 检测掉落物累积 - 严重级别 1
      const itemEntities = allEntities.filter((e) => e.typeId === "minecraft:item");
      if (itemEntities.length > 500) {
        let severity = PerformanceSeverity.NOTICE;
        if (itemEntities.length > 5000) severity = PerformanceSeverity.SEVERE;
        else if (itemEntities.length > 2000) severity = PerformanceSeverity.CRITICAL;
        else if (itemEntities.length > 1000) severity = PerformanceSeverity.WARNING;

        issues.push({
          type: PerformanceIssueType.ITEM_ENTITIES,
          severity,
          description: `${dimensionName} 掉落物过多`,
          value: itemEntities.length,
          threshold: 500,
          dimension: dimensionName,
        });
      }

      // 3. 检测村民数量 - 严重级别 2
      const villagers = allEntities.filter((e) => e.typeId === "minecraft:villager");
      if (villagers.length > 50) {
        let severity = PerformanceSeverity.NOTICE;
        if (villagers.length > 500) severity = PerformanceSeverity.SEVERE;
        else if (villagers.length > 200) severity = PerformanceSeverity.CRITICAL;
        else if (villagers.length > 100) severity = PerformanceSeverity.WARNING;

        issues.push({
          type: PerformanceIssueType.VILLAGER_COUNT,
          severity,
          description: `${dimensionName} 村民数量过多`,
          value: villagers.length,
          threshold: 50,
          dimension: dimensionName,
        });
      }

      // 4. 检测经验球累积 - 严重级别 3
      const xpOrbs = allEntities.filter((e) => e.typeId === "minecraft:xp_orb");
      if (xpOrbs.length > 500) {
        let severity = PerformanceSeverity.NOTICE;
        if (xpOrbs.length > 2000) severity = PerformanceSeverity.CRITICAL;
        else if (xpOrbs.length > 1000) severity = PerformanceSeverity.WARNING;

        issues.push({
          type: PerformanceIssueType.XP_ORB_COUNT,
          severity,
          description: `${dimensionName} 经验球累积过多`,
          value: xpOrbs.length,
          threshold: 500,
          dimension: dimensionName,
        });
      }

      // 5. 检测装饰实体（展示框、盔甲架）- 严重级别 3
      const itemFrames = allEntities.filter((e) => e.typeId === "minecraft:item_frame");
      const armorStands = allEntities.filter((e) => e.typeId === "minecraft:armor_stand");
      const decorationCount = itemFrames.length + armorStands.length;
      if (decorationCount > 500) {
        let severity = PerformanceSeverity.NOTICE;
        if (decorationCount > 2000) severity = PerformanceSeverity.CRITICAL;
        else if (decorationCount > 1000) severity = PerformanceSeverity.WARNING;

        issues.push({
          type: PerformanceIssueType.DECORATION_ENTITIES,
          severity,
          description: `${dimensionName} 装饰实体过多（展示框+盔甲架）`,
          value: decorationCount,
          threshold: 500,
          dimension: dimensionName,
        });
      }

      // 6. 检测 TNT 爆炸 - 严重级别 3
      const tntEntities = allEntities.filter((e) => e.typeId === "minecraft:tnt");
      if (tntEntities.length > 1) {
        let severity = PerformanceSeverity.NOTICE;
        if (tntEntities.length > 100) severity = PerformanceSeverity.SEVERE;
        else if (tntEntities.length > 20) severity = PerformanceSeverity.CRITICAL;
        else if (tntEntities.length > 5) severity = PerformanceSeverity.WARNING;

        issues.push({
          type: PerformanceIssueType.TNT_EXPLOSION,
          severity,
          description: `${dimensionName} 存在大量 TNT 实体`,
          value: tntEntities.length,
          threshold: 1,
          dimension: dimensionName,
        });
      }
    } catch (error) {
      console.warn(`检测维度 ${dimensionName} 时出错:`, error);
    }

    return issues;
  }

  /**
   * 检测实体聚集问题（刷怪塔）
   * 这是最严重的性能问题之一
   */
  private detectEntityClusters(entities: any[], dimensionName: string): PerformanceIssue[] {
    const issues: PerformanceIssue[] = [];
    const chunkEntityMap = new Map<string, any[]>();

    // 将实体按区块分组
    for (const entity of entities) {
      // 只统计生物实体（不包括掉落物、经验球等）
      if (
        entity.typeId === "minecraft:item" ||
        entity.typeId === "minecraft:xp_orb" ||
        entity.typeId === "minecraft:item_frame" ||
        entity.typeId === "minecraft:armor_stand" ||
        entity.typeId === "minecraft:arrow" ||
        entity.typeId === "minecraft:player"
      ) {
        continue;
      }

      try {
        const location = entity.location;
        const chunkX = Math.floor(location.x / 16);
        const chunkZ = Math.floor(location.z / 16);
        const chunkKey = `${chunkX},${chunkZ}`;

        if (!chunkEntityMap.has(chunkKey)) {
          chunkEntityMap.set(chunkKey, []);
        }
        chunkEntityMap.get(chunkKey)!.push(entity);
      } catch (error) {
        // 实体可能已失效
        continue;
      }
    }

    // 检查每个区块的实体密度
    for (const [chunkKey, chunkEntities] of chunkEntityMap.entries()) {
      const count = chunkEntities.length;
      if (count > 50) {
        let severity = PerformanceSeverity.NOTICE;
        if (count > 500) severity = PerformanceSeverity.SEVERE;
        else if (count > 200) severity = PerformanceSeverity.CRITICAL;
        else if (count > 100) severity = PerformanceSeverity.WARNING;

        const [chunkX, chunkZ] = chunkKey.split(",").map(Number);
        const centerLocation = {
          x: chunkX * 16 + 8,
          y: 64,
          z: chunkZ * 16 + 8,
        };

        issues.push({
          type: PerformanceIssueType.ENTITY_CLUSTER,
          severity,
          description: `${dimensionName} 区块(${chunkX}, ${chunkZ})实体密度极高（疑似刷怪塔）`,
          value: count,
          threshold: 50,
          location: centerLocation,
          dimension: dimensionName,
        });
      }
    }

    return issues;
  }

  /**
   * 检测全局性能问题
   */
  private checkGlobalIssues(): PerformanceIssue[] {
    const issues: PerformanceIssue[] = [];

    // Dynamic Properties 不影响运行时性能，已移除检测

    return issues;
  }

  /**
   * 计算综合性能评级
   */
  private calculateOverallRating(issues: PerformanceIssue[]): "excellent" | "good" | "fair" | "poor" | "critical" {
    if (issues.length === 0) return "excellent";

    const hasSevere = issues.some((i) => i.severity === PerformanceSeverity.SEVERE);
    const hasCritical = issues.some((i) => i.severity === PerformanceSeverity.CRITICAL);
    const warningCount = issues.filter((i) => i.severity === PerformanceSeverity.WARNING).length;

    if (hasSevere) return "critical";
    if (hasCritical || warningCount >= 3) return "poor";
    if (warningCount >= 1) return "fair";
    return "good";
  }

  /**
   * 获取当前 TPS
   */
  private getCurrentTPS(): number {
    // 尝试从 serverInfo 服务获取
    try {
      const serverInfo = require("../../system/services/server-info").default;
      return serverInfo.TPS || 20;
    } catch {
      return 20; // 默认值
    }
  }

  /**
   * 获取总实体数
   */
  private getTotalEntityCount(): number {
    try {
      const serverInfo = require("../../system/services/server-info").default;
      return (serverInfo.organismLength || 0) + (serverInfo.itemsLength || 0);
    } catch {
      // 手动统计
      let total = 0;
      try {
        total += world.getDimension("overworld").getEntities().length;
      } catch {}
      try {
        total += world.getDimension("nether").getEntities().length;
      } catch {}
      try {
        total += world.getDimension("the_end").getEntities().length;
      } catch {}
      return total;
    }
  }

  /**
   * 生成诊断摘要报告
   */
  generateSummaryReport(): string {
    if (this.sampleData.length === 0) {
      return "暂无诊断数据";
    }

    const latestReport = this.sampleData[this.sampleData.length - 1];
    const avgTPS = this.sampleData.reduce((sum, r) => sum + r.currentTPS, 0) / this.sampleData.length;

    // 统计问题出现频率
    const issueFrequency = new Map<string, number>();
    for (const report of this.sampleData) {
      for (const issue of report.issues) {
        const key = `${issue.type}_${issue.dimension || "global"}`;
        issueFrequency.set(key, (issueFrequency.get(key) || 0) + 1);
      }
    }

    // 找出持续存在的问题
    const persistentIssues = Array.from(issueFrequency.entries())
      .filter(([_, count]) => count >= this.sampleData.length * 0.5) // 至少出现在50%的采样中
      .map(([key, count]) => ({ key, count }));

    let summary = `性能诊断摘要报告\n`;
    summary += `采样次数: ${this.sampleData.length}\n`;
    summary += `平均 TPS: ${avgTPS.toFixed(1)}\n`;
    summary += `当前评级: ${this.translateRating(latestReport.overallRating)}\n\n`;

    if (persistentIssues.length > 0) {
      summary += `持续性能问题:\n`;
      for (const { key, count } of persistentIssues) {
        summary += `- ${key}: 出现 ${count}/${this.sampleData.length} 次\n`;
      }
    } else {
      summary += `未发现持续性能问题\n`;
    }

    return summary;
  }

  /**
   * 翻译评级
   */
  private translateRating(rating: string): string {
    const map: Record<string, string> = {
      excellent: "优秀",
      good: "良好",
      fair: "一般",
      poor: "较差",
      critical: "严重",
    };
    return map[rating] || rating;
  }
}

export const performanceDiagnostics = new PerformanceDiagnosticsService();
