import { Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { color } from "../../../shared/utils/color";
import { openConfirmDialogForm, openDialogForm } from "../../components/dialog";
import {
  createJoinPopupAnnouncement,
  deleteJoinPopupAnnouncement,
  getEnabledJoinPopupAnnouncements,
  getJoinPopupAnnouncements,
  JoinPopupAnnouncement,
  MAX_JOIN_POPUP_ANNOUNCEMENTS,
  renderJoinPopupAnnouncement,
  renderJoinPopupAnnouncements,
  setJoinPopupAnnouncementEnabled,
  updateJoinPopupAnnouncement,
} from "../../../features/system/services/join-popup-announcement";
import { openSystemSettingForm } from ".";

function validateAnnouncementInput(title: string, content: string): string | null {
  if (!title.trim()) return "公告标题不能为空。";
  if (!content.trim()) return "公告内容不能为空。";
  if (title.replace(/\\n/g, "").length > 30) return "公告标题最多 30 个字符。";
  if (content.length > 600) return "公告内容最多 600 个字符。";
  return null;
}

export function openJoinPopupAnnouncementManageForm(player: Player): void {
  const announcements = getJoinPopupAnnouncements();
  const enabledCount = announcements.filter((announcement) => announcement.enabled).length;
  const form = new ActionFormData();
  const actions: (() => void)[] = [];

  form.title("§w进服弹窗公告");
  form.body(
    [
      `§7公告数量：§e${announcements.length}/${MAX_JOIN_POPUP_ANNOUNCEMENTS}`,
      `§7启用数量：§a${enabledCount}`,
      "",
      "§7玩家每次连接服务器时，会看到所有已启用公告组成的弹窗。",
    ].join("\n")
  );

  if (announcements.length < MAX_JOIN_POPUP_ANNOUNCEMENTS) {
    form.button("§w新增公告", "textures/icons/add");
    actions.push(() => openEditJoinPopupAnnouncementForm(player));
  }

  if (enabledCount > 0) {
    form.button("§w预览启用公告", "textures/icons/duyuru");
    actions.push(() => openJoinPopupAnnouncementPreviewForm(player));
  }

  announcements.forEach((announcement, index) => {
    const status = announcement.enabled ? "§a启用" : "§7停用";
    form.button(`§w${index + 1}. ${announcement.title}\n${status}`, "textures/icons/edit2");
    actions.push(() => openJoinPopupAnnouncementDetailForm(player, announcement.id));
  });

  form.button("§w返回", "textures/icons/back");
  actions.push(() => openSystemSettingForm(player));

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason || typeof data.selection !== "number") return;
    actions[data.selection]?.();
  });
}

function openJoinPopupAnnouncementPreviewForm(player: Player): void {
  const announcements = getEnabledJoinPopupAnnouncements();
  if (announcements.length === 0) {
    openDialogForm(player, { title: "暂无公告", desc: color.yellow("当前没有已启用的进服弹窗公告。") }, () =>
      openJoinPopupAnnouncementManageForm(player)
    );
    return;
  }

  const form = new ActionFormData();
  form.title("§w进服公告预览");
  form.body(renderJoinPopupAnnouncements(announcements));
  form.button("§w返回", "textures/icons/back");
  form.show(player).then(() => openJoinPopupAnnouncementManageForm(player));
}

function openJoinPopupAnnouncementDetailForm(player: Player, id: string): void {
  const announcement = getJoinPopupAnnouncements().find((item) => item.id === id);
  if (!announcement) {
    openDialogForm(player, { title: "公告不存在", desc: color.red("该公告可能已被删除。") }, () =>
      openJoinPopupAnnouncementManageForm(player)
    );
    return;
  }

  const form = new ActionFormData();
  form.title("§w公告详情");
  form.body(
    [
      `§7状态：${announcement.enabled ? "§a启用" : "§7停用"}`,
      "",
      renderJoinPopupAnnouncement(announcement, 0),
    ].join("\n")
  );
  form.button("§w编辑公告", "textures/icons/edit2");
  form.button(announcement.enabled ? "§w停用公告" : "§w启用公告", "textures/icons/settings");
  form.button("§c删除公告", "textures/icons/deny");
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    switch (data.selection) {
      case 0:
        openEditJoinPopupAnnouncementForm(player, announcement);
        break;
      case 1:
        setJoinPopupAnnouncementEnabled(announcement.id, !announcement.enabled);
        openJoinPopupAnnouncementDetailForm(player, announcement.id);
        break;
      case 2:
        openDeleteJoinPopupAnnouncementConfirmForm(player, announcement);
        break;
      case 3:
        openJoinPopupAnnouncementManageForm(player);
        break;
      default:
        break;
    }
  });
}

function openEditJoinPopupAnnouncementForm(player: Player, announcement?: JoinPopupAnnouncement): void {
  const form = new ModalFormData();
  const isEdit = announcement !== undefined;
  form.title(isEdit ? "§w编辑进服公告" : "§w新增进服公告");
  form.textField("公告标题", "例如：服务器规则", {
    defaultValue: announcement?.title ?? "",
  });
  form.textField("公告内容（支持颜色代码和 \\n 换行）", "请输入公告内容", {
    defaultValue: announcement?.content.replace(/\n/g, "\\n") ?? "",
  });
  form.toggle("启用公告", {
    defaultValue: announcement?.enabled ?? true,
  });
  form.submitButton(isEdit ? "保存" : "创建");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason || !data.formValues) return;

    const title = String(data.formValues[0] ?? "").replace(/\\n/g, " ").trim();
    const content = String(data.formValues[1] ?? "").trim();
    const enabled = Boolean(data.formValues[2]);
    const error = validateAnnouncementInput(title, content);
    if (error) {
      openDialogForm(player, { title: "保存失败", desc: color.red(error) }, () =>
        openEditJoinPopupAnnouncementForm(player, announcement)
      );
      return;
    }

    const ok = isEdit
      ? updateJoinPopupAnnouncement(announcement.id, { title, content, enabled })
      : createJoinPopupAnnouncement(title, content, enabled);

    if (!ok) {
      openDialogForm(player, { title: "保存失败", desc: color.red("公告数量已达上限，最多只能创建 5 条。") }, () =>
        openJoinPopupAnnouncementManageForm(player)
      );
      return;
    }

    openDialogForm(
      player,
      {
        title: "保存成功",
        desc: color.green(isEdit ? "进服弹窗公告已更新。" : "进服弹窗公告已创建。"),
      },
      () => openJoinPopupAnnouncementManageForm(player)
    );
  });
}

function openDeleteJoinPopupAnnouncementConfirmForm(player: Player, announcement: JoinPopupAnnouncement): void {
  openConfirmDialogForm(
    player,
    "§w删除进服公告",
    `§c确认删除公告「${announcement.title}」吗？\n§7删除后无法恢复。`,
    () => {
      deleteJoinPopupAnnouncement(announcement.id);
      openDialogForm(player, { title: "删除成功", desc: color.green("进服弹窗公告已删除。") }, () =>
        openJoinPopupAnnouncementManageForm(player)
      );
    },
    () => openJoinPopupAnnouncementDetailForm(player, announcement.id),
    { dangerConfirm: true }
  );
}
