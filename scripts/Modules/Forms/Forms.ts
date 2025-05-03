import { Player } from "@minecraft/server";
import { ActionFormData, FormCancelationReason } from "@minecraft/server-ui";
import { openPlayerActionForm } from "../Player/Forms";
import { openLandManageForms } from "../Land/Forms";
import { openHelpMenuForm } from "../Help/Forms";
import { useForceOpen } from "../../hooks/hooks";
import { openBaseFunctionForm } from "../OtherFun/Forms";
import { openWayPointMenuForms } from "../WayPoint/Forms";
import { openSystemSettingForm } from "../System/Forms";
import setting, { IModules } from "../System/Setting";
import { openEconomyMenuForm } from "../Economic/Forms";
import { isAdmin } from "../../utils/utils";

interface MenuItem {
  text: string;
  icon: string;
  id: IModules;
  action: (player: Player) => void;
  adminOnly?: boolean;
}

const menuItems: MenuItem[] = [
  {
    id: "player",
    text: "§w玩家操作",
    icon: "textures/ui/multiplayer_glyph_color",
    action: openPlayerActionForm,
  },
  {
    id: "wayPoint",
    text: "§w坐标点管理",
    icon: "textures/packs/027-location",
    action: openWayPointMenuForms,
  },
  {
    id: "land",
    text: "§w领地管理",
    icon: "textures/packs/12751922",
    action: openLandManageForms,
  },
  // 添加经济系统菜单项
  {
    id: "economy",
    text: "§w经济系统",
    icon: "textures/packs/15174541",
    action: openEconomyMenuForm,
  },
  {
    id: "other",
    text: "§w其他功能",
    icon: "textures/packs/16329407",
    action: openBaseFunctionForm,
  },
  {
    id: "help",
    text: "§w获取帮助",
    icon: "textures/icons/quest",
    action: openHelpMenuForm,
  },
  {
    id: "sm",
    text: "§w给予我服务器菜单道具",
    icon: "textures/icons/more2",
    action: (player: Player) => player.runCommand("give @s yuehua:sm"),
  },
  {
    id: "setting",
    text: "服务器设置",
    icon: "textures/ui/settings_glyph_color_2x",
    action: openSystemSettingForm,
    adminOnly: true,
  },
];

function createServerMenuForm(player: Player): ActionFormData {
  const _isAdmin = isAdmin(player);

  const form = new ActionFormData();
  form.title("§w服务器菜单");
  form.body({
    rawtext: [
      { text: "§a欢迎使用杜绝熊孩服务器插件，请选择你的操作。\n" },
      { text: "§a此插件由 §eYuehua §a制作，B站ID： §e月花zzZ" },
    ],
  });

  menuItems
    .filter(({ id }) => {
      return setting.getState(id);
    })
    .forEach((item) => {
      if (!item.adminOnly || _isAdmin) {
        form.button(item.text, item.icon);
      }
    });

  return form;
}

function openServerMenuForm(player: Player) {
  const form = createServerMenuForm(player);

  form.show(player).then(async (data) => {
    if (data.cancelationReason === FormCancelationReason.UserBusy) {
      player.sendMessage("§e请关闭你当前的聊天窗口，以便显示服务器菜单。");
      await useForceOpen(player, form).then((data) => {
        if (data?.selection !== undefined) {
          menuItems
            .filter(({ id }) => {
              return setting.getState(id);
            })
            [data.selection].action(player);
        }
      });
    } else {
      if (data.selection !== undefined) {
        menuItems
          .filter(({ id }) => {
            return setting.getState(id);
          })
          [data.selection].action(player);
      }
    }
  });
}

export { openServerMenuForm, openEconomyMenuForm };
