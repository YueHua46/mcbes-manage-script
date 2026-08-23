import { Player } from "@minecraft/server";
import { CreeperModalFormData as ModalFormData } from "../../creeper-modal-form";
import type { RGBA } from "@minecraft/server";
import { CreeperActionFormData as ActionFormData } from "../../creeper-action-form";
import { color, colorCodes } from "../../../shared/utils/color";
import { isAdmin } from "../../../shared/utils/common";
import setting from "../../../features/system/services/setting";
import floatingTextService, { IFloatingText } from "../../../features/floating-text/services/floating-text";
import { openConfirmDialogForm, openDialogForm } from "../../../ui/components/dialog";
import { openServerMenuForm } from "../server";

const PAGE_SIZE = 9;
const DEFAULT_TEXT_COLOR: RGBA = { red: 1, green: 1, blue: 1, alpha: 1 };
const DEFAULT_BACKGROUND_COLOR: RGBA = { red: 0, green: 0, blue: 0, alpha: 0.35 };

const SIZE_PRESETS = [
  { label: "小巧（适合补充说明）", value: 0.7 },
  { label: "标准（推荐）", value: 1 },
  { label: "醒目（适合标题）", value: 1.5 },
  { label: "特大（适合重要公告）", value: 2 },
] as const;

const DISTANCE_PRESETS = [
  { label: "附近可见（约 32 格）", value: 32 },
  { label: "一般距离（约 64 格，推荐）", value: 64 },
  { label: "较远可见（约 128 格）", value: 128 },
  { label: "超远可见（约 256 格）", value: 256 },
] as const;

const BACKGROUND_VISIBILITY_PRESETS = [
  { label: "无背景（完全透明）", value: 0 },
  { label: "淡淡显示（文字更突出）", value: 0.2 },
  { label: "半透明（推荐）", value: 0.35 },
  { label: "较明显（不易看穿）", value: 0.65 },
  { label: "完全不透明", value: 1 },
] as const;

const TEXT_VISIBILITY_PRESETS = [
  { label: "完全清晰（推荐）", value: 1 },
  { label: "稍微变淡", value: 0.75 },
  { label: "半透明", value: 0.5 },
  { label: "很淡", value: 0.25 },
  { label: "完全隐藏", value: 0 },
] as const;

const COLOR_PRESETS: ReadonlyArray<{ label: string; color: RGBA }> = [
  { label: "白色（清晰通用）", color: { red: 1, green: 1, blue: 1, alpha: 1 } },
  { label: "黑色", color: { red: 0, green: 0, blue: 0, alpha: 1 } },
  { label: "浅灰色", color: { red: 0.75, green: 0.75, blue: 0.75, alpha: 1 } },
  { label: "深灰色", color: { red: 0.25, green: 0.25, blue: 0.25, alpha: 1 } },
  { label: "红色", color: { red: 1, green: 0.33, blue: 0.33, alpha: 1 } },
  { label: "橙色", color: { red: 1, green: 0.65, blue: 0, alpha: 1 } },
  { label: "金色", color: { red: 1, green: 0.84, blue: 0, alpha: 1 } },
  { label: "黄色", color: { red: 1, green: 1, blue: 0.33, alpha: 1 } },
  { label: "绿色", color: { red: 0.33, green: 1, blue: 0.33, alpha: 1 } },
  { label: "青色", color: { red: 0.33, green: 1, blue: 1, alpha: 1 } },
  { label: "蓝色", color: { red: 0.33, green: 0.33, blue: 1, alpha: 1 } },
  { label: "紫色", color: { red: 0.67, green: 0, blue: 0.67, alpha: 1 } },
  { label: "粉色", color: { red: 1, green: 0.33, blue: 1, alpha: 1 } },
];

interface ColorChoices {
  labels: string[];
  colors: RGBA[];
  defaultValueIndex: number;
}

interface NumberChoices {
  labels: string[];
  values: number[];
  defaultValueIndex: number;
}

function parseHexColor(value: unknown, alpha: unknown): RGBA | undefined {
  const match = String(value ?? "")
    .trim()
    .match(/^#?([0-9a-f]{6})$/i);
  if (!match) return undefined;
  const parsedAlpha = Number(alpha);
  if (!Number.isFinite(parsedAlpha) || parsedAlpha < 0 || parsedAlpha > 1) return undefined;
  const hex = match[1];
  return {
    red: Number.parseInt(hex.slice(0, 2), 16) / 255,
    green: Number.parseInt(hex.slice(2, 4), 16) / 255,
    blue: Number.parseInt(hex.slice(4, 6), 16) / 255,
    alpha: parsedAlpha,
  };
}

function colorToHex(colorValue: RGBA | undefined, fallback: RGBA): string {
  const color = colorValue ?? fallback;
  const channel = (value: number) =>
    Math.round(Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)) * 255)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  return `#${channel(color.red)}${channel(color.green)}${channel(color.blue)}`;
}

function buildColorChoices(current: RGBA): ColorChoices {
  const currentHex = colorToHex(current, current);
  const presetIndex = COLOR_PRESETS.findIndex((preset) => colorToHex(preset.color, preset.color) === currentHex);
  if (presetIndex >= 0) {
    return {
      labels: COLOR_PRESETS.map((preset) => preset.label),
      colors: COLOR_PRESETS.map((preset) => preset.color),
      defaultValueIndex: presetIndex,
    };
  }
  return {
    labels: [`保留当前自定义颜色（${currentHex}）`, ...COLOR_PRESETS.map((preset) => preset.label)],
    colors: [current, ...COLOR_PRESETS.map((preset) => preset.color)],
    defaultValueIndex: 0,
  };
}

function buildNumberChoices(
  current: number,
  presets: ReadonlyArray<{ label: string; value: number }>,
  customLabel: (value: number) => string
): NumberChoices {
  const presetIndex = presets.findIndex((preset) => Math.abs(preset.value - current) < 0.001);
  if (presetIndex >= 0) {
    return {
      labels: presets.map((preset) => preset.label),
      values: presets.map((preset) => preset.value),
      defaultValueIndex: presetIndex,
    };
  }
  return {
    labels: [customLabel(current), ...presets.map((preset) => preset.label)],
    values: [current, ...presets.map((preset) => preset.value)],
    defaultValueIndex: 0,
  };
}

function getCurrentViewRotation(player: Player): { x: number; y: number; z: number } {
  try {
    const rotation = player.getRotation();
    return { x: rotation.x, y: rotation.y, z: 0 };
  } catch {
    return { x: 0, y: 0, z: 0 };
  }
}

function findClosestLabel(value: number, presets: ReadonlyArray<{ label: string; value: number }>): string {
  return presets.reduce((best, candidate) =>
    Math.abs(candidate.value - value) < Math.abs(best.value - value) ? candidate : best
  ).label;
}

function describeColor(colorValue: RGBA | undefined, fallback: RGBA): string {
  const color = colorValue ?? fallback;
  const hex = colorToHex(color, fallback);
  return (
    COLOR_PRESETS.find((preset) => colorToHex(preset.color, preset.color) === hex)?.label.split("（")[0] ?? "自定义"
  );
}

function getBackgroundColor(item: IFloatingText): RGBA {
  return (
    item.backgroundColor ?? {
      ...DEFAULT_BACKGROUND_COLOR,
      alpha: item.backgroundAlpha ?? DEFAULT_BACKGROUND_COLOR.alpha,
    }
  );
}

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
  const economyEnabled = setting.getState("economy") === true;
  const costText =
    cost > 0
      ? `创建每次消耗 ${cost} 金币`
      : economyEnabled
        ? "创建免费（当前费用为 0，不扣金币）"
        : "创建免费（经济系统已关闭）";

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
    form.button("管理全部悬浮文字", "textures/icons/floating_text_admin");
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

function openFloatingTextListForm(
  player: Player,
  mode: "mine" | "all" | "player",
  page: number,
  targetName?: string
): void {
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
  const economyEnabled = setting.getState("economy") === true;
  const form = new ModalFormData();
  form.title("创建悬浮文字");
  form.textField("名称", "最多 24 个字符", { defaultValue: "" });
  form.textField("显示文本", "支持输入 \\n 换行，最多 240 字符", {
    defaultValue: "",
    tooltip:
      cost > 0
        ? `提交后将扣除 ${cost} 金币。`
        : economyEnabled
          ? "当前费用为 0，创建不会扣金币。"
          : "经济系统已关闭，创建不会扣金币。",
  });
  form.dropdown(
    "文字大小",
    SIZE_PRESETS.map((preset) => preset.label),
    { defaultValueIndex: 1 }
  );
  form.dropdown(
    "多远还能看见",
    DISTANCE_PRESETS.map((preset) => preset.label),
    { defaultValueIndex: 1 }
  );
  form.toggle("允许墙壁遮住文字（更符合真实场景）", {
    defaultValue: false,
    tooltip: "关闭时隔着墙也能看见；开启后墙壁会挡住文字。",
  });
  form.dropdown(
    "文字颜色",
    COLOR_PRESETS.map((preset) => preset.label),
    { defaultValueIndex: 0 }
  );
  form.dropdown(
    "背景颜色",
    COLOR_PRESETS.map((preset) => preset.label),
    { defaultValueIndex: 1 }
  );
  form.dropdown(
    "背景显示效果",
    BACKGROUND_VISIBILITY_PRESETS.map((preset) => preset.label),
    { defaultValueIndex: 2 }
  );
  form.dropdown("文字朝向", ["始终面向每位玩家（推荐）", "固定为我现在面对的方向"], {
    defaultValueIndex: 0,
    tooltip: "推荐选择自动面向玩家。固定朝向适合贴墙告示牌；保存时会采用你当前的视角方向。",
  });
  form.submitButton(cost > 0 ? `创建（消耗 ${cost} 金币）` : "创建（免费）");

  form.show(player).then((data) => {
    if (data.cancelationReason) return;
    const values = data.formValues;
    if (!values) return;
    const size = SIZE_PRESETS[Number(values[2])] ?? SIZE_PRESETS[1];
    const distance = DISTANCE_PRESETS[Number(values[3])] ?? DISTANCE_PRESETS[1];
    const textPreset = COLOR_PRESETS[Number(values[5])] ?? COLOR_PRESETS[0];
    const backgroundPreset = COLOR_PRESETS[Number(values[6])] ?? COLOR_PRESETS[1];
    const backgroundVisibility = BACKGROUND_VISIBILITY_PRESETS[Number(values[7])] ?? BACKGROUND_VISIBILITY_PRESETS[2];
    const useRotation = Number(values[8]) === 1;
    const result = floatingTextService.create({
      player,
      name: String(values[0] ?? ""),
      text: String(values[1] ?? ""),
      scale: size.value,
      maximumRenderDistance: distance.value,
      depthTest: values[4] as boolean,
      textColor: textPreset.color,
      backgroundColor: { ...backgroundPreset.color, alpha: backgroundVisibility.value },
      useRotation,
      rotation: useRotation ? getCurrentViewRotation(player) : undefined,
      backfaceVisible: true,
      textBackfaceVisible: true,
    });
    if (isResultError(result)) {
      return openDialogForm(player, { title: "创建失败", desc: color.red(result) }, () =>
        openFloatingTextCreateForm(player)
      );
    }
    openDialogForm(player, {
      title: "创建成功",
      desc: `${color.green("悬浮文字已创建在你当前位置上方。")}\n${cost > 0 ? color.yellow(`已扣除 ${cost} 金币。`) : color.gray("本次创建未扣金币。")}`,
    });
  });
}

function openFloatingTextDetailForm(player: Player, item: IFloatingText, back: () => void): void {
  const latest = floatingTextService.getById(item.id);
  if (!latest) {
    return openDialogForm(player, { title: "提示", desc: "该悬浮文字已不存在。" }, back);
  }

  const form = new ActionFormData();
  const backgroundColor = getBackgroundColor(latest);
  form.title("悬浮文字详情");
  form.body(
    [
      `所有者: ${latest.ownerName}`,
      `位置: ${formatLocation(latest)}`,
      `大小: ${findClosestLabel(latest.scale, SIZE_PRESETS).split("（")[0]} · ${findClosestLabel(latest.maximumRenderDistance, DISTANCE_PRESETS)}`,
      `文字颜色: ${describeColor(latest.textColor, DEFAULT_TEXT_COLOR)}`,
      backgroundColor.alpha <= 0
        ? "背景: 无背景"
        : `背景: ${describeColor(backgroundColor, DEFAULT_BACKGROUND_COLOR)} · ${findClosestLabel(backgroundColor.alpha, BACKGROUND_VISIBILITY_PRESETS)}`,
      latest.useRotation ? "朝向: 固定方向" : "朝向: 始终面向玩家",
      `创建: ${latest.created}`,
      `修改: ${latest.modified}`,
      "",
      `${colorCodes.white}${latest.text}`,
    ].join("\n")
  );
  form.button("编辑常用设置", "textures/icons/edit2");
  form.button("高级颜色设置", "textures/icons/gear");
  form.button("移动到当前位置", "textures/icons/menu_waypoint");
  form.button("删除", "textures/icons/deny");
  form.button("返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    switch (data.selection) {
      case 0:
        openFloatingTextEditForm(player, latest, () => openFloatingTextDetailForm(player, latest, back));
        break;
      case 1:
        openFloatingTextAdvancedColorForm(player, latest, () => openFloatingTextDetailForm(player, latest, back));
        break;
      case 2:
        openConfirmDialogForm(
          player,
          "移动悬浮文字",
          `确定将「${latest.name}」移动到你当前位置上方吗？`,
          () => {
            const result = floatingTextService.update({ player, id: latest.id, updateLocation: true });
            openDialogForm(
              player,
              {
                title: isResultError(result) ? "移动失败" : "移动成功",
                desc: isResultError(result) ? color.red(result) : color.green("已移动到当前位置上方。"),
              },
              () => openFloatingTextDetailForm(player, latest, back)
            );
          },
          () => openFloatingTextDetailForm(player, latest, back)
        );
        break;
      case 3:
        openConfirmDialogForm(
          player,
          "删除悬浮文字",
          `确定删除「${latest.name}」吗？此操作不可恢复。`,
          () => {
            const result = floatingTextService.delete(player, latest.id);
            openDialogForm(
              player,
              {
                title: result === true ? "删除成功" : "删除失败",
                desc: result === true ? color.green("悬浮文字已删除。") : color.red(String(result)),
              },
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

  const textColor = latest.textColor ?? DEFAULT_TEXT_COLOR;
  const backgroundColor = getBackgroundColor(latest);
  const sizeChoices = buildNumberChoices(latest.scale, SIZE_PRESETS, (value) => `保留当前大小（${value}）`);
  const distanceChoices = buildNumberChoices(
    latest.maximumRenderDistance,
    DISTANCE_PRESETS,
    (value) => `保留当前距离（约 ${value} 格）`
  );
  const textColorChoices = buildColorChoices(textColor);
  const backgroundColorChoices = buildColorChoices(backgroundColor);
  const backgroundVisibilityChoices = buildNumberChoices(
    backgroundColor.alpha,
    BACKGROUND_VISIBILITY_PRESETS,
    (value) => `保留当前效果（约 ${Math.round(value * 100)}% 不透明）`
  );

  const form = new ModalFormData();
  form.title("编辑常用设置");
  form.textField("名称", "最多 24 个字符", { defaultValue: latest.name });
  form.textField("显示文本", "支持输入 \\n 换行，最多 240 字符", { defaultValue: latest.text.replace(/\n/g, "\\n") });
  form.dropdown("文字大小", sizeChoices.labels, { defaultValueIndex: sizeChoices.defaultValueIndex });
  form.dropdown("多远还能看见", distanceChoices.labels, {
    defaultValueIndex: distanceChoices.defaultValueIndex,
  });
  form.toggle("允许墙壁遮住文字（更符合真实场景）", {
    defaultValue: latest.depthTest,
    tooltip: "关闭时隔着墙也能看见；开启后墙壁会挡住文字。",
  });
  form.dropdown("文字颜色", textColorChoices.labels, {
    defaultValueIndex: textColorChoices.defaultValueIndex,
  });
  form.dropdown("背景颜色", backgroundColorChoices.labels, {
    defaultValueIndex: backgroundColorChoices.defaultValueIndex,
  });
  form.dropdown("背景显示效果", backgroundVisibilityChoices.labels, {
    defaultValueIndex: backgroundVisibilityChoices.defaultValueIndex,
  });
  form.dropdown("文字朝向", ["始终面向每位玩家（推荐）", "固定为我现在面对的方向"], {
    defaultValueIndex: latest.useRotation ? 1 : 0,
    tooltip: "选择固定方向后，保存时会采用你当前的视角方向。",
  });
  form.submitButton("保存");

  form.show(player).then((data) => {
    if (data.cancelationReason) return;
    const values = data.formValues;
    if (!values) return;
    const useRotation = Number(values[8]) === 1;
    const selectedTextColor = textColorChoices.colors[Number(values[5])] ?? textColor;
    const selectedBackgroundColor = backgroundColorChoices.colors[Number(values[6])] ?? backgroundColor;
    const backgroundAlpha = backgroundVisibilityChoices.values[Number(values[7])] ?? DEFAULT_BACKGROUND_COLOR.alpha;
    const result = floatingTextService.update({
      player,
      id: latest.id,
      name: String(values[0] ?? ""),
      text: String(values[1] ?? ""),
      scale: sizeChoices.values[Number(values[2])],
      maximumRenderDistance: distanceChoices.values[Number(values[3])],
      depthTest: values[4] as boolean,
      textColor: { ...selectedTextColor, alpha: textColor.alpha },
      backgroundColor: { ...selectedBackgroundColor, alpha: backgroundAlpha },
      useRotation,
      rotation: useRotation ? getCurrentViewRotation(player) : latest.rotation,
    });
    if (isResultError(result)) {
      return openDialogForm(player, { title: "保存失败", desc: color.red(result) }, () =>
        openFloatingTextEditForm(player, latest, back)
      );
    }
    openDialogForm(player, { title: "保存成功", desc: color.green("悬浮文字已更新。") }, back);
  });
}

function openFloatingTextAdvancedColorForm(player: Player, item: IFloatingText, back: () => void): void {
  const latest = floatingTextService.getById(item.id);
  if (!latest) return openDialogForm(player, { title: "提示", desc: "该悬浮文字已不存在。" }, back);

  const textColor = latest.textColor ?? DEFAULT_TEXT_COLOR;
  const backgroundColor = getBackgroundColor(latest);
  const textVisibilityChoices = buildNumberChoices(
    textColor.alpha,
    TEXT_VISIBILITY_PRESETS,
    (value) => `保留当前效果（约 ${Math.round(value * 100)}% 清晰度）`
  );
  const backgroundVisibilityChoices = buildNumberChoices(
    backgroundColor.alpha,
    BACKGROUND_VISIBILITY_PRESETS,
    (value) => `保留当前效果（约 ${Math.round(value * 100)}% 不透明）`
  );

  const form = new ModalFormData();
  form.title("高级颜色设置");
  form.textField("精确文字颜色（高级）", "仅在知道色值时修改，例如 #FFFFFF", {
    defaultValue: colorToHex(textColor, DEFAULT_TEXT_COLOR),
    tooltip: "普通玩家建议返回并使用颜色名称。这里供需要精确颜色的玩家使用。",
  });
  form.dropdown("文字显示效果", textVisibilityChoices.labels, {
    defaultValueIndex: textVisibilityChoices.defaultValueIndex,
    tooltip: "完全清晰最容易阅读；越淡越容易看穿文字。",
  });
  form.textField("精确背景颜色（高级）", "仅在知道色值时修改，例如 #000000", {
    defaultValue: colorToHex(backgroundColor, DEFAULT_BACKGROUND_COLOR),
  });
  form.dropdown("背景显示效果", backgroundVisibilityChoices.labels, {
    defaultValueIndex: backgroundVisibilityChoices.defaultValueIndex,
    tooltip: "无背景表示只显示文字；越不透明，背景底板越明显。",
  });
  form.toggle("固定朝向时，背面也显示文字", {
    defaultValue: latest.textBackfaceVisible ?? true,
    tooltip: "开启后从悬浮文字背后也能读到内容。自动面向玩家时此项没有影响。",
  });
  form.toggle("固定朝向时，背面也显示背景", {
    defaultValue: latest.backfaceVisible ?? true,
    tooltip: "开启后从背面也能看到背景底板。自动面向玩家时此项没有影响。",
  });
  form.submitButton("保存高级设置");

  form.show(player).then((data) => {
    if (data.cancelationReason) return;
    const values = data.formValues;
    if (!values) return;
    const textAlpha = textVisibilityChoices.values[Number(values[1])] ?? textColor.alpha;
    const backgroundAlpha = backgroundVisibilityChoices.values[Number(values[3])] ?? backgroundColor.alpha;
    const nextTextColor = parseHexColor(values[0], textAlpha);
    const nextBackgroundColor = parseHexColor(values[2], backgroundAlpha);
    if (!nextTextColor || !nextBackgroundColor) {
      return openDialogForm(
        player,
        {
          title: "保存失败",
          desc: color.red("精确颜色格式不正确。请填写井号加 6 位数字或字母，例如 #FFFFFF。"),
        },
        () => openFloatingTextAdvancedColorForm(player, latest, back)
      );
    }
    const result = floatingTextService.update({
      player,
      id: latest.id,
      textColor: nextTextColor,
      backgroundColor: nextBackgroundColor,
      textBackfaceVisible: values[4] as boolean,
      backfaceVisible: values[5] as boolean,
    });
    if (isResultError(result)) {
      return openDialogForm(player, { title: "保存失败", desc: color.red(result) }, () =>
        openFloatingTextAdvancedColorForm(player, latest, back)
      );
    }
    openDialogForm(player, { title: "保存成功", desc: color.green("高级颜色设置已更新。") }, back);
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
        desc:
          cost === 0
            ? color.green("悬浮文字设置已保存。创建费用为 0，创建时不会扣金币。")
            : color.green(
                `悬浮文字设置已保存。配置费用为 ${cost} 金币；${setting.getState("economy") === true ? "创建时生效。" : "经济系统关闭期间不扣费，重新开启后生效。"}`
              ),
      },
      () => openFloatingTextMenu(player)
    );
  });
}
