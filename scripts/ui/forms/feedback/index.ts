import { Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { color } from "../../../shared/utils/color";
import { isAdmin } from "../../../shared/utils/common";
import setting from "../../../features/system/services/setting";
import feedbackService, {
  FeedbackStatus,
  FeedbackType,
  IFeedbackEntry,
} from "../../../features/feedback/services/feedback";
import { openDialogForm, openConfirmDialogForm } from "../../components/dialog";
import { openServerMenuForm } from "../server";

const PAGE_SIZE = 8;

function statusColor(status: FeedbackStatus): string {
  switch (status) {
    case "open":
      return "§e";
    case "processing":
      return "§b";
    case "closed":
      return "§7";
  }
}

function entryButtonText(entry: IFeedbackEntry): string {
  const target = entry.targetPlayer ? ` -> ${entry.targetPlayer}` : "";
  return `§w[${feedbackService.formatType(entry.type)}] ${entry.title}\n${statusColor(entry.status)}${feedbackService.formatStatus(
    entry.status
  )} §7${entry.submitter}${target}`;
}

function entryIcon(entry: IFeedbackEntry): string {
  if (entry.status === "closed") return "textures/icons/accept";
  if (entry.type === "report") return "textures/icons/sus";
  return "textures/icons/quest_log";
}

export function openFeedbackForm(player: Player): void {
  const form = new ActionFormData();
  form.title("§w举报与工单");
  form.body(
    [
      `§7提交费用: §e${feedbackService.getSubmitCost()} 金币`,
      `§7内容上限: §e${feedbackService.getMaxContentLength()} 字`,
      feedbackService.canManage(player)
        ? `§a你可以查看和处理反馈。`
        : `§7提交后工作人员会收到屏幕提醒。`,
    ].join("\n")
  );

  const buttons: { text: string; icon: string; action: () => void }[] = [
    {
      text: "§w提交举报",
      icon: "textures/icons/sus",
      action: () => openSubmitFeedbackForm(player, "report"),
    },
    {
      text: "§w提交工单",
      icon: "textures/icons/quest_log",
      action: () => openSubmitFeedbackForm(player, "ticket"),
    },
    {
      text: "§w我的反馈",
      icon: "textures/icons/profile",
      action: () => openMyFeedbackListForm(player, 1),
    },
  ];

  if (feedbackService.canManage(player)) {
    buttons.push({
      text: "§w处理反馈",
      icon: "textures/icons/mod_shield",
      action: () => openFeedbackManageMenu(player),
    });
  }

  if (isAdmin(player)) {
    buttons.push({
      text: "§w举报/工单设置",
      icon: "textures/icons/gear",
      action: () => openFeedbackSettingsForm(player),
    });
  }

  buttons.forEach((button) => form.button(button.text, button.icon));
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    if (data.selection === buttons.length) {
      void openServerMenuForm(player);
      return;
    }
    if (typeof data.selection === "number") {
      buttons[data.selection]?.action();
    }
  });
}

function openSubmitFeedbackForm(player: Player, type: FeedbackType): void {
  const maxLength = feedbackService.getMaxContentLength();
  const form = new ModalFormData();
  form.title(type === "report" ? "§w提交举报" : "§w提交工单");

  if (type === "report") {
    form.textField("被举报玩家", "请输入玩家名");
    form.textField("标题", "例如：恶意破坏 / 违规发言 / 盗窃物品");
    form.textField(`内容（最多 ${maxLength} 字）`, "请写清发生时间、地点和经过");
  } else {
    form.textField("标题", "例如：领地问题 / 商店问题 / 需要协助");
    form.textField(`内容（最多 ${maxLength} 字）`, "请写清你需要处理的事情");
  }

  form.submitButton(`提交（${feedbackService.getSubmitCost()} 金币）`);

  form.show(player).then((data) => {
    if (data.cancelationReason) return;
    if (data.canceled || !data.formValues) {
      openFeedbackForm(player);
      return;
    }

    const values = data.formValues;
    const result =
      type === "report"
        ? feedbackService.create({
            type,
            submitter: player,
            targetPlayer: String(values[0] ?? ""),
            title: String(values[1] ?? ""),
            content: String(values[2] ?? ""),
          })
        : feedbackService.create({
            type,
            submitter: player,
            title: String(values[0] ?? ""),
            content: String(values[1] ?? ""),
          });

    if (!result.ok) {
      openDialogForm(player, { title: "提交失败", desc: color.red(result.message) }, () =>
        openSubmitFeedbackForm(player, type)
      );
      return;
    }

    openDialogForm(
      player,
      {
        title: "提交成功",
        desc: color.green(`${feedbackService.formatType(type)}已提交，编号: ${result.entry.id}`),
      },
      () => openFeedbackForm(player)
    );
  });
}

function openMyFeedbackListForm(player: Player, page: number): void {
  openFeedbackListForm(player, {
    title: "§w我的反馈",
    entries: feedbackService.listBySubmitter(player.name),
    page,
    back: () => openFeedbackForm(player),
  });
}

function openFeedbackManageMenu(player: Player): void {
  if (!feedbackService.canManage(player)) {
    player.sendMessage(color.red("你没有查看举报/工单的权限。"));
    return;
  }

  const openEntries = feedbackService.listForManage(undefined, "open").length;
  const processingEntries = feedbackService.listForManage(undefined, "processing").length;
  const form = new ActionFormData();
  form.title("§w处理反馈");
  form.body(
    [
      `§e待处理: §f${openEntries}`,
      `§b处理中: §f${processingEntries}`,
      `§7处理权限: 管理员或 §e${feedbackService.getStaffTag()} §7标签`,
      setting.getState("feedbackAllowPublicView") === true ? "§a当前允许所有玩家查看/处理。" : "",
    ]
      .filter(Boolean)
      .join("\n")
  );

  const buttons: { text: string; icon: string; action: () => void }[] = [
    {
      text: "§w全部待处理",
      icon: "textures/icons/clock",
      action: () => openManagedFeedbackListForm(player, undefined, "open", 1),
    },
    {
      text: "§w举报待处理",
      icon: "textures/icons/sus",
      action: () => openManagedFeedbackListForm(player, "report", "open", 1),
    },
    {
      text: "§w工单待处理",
      icon: "textures/icons/quest_log",
      action: () => openManagedFeedbackListForm(player, "ticket", "open", 1),
    },
    {
      text: "§w处理中",
      icon: "textures/icons/info",
      action: () => openManagedFeedbackListForm(player, undefined, "processing", 1),
    },
    {
      text: "§w全部记录",
      icon: "textures/icons/catalogue",
      action: () => openManagedFeedbackListForm(player, undefined, undefined, 1),
    },
  ];

  buttons.forEach((button) => form.button(button.text, button.icon));
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    if (data.selection === buttons.length) {
      openFeedbackForm(player);
      return;
    }
    if (typeof data.selection === "number") {
      buttons[data.selection]?.action();
    }
  });
}

function openManagedFeedbackListForm(
  player: Player,
  type: FeedbackType | undefined,
  status: FeedbackStatus | undefined,
  page: number
): void {
  openFeedbackListForm(player, {
    title: `§w${type ? feedbackService.formatType(type) : "反馈"}列表`,
    entries: feedbackService.listForManage(type, status),
    page,
    back: () => openFeedbackManageMenu(player),
  });
}

function openFeedbackListForm(
  player: Player,
  options: {
    title: string;
    entries: IFeedbackEntry[];
    page: number;
    back: () => void;
  }
): void {
  const { entries, back } = options;
  if (entries.length === 0) {
    openDialogForm(player, { title: "暂无记录", desc: "当前没有符合条件的举报/工单。" }, back);
    return;
  }

  const totalPages = Math.ceil(entries.length / PAGE_SIZE);
  const safePage = Math.min(Math.max(1, options.page), totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const currentEntries = entries.slice(start, start + PAGE_SIZE);

  const form = new ActionFormData();
  form.title(options.title);
  form.body(`§7第 ${safePage} / ${totalPages} 页，共 ${entries.length} 条`);
  currentEntries.forEach((entry) => form.button(entryButtonText(entry), entryIcon(entry)));

  const previousIndex = currentEntries.length;
  if (safePage > 1) form.button("§w上一页", "textures/icons/left_arrow");
  const nextIndex = currentEntries.length + (safePage > 1 ? 1 : 0);
  if (safePage < totalPages) form.button("§w下一页", "textures/icons/right_arrow");
  const backIndex = currentEntries.length + (safePage > 1 ? 1 : 0) + (safePage < totalPages ? 1 : 0);
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    if (typeof data.selection !== "number") return;

    if (data.selection < currentEntries.length) {
      openFeedbackDetailForm(player, currentEntries[data.selection], () =>
        openFeedbackListForm(player, { ...options, entries: options.entries, page: safePage })
      );
      return;
    }
    if (safePage > 1 && data.selection === previousIndex) {
      openFeedbackListForm(player, { ...options, page: safePage - 1 });
      return;
    }
    if (safePage < totalPages && data.selection === nextIndex) {
      openFeedbackListForm(player, { ...options, page: safePage + 1 });
      return;
    }
    if (data.selection === backIndex) {
      back();
    }
  });
}

function openFeedbackDetailForm(player: Player, entry: IFeedbackEntry, back: () => void): void {
  const latest = feedbackService.get(entry.id);
  if (!latest) {
    openDialogForm(player, { title: "记录不存在", desc: "该记录可能已被删除。" }, back);
    return;
  }

  const canManage = feedbackService.canManage(player);
  if (!canManage && latest.submitter !== player.name) {
    player.sendMessage(color.red("你没有查看该反馈的权限。"));
    return;
  }

  const form = new ActionFormData();
  form.title(`§w${feedbackService.formatType(latest.type)}详情`);
  form.body(
    [
      `§7编号: §f${latest.id}`,
      `§7状态: ${statusColor(latest.status)}${feedbackService.formatStatus(latest.status)}`,
      `§7提交人: §f${latest.submitter}`,
      latest.targetPlayer ? `§7相关玩家: §f${latest.targetPlayer}` : "",
      `§7创建: §f${feedbackService.formatTime(latest.createdAt)}`,
      `§7更新: §f${feedbackService.formatTime(latest.updatedAt)}`,
      latest.handler ? `§7处理人: §f${latest.handler}` : "",
      "",
      `§e${latest.title}`,
      `§f${latest.content}`,
      latest.reply ? `\n§a回复:\n§f${latest.reply}` : "",
    ]
      .filter((line) => line !== "")
      .join("\n")
  );

  const buttons: { text: string; icon: string; action: () => void }[] = [];
  if (canManage) {
    if (latest.status !== "processing") {
      buttons.push({
        text: "§w标记处理中",
        icon: "textures/icons/info",
        action: () => {
          feedbackService.setStatus(latest.id, "processing", player.name);
          openFeedbackDetailForm(player, latest, back);
        },
      });
    }
    if (latest.status !== "closed") {
      buttons.push({
        text: "§w关闭并回复",
        icon: "textures/icons/accept",
        action: () => openCloseFeedbackForm(player, latest, back),
      });
    }
    if (latest.status === "closed") {
      buttons.push({
        text: "§w重新打开",
        icon: "textures/icons/clock",
        action: () => {
          feedbackService.setStatus(latest.id, "open", player.name);
          openFeedbackDetailForm(player, latest, back);
        },
      });
    }
    if (isAdmin(player)) {
      buttons.push({
        text: "§c删除记录",
        icon: "textures/icons/deny",
        action: () =>
          openConfirmDialogForm(
            player,
            "删除记录",
            "确定要删除这条举报/工单吗？此操作不可恢复。",
            () => {
              feedbackService.delete(latest.id);
              back();
            },
            () => openFeedbackDetailForm(player, latest, back),
            { dangerConfirm: true }
          ),
      });
    }
  }

  buttons.forEach((button) => form.button(button.text, button.icon));
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    if (data.selection === buttons.length) {
      back();
      return;
    }
    if (typeof data.selection === "number") {
      buttons[data.selection]?.action();
    }
  });
}

function openCloseFeedbackForm(player: Player, entry: IFeedbackEntry, back: () => void): void {
  const form = new ModalFormData();
  form.title("§w关闭并回复");
  form.textField("回复内容", "处理结果或说明，会发送给提交人", {
    defaultValue: entry.reply ?? "",
  });
  form.submitButton("关闭");

  form.show(player).then((data) => {
    if (data.cancelationReason) return;
    if (data.canceled || !data.formValues) {
      openFeedbackDetailForm(player, entry, back);
      return;
    }
    feedbackService.setStatus(entry.id, "closed", player.name, String(data.formValues[0] ?? ""));
    openDialogForm(player, { title: "已关闭", desc: color.green("该反馈已关闭。") }, back);
  });
}

function openFeedbackSettingsForm(player: Player): void {
  if (!isAdmin(player)) {
    player.sendMessage(color.red("只有管理员可以修改举报/工单设置。"));
    return;
  }

  const form = new ModalFormData();
  form.title("§w举报/工单设置");
  form.toggle("允许非管理员查看/处理", {
    defaultValue: setting.getState("feedbackAllowPublicView") === true,
    tooltip: `关闭时仅管理员和拥有 ${feedbackService.getStaffTag()} 标签的玩家可处理。`,
  });
  form.textField("每次提交费用（金币）", "0 表示免费", {
    defaultValue: String(setting.getState("feedbackSubmitCost")),
  });
  form.textField("内容最大字数", "20～2000", {
    defaultValue: String(setting.getState("feedbackMaxContentLength")),
  });
  form.textField("最多保留记录数", "20～2000", {
    defaultValue: String(setting.getState("feedbackMaxEntries")),
  });
  form.submitButton("保存");

  form.show(player).then((data) => {
    if (data.cancelationReason) return;
    if (data.canceled || !data.formValues) {
      openFeedbackForm(player);
      return;
    }

    const cost = Math.floor(Number(data.formValues[1]));
    const maxLength = Math.floor(Number(data.formValues[2]));
    const maxEntries = Math.floor(Number(data.formValues[3]));

    if (!Number.isFinite(cost) || cost < 0) {
      openDialogForm(player, { title: "设置失败", desc: color.red("提交费用必须是 0 或正整数。") }, () =>
        openFeedbackSettingsForm(player)
      );
      return;
    }
    if (!Number.isFinite(maxLength) || maxLength < 20 || maxLength > 2000) {
      openDialogForm(player, { title: "设置失败", desc: color.red("内容最大字数必须在 20～2000 之间。") }, () =>
        openFeedbackSettingsForm(player)
      );
      return;
    }
    if (!Number.isFinite(maxEntries) || maxEntries < 20 || maxEntries > 2000) {
      openDialogForm(player, { title: "设置失败", desc: color.red("最多保留记录数必须在 20～2000 之间。") }, () =>
        openFeedbackSettingsForm(player)
      );
      return;
    }

    setting.setState("feedbackAllowPublicView", data.formValues[0] as boolean);
    setting.setState("feedbackSubmitCost", String(cost));
    setting.setState("feedbackMaxContentLength", String(maxLength));
    setting.setState("feedbackMaxEntries", String(maxEntries));

    openDialogForm(player, { title: "设置成功", desc: color.green("举报/工单设置已更新。") }, () =>
      openFeedbackForm(player)
    );
  });
}
