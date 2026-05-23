/**
 * 杜绝熊孩服务器插件 - BDS 增强版入口
 */

import { SystemLog } from "./shared/utils/common";
import "./shared/database/database";
import serverInfo from "./features/system/services/server-info";
import setting from "./features/system/services/setting";
import "./features/system/services/trial-mode";
import "./features/one-click/dig-ore";
import "./features/one-click/tree";
import "./features/player/services/name-display";
import "./features/command/services/command";
import "./features/blacklist/services/blacklist";
import "./features/guild";
import { eventRegistry } from "./events/registry";
import "./events/handlers/index.bds";

function initializeApp(): void {
  SystemLog.info("========================================");
  SystemLog.info("杜绝熊孩服务器插件 v2.0 启动中...");
  SystemLog.info("当前构建：BDS 增强版（仅 BDS 服务器）");
  SystemLog.info("========================================");

  try {
    SystemLog.info("[1/3] 核心模块初始化完成");
    SystemLog.info("  ✓ 数据库系统");
    SystemLog.info("  ✓ 服务器信息监控");
    SystemLog.info("  ✓ 系统设置管理");

    SystemLog.info("[2/3] 功能模块加载完成");
    SystemLog.info("  ✓ 一键挖矿功能");
    SystemLog.info("  ✓ 一键砍树功能");
    SystemLog.info("  ✓ 玩家名称显示");
    SystemLog.info("  ✓ 自定义命令系统");
    SystemLog.info("  ✓ 试玩模式系统");
    SystemLog.info("  ✓ 黑名单进服前校验");

    SystemLog.info("[3/3] 初始化事件系统...");
    eventRegistry.initializeAll();

    SystemLog.info("========================================");
    SystemLog.info("✓ 所有模块已加载成功");
    SystemLog.info("✓ BDS 增强版运行正常");
    SystemLog.info("========================================");
  } catch (error) {
    SystemLog.error("插件初始化失败", error);
    throw error;
  }
}

initializeApp();
