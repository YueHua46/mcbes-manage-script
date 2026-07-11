import { Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { color, colorCodes } from "../../../shared/utils/color";
import { isAdmin } from "../../../shared/utils/common";
import setting from "../../../features/system/services/setting";
import floatingTextService, { IFloatingText } from "../../../features/floating-text/services/floating-text";
import { openConfirmDialogForm, openDialogForm } from "../../../ui/components/dialog";
import { openServerMenuForm } from "../server";

const PAGE_SIZE = 9;

function dimensionLabel(dimension: string): string {
  switch (dimension) {
    case "minecraft:overworld":
    case "overworld":
      return "主世界";
    case "minecraft:nether":
    case "nether":
      return "下界";
    case "minecraft:the_end":
    case "the_end":
      return "末地";
    default:
      return dimension;
  }
}

function oneLine(text: string): string {
  return text.replace(/\n/g, " / ").slice(0, 36);
}

function formatLocation(item: IFloatingText): string {
  return `${dimensionLabel(item.dimension)} ${item.location.x}, ${item.location.y}, ${item.location.z}`;
}

function isResultError<T>(result: T | string): result is string {
  return typeof result === "string";
}

export function openFloatingTextMenu(player: Player): void {
  if (!floatingTextService.canUse(player)) {
    openDialogForm(
      player,
      {
        title: "悬浮文字不可用",
        desc: isAdmin(player) ? "悬浮文字系统已关闭，请先在功能开关中开启。" : "服务器暂未对普通成员开放悬浮文字功能。",
      },
      () => openServerMenuForm(player)
    );
    return;
  }

  const admin = isAdmin(player);
  const myTexts = floatingTextService.listForPlayer(player.name);
  const cost = floatingTextService.getCreateCost(player);
  const costText = cost > 0 ? `创建每次消耗 ${cost} 金币` : "创建免费（当前费用为 0，不扣金币）";

  const form = new ActionFormData();
  form.title("悬浮文字");
  form.body(
    [
      `我的悬浮文字: ${myTexts.length}${admin ? "（管理员不受数量限制）" : ` / ${floatingTextService.getMaxPerPlayer()}`}`,
      admin ? `管理员可管理所有人的悬浮文字；${costText}。` : costText,
    ].join("\n")
  );
  form.button("我的悬浮文字", "textures/icons/catalogue");
  form.button(cost > 0 ? `创建悬浮文字\n${costText}` : "创建悬浮文字\n免费", "textures/icons/add");
  if (admin) {
    form.button("管理全部悬浮文字", "textures/icons/gear");
    form.button("系统设置", "textures/icons/settings");
  }
  form.button("返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    const selection = data.selection;
    if (selection === undefined) return;
    if (selection === 0) return openFloatingTextListForm(player, "mine", 1);
    if (selection === 1) return openFloatingTextCreateForm(player);
    if (admin && selection === 2) return openFloatingTextListForm(player, "all", 1);
    if (admin && selection === 3) return openFloatingTextSettingsForm(player);
    openServerMenuForm(player);
  });
}

function openFloatingTextListForm(player: Player, mode: "mine" | "all" | "player", page: number, targetName?: string): void {
  const admin = isAdmin(player);
  let items =
    mode === "all" && admin
      ? floatingTextService.listAllForAdmin()
      : floatingTextService.listForPlayer(mode === "player" && targetName ? targetName : player.name);

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const currentItems = items.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const form = new ActionFormData();
  form.title(mode === "all" ? "全部悬浮文字" : mode === "player" ? `${targetName} 的悬浮文字` : "我的悬浮文字");
  form.body(`第 ${safePage} / ${totalPages} 页 · 共 ${items.length} 个`);

  currentItems.forEach((item) => {
    const owner = admin && item.ownerName !== player.name ? ` · ${item.ownerName}` : "";
    form.button(`${item.name}${owner}\n${oneLine(item.text)}`, "textures/icons/chat_bubble_white");
  });

  let previousIndex = -1;
  let nextIndex = -1;
  let searchIndex = -1;

  if (safePage > 1) {
    previousIndex = currentItems.length;
    form.button("上一页", "textures/icons/left_arrow");
  }
  if (safePage < totalPages) {
    nextIndex = currentItems.length + (previousIndex >= 0 ? 1 : 0);
    form.button("下一页", "textures/icons/right_arrow");
  }
  if (mode === "all" && admin) {
    searchIndex = currentItems.length + (previousIndex >= 0 ? 1 : 0) + (nextIndex >= 0 ? 1 : 0);
    form.button("按玩家搜索", "textures/icons/wisdom");
  }

  form.button("返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    const selection = data.selection;
    if (selection === undefined) return;

    if (selection < currentItems.length) {
      return openFloatingTextDetailForm(player, currentItems[selection], () =>
        openFloatingTextListForm(player, mode, safePage, targetName)
      );
    }
    if (selection === previousIndex) return openFloatingTextListForm(player, mode, safePage - 1, targetName);
    if (selection === nextIndex) return openFloatingTextListForm(player, mode, safePage + 1, targetName);
    if (selection === searchIndex) return openFloatingTextSearchPlayerForm(player);
    openFloatingTextMenu(player);
  });
}

function openFloatingTextSearchPlayerForm(player: Player): void {
  const form = new ModalFormData();
  form.title("搜索玩家悬浮文字");
  form.textField("玩家名称", "输入完整玩家名", { defaultValue: "" });
  form.submitButton("搜索");

  form.show(player).then((data) => {
    if (data.cancelationReason) return;
    const name = String(data.formValues?.[0] ?? "").trim();
    if (!name) {
      return openDialogForm(player, { title: "搜索失败", desc: color.red("玩家名称不能为空。") }, () =>
        openFloatingTextSearchPlayerForm(player)
      );
    }
    openFloatingTextListForm(player, "player", 1, name);
  });
}

function openFloatingTextCreateForm(player: Player): void {
  const cost = floatingTextService.getCreateCost(player);
  const form = new ModalFormData();
  form.title("创建悬浮文字");
  form.textField("名称", "最多 24 个字符", { defaultValue: "" });
  form.textField("显示文本", "支持输入 \\n 换行，最多 240 字符", {
    defaultValue: "",
    tooltip: cost > 0 ? `提交后将扣除 ${cost} 金币。` : "当前费用为 0，创建不会扣金币。",
  });
  form.textField("显示缩放", "0.3～4，默认 1", { defaultValue: "1" });
  form.textField("可见距离", "8～256，默认 64", { defaultValue: "64" });
  form.toggle("被方块遮挡时隐藏", { defaultValue: false });
  form.textField("背景透明度", "0～1，默认 0.35；0 为透明", { defaultValue: "0.35" });
  form.submitButton(cost > 0 ? `创建（消耗 ${cost} 金币）` : "创建（免费）");

  form.show(player).then((data) => {
    if (data.cancelationReason) return;
    const values = data.formValues;
    if (!values) return;
    const result = floatingTextService.create({
      player,
      name: String(values[0] ?? ""),
      text: String(values[1] ?? ""),
      scale: Number(values[2]),
      maximumRenderDistance: Number(values[3]),
      depthTest: values[4] as boolean,
      backgroundAlpha: Number(values[5]),
    });
    if (isResultError(result)) {
      return openDialogForm(player, { title: "创建失败", desc: color.red(result) }, () => openFloatingTextCreateForm(player));
    }
    openDialogForm(
      player,
      {
        title: "创建成功",
        desc: `${color.green("悬浮文字已创建在你当前位置上方。")}\n${cost > 0 ? color.yellow(`已扣除 ${cost} 金币。`) : color.gray("本次创建未扣金币。")}`,
      },
      () => openFloatingTextDetailForm(player, result, () => openFloatingTextMenu(player))
    );
  });
}

function openFloatingTextDetailForm(player: Player, item: IFloatingText, back: () => void): void {
  const latest = floatingTextService.getById(item.id);
  if (!latest) {
    return openDialogForm(player, { title: "提示", desc: "该悬浮文字已不存在。" }, back);
  }

  const form = new ActionFormData();
  form.title(`${latest.name}`);
  form.body(
    [
      `所有者: ${latest.ownerName}`,
      `位置: ${formatLocation(latest)}`,
      `缩放: ${latest.scale} · 可见距离: ${latest.maximumRenderDistance}`,
      `创建: ${latest.created}`,
      `修改: ${latest.modified}`,
      "",
      `${colorCodes.white}${latest.text}`,
    ].join("\n")
  );
  form.button("编辑文字和样式", "textures/icons/edit2");
  form.button("移动到当前位置", "textures/icons/marker_quest");
  form.button("删除", "textures/icons/deny");
  form.button("返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    switch (data.selection) {
      case 0:
        openFloatingTextEditForm(player, latest, () => openFloatingTextDetailForm(player, latest, back));
        break;
      case 1:
        openConfirmDialogForm(
          player,
          "移动悬浮文字",
          `确定将「${latest.name}」移动到你当前位置上方吗？`,
          () => {
            const result = floatingTextService.update({ player, id: latest.id, updateLocation: true });
            openDialogForm(
              player,
              { title: isResultError(result) ? "移动失败" : "移动成功", desc: isResultError(result) ? color.red(result) : color.green("已移动到当前位置上方。") },
              () => openFloatingTextDetailForm(player, latest, back)
            );
          },
          () => openFloatingTextDetailForm(player, latest, back)
        );
        break;
      case 2:
        openConfirmDialogForm(
          player,
          "删除悬浮文字",
          `确定删除「${latest.name}」吗？此操作不可恢复。`,
          () => {
            const result = floatingTextService.delete(player, latest.id);
            openDialogForm(
              player,
              { title: result === true ? "删除成功" : "删除失败", desc: result === true ? color.green("悬浮文字已删除。") : color.red(String(result)) },
              back
            );
          },
          () => openFloatingTextDetailForm(player, latest, back),
          { dangerConfirm: true }
        );
        break;
      default:
        back();
        break;
    }
  });
}

function openFloatingTextEditForm(player: Player, item: IFloatingText, back: () => void): void {
  const latest = floatingTextService.getById(item.id);
  if (!latest) return openDialogForm(player, { title: "提示", desc: "该悬浮文字已不存在。" }, back);

  const form = new ModalFormData();
  form.title("编辑悬浮文字");
  form.textField("名称", "最多 24 个字符", { defaultValue: latest.name });
  form.textField("显示文本", "支持输入 \\n 换行，最多 240 字符", { defaultValue: latest.text.replace(/\n/g, "\\n") });
  form.textField("显示缩放", "0.3～4", { defaultValue: String(latest.scale) });
  form.textField("可见距离", "8～256", { defaultValue: String(latest.maximumRenderDistance) });
  form.toggle("被方块遮挡时隐藏", { defaultValue: latest.depthTest });
  form.textField("背景透明度", "0～1；0 为透明", { defaultValue: String(latest.backgroundAlpha) });
  form.submitButton("保存");

  form.show(player).then((data) => {
    if (data.cancelationReason) return;
    const values = data.formValues;
    if (!values) return;
    const result = floatingTextService.update({
      player,
      id: latest.id,
      name: String(values[0] ?? ""),
      text: String(values[1] ?? ""),
      scale: Number(values[2]),
      maximumRenderDistance: Number(values[3]),
      depthTest: values[4] as boolean,
      backgroundAlpha: Number(values[5]),
    });
    if (isResultError(result)) {
      return openDialogForm(player, { title: "保存失败", desc: color.red(result) }, () =>
        openFloatingTextEditForm(player, latest, back)
      );
    }
    openDialogForm(player, { title: "保存成功", desc: color.green("悬浮文字已更新。") }, back);
  });
}

export function openFloatingTextSettingsForm(player: Player): void {
  if (!isAdmin(player)) {
    player.sendMessage(color.red("只有管理员可以修改悬浮文字设置。"));
    return;
  }

  const form = new ModalFormData();
  form.title("悬浮文字设置");
  form.toggle("对普通成员开放悬浮文字", {
    defaultValue: setting.getState("floatingTextAllowMembers") === true,
    tooltip: "关闭后只有管理员可以使用和管理悬浮文字；管理员始终可管理所有人的悬浮文字。",
  });
  form.textField("普通玩家最多创建数量", "0 表示普通玩家无法创建新的悬浮文字", {
    defaultValue: String(setting.getState("floatingTextMaxPerPlayer")),
  });
  form.textField("每次创建消耗金币", "填 0 表示免费，不扣金币", {
    defaultValue: String(setting.getState("floatingTextCreateCost")),
    tooltip: "所有玩家创建时都会按此配置扣除；设置为 0 时等同于不需要金币。",
  });
  form.submitButton("保存");

  form.show(player).then((data) => {
    if (data.cancelationReason) return;
    const values = data.formValues;
    if (!values) return;

    const max = Math.floor(Number(values[1]));
    const cost = Math.floor(Number(values[2]));
    if (!Number.isFinite(max) || max < 0) {
      return openDialogForm(player, { title: "设置失败", desc: color.red("最多创建数量必须是 0 或正整数。") }, () =>
        openFloatingTextSettingsForm(player)
      );
    }
    if (!Number.isFinite(cost) || cost < 0) {
      return openDialogForm(player, { title: "设置失败", desc: color.red("创建消耗金币必须是 0 或正整数。") }, () =>
        openFloatingTextSettingsForm(player)
      );
    }

    setting.setState("floatingTextAllowMembers", values[0] as boolean);
    setting.setState("floatingTextMaxPerPlayer", String(max));
    setting.setState("floatingTextCreateCost", String(cost));

    openDialogForm(
      player,
      {
        title: "设置成功",
        desc: cost === 0 ? color.green("悬浮文字设置已保存。创建费用为 0，创建时不会扣金币。") : color.green(`悬浮文字设置已保存。所有玩家每次创建消耗 ${cost} 金币。`),
      },
      () => openFloatingTextMenu(player)
    );
  });
}
