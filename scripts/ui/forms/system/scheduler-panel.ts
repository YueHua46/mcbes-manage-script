import { Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { taskScheduler } from "../../../features/platform/scheduler";
import { color } from "../../../shared/utils/color";

function formatInterval(ticks: number): string {
  const sec = ticks / 20;
  if (sec < 1) {
    return `${ticks}t`;
  }
  if (sec >= 60) {
    const min = sec / 60;
    return min % 1 === 0 ? `${min}分` : `${min.toFixed(1)}分`;
  }
  return sec % 1 === 0 ? `${sec}秒` : `${sec.toFixed(1)}秒`;
}

function buildDetailBody(): string {
  const snapshots = taskScheduler
    .getSnapshots()
    .sort((a, b) => b.avgDurationMs - a.avgDurationMs || a.label.localeCompare(b.label, "zh"));

  if (snapshots.length === 0) {
    return color.yellow("暂无已注册的调度任务。");
  }

  const lines = snapshots.map((task) => {
    const state = task.enabled ? color.green("开") : color.red("停");
    const running = task.isRunning ? color.gold(" 执行中") : "";
    const stats =
      task.runCount > 0
        ? `均${task.avgDurationMs.toFixed(1)}ms / 末${task.lastDurationMs.toFixed(1)}ms / 最大${task.maxDurationMs.toFixed(1)}ms`
        : color.gray("尚未执行");
    const extras: string[] = [];
    if (task.skipCount > 0) extras.push(`跳过${task.skipCount}`);
    if (task.slowCount > 0) extras.push(`慢${task.slowCount}`);
    if (task.errorCount > 0) extras.push(color.red(`错${task.errorCount}`));
    const extraText = extras.length > 0 ? `  ${extras.join(" ")}` : "";

    return [
      `${color.aqua(task.label)} ${state}${running}`,
      `${color.gray("间隔")} ${formatInterval(task.intervalTicks)}  ${color.gray("次数")} ${task.runCount}`,
      `${color.white(stats)}${extraText}`,
    ].join("\n");
  });

  return lines.join("\n\n");
}

export function openSchedulerDetailForm(player: Player, returnForm?: () => void): void {
  const form = new ActionFormData();
  form.title("§w调度器详情");
  form.body({ rawtext: [{ text: buildDetailBody() }] });
  form.button("§w任务开关", "textures/icons/gear");
  form.button("§w刷新", "textures/icons/requeue");
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((response) => {
    if (response.canceled || response.cancelationReason) return;
    switch (response.selection) {
      case 0:
        openSchedulerToggleForm(player, () => openSchedulerDetailForm(player, returnForm));
        break;
      case 1:
        openSchedulerDetailForm(player, returnForm);
        break;
      default:
        returnForm?.();
        break;
    }
  });
}

function openSchedulerToggleForm(player: Player, returnForm?: () => void): void {
  const snapshots = taskScheduler.getSnapshots().sort((a, b) => a.label.localeCompare(b.label, "zh"));
  if (snapshots.length === 0) {
    openSchedulerDetailForm(player, returnForm);
    return;
  }

  const form = new ModalFormData();
  form.title("调度任务开关");
  form.label("关闭后任务不再执行（模块 when 条件仍生效）。重启世界后开关会重置为开启。");

  snapshots.forEach((task) => {
    form.toggle(`${task.label}（${formatInterval(task.intervalTicks)}）`, {
      defaultValue: task.enabled,
    });
  });

  form.submitButton("保存");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason || !data.formValues) {
      returnForm?.();
      return;
    }

    snapshots.forEach((task, index) => {
      const value = data.formValues?.[index];
      taskScheduler.setEnabled(task.id, value === true);
    });

    returnForm?.();
  });
}
