import { Player, system, world } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import serverInfo from "../../../features/system/services/server-info";
import setting from "../../../features/system/services/setting";
import { color } from "../../../shared/utils/color";

type ServerUiModule = typeof import("@minecraft/server-ui");

function boolState(value: unknown): string {
  return value === true ? color.green("开") : color.red("关");
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

  return [
    `${color.gold("TPS")} ${color.white(String(serverInfo.TPS || 0))}`,
    `${color.aqua("在线玩家")} ${color.white(String(onlinePlayers.length))}`,
    `${color.aqua("生物/非掉落物")} ${color.white(String(serverInfo.organismLength || 0))}`,
    `${color.aqua("掉落物")} ${color.white(String(serverInfo.itemsLength || 0))}`,
    `${color.gray("实体总数")} ${color.white(String(totalEntities))}`,
    "",
    `${color.yellow("经济系统")} ${boolState(setting.getState("economy"))}`,
    `${color.yellow("领地系统")} ${boolState(setting.getState("land"))}`,
    `${color.yellow("行为日志")} ${boolState(setting.getState("behaviorLogEnabled"))}`,
    `${color.yellow("防刷物品")} ${boolState(setting.getState("antiDupeEnabled"))}`,
    `${color.yellow("公会系统")} ${boolState(setting.getState("guild"))}`,
    `${color.yellow("PVP 菜单")} ${boolState(setting.getState("pvp"))}`,
  ].join("\n");
}

function openFallbackServerPanel(player: Player, returnForm?: () => void): void {
  const form = new ActionFormData();
  form.title("§w服务器实时面板");
  form.body({ rawtext: [{ text: buildSnapshot() }] });
  form.button("§w刷新", "textures/icons/requeue");
  form.button("§w返回", "textures/icons/back");
  form.show(player).then((response) => {
    if (response.canceled || response.cancelationReason) return;
    if (response.selection === 0) {
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
  let ui: ServerUiModule;

  try {
    ui = await import("@minecraft/server-ui");
  } catch {
    openFallbackServerPanel(player, returnForm);
    return;
  }

  const CustomForm = (ui as any).CustomForm;
  const Observable = (ui as any).Observable;

  if (!CustomForm || !Observable) {
    openFallbackServerPanel(player, returnForm);
    return;
  }

  const snapshot = Observable.create(buildSnapshot());
  const lastRefresh = Observable.create(`最后刷新 tick: ${system.currentTick}`);
  const form = CustomForm.create(player, "服务器实时面板");

  form
    .closeButton()
    .header("运行状态")
    .label(snapshot)
    .label(lastRefresh)
    .divider()
    .button("立即刷新", () => {
      snapshot.setData(buildSnapshot());
      lastRefresh.setData(`最后刷新 tick: ${system.currentTick}`);
    })
    .button("返回", () => {
      safeClose(form);
      system.run(() => returnForm?.());
    });

  const refreshRun = system.runInterval(() => {
    try {
      if (!form.isShowing()) return;
      snapshot.setData(buildSnapshot());
      lastRefresh.setData(`最后刷新 tick: ${system.currentTick}`);
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
