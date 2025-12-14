/**
 * 服务器主菜单表单
 */

import { Player } from "@minecraft/server";
import { ActionFormData, FormCancelationReason } from "@minecraft/server-ui";
import { isAdmin } from "../../../shared/utils/common";
import { IModules } from "../../../features/system/services/setting";
import { openPlayerActionForm } from "../player";
import { openWayPointMenuForms } from "../waypoint";
import { useForceOpen } from "../../../shared/hooks/use-form";
import { openLandManageForms } from "../land";
import { openEconomyMenuForm } from "../economic";
import { openBaseFunctionForm } from "../other";
import { openHelpMenuForm } from "../help";
import { openSystemSettingForm } from "../system";

interface MenuItem {
  text: string;
  icon: string;
  id: string;
  action: (player: Player) => void | Promise<void>;
  adminOnly?: boolean;
}

/**
 * 创建服务器菜单表单
 */
function createServerMenuForm(player: Player, menuItems: MenuItem[], setting: any): ActionFormData {
  const _isAdmin = isAdmin(player);

  const form = new ActionFormData();
  form.title("§w服务器菜单");
  form.body("");

  menuItems
    .filter(({ id }) => setting.getState(id))
    .forEach((item) => {
      if (!item.adminOnly || _isAdmin) {
        form.button(item.text, item.icon);
      }
    });

  return form;
}

/**
 * 打开服务器菜单表单
 */
export async function openServerMenuForm(player: Player): Promise<void> {
  // 动态导入以避免循环依赖
  const setting = (await import("../../../features/system/services/setting")).default;

  const menuItems: MenuItem[] = [
    {
      id: "player",
      text: "§w玩家操作",
      icon: "textures/icons/faces",
      action: async (player: Player) => {
        openPlayerActionForm(player);
      },
    },
    {
      id: "wayPoint",
      text: "§w坐标点管理",
      icon: "textures/icons/fast_travel",
      action: async (player: Player) => {
        openWayPointMenuForms(player);
      },
    },
    {
      id: "land",
      text: "§w领地管理",
      icon: "textures/icons/bina",
      action: async (player: Player) => {
        openLandManageForms(player);
      },
    },
    {
      id: "economy",
      text: "§w经济系统",
      icon: "textures/icons/clock",
      action: async (player: Player) => {
        openEconomyMenuForm(player);
      },
    },
    {
      id: "other",
      text: "§w其他功能",
      icon: "textures/icons/accessories",
      action: async (player: Player) => {
        openBaseFunctionForm(player);
      },
    },
    {
      id: "help",
      text: "§w获取帮助",
      icon: "textures/icons/marker_quest",
      action: async (player: Player) => {
        openHelpMenuForm(player);
      },
    },
    {
      id: "sm",
      text: "§w给予我服务器菜单道具",
      icon: "textures/icons/uye",
      action: (player: Player) => {
        player.runCommand("give @s yuehua:sm");
      },
    },
    {
      id: "setting",
      text: "服务器设置",
      icon: "textures/icons/gear",
      action: async (player: Player) => {
        openSystemSettingForm(player);
      },
      adminOnly: true,
    },
  ];

  const form = createServerMenuForm(player, menuItems, setting);

  form.show(player).then(async (data) => {
    if (data.cancelationReason === FormCancelationReason.UserBusy) {
      player.sendMessage("§e请关闭你当前的聊天窗口，以便显示服务器菜单。");
      const forceForm = await useForceOpen(player, form);
      if (forceForm?.canceled) return;
      if (forceForm?.selection !== undefined) {
        const availableItems = menuItems.filter(
          ({ id, adminOnly }) => setting.getState(id as IModules) && (!adminOnly || isAdmin(player))
        );
        const selectedItem = availableItems[forceForm.selection];
        if (selectedItem) {
          await selectedItem.action(player);
        }
      }
      return;
    }

    if (data.canceled) return;
    if (data.selection !== undefined) {
      const availableItems = menuItems.filter(
        ({ id, adminOnly }) => setting.getState(id as IModules) && (!adminOnly || isAdmin(player))
      );
      const selectedItem = availableItems[data.selection];
      if (selectedItem) {
        await selectedItem.action(player);
      }
    }
  });
}
