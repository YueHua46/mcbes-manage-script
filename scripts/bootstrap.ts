/**
 * 苦力怕菜单统一启动器。
 *
 * 各构建入口只选择事件处理器和启动变体；公共模块的加载顺序、事件初始化
 * 与启动日志统一由这里维护。
 */

import { eventRegistry } from "./events/registry";
import { APP_VERSION, MINECRAFT_VERSION_FAMILY } from "./build-metadata";
import "./features/behavior-log/services/log-inspector-tool";
import "./features/blacklist/services/blacklist";
import "./features/command/services/command";
import "./features/fake-player";
import "./features/floating-text";
import "./features/guild";
import "./features/one-click/crop-harvest";
import "./features/one-click/crop-plant";
import "./features/one-click/dig-ore";
import "./features/one-click/tree";
import "./features/player/services/name-display";
import "./features/system/services/player-hud";
import "./features/system/services/server-info";
import "./features/system/services/setting";
import "./features/system/services/trial-mode";
import { scheduleItemIconKeyCacheWarmup } from "./features/system/services/item-icon-key-cache";
import "./shared/database/database";
import { SystemLog } from "./shared/utils/common";
import type { StartupVariant } from "./startup-variants";

const COMMON_FEATURE_LINES = [
  "一键挖矿功能",
  "一键砍树功能",
  "下蹲连锁收割作物",
  "下蹲一键连锁播种",
  "玩家名称显示",
  "自定义命令系统",
  "试玩模式系统",
  "悬浮文字系统",
] as const;

function logFeature(feature: string): void {
  SystemLog.info(`  ✓ ${feature}`);
}

export function bootstrap(variant: StartupVariant): void {
  SystemLog.info("========================================");
  SystemLog.info(`苦力怕菜单 v${APP_VERSION} 启动中...`);
  SystemLog.info(`适配游戏版本：MCBE ${MINECRAFT_VERSION_FAMILY} 及以上`);
  SystemLog.info(`当前构建：${variant.buildDescription}`);
  SystemLog.info("========================================");

  try {
    SystemLog.info("[1/3] 核心模块初始化完成");
    logFeature("数据库系统");
    logFeature("服务器信息监控");
    logFeature("系统设置管理");

    SystemLog.info("[2/3] 功能模块加载完成");
    for (const feature of COMMON_FEATURE_LINES) logFeature(feature);
    logFeature(variant.fakePlayerFeature);
    for (const feature of variant.extraFeatureLines) logFeature(feature);

    SystemLog.info("[3/3] 初始化事件系统...");
    eventRegistry.initializeAll();
    scheduleItemIconKeyCacheWarmup();

    SystemLog.info("========================================");
    SystemLog.info("✓ 所有模块已加载成功");
    SystemLog.info(`✓ ${variant.readyMessage}`);
    SystemLog.info("========================================");
  } catch (error) {
    SystemLog.error("插件初始化失败", error);
    throw error;
  }
}
