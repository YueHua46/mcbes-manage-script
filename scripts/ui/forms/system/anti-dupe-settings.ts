/**
 * 服务器设置 · 防刷物品（收纳袋等）
 */

import { Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import {
  clearAllWhitelistedBlocks,
  getTrustedPlacerNames,
  setTrustedPlacerNames,
} from "../../../features/anti-dupe/whitelist-store";
import setting from "../../../features/system/services/setting";
import { isAdmin } from "../../../shared/utils/common";
import { color } from "../../../shared/utils/color";
import { openConfirmDialogForm, openDialogForm } from "../../components/dialog";

export function openAntiDupeSettingsForm(player: Player): void {
  if (!isAdmin(player)) {
    player.sendMessage(color.red("仅管理员可访问防刷物品设置"));
    return;
  }

  const form = new ActionFormData();
  form.title("§w防刷物品设置");
  form.body(
    "§e§l总开关§r 在「功能开关管理」中；关闭后本条目不生效\n§b· §f收纳袋防刷 §a默认开§f，可在此页关闭\n§b· §f总开关开且收纳袋防刷开：非常规容器不可放收纳袋，方块白名单除外\n§b· §f容器 §e10 §f格内有玩家时才扫描"
  );
  form.button("§w防刷项开关", "textures/icons/gadgets");
  form.button("§w防刷白名单（玩家）", "textures/icons/social");
  form.button("§w清空方块白名单", "textures/icons/deny");
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    switch (data.selection) {
      case 0:
        openAntiDupeToggleForm(player);
        break;
      case 1:
        openAntiDupeWhitelistMenu(player);
        break;
      case 2:
        openConfirmClearWhitelist(player);
        break;
      case 3:
        import("./index").then((m) => m.openSystemSettingForm(player));
        break;
    }
  });
}

function openAntiDupeToggleForm(player: Player): void {
  const form = new ModalFormData();
  form.title("§w防刷物品 · 子项开关（总开关在功能开关管理）");
  form.toggle("收纳袋防刷：禁止放入漏斗/投掷器等非常规容器（§a默认开§f，可关）", {
    defaultValue: setting.getState("antiDupeBundleRestrictEnabled" as never) !== false,
  });
  form.submitButton("确认");

  form.show(player).then((data) => {
    if (data.cancelationReason) return;
    const v = data.formValues;
    if (!v) return;
    setting.setState("antiDupeBundleRestrictEnabled" as never, Boolean(v[0]));
    openDialogForm(player, { title: "已保存", desc: color.green("防刷项已更新") }, () =>
      openAntiDupeSettingsForm(player)
    );
  });
}

function openAntiDupeWhitelistMenu(player: Player): void {
  const names = [...getTrustedPlacerNames()].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const form = new ActionFormData();
  form.title("§w防刷白名单");
  const preview = names.slice(0, 10).join("§7, §b");
  form.body(
    names.length
      ? `§a当前共 §e${names.length} §a名玩家\n§b${preview}${names.length > 10 ? " §7…" : ""}\n§3名单内玩家放置受限容器方块时，自动登记方块白名单`
      : "§e防刷白名单暂无玩家"
  );
  form.button("§w添加", "textures/icons/add");
  form.button("§w移除", "textures/icons/requeue");
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    if (data.selection === 0) openAddToAntiDupeWhitelistForm(player);
    else if (data.selection === 1) openRemoveFromAntiDupeWhitelistForm(player);
    else openAntiDupeSettingsForm(player);
  });
}

function openAddToAntiDupeWhitelistForm(player: Player): void {
  const form = new ModalFormData();
  form.title("§w添加至防刷白名单");
  form.textField("玩家名称（与游戏内显示名一致）", "名称");
  form.submitButton("确认");

  form.show(player).then((data) => {
    if (data.cancelationReason) return;
    const name = String(data.formValues?.[0] ?? "").trim();
    if (!name) {
      openDialogForm(player, { title: "失败", desc: color.red("名称不能为空") }, () =>
        openAntiDupeWhitelistMenu(player)
      );
      return;
    }
    const set = getTrustedPlacerNames();
    set.add(name);
    setTrustedPlacerNames([...set]);
    openDialogForm(player, { title: "已添加", desc: color.green(`已加入防刷白名单：§b${name}`) }, () =>
      openAntiDupeWhitelistMenu(player)
    );
  });
}

function openRemoveFromAntiDupeWhitelistForm(player: Player): void {
  const names = [...getTrustedPlacerNames()].sort((a, b) => a.localeCompare(b, "zh-CN"));
  if (names.length === 0) {
    openDialogForm(player, { title: "提示", desc: color.yellow("防刷白名单为空，无可移除项") }, () =>
      openAntiDupeWhitelistMenu(player)
    );
    return;
  }

  const form = new ActionFormData();
  form.title("§w从防刷白名单移除");
  names.forEach((n) => form.button(`§w${n}`));
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    if (data.selection === names.length) {
      openAntiDupeWhitelistMenu(player);
      return;
    }
    const idx = data.selection;
    if (typeof idx !== "number" || idx < 0 || idx >= names.length) return;
    const removed = names[idx];
    const next = names.filter((_, i) => i !== idx);
    setTrustedPlacerNames(next);
    openDialogForm(player, { title: "已移除", desc: color.green(`已从防刷白名单移除：§b${removed}`) }, () =>
      openAntiDupeWhitelistMenu(player)
    );
  });
}

function openConfirmClearWhitelist(player: Player): void {
  openConfirmDialogForm(
    player,
    "§w清空方块白名单",
    color.yellow("将清除所有已登记的容器方块坐标白名单；防刷白名单（玩家）不变。"),
    () => {
      clearAllWhitelistedBlocks();
      openDialogForm(player, { title: "完成", desc: color.green("方块白名单已清空") }, () =>
        openAntiDupeSettingsForm(player)
      );
    },
    () => openAntiDupeSettingsForm(player),
    { dangerConfirm: true }
  );
}
