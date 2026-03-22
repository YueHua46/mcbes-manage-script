/**
 * 服务器设置：离线玩家时长（排行榜 + 按名查询）
 */

import { Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import onlineTimeService, { formatOnlineDuration } from "../../../features/player/services/online-time";
import { openDialogForm } from "../../../ui/components/dialog";
import { color } from "../../../shared/utils/color";

const TOP_N = 20;

function getStatsGlyphPrefix(): string {
  const { otherGlyphMap } = require("../../../assets/glyph-map");
  return otherGlyphMap.cat;
}

function formatRankRow(rank: number, name: string, valuePart: string): string {
  return `${getStatsGlyphPrefix()} ${rank}. §b${name}§f: ${valuePart}\n`;
}

function buildHeader(): string {
  let s = `§e========= §6离线时长排行榜 §e=========\n\n`;
  s += `§3仅显示当前不在线的玩家\n`;
  s += `§3按离线时长从长到短（TOP ${TOP_N}）\n\n`;
  return s;
}

function openOfflineLeaderboardForm(player: Player, navigateBack: () => void): void {
  const rows = onlineTimeService.getOfflineDurationLeaderboard(TOP_N);

  let bodyText = buildHeader();
  if (rows.length === 0) {
    bodyText += "§3暂无符合条件的记录。\n§3（需玩家在本功能启用后至少下线过一次）";
  } else {
    rows.forEach((r, i) => {
      bodyText += formatRankRow(i + 1, r.name, `§e${formatOnlineDuration(r.offlineSeconds)}`);
    });
  }
  bodyText += `\n§e=======================\n\n§3按上次离开服务器时间计算`;

  const form = new ActionFormData();
  form.title("§w离线时长排行榜");
  form.body({ rawtext: [{ text: bodyText }] });
  form.button("§w返回", "textures/icons/back");
  form.show(player).then((response) => {
    if (response.canceled) return;
    navigateBack();
  });
}

function openOfflineSearchForm(player: Player, navigateBack: () => void): void {
  const form = new ModalFormData();
  form.title("§w搜索玩家离线时长");
  form.textField("玩家名称", "与游戏内显示名完全一致", { defaultValue: "" });
  form.submitButton("查询");

  form.show(player).then((data) => {
    if (data.cancelationReason) return;
    const { formValues } = data;
    if (!formValues) return;
    const raw = String(formValues[0] ?? "").trim();
    if (!raw) {
      openDialogForm(player, { title: "§w提示", desc: color.yellow("请输入玩家名称。") }, () =>
        openOfflineSearchForm(player, navigateBack)
      );
      return;
    }

    const info = onlineTimeService.lookupOfflineDuration(raw);
    let desc: string;
    if (info.kind === "online") {
      desc = color.green(`玩家 §b${raw} §a当前在线§f，离线时长视为 §e0§f。`);
    } else if (info.kind === "offline") {
      desc = color.aqua(`玩家 §b${raw}\n`) + color.white(`当前已离线：§e${formatOnlineDuration(info.seconds)}`);
    } else if (info.kind === "no_logout_record") {
      desc = color.yellow(`库中有该玩家在线时长记录，但尚无下线时间。\n请待其至少下线一次后再查。`);
    } else {
      desc = color.yellow(`未找到名为 §b${raw} §e的在线时长记录§f（可能从未进过服或名称不一致）。`);
    }

    openDialogForm(player, { title: "§w查询结果", desc }, () => openOfflineSearchForm(player, navigateBack));
  });
}

/**
 * 子菜单：排行榜 / 搜索 / 返回上级「服务器设置」
 * @param backToSystemSettings 返回服务器设置主菜单（由调用方传入，避免与 system/index 循环依赖）
 */
export function openOfflineDurationQueryMenu(player: Player, backToSystemSettings: () => void): void {
  const openHub = () => openOfflineDurationQueryMenu(player, backToSystemSettings);

  const form = new ActionFormData();
  form.title("§w离线玩家时长");
  form.body({
    rawtext: [{ text: "§b查看离线玩家已离开服务器多久\n§3（按上次下线时间计算）" }],
  });
  form.button("§w离线时长排行榜", "textures/icons/saat");
  form.button("§w搜索玩家离线时长", "textures/icons/wisdom");
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    const sel = data.selection;
    if (sel === undefined) return;
    switch (sel) {
      case 0:
        openOfflineLeaderboardForm(player, openHub);
        return;
      case 1:
        openOfflineSearchForm(player, openHub);
        return;
      case 2:
        backToSystemSettings();
        return;
      default:
        return;
    }
  });
}
