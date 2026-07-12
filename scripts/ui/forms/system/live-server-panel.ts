import { Player, system } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import serverInfo from "../../../features/system/services/server-info";
import setting from "../../../features/system/services/setting";
import {
  collectDebugPluginStats,
  collectDebugRuntimeStats,
  getLiveFormCapabilities,
  isDebugUtilitiesAvailable,
} from "../../../features/platform/sapi-capabilities";
import { taskScheduler } from "../../../features/platform/scheduler";
import { color } from "../../../shared/utils/color";
import { getOnlineRealPlayers } from "../../../shared/utils/online-players";
import { openSchedulerDetailForm } from "./scheduler-panel";

function boolState(value: unknown): string {
  return value === true ? color.green("开") : color.red("关");
}

function stat(label: string, value: string | number, labelColor: (text: string) => string = color.aqua): string {
  return `${labelColor(label)} ${color.white(String(value))}`;
}

function switchStat(label: string, value: unknown): string {
  return `${color.yellow(label)} ${boolState(value)}`;
}

function formatBytes(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  if (value < 1024) return `${value}B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)}KB`;
  return `${(value / 1024 / 1024).toFixed(1)}MB`;
}

function buildSnapshot(): string {
  const onlinePlayers = getOnlineRealPlayers();
  const tps = serverInfo.TPS || 0;
  const otherEntities = serverInfo.organismLength || 0;
  const items = serverInfo.itemsLength || 0;
  const totalEntities = otherEntities + items;
  const taskCount = taskScheduler.getSnapshots().length;
  const runningTasks = taskScheduler.getSnapshots().filter((task) => task.isRunning).length;

  return [
    `${stat("TPS", tps, color.gold)}  ${color.darkGray("|")}  ${stat("在线", onlinePlayers.length)}`,
    `${stat("实体", totalEntities)}  ${color.gray("(")}${color.green("其他实体")} ${color.white(String(otherEntities))}${color.gray(" / ")}${color.gold("掉落物")} ${color.white(String(items))}${color.gray(")")}`,
    "",
    `${switchStat("经济", setting.getState("economy"))}  ${switchStat("领地", setting.getState("land"))}`,
    `${switchStat("日志", setting.getState("behaviorLogEnabled"))}  ${switchStat("防刷", setting.getState("antiDupeEnabled"))}`,
    `${switchStat("公会", setting.getState("guild"))}  ${switchStat("PVP", setting.getState("pvp"))}`,
    "",
    `${color.gold("── 调度器 ──")}  ${color.gray(`任务 ${taskCount}`)}${runningTasks > 0 ? color.yellow(`  执行中 ${runningTasks}`) : ""}`,
    taskScheduler.formatPanelSection(5),
    "",
    `${color.gray(`更新 tick ${system.currentTick}`)}`,
  ].join("\n");
}

async function buildDebugDiagnosticsSnapshot(): Promise<string> {
  const [runtime, plugins] = await Promise.all([collectDebugRuntimeStats(), collectDebugPluginStats()]);

  if (!runtime && !plugins) {
    return color.red("DebugUtilities 当前不可用。请确认正在使用本地/BDS 调试版附加包。");
  }

  const lines: string[] = [];
  lines.push(`${color.gold("── Runtime ──")}`);
  if (runtime) {
    lines.push(
      `${stat("内存已用", formatBytes(runtime.memoryUsedSize))}  ${color.darkGray("|")}  ${stat(
        "已分配",
        formatBytes(runtime.memoryAllocatedSize)
      )}`
    );
    lines.push(
      `${stat("对象", runtime.objectCount)}  ${color.darkGray("|")}  ${stat("字符串", runtime.stringCount)}  ${color.darkGray(
        "|"
      )}  ${stat("函数", runtime.functionCount)}`
    );
    lines.push(
      `${stat("属性", runtime.propertyCount)}  ${color.darkGray("|")}  ${stat(
        "数组",
        runtime.arrayCount + runtime.fastArrayCount
      )}`
    );
  } else {
    lines.push(color.gray("运行时统计读取失败。"));
  }

  lines.push("");
  lines.push(`${color.gold("── Plugin Handles ──")}`);
  if (plugins?.plugins?.length) {
    for (const plugin of plugins.plugins.slice(0, 5)) {
      const totalHandles = Object.values(plugin.handleCounts).reduce((sum, count) => sum + count, 0);
      const topHandles = Object.entries(plugin.handleCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, count]) => `${name}:${count}`)
        .join(" ");
      lines.push(`${color.aqua(plugin.name)} ${color.white(String(totalHandles))} ${color.gray(topHandles)}`);
    }
  } else {
    lines.push(color.gray("暂无插件句柄统计。"));
  }

  lines.push("");
  lines.push(`${color.gray(`更新 tick ${system.currentTick}`)}`);
  return lines.join("\n");
}

async function openDebugDiagnosticsPanel(player: Player, returnForm?: () => void): Promise<void> {
  const form = new ActionFormData();
  form.title("调试诊断");
  form.body({ rawtext: [{ text: await buildDebugDiagnosticsSnapshot() }] });
  form.button("刷新", "textures/icons/requeue");
  form.button("返回", "textures/icons/back");
  form.show(player).then((response) => {
    if (response.canceled || response.cancelationReason) return;
    if (response.selection === 0) {
      void openDebugDiagnosticsPanel(player, returnForm);
      return;
    }
    returnForm?.();
  });
}

function safeClose(form: { close?: () => void }): void {
  try {
    form.close?.();
  } catch {
    // 表单可能已经被客户端关闭。
  }
}

export async function openLiveServerPanel(player: Player, returnForm?: () => void): Promise<void> {
  const liveForm = await getLiveFormCapabilities();
  if (!liveForm) {
    player.sendMessage(color.red("当前运行时不支持 DDUI，无法打开服务器实时面板。"));
    system.run(() => returnForm?.());
    return;
  }

  const { CustomForm, Observable } = liveForm;
  const snapshot = Observable.create(buildSnapshot());
  const form = CustomForm.create(player, "服务器实时面板");

  form
    .label(snapshot)
    .divider()
    .button("调度详情", () => {
      safeClose(form);
      system.run(() => openSchedulerDetailForm(player, () => openLiveServerPanel(player, returnForm)));
    });

  if (isDebugUtilitiesAvailable()) {
    form.button("调试诊断", () => {
      safeClose(form);
      system.run(() => void openDebugDiagnosticsPanel(player, () => openLiveServerPanel(player, returnForm)));
    });
  }

  form.button("返回", () => {
      safeClose(form);
      system.run(() => returnForm?.());
    });

  const refreshRun = system.runInterval(() => {
    try {
      if (!form.isShowing()) return;
      snapshot.setData(buildSnapshot());
    } catch {
      system.clearRun(refreshRun);
    }
  }, 20);

  try {
    await form.show();
  } catch {
    player.sendMessage(color.red("DDUI 实时面板打开失败，请稍后重试。"));
    return;
  } finally {
    system.clearRun(refreshRun);
  }
}
