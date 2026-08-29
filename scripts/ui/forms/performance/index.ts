/**
 * 性能诊断表单
 * 所有玩家都可以使用
 */

import { Player, system } from "@minecraft/server";
import { CreeperActionFormData as ActionFormData } from "../../creeper-action-form";
import { CreeperModalFormData as ModalFormData } from "../../creeper-modal-form";
import { openDialogForm } from "../../components/dialog";
import { color } from "../../../shared/utils/color";
import {
  performanceDiagnostics,
  PerformanceSeverity,
  PerformanceIssueType,
  type PerformanceDiagnosticReport,
} from "../../../features/performance";

/**
 * 打开性能诊断主菜单
 */
export function openPerformanceDiagnosticsMenu(player: Player, returnForm?: () => void): void {
  const form = new ActionFormData();
  form.title("服务器性能诊断");

  const isRunning = performanceDiagnostics.isRunningDiagnostics();

  if (isRunning) {
    const progress = performanceDiagnostics.getProgress();
    form.body(
      `${color.yellow("诊断进行中...")}\n` +
        `${color.gray("进度:")} ${color.green(`${(progress * 100).toFixed(1)}%`)}\n\n` +
        `${color.gray("请等待诊断完成后查看详细报告")}`
    );
    form.button("查看实时状态", "textures/icons/server_live_dashboard");
    form.button("停止诊断", "textures/icons/deny");
  } else {
    const sampleData = performanceDiagnostics.getSampleData();
    if (sampleData.length > 0) {
      const latestReport = sampleData[sampleData.length - 1];
      form.body(
        `${color.green("上次诊断结果:")}\n` +
          `${color.gray("TPS:")} ${color.white(latestReport.currentTPS.toFixed(1))}\n` +
          `${color.gray("评级:")} ${translateRating(latestReport.overallRating)}\n` +
          `${color.gray("问题数:")} ${color.yellow(latestReport.issues.length.toString())}\n\n` +
          `${color.gray("点击下方按钮查看详细报告或开始新的诊断")}`
      );
      form.button("查看详细报告", "textures/icons/marketplace_browse");
      form.button("开始新诊断", "textures/icons/requeue");
    } else {
      form.body(
        `${color.aqua("服务器性能诊断工具")}\n\n` +
          `${color.gray("功能:")}\n` +
          `${color.white("• 检测实体过载（刷怪塔）")}\n` +
          `${color.white("• 检测掉落物累积")}\n` +
          `${color.white("• 检测红石电路负载")}\n` +
          `${color.white("• 检测漏斗系统")}\n` +
          `${color.white("• 检测村民数量")}\n` +
          `${color.white("• 综合性能评估")}\n\n` +
          `${color.yellow("点击下方开始诊断")}`
      );
      form.button("开始诊断", "textures/icons/accept");
    }
  }

  form.button("返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;

    if (isRunning) {
      // 诊断进行中的选项
      switch (data.selection) {
        case 0: // 查看实时状态
          openRealtimeStatusForm(player);
          break;
        case 1: // 停止诊断
          performanceDiagnostics.stopDiagnostics();
          openDialogForm(
            player,
            {
              title: "已停止",
              desc: color.yellow("性能诊断已停止"),
            },
            () => openPerformanceDiagnosticsMenu(player, returnForm)
          );
          break;
        case 2: // 返回
          returnForm?.();
          break;
      }
    } else {
      const hasSampleData = performanceDiagnostics.getSampleData().length > 0;
      if (hasSampleData) {
        // 有历史数据的选项
        switch (data.selection) {
          case 0: // 查看详细报告
            openDetailedReportForm(player);
            break;
          case 1: // 开始新诊断
            openStartDiagnosticsForm(player, returnForm);
            break;
          case 2: // 返回
            returnForm?.();
            break;
        }
      } else {
        // 首次使用的选项
        switch (data.selection) {
          case 0: // 开始诊断
            openStartDiagnosticsForm(player, returnForm);
            break;
          case 1: // 返回
            returnForm?.();
            break;
        }
      }
    }
  });
}

/**
 * 打开开始诊断配置表单
 */
function openStartDiagnosticsForm(player: Player, returnForm?: () => void): void {
  const form = new ModalFormData();
  form.title("配置性能诊断");
  form.textField("诊断持续时间（秒）", "建议 60-300 秒", { defaultValue: "60" });
  form.textField("采样间隔（秒）", "建议 5-20 秒", { defaultValue: "5" });
  form.submitButton("开始诊断");

  form.show(player).then((data) => {
    if (data.canceled || !data.formValues) {
      openPerformanceDiagnosticsMenu(player, returnForm);
      return;
    }

    const durationStr = String(data.formValues[0] || "60");
    const intervalStr = String(data.formValues[1] || "5");

    const duration = Math.floor(Number(durationStr));
    const interval = Math.floor(Number(intervalStr));

    if (
      !Number.isFinite(duration) ||
      !Number.isFinite(interval) ||
      duration < 10 ||
      duration > 600 ||
      interval < 1 ||
      interval > 60
    ) {
      openDialogForm(
        player,
        {
          title: "参数错误",
          desc: color.red("持续时间须为 10-600 秒\n采样间隔须为 1-60 秒"),
        },
        () => openStartDiagnosticsForm(player, returnForm)
      );
      return;
    }

    try {
      performanceDiagnostics.startDiagnostics(duration, interval);
      openDialogForm(
        player,
        {
          title: "诊断已启动",
          desc:
            color.green("性能诊断已开始运行\n") +
            color.gray(`持续时间: ${duration} 秒\n`) +
            color.gray(`采样间隔: ${interval} 秒\n\n`) +
            color.yellow("请稍后查看诊断报告"),
        },
        () => openPerformanceDiagnosticsMenu(player, returnForm)
      );
    } catch (error) {
      openDialogForm(
        player,
        {
          title: "启动失败",
          desc: color.red((error as Error).message),
        },
        () => openPerformanceDiagnosticsMenu(player, returnForm)
      );
    }
  });
}

/**
 * 打开实时状态表单
 */
function openRealtimeStatusForm(player: Player): void {
  const progress = performanceDiagnostics.getProgress();
  const sampleData = performanceDiagnostics.getSampleData();

  const form = new ActionFormData();
  form.title("诊断实时状态");
  form.body(
    `${color.yellow("诊断进行中...")}\n\n` +
      `${color.gray("进度:")} ${color.green(`${(progress * 100).toFixed(1)}%`)}\n` +
      `${color.gray("已采样:")} ${color.white(sampleData.length.toString())} 次\n\n` +
      `${
        sampleData.length > 0
          ? `${color.gray("最近一次:")}\n` +
            `${color.gray("TPS:")} ${color.white(sampleData[sampleData.length - 1].currentTPS.toFixed(1))}\n` +
            `${color.gray("问题:")} ${color.yellow(sampleData[sampleData.length - 1].issues.length.toString())} 个`
          : color.gray("等待首次采样...")
      }`
  );
  form.button("刷新", "textures/icons/requeue");
  form.button("返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    if (data.selection === 0) {
      // 刷新
      openRealtimeStatusForm(player);
    } else {
      // 返回
      openPerformanceDiagnosticsMenu(player);
    }
  });
}

/**
 * 打开详细报告表单
 */
function openDetailedReportForm(player: Player): void {
  const sampleData = performanceDiagnostics.getSampleData();
  if (sampleData.length === 0) {
    openPerformanceDiagnosticsMenu(player);
    return;
  }

  const latestReport = sampleData[sampleData.length - 1];
  const avgTPS = sampleData.reduce((sum, r) => sum + r.currentTPS, 0) / sampleData.length;

  const form = new ActionFormData();
  form.title("性能诊断详细报告");

  let bodyText = `${color.aqua("=== 诊断概览 ===")}\n`;
  bodyText += `${color.gray("采样次数:")} ${color.white(sampleData.length.toString())}\n`;
  bodyText += `${color.gray("平均 TPS:")} ${color.white(avgTPS.toFixed(1))}\n`;
  bodyText += `${color.gray("当前 TPS:")} ${color.white(latestReport.currentTPS.toFixed(1))}\n`;
  bodyText += `${color.gray("综合评级:")} ${translateRating(latestReport.overallRating)}\n\n`;

  if (latestReport.issues.length > 0) {
    bodyText += `${color.red("=== 发现的性能问题 ===")}\n`;

    // 按严重程度排序
    const sortedIssues = [...latestReport.issues].sort((a, b) => {
      const severityOrder = {
        [PerformanceSeverity.SEVERE]: 0,
        [PerformanceSeverity.CRITICAL]: 1,
        [PerformanceSeverity.WARNING]: 2,
        [PerformanceSeverity.NOTICE]: 3,
        [PerformanceSeverity.NORMAL]: 4,
      };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });

    for (const issue of sortedIssues.slice(0, 10)) {
      // 最多显示10个
      const severityColor = getSeverityColor(issue.severity);
      bodyText += `\n${severityColor(`[${translateSeverity(issue.severity)}]`)} `;
      bodyText += `${color.white(issue.description)}\n`;
      bodyText += `${color.gray(`数值: ${issue.value} (阈值: ${issue.threshold})`)}\n`;
      if (issue.location) {
        bodyText += `${color.gray(
          `位置: ${Math.floor(issue.location.x)}, ${Math.floor(issue.location.y)}, ${Math.floor(issue.location.z)}`
        )}\n`;
      }
    }

    if (latestReport.issues.length > 10) {
      bodyText += `\n${color.gray(`... 还有 ${latestReport.issues.length - 10} 个问题`)}\n`;
    }
  } else {
    bodyText += `${color.green("=== 未发现性能问题 ===")}\n`;
    bodyText += `${color.gray("服务器性能良好")}\n`;
  }

  form.body(bodyText);
  form.button("查看问题列表", "textures/icons/marketplace_browse");
  form.button("生成文本报告", "textures/icons/edit2");
  form.button("返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    switch (data.selection) {
      case 0: // 查看问题列表
        openIssueListForm(player, latestReport, 1);
        break;
      case 1: // 生成文本报告
        const summary = performanceDiagnostics.generateSummaryReport();
        player.sendMessage(summary);
        openPerformanceDiagnosticsMenu(player);
        break;
      case 2: // 返回
        openPerformanceDiagnosticsMenu(player);
        break;
    }
  });
}

/**
 * 打开问题列表表单（分页）
 */
function openIssueListForm(player: Player, report: PerformanceDiagnosticReport, page: number = 1): void {
  const pageSize = 10;
  const totalPages = Math.ceil(report.issues.length / pageSize) || 1;
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  const currentPageIssues = report.issues.slice(start, start + pageSize);

  const form = new ActionFormData();
  form.title(`性能问题列表 (${safePage}/${totalPages})`);
  form.body(`${color.gray(`共 ${report.issues.length} 个问题`)}`);

  currentPageIssues.forEach((issue) => {
    const severityColor = getSeverityColor(issue.severity);
    const buttonText = `${translateSeverity(issue.severity)} - ${translateIssueType(issue.type)}\n${issue.dimension || "全局"} | 数值: ${issue.value}`;
    form.button(buttonText, "textures/icons/eyes");
  });

  if (safePage > 1) {
    form.button("上一页", "textures/icons/left_arrow");
  }
  if (safePage < totalPages) {
    form.button("下一页", "textures/icons/right_arrow");
  }
  form.button("返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.selection === undefined) return;

    const issueCount = currentPageIssues.length;
    if (data.selection < issueCount) {
      // 选择了某个问题
      openIssueDetailForm(player, currentPageIssues[data.selection], report, safePage);
    } else {
      // 导航按钮
      let buttonIndex = issueCount;
      if (safePage > 1) {
        if (data.selection === buttonIndex) {
          openIssueListForm(player, report, safePage - 1);
          return;
        }
        buttonIndex++;
      }
      if (safePage < totalPages) {
        if (data.selection === buttonIndex) {
          openIssueListForm(player, report, safePage + 1);
          return;
        }
        buttonIndex++;
      }
      // 返回按钮
      openDetailedReportForm(player);
    }
  });
}

/**
 * 打开单个问题详情表单
 */
function openIssueDetailForm(
  player: Player,
  issue: any,
  report: PerformanceDiagnosticReport,
  returnPage: number
): void {
  const form = new ActionFormData();
  form.title("问题详情");

  let bodyText = `${getSeverityColor(issue.severity)(`[${translateSeverity(issue.severity)}]`)}\n\n`;
  bodyText += `${color.white("类型:")} ${color.yellow(translateIssueType(issue.type))}\n`;
  bodyText += `${color.white("描述:")} ${color.gray(issue.description)}\n`;
  bodyText += `${color.white("当前值:")} ${color.red(issue.value.toString())}\n`;
  bodyText += `${color.white("阈值:")} ${color.green(issue.threshold.toString())}\n`;
  if (issue.dimension) {
    bodyText += `${color.white("维度:")} ${color.aqua(issue.dimension)}\n`;
  }
  if (issue.location) {
    bodyText += `${color.white("位置:")} ${color.yellow(
      `${Math.floor(issue.location.x)}, ${Math.floor(issue.location.y)}, ${Math.floor(issue.location.z)}`
    )}\n`;
  }

  bodyText += `\n${color.gold("=== 建议 ===")}\n`;
  bodyText += getSuggestionForIssue(issue);

  form.body(bodyText);
  if (issue.location) {
    form.button("传送到问题位置", "textures/icons/waypoint_admin_all");
  }
  form.button("返回列表", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.selection === undefined) return;
    if (issue.location && data.selection === 0) {
      // 传送到问题位置
      try {
        player.teleport(issue.location, {
          dimension: player.dimension,
        });
        player.sendMessage(color.green("已传送到问题位置"));
      } catch (error) {
        player.sendMessage(color.red("传送失败"));
      }
      openIssueListForm(player, report, returnPage);
    } else {
      openIssueListForm(player, report, returnPage);
    }
  });
}

/**
 * 获取问题类型的建议
 */
function getSuggestionForIssue(issue: any): string {
  switch (issue.type) {
    case PerformanceIssueType.ENTITY_CLUSTER:
      return (
        color.white("• 疑似刷怪塔或实体农场\n") +
        color.white("• 建议限制单区块实体数量\n") +
        color.white("• 可使用漏斗+箱子及时清理\n") +
        color.white("• 考虑使用开关控制刷怪频率")
      );
    case PerformanceIssueType.ITEM_ENTITIES:
      return (
        color.white("• 建议清理掉落物\n") +
        color.white("• 使用命令: /kill @e[type=item]\n") +
        color.white("• 优化自动农场的物品收集\n") +
        color.white("• 启用自动清理掉落物功能")
      );
    case PerformanceIssueType.VILLAGER_COUNT:
      return (
        color.white("• 村民过多影响 AI 计算\n") +
        color.white("• 建议控制村民繁殖\n") +
        color.white("• 可移除不必要的村民\n") +
        color.white("• 优化村民交易所设计")
      );
    case PerformanceIssueType.XP_ORB_COUNT:
      return (
        color.white("• 建议清理经验球\n") +
        color.white("• 使用命令: /kill @e[type=xp_orb]\n") +
        color.white("• 优化经验农场设计")
      );
    case PerformanceIssueType.DECORATION_ENTITIES:
      return (
        color.white("• 展示框/盔甲架过多\n") +
        color.white("• 建议减少装饰实体数量\n") +
        color.white("• 考虑使用方块替代")
      );
    case PerformanceIssueType.TNT_EXPLOSION:
      return (
        color.white("• TNT 爆炸消耗大量性能\n") + color.white("• 建议分批引爆\n") + color.white("• 避免大规模连锁爆炸")
      );
    default:
      return color.gray("暂无具体建议");
  }
}

/**
 * 翻译评级
 */
function translateRating(rating: string): string {
  const map: Record<string, string> = {
    excellent: color.green("优秀"),
    good: color.green("良好"),
    fair: color.yellow("一般"),
    poor: color.red("较差"),
    critical: color.red("严重"),
  };
  return map[rating] || rating;
}

/**
 * 翻译严重程度
 */
function translateSeverity(severity: PerformanceSeverity): string {
  const map: Record<PerformanceSeverity, string> = {
    [PerformanceSeverity.NORMAL]: "正常",
    [PerformanceSeverity.NOTICE]: "注意",
    [PerformanceSeverity.WARNING]: "警告",
    [PerformanceSeverity.CRITICAL]: "严重",
    [PerformanceSeverity.SEVERE]: "极严重",
  };
  return map[severity] || severity;
}

/**
 * 翻译问题类型
 */
function translateIssueType(type: PerformanceIssueType): string {
  const map: Record<PerformanceIssueType, string> = {
    [PerformanceIssueType.ENTITY_CLUSTER]: "实体聚集",
    [PerformanceIssueType.ITEM_ENTITIES]: "掉落物",
    [PerformanceIssueType.REDSTONE_LOAD]: "红石负载",
    [PerformanceIssueType.HOPPER_SYSTEM]: "漏斗系统",
    [PerformanceIssueType.CHUNK_LOADING]: "区块加载",
    [PerformanceIssueType.VILLAGER_COUNT]: "村民数量",
    [PerformanceIssueType.XP_ORB_COUNT]: "经验球",
    [PerformanceIssueType.DECORATION_ENTITIES]: "装饰实体",
    [PerformanceIssueType.TNT_EXPLOSION]: "TNT爆炸",
    [PerformanceIssueType.SCRIPT_PERFORMANCE]: "脚本性能",
  };
  return map[type] || type;
}

/**
 * 获取严重程度对应的颜色函数
 */
function getSeverityColor(severity: PerformanceSeverity): (text: string) => string {
  const map: Record<PerformanceSeverity, (text: string) => string> = {
    [PerformanceSeverity.NORMAL]: color.green,
    [PerformanceSeverity.NOTICE]: color.yellow,
    [PerformanceSeverity.WARNING]: color.gold,
    [PerformanceSeverity.CRITICAL]: color.red,
    [PerformanceSeverity.SEVERE]: color.red,
  };
  return map[severity] || color.white;
}
