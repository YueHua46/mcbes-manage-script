/**
 * 杜绝熊孩服务器插件
 *
 * @author Yuehua
 * @version 2.0.0
 */

import { SystemLog } from "./shared/utils/common";

// ==================== 核心模块导入 ====================
import "./shared/database/database"; // 数据库系统
import serverInfo from "./features/system/services/server-info"; // 服务器信息监控
import setting from "./features/system/services/setting"; // 系统设置
import "./features/system/services/trial-mode"; // 试玩模式

// ==================== 功能模块导入 ====================
import "./features/one-click/dig-ore"; // 一键挖矿
import "./features/one-click/tree"; // 一键砍树
import "./features/player/services/name-display"; // 玩家名称显示
import "./features/command/services/command"; // 自定义命令系统

// ==================== 事件系统导入 ====================
import { eventRegistry } from "./events/registry";
import "./events/handlers"; // 自动导入并注册所有事件处理器

/**
 * 初始化应用程序
 */
function initializeApp(): void {
  SystemLog.info("========================================");
  SystemLog.info("杜绝熊孩服务器插件 v2.0 启动中...");
  SystemLog.info("========================================");

  try {
    // 1. 核心模块已通过import自动初始化
    SystemLog.info("[1/3] 核心模块初始化完成");
    SystemLog.info("  ✓ 数据库系统");
    SystemLog.info("  ✓ 服务器信息监控");
    SystemLog.info("  ✓ 系统设置管理");

    // 2. 功能模块已通过import自动加载
    SystemLog.info("[2/3] 功能模块加载完成");
    SystemLog.info("  ✓ 一键挖矿功能");
    SystemLog.info("  ✓ 一键砍树功能");
    SystemLog.info("  ✓ 玩家名称显示");
    SystemLog.info("  ✓ 自定义命令系统");
    SystemLog.info("  ✓ 试玩模式系统");

    // 3. 初始化事件系统
    SystemLog.info("[3/3] 初始化事件系统...");
    eventRegistry.initializeAll();

    // 完成初始化
    SystemLog.info("========================================");
    SystemLog.info("✓ 所有模块已加载成功");
    SystemLog.info("✓ 插件运行正常");
    SystemLog.info("========================================");
  } catch (error) {
    SystemLog.error("插件初始化失败", error);
    throw error;
  }
}

// 启动应用程序
initializeApp();
