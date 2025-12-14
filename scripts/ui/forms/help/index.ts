/**
 * 帮助系统表单
 * 完整迁移自 Modules/Help/Forms.ts (114行)
 */

import { Player } from "@minecraft/server";
import { ActionFormData, MessageFormData } from "@minecraft/server-ui";
import { useFormatInfo } from "../../../shared/hooks/use-form";
import { color } from "../../../shared/utils/color";
import { openServerMenuForm } from "../server";

// ==================== 如何圈地 ====================

const createHowToLandForm = (): MessageFormData => {
  const form = new MessageFormData();
  form.title("如何圈地？");
  return form;
};

export const openHowToLandForm = (player: Player): void => {
  const form = createHowToLandForm();
  form.body(
    useFormatInfo({
      title: "",
      desc:
        color.yellow("1. ") +
        color.green("使用木棍长按（拆方块动作）指定地面即可设置领地起始坐标点\n") +
        color.yellow("2. ") +
        color.green("设置完起始坐标点后，蹲着对着指定地面长按即可设置领地结束坐标点\n") +
        color.yellow("3. ") +
        color.green("设置完领地起始坐标点和结束坐标点后，使用服务器管理道具中的领地管理，点击申请领地\n") +
        color.yellow("4. ") +
        color.green("申请领地后，这个时候起始坐标和结束坐标是已经自动填写完刚才我们设置的坐标点了\n") +
        color.yellow("5. ") +
        color.green("然后输入完对应的领地名称后，点击申请即可完成圈地\n"),
    })
  );
  form.button1("了解");
  form.button2("返回");
  form.show(player).then((data) => {
    switch (data.selection) {
      case 1:
        openHelpMenuForm(player);
        break;
    }
  });
};

// ==================== 服务器菜单丢失 ====================

const createServerMenuLostForm = (): MessageFormData => {
  const form = new MessageFormData();
  form.title("服务器菜单丢失了怎么办？");
  return form;
};

export const openServerMenuLostForm = (player: Player): void => {
  const form = createServerMenuLostForm();
  form.body(
    useFormatInfo({
      title: "",
      desc:
        color.yellow("1. ") +
        color.green("如果你丢失了服务器菜单，请在聊天栏里输入：服务器菜单，即可打开服务器菜单\n") +
        color.yellow("2. ") +
        color.green("打开服务器菜单后，点击功能：给予我服务器菜单 即可\n"),
    })
  );
  form.button1("了解");
  form.button2("返回");
  form.show(player).then((data) => {
    switch (data.selection) {
      case 1:
        openHelpMenuForm(player);
        break;
    }
  });
};

// ==================== 帮助菜单 ====================

const createHelpMenuForm = (): ActionFormData => {
  const form = new ActionFormData();
  form.title("帮助菜单");
  return form;
};

export const openHelpMenuForm = (player: Player): void => {
  const form = createHelpMenuForm();
  const buttons = [
    {
      text: "如何圈地？",
      icon: "textures/icons/home",
    },
    {
      text: "服务器菜单丢失了怎么办？",
      icon: "textures/icons/uye",
    },
  ];

  buttons.forEach(({ text, icon }) => {
    form.button(text, icon);
  });
  form.button("返回", "textures/icons/back");

  form.show(player).then((data) => {
    switch (data.selection) {
      case 0:
        openHowToLandForm(player);
        break;
      case 1:
        openServerMenuLostForm(player);
        break;
      case buttons.length:
        openServerMenuForm(player);
        break;
    }
  });
};
