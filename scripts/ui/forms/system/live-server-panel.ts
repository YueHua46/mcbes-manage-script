import { Player, system, world } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import serverInfo from "../../../features/system/services/server-info";
import setting from "../../../features/system/services/setting";
import { getLiveFormCapabilities } from "../../../features/platform/sapi-capabilities";
import { taskScheduler } from "../../../features/platform/scheduler";
import { color } from "../../../shared/utils/color";
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

function countDimensionEntities(type?: string): number {
  const dimensions = ["overworld", "nether", "the_end"];
  let total = 0;

  for (const dimensionId of dimensions) {
    try {
      total += world.getDimension(dimensionId).getEntities(type ? { type } : undefined).length;
    } catch {
      // 维度未加载或查询失败时跳过，避免面板本身影响服务器。
    }
  }

  return total;
}

function buildSnapshot(): string {
  const onlinePlayers = world.getAllPlayers();
  const totalEntities = countDimensionEntities();
  const tps = serverInfo.TPS || 0;
  const mobs = serverInfo.organismLength || 0;
  const items = serverInfo.itemsLength || 0;
  const taskCount = taskScheduler.getSnapshots().length;
  const runningTasks = taskScheduler.getSnapshots().filter((task) => task.isRunning).length;

  return [
    `${stat("TPS", tps, color.gold)}  ${color.darkGray("|")}  ${stat("在线", onlinePlayers.length)}`,
    `${stat("实体", totalEntities)}  ${color.gray("(")}${color.green("生物")} ${color.white(String(mobs))}${color.gray(" / ")}${color.gold("掉落")} ${color.white(String(items))}${color.gray(")")}`,
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

function openFallbackServerPanel(player: Player, returnForm?: () => void): void {
  const form = new ActionFormData();
  form.title("§w服务器实时面板");
  form.body({ rawtext: [{ text: buildSnapshot() }] });
  form.button("§w调度详情", "textures/icons/gear");
  form.button("§w刷新", "textures/icons/requeue");
  form.button("§w返回", "textures/icons/back");
  form.show(player).then((response) => {
    if (response.canceled || response.cancelationReason) return;
    if (response.selection === 0) {
      openSchedulerDetailForm(player, () => openFallbackServerPanel(player, returnForm));
      return;
    }
    if (response.selection === 1) {
      openFallbackServerPanel(player, returnForm);
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
    openFallbackServerPanel(player, returnForm);
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
    })
    .button("刷新", () => {
      snapshot.setData(buildSnapshot());
    })
    .button("返回", () => {
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
    openFallbackServerPanel(player, returnForm);
    return;
  } finally {
    system.clearRun(refreshRun);
  }
}
