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
import { openGuildMenuForm } from "../guild";
import { openFloatingTextMenu } from "../floating-text";
import { openQuestPlayerForm } from "../quest-system";
import { BRANDING } from "../../../core/constants";

interface MenuItem {
  text: string;
  icon: string;
  id: string;
  action: (player: Player) => void | Promise<void>;
  adminOnly?: boolean;
  alwaysVisible?: boolean;
}

/**
 * 创建苦力怕菜单表单
 */
function createServerMenuForm(player: Player, menuItems: MenuItem[], setting: any): ActionFormData {
  const _isAdmin = isAdmin(player);

  const form = new ActionFormData();
  form.title(BRANDING.MENU_TITLE);
  form.body("");

  menuItems
    .filter(({ id, alwaysVisible }) => alwaysVisible || setting.getState(id))
    .forEach((item) => {
      if (!item.adminOnly || _isAdmin) {
        form.button(item.text, item.icon);
      }
    });

  return form;
}

/**
 * 打开苦力怕菜单表单
 */
export async function openServerMenuForm(player: Player): Promise<void> {
  // 动态导入以避免循环依赖
  const setting = (await import("../../../features/system/services/setting")).default;

  const menuItems: MenuItem[] = [
    {
      id: "player",
      text: "玩家操作",
      icon: "textures/icons/menu_player",
      action: async (player: Player) => {
        openPlayerActionForm(player);
      },
    },
    {
      id: "wayPoint",
      text: "坐标点管理",
      icon: "textures/icons/menu_waypoint",
      action: async (player: Player) => {
        openWayPointMenuForms(player);
      },
    },
    {
      id: "land",
      text: "领地管理",
      icon: "textures/icons/menu_land",
      action: async (player: Player) => {
        openLandManageForms(player);
      },
    },
    {
      id: "economy",
      text: "经济系统",
      icon: "textures/icons/menu_economy",
      action: async (player: Player) => {
        openEconomyMenuForm(player);
      },
    },
    {
      id: "guild",
      text: "公会",
      icon: "textures/icons/menu_guild",
      action: async (player: Player) => {
        await openGuildMenuForm(player);
      },
    },
    {
      id: "floatingText",
      text: "悬浮文字",
      icon: "textures/icons/menu_floating_text",
      action: async (player: Player) => {
        openFloatingTextMenu(player);
      },
      adminOnly: setting.getState("floatingTextAllowMembers") !== true,
    },
    {
      id: "pvp",
      text: "PVP系统",
      icon: "textures/icons/menu_pvp",
      action: async (player: Player) => {
        const { openPvpSystemForm } = await import("../pvp");
        openPvpSystemForm(player);
      },
    },
    {
      id: "stats",
      text: "数据统计",
      icon: "textures/icons/menu_stats",
      action: async (player: Player) => {
        const { openStatsHubForm } = await import("../stats");
        openStatsHubForm(player);
      },
    },
    {
      id: "quest",
      text: "任务系统",
      icon: "textures/icons/menu_quest",
      action: async (player: Player) => {
        openQuestPlayerForm(player, () => void openServerMenuForm(player));
      },
      alwaysVisible: true,
    },
    {
      id: "other",
      text: "其他功能",
      icon: "textures/icons/menu_other",
      action: async (player: Player) => {
        openBaseFunctionForm(player);
      },
    },
    {
      id: "help",
      text: "获取帮助",
      icon: "textures/icons/menu_help",
      action: async (player: Player) => {
        openHelpMenuForm(player);
      },
    },
    {
      id: "sm",
      text: `给予我${BRANDING.MENU_ITEM_LABEL}道具`,
      icon: "textures/icons/menu_item",
      action: (player: Player) => {
        player.runCommand("give @s yuehua:sm");
      },
    },
    {
      id: "setting",
      text: "服务器设置",
      icon: "textures/icons/menu_server_settings",
      action: async (player: Player) => {
        openSystemSettingForm(player);
      },
      adminOnly: true,
    },
  ];

  const form = createServerMenuForm(player, menuItems, setting);

  form.show(player).then(async (data) => {
    if (data.cancelationReason === FormCancelationReason.UserBusy) {
      player.sendMessage(`§e请关闭你当前的聊天窗口，以便显示${BRANDING.MENU_ITEM_LABEL}。`);
      const forceForm = await useForceOpen(player, form);
      if (forceForm?.canceled) return;
      if (forceForm?.selection !== undefined) {
        const availableItems = menuItems.filter(
          ({ id, adminOnly, alwaysVisible }) => (alwaysVisible || setting.getState(id as IModules)) && (!adminOnly || isAdmin(player))
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
        ({ id, adminOnly, alwaysVisible }) => (alwaysVisible || setting.getState(id as IModules)) && (!adminOnly || isAdmin(player))
      );
      const selectedItem = availableItems[data.selection];
      if (selectedItem) {
        await selectedItem.action(player);
      }
    }
  });
}
