/**
 * 其他功能表单
 * 完整迁移自 Modules/OtherFun/Forms.ts (286行)
 */

import { Dimension, Player, Vector3, world } from "@minecraft/server";
import { ActionFormData, MessageFormData, ModalFormData } from "@minecraft/server-ui";
import { openServerMenuForm } from "../server";
import { RandomTp } from "../../../features/other/services/random-tp";
import serverInfo from "../../../features/system/services/server-info";
import { openDialogForm } from "../../../ui/components/dialog";
import { color, colorCodes } from "../../../shared/utils/color";
import leaveMessage from "../../../features/other/services/leave-message";
import { useNotify } from "../../../shared/hooks/use-notify";
import setting from "../../../features/system/services/setting";

// ==================== 服务器信息 ====================

function createServerInfoForm(): MessageFormData {
  const form = new MessageFormData();
  form.title("§w服务器信息");
  form.body({
    rawtext: [
      { text: `§a---------------------------------\n` },
      { text: `§eTPS: §c${serverInfo.TPS}\n` },
      { text: `§e实体数量: §c${serverInfo.organismLength}\n` },
      { text: `§e掉落物数量: §c${serverInfo.itemsLength}\n` },
      { text: `§a---------------------------------\n` },
      { text: `§c腐竹留言\n` },
      { text: `§a---------------------------------\n` },
    ],
  });
  form.button1("§w刷新");
  form.button2("§w返回");
  return form;
}

function openServerInfoForm(player: Player): void {
  let form = createServerInfoForm();

  form.show(player).then((data) => {
    switch (data.selection) {
      case 0:
        form = createServerInfoForm();
        openServerInfoForm(player);
        break;
      case 1:
        openServerMenuForm(player);
        break;
    }
  });
}

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
  form.button("§w返回", "textures/icons/back");
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
  const buttons = [{ text: "§w留言板", icon: "textures/icons/8", action: () => openLeaveMessageForms(player) }];

  if (randomTeleport) {
    buttons.push({
      text: "§w随机传送",
      icon: "textures/icons/dunya",
      action: () => RandomTp(player),
    });
  }

  buttons.push({ text: "§w自杀", icon: "textures/icons/dead", action: () => player.kill() });

  if (backToDeath) {
    buttons.push({
      text: "§w回到上次死亡地点",
      icon: "textures/icons/game_battle_box",
      action: () => {
        const deathData = player.getDynamicProperty("lastDeath") as string | undefined;
        if (deathData?.length) {
          const death = JSON.parse(deathData) as { location: Vector3; dimension: Dimension };
          player.teleport(death.location, { dimension: world.getDimension(death.dimension.id) });
          useNotify("actionbar", player, "§a你已回到上次死亡地点！");
        } else {
          openDialogForm(player, { title: "失败", desc: color.red("未找到上次死亡地点！") });
        }
      },
    });
  }

  buttons.push({ text: "§w服务器状态", icon: "textures/icons/fotograf", action: () => openServerInfoForm(player) });

  buttons.push({ text: "§w制作者名单", icon: "textures/icons/social", action: () => openAuthorListForm(player) });
  form.title("§w其他功能");

  buttons.forEach((button) => {
    form.button(button.text, button.icon);
  });

  form.button("§w返回", "textures/icons/back");

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
  form.title("§w留言板");
  const buttons = [
    {
      text: "§w留言列表",
      icon: "textures/ui/realmsStoriesIcon",
      action: () => openLeaveMessageListForm(player),
    },
    { text: "§w添加留言", icon: "textures/icons/add", action: () => openAddLeaveMessageForm(player) },
    { text: "§w删除留言", icon: "textures/icons/deny", action: () => openDeleteLeaveMessageForm(player) },
  ];
  buttons.forEach(({ text, icon }) => form.button(text, icon));
  form.button("§w返回", "textures/icons/back");
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
  form.title("§w留言列表");

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

  form.button("§w返回", "textures/icons/back");

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
  form.title("§w添加留言");
  form.textField("标题", "", {
    defaultValue: "",
    tooltip: "请输入标题",
  });
  form.textField("内容", "", {
    defaultValue: "",
    tooltip: "请输入内容",
  });
  form.submitButton("§w确定");
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

export const openDeleteLeaveMessageForm = (player: Player, isAdmin: boolean = false): void => {
  const form = new ModalFormData();
  form.title("§w删除留言");
  const lms = isAdmin ? leaveMessage.getLeaveMessages() : leaveMessage.getPlayerLeaveMessages(player);
  form.dropdown(
    "选择留言",
    lms.map((lm) => lm.title)
  );
  form.submitButton("§w确定");
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
