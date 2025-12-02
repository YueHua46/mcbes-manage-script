/**
 * 系统设置表单
 * 迁移自 Modules/System/Forms.ts（主要部分）
 */

import { Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { color, colorCodes } from "../../../shared/utils/color";
import setting from "../../../features/system/services/setting";
import { openServerMenuForm } from "../server";
import { openDialogForm } from "../../../ui/components/dialog";
import { isAdmin } from "../../../shared/utils/common";
import { officeShopSettingForm } from "./office-shop-setting";
import { openAllPlayerLandManageForm } from "../land";
import { openNotifyForms } from "../notify";

// ==================== 系统设置主菜单 ====================

export function openSystemSettingForm(player: Player): void {
  if (!isAdmin(player)) {
    player.sendMessage(color.red("只有管理员可以访问系统设置！"));
    return;
  }

  const form = new ActionFormData();
  form.title("§w服务器设置");

  const buttons = [
    {
      text: "§w通用系统设置",
      icon: "textures/icons/gear",
      action: () => openGeneralSettingsForm(player),
    },
    {
      text: "§w模块开关管理",
      icon: "textures/icons/gadgets",
      action: () => openModuleToggleForm(player),
    },
    {
      text: "§w领地管理",
      icon: "textures/icons/home",
      action: async () => {
        openAllPlayerLandManageForm(player);
      },
    },
    {
      text: "§w坐标点管理",
      icon: "textures/icons/checkpoint",
      action: () => openWayPointManageMenu(player),
    },
    {
      text: "§w通知管理",
      icon: "textures/icons/duyuru",
      action: async () => {
        openNotifyForms(player);
      },
    },
    {
      text: "§w试玩模式管理",
      icon: "textures/icons/game_battle_box",
      action: () => openTrialModeManageForm(player),
    },
    {
      text: "§w官方商店管理",
      icon: "textures/icons/shop",
      action: () => {
        officeShopSettingForm.openCategoryList(player);
      },
    },
    {
      text: "§w物品价格管理",
      icon: "textures/icons/clock",
      action: () => openItemPriceManageForm(player),
    },
  ];

  buttons.forEach((button) => {
    form.button(button.text, button.icon);
  });

  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    if (data.selection === buttons.length) {
      openServerMenuForm(player);
      return;
    }
    if (typeof data.selection === "number") {
      buttons[data.selection].action();
    }
  });
}

// ==================== 通用系统设置 ====================

export function openGeneralSettingsForm(player: Player): void {
  const form = new ActionFormData();
  form.title("§w通用系统设置");

  const settingItems = [
    { key: "killItemAmount", name: "掉落物清理数量阈值", type: "number" },
    { key: "randomTpRange", name: "随机传送范围", type: "number" },
    { key: "maxLandPerPlayer", name: "每玩家最大领地数", type: "number" },
    { key: "maxLandBlocks", name: "领地最大方块数", type: "number" },
    { key: "maxPointsPerPlayer", name: "每玩家最大坐标点数", type: "number" },
    { key: "playerNameColor", name: "玩家名称颜色", type: "string" },
    { key: "playerChatColor", name: "聊天颜色", type: "string" },
    { key: "trialModeDuration", name: "试玩模式时长(秒)", type: "number" },
    { key: "land1BlockPerPrice", name: "领地每方块价格", type: "number" },
    { key: "daily_gold_limit", name: "每日金币获取上限", type: "number" },
    { key: "startingGold", name: "新玩家初始金币", type: "number" },
  ];

  settingItems.forEach((item) => {
    const currentValue = setting.getState(item.key as any);
    // 使用白色主标题 + 青色标签 + 金色数值，在淡灰色背景下清晰可读
    form.button(`${item.name}\n当前: ${colorCodes.darkAqua}${currentValue}`, "textures/icons/gadgets");
  });

  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;

    if (data.selection === settingItems.length) {
      openSystemSettingForm(player);
      return;
    }

    if (typeof data.selection === "number" && data.selection < settingItems.length) {
      const selectedItem = settingItems[data.selection];
      openEditSettingForm(player, selectedItem.key, selectedItem.name, selectedItem.type as "number" | "string");
    }
  });
}

function openEditSettingForm(player: Player, key: string, name: string, type: "number" | "string"): void {
  const form = new ModalFormData();
  form.title(`编辑 ${name}`);

  const currentValue = setting.getState(key as any);
  form.textField(name, `请输入新值`, {
    defaultValue: String(currentValue),
  });
  form.submitButton("确认");

  form.show(player).then((data) => {
    if (data.cancelationReason) return;
    const { formValues } = data;
    if (formValues?.[0]) {
      const newValue = formValues[0].toString();

      if (type === "number") {
        const numValue = Number(newValue);
        if (isNaN(numValue)) {
          openDialogForm(player, {
            title: "设置失败",
            desc: color.red("请输入有效的数字！"),
          });
          return;
        }
        setting.setState(key as any, newValue);
      } else {
        setting.setState(key as any, newValue);
      }

      openDialogForm(
        player,
        {
          title: "设置成功",
          desc: color.green(`${name} 已更新为: ${newValue}`),
        },
        () => openGeneralSettingsForm(player)
      );
    }
  });
}

// ==================== 模块开关管理 ====================

export function openModuleToggleForm(player: Player): void {
  const form = new ModalFormData();
  form.title("§w模块开关管理");

  const modules = [
    { key: "player", name: "玩家功能模块" },
    { key: "land", name: "领地功能模块" },
    { key: "wayPoint", name: "坐标点功能模块" },
    { key: "economy", name: "经济系统" },
    { key: "other", name: "其他功能模块" },
    { key: "help", name: "帮助功能" },
    { key: "sm", name: "服务器菜单" },
    { key: "killItem", name: "自动清理掉落物" },
    { key: "trialMode", name: "试玩模式" },
    { key: "randomTeleport", name: "随机传送功能" },
    { key: "backToDeath", name: "回到死亡地点功能" },
    { key: "enableTreeCutOneClick", name: "一键砍树" },
    { key: "enableDigOreOneClick", name: "一键挖矿" },
  ];

  modules.forEach((module) => {
    const currentValue = setting.getState(module.key as any);
    form.toggle(`${module.name}`, {
      defaultValue: currentValue as boolean,
    });
  });

  form.submitButton("确认");

  form.show(player).then((data) => {
    if (data.cancelationReason) return;
    const { formValues } = data;
    if (formValues) {
      modules.forEach((module, index) => {
        setting.setState(module.key as any, formValues[index] as boolean);
      });

      openDialogForm(
        player,
        {
          title: "设置成功",
          desc: color.green("模块开关已更新！"),
        },
        () => openSystemSettingForm(player)
      );
    }
  });
}

// ==================== 试玩模式管理 ====================

export function openTrialModeManageForm(player: Player): void {
  const form = new ActionFormData();
  form.title("§w试玩模式管理");

  form.button("§w会员列表", "textures/ui/friend1");
  form.button("§w添加会员", "textures/ui/plus");
  form.button("§w移除会员", "textures/ui/minus");
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    switch (data.selection) {
      case 0:
        openMemberListForm(player);
        break;
      case 1:
        openAddMemberForm(player);
        break;
      case 2:
        openRemoveMemberForm(player);
        break;
      case 3:
        openSystemSettingForm(player);
        break;
    }
  });
}

function openMemberListForm(player: Player): void {
  const { memberManager } = require("../../../features/system/services/trial-mode");
  const members = memberManager.getAllMembers();

  const form = new ActionFormData();
  form.title("§w正式会员列表");

  if (members.length === 0) {
    form.body(color.yellow("当前没有正式会员"));
  } else {
    let bodyText = "§a正式会员列表:\n\n";
    members.forEach((memberName: string, index: number) => {
      bodyText += `${index + 1}. §b${memberName}\n`;
    });
    form.body(bodyText);
  }

  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled) return;
    openTrialModeManageForm(player);
  });
}

function openAddMemberForm(player: Player): void {
  const form = new ModalFormData();
  form.title("§w添加会员");

  form.textField("玩家名称", "请输入玩家名称（支持批量，用逗号分隔）");
  form.submitButton("确认");

  form.show(player).then((data) => {
    if (data.cancelationReason) return;
    const { formValues } = data;
    if (formValues?.[0]) {
      const { memberManager } = require("../../../features/system/services/trial-mode");
      const playerNames = formValues[0]
        .toString()
        .split(",")
        .map((n) => n.trim())
        .filter((n) => n.length > 0);

      let successCount = 0;
      playerNames.forEach((name: string) => {
        if (memberManager.addMember(name)) {
          successCount++;
        }
      });

      openDialogForm(
        player,
        {
          title: "操作完成",
          desc: color.green(`成功添加 ${successCount} 个会员`),
        },
        () => openTrialModeManageForm(player)
      );
    }
  });
}

function openRemoveMemberForm(player: Player): void {
  const { memberManager } = require("../../../features/system/services/trial-mode");
  const members = memberManager.getAllMembers();

  const form = new ModalFormData();
  form.title("§w移除会员");

  form.dropdown("选择会员", members);
  form.submitButton("确认");

  form.show(player).then((data) => {
    if (data.cancelationReason) return;
    const { formValues } = data;
    if (typeof formValues?.[0] === "number") {
      const memberName = members[formValues[0]];
      if (memberManager.removeMember(memberName)) {
        openDialogForm(
          player,
          {
            title: "移除成功",
            desc: color.green(`已移除会员: ${memberName}`),
          },
          () => openTrialModeManageForm(player)
        );
      }
    }
  });
}

// ==================== 坐标点管理菜单 ====================

export const openWayPointManageMenu = (player: Player): void => {
  const form = new ActionFormData();
  form.title("§w坐标点管理");

  form.button("§w所有玩家坐标点管理", "textures/packs/14321635");
  form.button("§w搜索玩家坐标点管理", "textures/ui/magnifyingGlass");
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    switch (data.selection) {
      case 0:
        openPlayerWayPointManageForm(player);
        break;
      case 1:
        const { openSearchWayPointForm } = require("../waypoint");
        openSearchWayPointForm(player);
        break;
      case 2:
        openSystemSettingForm(player);
        break;
    }
  });
};

function openPlayerWayPointManageForm(player: Player, page: number = 1): void {
  const form = new ActionFormData();
  form.title("§w玩家坐标点管理");

  const wayPoint = require("../../../features/waypoint/services/waypoint").default;
  const players = wayPoint.getWayPointPlayers();

  const pageSize = 10;
  const totalPages = Math.ceil(players.length / pageSize);
  const start = (page - 1) * pageSize;
  const end = Math.min(start + pageSize, players.length);
  const currentPagePlayers = players.slice(start, end);

  currentPagePlayers.forEach((playerName: string) => {
    const waypoints = wayPoint.getPointsByPlayer(playerName);
    const publicCount = waypoints.filter((p: any) => p.type === "public").length;
    const privateCount = waypoints.filter((p: any) => p.type === "private").length;
    // 使用亮色系在淡灰色背景下更清晰：白色玩家名 + 绿色/黄色标签
    form.button(
      `${colorCodes.white}${playerName} ${colorCodes.gray}的所有坐标点\n${colorCodes.green}公共: ${colorCodes.yellow}${publicCount} ${colorCodes.gray}| ${colorCodes.aqua}私有: ${colorCodes.minecoinGold}${privateCount}`,
      "textures/ui/icon_steve"
    );
  });

  let previousButtonIndex = currentPagePlayers.length;
  let nextButtonIndex = currentPagePlayers.length;

  if (page > 1) {
    form.button("§w上一页", "textures/icons/left_arrow");
    previousButtonIndex++;
    nextButtonIndex++;
  }

  if (page < totalPages) {
    form.button("§w下一页", "textures/icons/right_arrow");
    nextButtonIndex++;
  }

  form.button("§w返回", "textures/icons/back");
  form.body(`第 ${page} 页 / 共 ${totalPages} 页`);

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    const selectionIndex = data.selection;
    if (selectionIndex === null || selectionIndex === undefined) return;

    const currentPagePlayersCount = currentPagePlayers.length;
    const playerIndex = selectionIndex;

    if (playerIndex >= 0 && playerIndex < currentPagePlayersCount) {
      const selectedPlayer = currentPagePlayers[playerIndex];
      const { openPlayerWayPointListForm } = require("../waypoint");
      openPlayerWayPointListForm(player, selectedPlayer, 1, true, () => openPlayerWayPointManageForm(player, page));
    } else if (selectionIndex === previousButtonIndex - 1 && page > 1) {
      openPlayerWayPointManageForm(player, page - 1);
    } else if (selectionIndex === nextButtonIndex - 1 && page < totalPages) {
      openPlayerWayPointManageForm(player, page + 1);
    } else {
      openWayPointManageMenu(player);
    }
  });
}

// ==================== 领地管理菜单 ====================

export const openLandManageForm = async (player: Player): Promise<void> => {
  const form = new ActionFormData();
  form.title("§w领地管理");

  form.button("§w所有玩家领地管理", "textures/packs/14321662");
  form.button("§w搜索玩家领地", "textures/ui/magnifyingGlass");
  form.button("§w返回", "textures/icons/back");

  form.show(player).then(async (data) => {
    if (data.canceled || data.cancelationReason) return;
    switch (data.selection) {
      case 0:
        const { openAllPlayerLandManageForm } = await import("../land");
        openAllPlayerLandManageForm(player);
        break;
      case 1:
        const { openSearchLandForm } = await import("../land");
        openSearchLandForm(player);
        break;
      case 2:
        openSystemSettingForm(player);
        break;
    }
  });
};

// ==================== 物品价格管理 ====================

function openItemPriceManageForm(player: Player): void {
  openDialogForm(
    player,
    {
      title: "功能开发中",
      desc: color.yellow("物品价格管理功能正在开发中..."),
    },
    () => openSystemSettingForm(player)
  );
}
