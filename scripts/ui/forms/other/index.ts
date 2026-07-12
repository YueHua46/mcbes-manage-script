/**
 * 其他功能表单
 * 完整迁移自 Modules/OtherFun/Forms.ts (286行)
 */

import { Dimension, Player, Vector3, world } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { openServerMenuForm } from "../server";
import { RandomTp } from "../../../features/other/services/random-tp";
import { openDialogForm } from "../../../ui/components/dialog";
import { color, colorCodes } from "../../../shared/utils/color";
import leaveMessage from "../../../features/other/services/leave-message";
import { useNotify } from "../../../shared/hooks/use-notify";
import setting from "../../../features/system/services/setting";
import { isAdmin } from "../../../shared/utils/common";
import { openMyEnderChestForm } from "../system/player-inventory-admin";
import { chargeTeleportCost, refundTeleportCost } from "../../../features/economic/services/teleport-cost";
import { openLiveServerPanel } from "../system/live-server-panel";

function openAuthorListForm(player: Player): void {
  const authors = [{ name: "月花zzZ", icon: "textures/authors/yuehua" }];
  const form = new ActionFormData();
  form.title(`${colorCodes.darkGreen}制作者名单`);
  form.body(
    `插件目前个人维护较为困难，如有对开发MC行为包（SAPI脚本）感兴趣的同学。\n可以联系我QQ：2766274062，共同维护本插件。\n仅需掌握一些基本的JS语言基础知识即可。\n本插件目前非盈利，一切为爱发电。`
  );
  authors.forEach((author) => {
    form.button(
      {
        text: `${author.name}${colorCodes.reset}\n${colorCodes.darkGreen}创建人${colorCodes.reset}`,
      },
      author.icon
    );
  });
  form.button("返回", "textures/icons/back");
  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    switch (data.selection) {
      case authors.length:
        openServerMenuForm(player);
        break;
    }
  });
}

// ==================== 其他功能主菜单 ====================

export function openBaseFunctionForm(player: Player): void {
  const randomTeleport = setting.getState("randomTeleport") as boolean;
  const backToDeath = setting.getState("backToDeath") as boolean;

  const form = new ActionFormData();
  const buttons: Array<{ text: string; icon: string; action: () => void }> = [];

  buttons.push({ text: "留言板", icon: "textures/icons/8", action: () => openLeaveMessageForms(player) });

  if (randomTeleport) {
    buttons.push({
      text: "随机传送",
      icon: "textures/icons/dunya",
      action: () => RandomTp(player),
    });
  }

  buttons.push({ text: "自杀", icon: "textures/icons/dead", action: () => player.kill() });

  if (backToDeath) {
    buttons.push({
      text: "回到上次死亡地点",
      icon: "textures/icons/game_battle_box",
      action: () => {
        let charged = false;
        try {
          const deathData = player.getDynamicProperty("lastDeath") as string | undefined;
          if (!deathData?.length) {
            openDialogForm(player, { title: "失败", desc: color.red("未找到上次死亡地点！") });
            return;
          }

          const death = JSON.parse(deathData) as { location: Vector3; dimension: Dimension };
          const dimensionId = death.dimension?.id;
          if (!death.location || !dimensionId) {
            openDialogForm(player, { title: "失败", desc: color.red("死亡地点数据无效！") });
            return;
          }

          const targetDimension = world.getDimension(dimensionId);
          const chargeError = chargeTeleportCost(player, "backToDeathCost", "回到死亡地点");
          if (chargeError) {
            openDialogForm(player, { title: "失败", desc: color.red(chargeError) });
            return;
          }
          charged = true;

          player.teleport(death.location, { dimension: targetDimension });
          useNotify("actionbar", player, "§a你已回到上次死亡地点！");
        } catch {
          if (charged) refundTeleportCost(player, "backToDeathCost", "回到死亡地点失败退款");
          openDialogForm(player, { title: "失败", desc: color.red("死亡地点数据异常，无法传送。") });
        }
      },
    });
  }

  buttons.push({
    text: "服务器状态",
    icon: "textures/icons/fotograf",
    action: () => void openLiveServerPanel(player, () => openBaseFunctionForm(player)),
  });

  buttons.push({
    text: "我的末影箱",
    icon: "textures/blocks/ender_chest_front",
    action: () => openMyEnderChestForm(player, () => openBaseFunctionForm(player)),
  });

  buttons.push({ text: "制作者名单", icon: "textures/icons/social", action: () => openAuthorListForm(player) });
  form.title("其他功能");

  buttons.forEach((button) => {
    form.button(button.text, button.icon);
  });

  form.button("返回", "textures/icons/back");

  form.show(player).then((data) => {
    switch (data.selection) {
      case buttons.length:
        openServerMenuForm(player);
        break;
      default:
        if (typeof data.selection !== "number") return;
        buttons[data.selection].action();
        break;
    }
  });
}

// ==================== 留言板 ====================

export const openLeaveMessageForms = (player: Player): void => {
  const form = new ActionFormData();
  form.title("留言板");
  const buttons = [
    {
      text: "留言列表",
      icon: "textures/ui/realmsStoriesIcon",
      action: () => openLeaveMessageListForm(player),
    },
    { text: "添加留言", icon: "textures/icons/add", action: () => openAddLeaveMessageForm(player) },
    {
      text: "删除留言",
      icon: "textures/icons/deny",
      action: () => openDeleteLeaveMessageForm(player, isAdmin(player)),
    },
  ];
  buttons.forEach(({ text, icon }) => form.button(text, icon));
  form.button("返回", "textures/icons/back");
  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    switch (data.selection) {
      case buttons.length:
        openServerMenuForm(player);
        break;
      default:
        if (typeof data.selection !== "number") return;
        buttons[data.selection].action();
        break;
    }
  });
};

export const openLeaveMessageListForm = (player: Player, page: number = 1): void => {
  const form = new ActionFormData();
  form.title("留言列表");

  const lms = leaveMessage.getLeaveMessages();
  const totalPages = Math.ceil(lms.length / 10);
  const start = (page - 1) * 10;
  const end = start + 10;
  const currentPageMessages = lms.slice(start, end);

  form.body(`第 ${page} 页 / 共 ${totalPages} 页`);

  currentPageMessages.forEach((lm) => {
    form.button(` ${lm.title}`);
  });

  let previousButtonIndex = currentPageMessages.length;
  let nextButtonIndex = currentPageMessages.length;
  if (page > 1) {
    form.button("上一页", "textures/icons/left_arrow");
    previousButtonIndex++;
    nextButtonIndex++;
  }
  if (page < totalPages) {
    form.button("下一页", "textures/icons/right_arrow");
    nextButtonIndex++;
  }

  form.button("返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.cancelationReason) return;
    const selectionIndex = data.selection;
    if (selectionIndex === null || selectionIndex === undefined) return;

    const currentPageMessagesCount = currentPageMessages.length;

    if (selectionIndex < currentPageMessagesCount) {
      openDialogForm(
        player,
        {
          title: "留言内容",
          desc: `${currentPageMessages[selectionIndex].content}\n§b留言人： §e${currentPageMessages[selectionIndex].creator}\n§b留言时间： §e${currentPageMessages[selectionIndex].time}\n`,
        },
        () => openLeaveMessageListForm(player, page)
      );
    } else if (selectionIndex === previousButtonIndex - 1 && page > 1) {
      openLeaveMessageListForm(player, page - 1);
    } else if (selectionIndex === nextButtonIndex - 1 && page < totalPages) {
      openLeaveMessageListForm(player, page + 1);
    } else if (selectionIndex === nextButtonIndex) {
      openLeaveMessageForms(player);
    }
  });
};

export const openAddLeaveMessageForm = (player: Player): void => {
  const form = new ModalFormData();
  form.title("添加留言");
  form.textField("标题", "", {
    defaultValue: "",
    tooltip: "请输入标题",
  });
  form.textField("内容", "", {
    defaultValue: "",
    tooltip: "请输入内容",
  });
  form.submitButton("确定");
  form.show(player).then((data) => {
    if (data.cancelationReason) return;
    const { formValues } = data;
    if (formValues?.[0] && formValues?.[1]) {
      if (formValues[0].toString().length > 8)
        return openDialogForm(player, { title: "添加失败", desc: color.red("标题长度不能超过8个字符！") }, () =>
          openAddLeaveMessageForm(player)
        );
      leaveMessage.createLeaveMessage({
        title: formValues[0].toString(),
        content: formValues[1].toString(),
        creator: player.name,
      });
      openDialogForm(player, { title: "添加成功", desc: color.green("留言添加成功！") }, () =>
        openLeaveMessageForms(player)
      );
    } else {
      openDialogForm(player, { title: "添加失败", desc: color.red("表单未填写完整，请填写完整！") }, () =>
        openAddLeaveMessageForm(player)
      );
    }
  });
};

export const openDeleteLeaveMessageForm = (player: Player, forAllMessages: boolean = false): void => {
  const form = new ModalFormData();
  form.title("删除留言");
  const lms = forAllMessages ? leaveMessage.getLeaveMessages() : leaveMessage.getPlayerLeaveMessages(player);
  if (lms.length === 0) {
    openDialogForm(
      player,
      {
        title: "提示",
        desc: color.gray(forAllMessages ? "当前没有任何留言" : "你还没有留言"),
      },
      () => openLeaveMessageForms(player)
    );
    return;
  }
  form.dropdown(
    forAllMessages ? "选择留言（管理员：可删全部）" : "选择留言",
    lms.map((lm) => (forAllMessages ? `${lm.title} · ${lm.creator}` : lm.title))
  );
  form.submitButton("确定");
  form.show(player).then((data) => {
    if (data.cancelationReason) return;
    const { formValues } = data;
    if (typeof formValues?.[0] === "number") {
      leaveMessage.deleteLeaveMessage(lms[Number(formValues[0])].id);
      openDialogForm(player, { title: "删除成功", desc: color.green("留言删除成功！") }, () =>
        openLeaveMessageForms(player)
      );
    }
  });
};
