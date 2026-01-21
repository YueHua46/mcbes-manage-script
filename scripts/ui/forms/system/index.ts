/**
 * 系统设置表单
 * 迁移自 Modules/System/Forms.ts（主要部分）
 */

import { Player, RawMessage, world, ItemStack } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { color, colorCodes } from "../../../shared/utils/color";
import setting from "../../../features/system/services/setting";
import { openServerMenuForm } from "../server";
import { openDialogForm } from "../../../ui/components/dialog";
import { isAdmin } from "../../../shared/utils/common";
import { officeShopSettingForm } from "./office-shop-setting";
import { openNotifyForms } from "../notify";
import itemPriceDb from "../../../features/economic/services/item-price-database";
import economic from "../../../features/economic/services/economic";
import { dynamicMatchIconPath } from "../../../assets/texture-paths";

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
      text: "§w功能开关管理",
      icon: "textures/icons/gadgets",
      action: () => openModuleToggleForm(player),
    },
    {
      text: "§w领地管理",
      icon: "textures/icons/home",
      action: async () => {
        openLandManageForm(player);
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
      text: "§w经济系统管理",
      icon: "textures/icons/shop_bank",
      action: () => openEconomyManageForm(player),
    },
    {
      text: "§wPVP管理",
      icon: "textures/icons/sword",
      action: async () => {
        const { openPvpManagementForm } = await import("../pvp/admin");
        openPvpManagementForm(player);
      },
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
    { key: "maxPrivatePointsPerPlayer", name: "每玩家最大私人坐标点数", type: "number" },
    { key: "maxPublicPointsPerPlayer", name: "每玩家最大公开坐标点数", type: "number" },
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

// ==================== 功能开关管理 ====================

export function openModuleToggleForm(player: Player): void {
  const form = new ModalFormData();
  form.title("§w功能开关管理");

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
    { key: "allowPlayerDisplaySettings", name: "允许玩家编辑名字显示设置" },
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

  form.button("§w会员列表", "textures/icons/social");
  form.button("§w添加会员", "textures/icons/add");
  form.button("§w移除会员", "textures/icons/deny");
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
  const onlinePlayers = world.getPlayers();
  const playerNames = onlinePlayers.map((p) => p.name);

  if (playerNames.length === 0) {
    // 理论上不会发生，因为至少当前玩家应该在线
    const form = new ModalFormData();
    form.title("§w添加会员");
    form.textField("玩家名称", "请输入玩家名称（支持批量，用逗号分隔）");
    form.submitButton("确认");

    form.show(player).then((data) => {
      if (data.cancelationReason) return;
      const { formValues } = data;
      if (formValues?.[0]) {
        const { memberManager } = require("../../../features/system/services/trial-mode");
        const namesToAdd = formValues[0]
          .toString()
          .split(",")
          .map((n) => n.trim())
          .filter((n) => n.length > 0);

        let successCount = 0;
        namesToAdd.forEach((name: string) => {
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
  } else {
    // 有在线玩家，显示下拉框和文本输入框
    const form = new ModalFormData();
    form.title("§w添加会员");
    form.dropdown("选择在线玩家", ["-- 不选择 --", ...playerNames], {
      defaultValueIndex: 0,
    });
    form.textField("或直接输入玩家名称（二选一，优先使用输入，支持批量，用逗号分隔）", "输入玩家名称", {
      defaultValue: "",
    });
    form.submitButton("确认");

    form.show(player).then((data) => {
      if (data.cancelationReason) return;
      const { formValues } = data;

      const selectedIndex = formValues?.[0] as number;
      const inputName = formValues?.[1] as string;

      const { memberManager } = require("../../../features/system/services/trial-mode");
      let namesToAdd: string[] = [];

      // 优先使用文本输入，如果为空则使用下拉框选择
      if (inputName && inputName.trim() !== "") {
        namesToAdd = inputName
          .split(",")
          .map((n) => n.trim())
          .filter((n) => n.length > 0);
      } else if (selectedIndex > 0) {
        namesToAdd = [playerNames[selectedIndex - 1]];
      }

      if (namesToAdd.length === 0) {
        openDialogForm(
          player,
          {
            title: "添加失败",
            desc: color.red("请选择在线玩家或输入玩家名称"),
          },
          () => openAddMemberForm(player)
        );
        return;
      }

      let successCount = 0;
      namesToAdd.forEach((name: string) => {
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
    });
  }
}

function openRemoveMemberForm(player: Player): void {
  const onlinePlayers = world.getPlayers();
  const playerNames = onlinePlayers.map((p) => p.name);

  if (playerNames.length === 0) {
    // 理论上不会发生，因为至少当前玩家应该在线
    const form = new ModalFormData();
    form.title("§w移除会员");
    form.textField("玩家名称", "请输入玩家名称（支持批量，用逗号分隔）");
    form.submitButton("确认");

    form.show(player).then((data) => {
      if (data.cancelationReason) return;
      const { formValues } = data;
      if (formValues?.[0]) {
        const { memberManager } = require("../../../features/system/services/trial-mode");
        const namesToRemove = formValues[0]
          .toString()
          .split(",")
          .map((n) => n.trim())
          .filter((n) => n.length > 0);

        let successCount = 0;
        let notMemberCount = 0;
        namesToRemove.forEach((name: string) => {
          if (memberManager.isMember(name)) {
            if (memberManager.removeMember(name)) {
              successCount++;
            }
          } else {
            notMemberCount++;
          }
        });

        let message = color.green(`成功移除 ${successCount} 个会员`);
        if (notMemberCount > 0) {
          message += `\n${color.yellow(`${notMemberCount} 个玩家不是会员`)}`;
        }

        openDialogForm(
          player,
          {
            title: "操作完成",
            desc: message,
          },
          () => openTrialModeManageForm(player)
        );
      }
    });
  } else {
    // 有在线玩家，显示下拉框和文本输入框
    const form = new ModalFormData();
    form.title("§w移除会员");
    form.dropdown("选择在线玩家", ["-- 不选择 --", ...playerNames], {
      defaultValueIndex: 0,
    });
    form.textField("或直接输入玩家名称（二选一，优先使用输入，支持批量，用逗号分隔）", "输入玩家名称", {
      defaultValue: "",
    });
    form.submitButton("确认");

    form.show(player).then((data) => {
      if (data.cancelationReason) return;
      const { formValues } = data;

      const selectedIndex = formValues?.[0] as number;
      const inputName = formValues?.[1] as string;

      const { memberManager } = require("../../../features/system/services/trial-mode");
      let namesToRemove: string[] = [];

      // 优先使用文本输入，如果为空则使用下拉框选择
      if (inputName && inputName.trim() !== "") {
        namesToRemove = inputName
          .split(",")
          .map((n) => n.trim())
          .filter((n) => n.length > 0);
      } else if (selectedIndex > 0) {
        namesToRemove = [playerNames[selectedIndex - 1]];
      }

      if (namesToRemove.length === 0) {
        openDialogForm(
          player,
          {
            title: "移除失败",
            desc: color.red("请选择在线玩家或输入玩家名称"),
          },
          () => openRemoveMemberForm(player)
        );
        return;
      }

      let successCount = 0;
      let notMemberCount = 0;
      namesToRemove.forEach((name: string) => {
        if (memberManager.isMember(name)) {
          if (memberManager.removeMember(name)) {
            successCount++;
          }
        } else {
          notMemberCount++;
        }
      });

      let message = color.green(`成功移除 ${successCount} 个会员`);
      if (notMemberCount > 0) {
        message += `\n${color.yellow(`${notMemberCount} 个玩家不是会员`)}`;
      }

      openDialogForm(
        player,
        {
          title: "操作完成",
          desc: message,
        },
        () => openTrialModeManageForm(player)
      );
    });
  }
}

// ==================== 坐标点管理菜单 ====================

export const openWayPointManageMenu = (player: Player): void => {
  const form = new ActionFormData();
  form.title("§w坐标点管理");

  form.button("§w所有玩家坐标点管理", "textures/icons/game_parkour_tag");
  form.button("§w搜索玩家坐标点", "textures/ui/magnifyingGlass");
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    switch (data.selection) {
      case 0:
        openPlayerWayPointManageForm(player, 1, () => openWayPointManageMenu(player));
        break;
      case 1:
        const { openSearchWayPointForm } = require("../waypoint");
        openSearchWayPointForm(player, () => openWayPointManageMenu(player));
        break;
      case 2:
        openSystemSettingForm(player);
        break;
    }
  });
};

function openPlayerWayPointManageForm(player: Player, page: number = 1, returnForm?: () => void): void {
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
    // 使用亮色系在淡灰色背景下更清晰：蓝色玩家名 + 清晰的标签颜色
    form.button(
      `${color.blue(playerName)} 的所有坐标点\n${color.green("公共:")} ${color.yellow(publicCount.toString())} ${color.white("|")} ${color.aqua("私有:")} ${color.yellow(privateCount.toString())}`,
      "textures/icons/dinazor"
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
      openPlayerWayPointListForm(player, selectedPlayer, 1, true, () =>
        openPlayerWayPointManageForm(player, page, returnForm)
      );
    } else if (selectionIndex === previousButtonIndex - 1 && page > 1) {
      openPlayerWayPointManageForm(player, page - 1, returnForm);
    } else if (selectionIndex === nextButtonIndex - 1 && page < totalPages) {
      openPlayerWayPointManageForm(player, page + 1, returnForm);
    } else {
      if (returnForm) {
        returnForm();
      } else {
        openWayPointManageMenu(player);
      }
    }
  });
}

// ==================== 领地管理菜单 ====================

export const openLandManageForm = async (player: Player): Promise<void> => {
  const form = new ActionFormData();
  form.title("§w领地管理");

  form.button("§w所有玩家领地管理", "textures/icons/topraklar");
  form.button("§w搜索玩家领地", "textures/ui/magnifyingGlass");
  form.button("§w返回", "textures/icons/back");

  form.show(player).then(async (data) => {
    if (data.canceled || data.cancelationReason) return;
    switch (data.selection) {
      case 0:
        const { openAllPlayerLandManageForm } = await import("../land");
        openAllPlayerLandManageForm(player, 1, () => openLandManageForm(player));
        break;
      case 1:
        const { openSearchLandForm } = await import("../land");
        openSearchLandForm(player, () => openLandManageForm(player));
        break;
      case 2:
        openSystemSettingForm(player);
        break;
    }
  });
};

// ==================== 经济系统管理 ====================

// 经济系统管理主菜单
export function openEconomyManageForm(player: Player): void {
  const form = new ActionFormData();
  form.title("§w经济系统管理");

  form.button("§w官方商店管理", "textures/icons/shop");
  form.button("§w物品出售价格管理", "textures/icons/clock");
  form.button("§w玩家金币管理", "textures/icons/rewards");
  form.button("§w功能开关", "textures/icons/gadgets");
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    switch (data.selection) {
      case 0:
        officeShopSettingForm.openMainMenu(player);
        break;
      case 1:
        openItemPriceManageForm(player);
        break;
      case 2:
        openPlayerMoneyManageForm(player);
        break;
      case 3:
        openEconomyFeatureToggleForm(player);
        break;
      case 4:
        openSystemSettingForm(player);
        break;
    }
  });
}

// ==================== 经济系统功能开关 ====================

// 经济系统功能开关表单
function openEconomyFeatureToggleForm(player: Player): void {
  const form = new ModalFormData();
  form.title("§w经济系统功能开关");

  const features = [{ key: "monsterKillGoldReward", name: "杀怪掉金币" }];

  features.forEach((feature) => {
    const currentValue = setting.getState(feature.key as any);
    form.toggle(`${feature.name}`, {
      defaultValue: currentValue as boolean,
    });
  });

  form.submitButton("确认");

  form.show(player).then((data) => {
    if (data.cancelationReason) return;
    const { formValues } = data;
    if (formValues) {
      features.forEach((feature, index) => {
        setting.setState(feature.key as any, formValues[index] as boolean);
      });

      openDialogForm(
        player,
        {
          title: "设置成功",
          desc: color.green("功能开关已更新！"),
        },
        () => openEconomyManageForm(player)
      );
    }
  });
}

// ==================== 玩家金币管理 ====================

// 玩家金币管理主菜单
function openPlayerMoneyManageForm(player: Player): void {
  const form = new ActionFormData();
  form.title("§w玩家金币管理");

  form.button("§w设置指定玩家金币", "textures/icons/profile");
  form.button("§w重置所有玩家金币", "textures/icons/requeue");
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    switch (data.selection) {
      case 0:
        openSetPlayerMoneyForm(player);
        break;
      case 1:
        openResetAllPlayerMoneyForm(player);
        break;
      case 2:
        openEconomyManageForm(player);
        break;
    }
  });
}

// 设置指定玩家金币表单
function openSetPlayerMoneyForm(player: Player): void {
  const form = new ModalFormData();
  form.title("§w设置指定玩家金币");

  // 获取所有在线玩家
  const onlinePlayers = world.getAllPlayers();
  const playerNames = onlinePlayers.map((p) => p.name);

  form.dropdown("选择在线玩家", playerNames.length > 0 ? playerNames : ["无在线玩家"]);
  form.textField("或输入玩家名称（支持离线玩家）", "玩家名称", { defaultValue: "" });
  form.textField("设置金币数量", "金额（整数）", { defaultValue: "0" });
  form.submitButton("确认");

  form.show(player).then((data) => {
    if (data.cancelationReason) return;
    const { formValues } = data;
    if (!formValues) return;

    const selectedPlayerIndex = formValues[0] as number;
    const inputPlayerName = (formValues[1] as string)?.trim();
    const amountStr = (formValues[2] as string)?.trim();

    // 确定目标玩家名称：优先使用手动输入，否则使用选择的在线玩家
    let targetPlayerName = "";
    if (inputPlayerName && inputPlayerName !== "") {
      targetPlayerName = inputPlayerName;
    } else if (playerNames.length > 0 && selectedPlayerIndex >= 0) {
      targetPlayerName = playerNames[selectedPlayerIndex];
    }

    if (!targetPlayerName || targetPlayerName === "") {
      openDialogForm(
        player,
        {
          title: "设置失败",
          desc: color.red("请选择在线玩家或输入玩家名称！"),
        },
        () => openSetPlayerMoneyForm(player)
      );
      return;
    }

    // 验证金额
    const amount = parseInt(amountStr);
    if (isNaN(amount) || amount < 0) {
      openDialogForm(
        player,
        {
          title: "设置失败",
          desc: color.red("请输入有效的金额（必须为大于等于0的整数）！"),
        },
        () => openSetPlayerMoneyForm(player)
      );
      return;
    }

    if (amount > Number.MAX_SAFE_INTEGER) {
      openDialogForm(
        player,
        {
          title: "设置失败",
          desc: color.red(`金额过大，最大值为 ${Number.MAX_SAFE_INTEGER}！`),
        },
        () => openSetPlayerMoneyForm(player)
      );
      return;
    }

    // 检查玩家是否有钱包数据（是否进过服务器）
    if (!economic.hasWallet(targetPlayerName)) {
      openDialogForm(
        player,
        {
          title: "设置失败",
          desc: color.red(`玩家 ${color.yellow(targetPlayerName)} 从未进入过服务器，无法设置金币！\n\n只能为进入过服务器的玩家设置金币。`),
        },
        () => openSetPlayerMoneyForm(player)
      );
      return;
    }

    // 设置金币
    const success = economic.setPlayerGold(targetPlayerName, amount);
    if (success) {
      // 如果目标玩家在线，通知他
      const targetPlayer = world.getAllPlayers().find((p) => p.name === targetPlayerName);
      if (targetPlayer) {
        targetPlayer.sendMessage(color.yellow(`管理员将您的金币设置为 ${color.gold(amount.toString())}`));
      }

      openDialogForm(
        player,
        {
          title: "设置成功",
          desc: color.green(`已将玩家 ${color.yellow(targetPlayerName)} 的金币设置为 ${color.gold(amount.toString())}！`),
        },
        () => openPlayerMoneyManageForm(player)
      );
    } else {
      openDialogForm(
        player,
        {
          title: "设置失败",
          desc: color.red("设置金币失败，请检查输入！"),
        },
        () => openSetPlayerMoneyForm(player)
      );
    }
  });
}

// 重置所有玩家金币表单
function openResetAllPlayerMoneyForm(player: Player): void {
  const defaultGold = Number(setting.getState("startingGold"));
  
  const form = new ModalFormData();
  form.title("§w重置所有玩家金币");

  form.textField(
    "重置金额（默认起始金币）",
    `金额（整数，留空使用默认值 ${defaultGold}）`,
    { defaultValue: defaultGold.toString() }
  );
  form.toggle("§c确认重置所有玩家金币（包括离线玩家）", { defaultValue: false });
  form.submitButton("确认");

  form.show(player).then((data) => {
    if (data.cancelationReason) return;
    const { formValues } = data;
    if (!formValues) return;

    const amountStr = (formValues[0] as string)?.trim();
    const confirmed = formValues[1] as boolean;

    if (!confirmed) {
      openDialogForm(
        player,
        {
          title: "操作取消",
          desc: color.yellow("请勾选确认选项以继续重置操作！"),
        },
        () => openResetAllPlayerMoneyForm(player)
      );
      return;
    }

    // 确定重置金额
    let resetAmount = defaultGold;
    if (amountStr && amountStr !== "") {
      const parsedAmount = parseInt(amountStr);
      if (isNaN(parsedAmount) || parsedAmount < 0) {
        openDialogForm(
          player,
          {
            title: "设置失败",
            desc: color.red("请输入有效的金额（必须为大于等于0的整数）！"),
          },
          () => openResetAllPlayerMoneyForm(player)
        );
        return;
      }
      resetAmount = parsedAmount;
    }

    if (resetAmount > Number.MAX_SAFE_INTEGER) {
      openDialogForm(
        player,
        {
          title: "设置失败",
          desc: color.red(`金额过大，最大值为 ${Number.MAX_SAFE_INTEGER}！`),
        },
        () => openResetAllPlayerMoneyForm(player)
      );
      return;
    }

    // 执行重置操作
    try {
      const allWallets = economic.getAllWallets();
      let successCount = 0;
      let failCount = 0;

      allWallets.forEach((wallet) => {
        const success = economic.setPlayerGold(wallet.name, resetAmount);
        if (success) {
          successCount++;
          // 如果玩家在线，通知他
          const targetPlayer = world.getAllPlayers().find((p) => p.name === wallet.name);
          if (targetPlayer) {
            targetPlayer.sendMessage(
              color.yellow(`管理员已重置所有玩家金币，您的金币已设置为 ${color.gold(resetAmount.toString())}`)
            );
          }
        } else {
          failCount++;
        }
      });

      openDialogForm(
        player,
        {
          title: "重置完成",
          desc: color.green(
            `已重置 ${color.gold(successCount.toString())} 个玩家的金币为 ${color.gold(resetAmount.toString())}！${failCount > 0 ? color.red(`\n失败: ${failCount} 个`) : ""}`
          ),
        },
        () => openPlayerMoneyManageForm(player)
      );
    } catch (error) {
      openDialogForm(
        player,
        {
          title: "重置失败",
          desc: color.red(`重置金币时发生错误: ${(error as Error).message}`),
        },
        () => openResetAllPlayerMoneyForm(player)
      );
    }
  });
}

// ==================== 物品价格管理 ====================

// 物品价格管理主界面
function openItemPriceManageForm(player: Player): void {
  const customPricesCount = Object.keys(itemPriceDb.getAllCustomPrices()).length;
  const totalItemsCount = itemPriceDb.getAllDefaultItemIds().length;

  const form = new ActionFormData()
    .title("§w物品出售价格管理")
    .body(
      `§a当前状态:\n§e已设置物品出售价格: ${customPricesCount} 个\n§e配置文件默认价格: ${totalItemsCount} 个\n§c注意：未设置价格的物品无法出售！\n§a请选择要进行的操作:`
    )
    .button("§w初始化所有物品出售价格", "textures/icons/requeue")
    .button("§w浏览已设置的物品出售价格", "textures/icons/quest_chest")
    .button("§w手动修改物品出售价格", "textures/icons/edit2")
    .button("§w搜索物品出售价格", "textures/ui/magnifyingGlass")
    .button("§w清空所有物品出售价格", "textures/icons/deny")
    .button("§w返回", "textures/icons/back");

  form.show(player).then((res) => {
    if (res.canceled) return;
    switch (res.selection) {
      case 0:
        openInitializePricesConfirmForm(player);
        break;
      case 1:
        showItemPricesWithPagination(player, 1);
        break;
      case 2:
        openModifyItemPriceForm(player);
        break;
      case 3:
        openSearchItemPriceForm(player);
        break;
      case 4:
        openClearAllPricesConfirmForm(player);
        break;
      case 5:
        openEconomyManageForm(player);
        break;
    }
  });
}

// 分页显示自定义物品出售价格列表
function showItemPricesWithPagination(player: Player, page: number = 1): void {
  const form = new ActionFormData();
  form.title("§w自定义物品出售价格列表");

  const customPrices = itemPriceDb.getAllCustomPrices();
  const entries = Object.entries(customPrices);

  // 分页设置
  const pageSize = 12;
  const totalPages = Math.ceil(entries.length / pageSize);
  const start = (page - 1) * pageSize;
  const end = Math.min(start + pageSize, entries.length);
  const currentPageEntries = entries.slice(start, end);

  if (entries.length === 0) {
    form.body("§e当前没有任何自定义物品出售价格\n§a所有物品都使用默认物品出售价格");
  } else {
    form.body(`第 ${page} 页 / 共 ${totalPages} 页 (共 ${entries.length} 个自定义物品出售价格)`);
  }

  // 显示当前页的物品
  currentPageEntries.forEach(([itemId, price]) => {
    // 简化显示物品ID（移除minecraft:前缀）
    const displayName = itemId.replace("minecraft:", "");
    const itemTexture = dynamicMatchIconPath(displayName);
    
    // 创建 ItemStack 对象以获取本地化键
    const itemStack = new ItemStack(itemId);
    const itemNameRawMessage: RawMessage = {
      rawtext: [
        {
          text: "§t",
        },
        {
          translate: itemStack.localizationKey,
        },
        {
          text: `\n§e${price} 金币`,
        },
      ],
    };
    form.button(itemNameRawMessage, itemTexture);
  });

  // 添加导航按钮
  if (page > 1) {
    form.button("§w上一页", "textures/icons/left_arrow");
  }

  if (page < totalPages) {
    form.button("§w下一页", "textures/icons/right_arrow");
  }

  form.button("§w返回", "textures/icons/back");

  form.show(player).then((res) => {
    if (res.canceled) return;

    const selection = res.selection;
    if (selection === null || selection === undefined) return;

    const itemCount = currentPageEntries.length;

    if (selection < itemCount) {
      // 选择了某个物品，打开编辑表单
      const [itemId, currentPrice] = currentPageEntries[selection];
      openEditItemPriceForm(player, itemId, currentPrice, page);
    } else if (selection === itemCount && page > 1) {
      // 上一页
      showItemPricesWithPagination(player, page - 1);
    } else if (selection === itemCount + (page > 1 ? 1 : 0) && page < totalPages) {
      // 下一页
      showItemPricesWithPagination(player, page + 1);
    } else {
      // 返回
      openItemPriceManageForm(player);
    }
  });
}

// 编辑单个物品出售价格
function openEditItemPriceForm(player: Player, itemId: string, currentPrice: number, returnPage: number): void {
  const form = new ActionFormData();
  const displayName = itemId.replace("minecraft:", "");

  // 创建 ItemStack 对象以获取本地化键
  const itemStack = new ItemStack(itemId);
  const formTitleRawMessage: RawMessage = {
    rawtext: [
      {
        text: "§w",
      },
      {
        text: "编辑物品出售价格 - ",
      },
      {
        translate: itemStack.localizationKey,
      },
    ],
  };

  form.title(formTitleRawMessage);

  form.body(`§a当前出售价格: §e${currentPrice} §a金币\n§a请选择操作:`);
  form.button("§w修改出售价格", "textures/icons/edit2");
  form.button("§w删除价格设置", "textures/icons/deny");
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((res) => {
    if (res.canceled) {
      showItemPricesWithPagination(player, returnPage);
      return;
    }

    switch (res.selection) {
      case 0:
        // 修改价格
        openModifyCustomPriceForm(player, itemId, currentPrice, returnPage);
        break;
      case 1:
        // 删除价格设置
        itemPriceDb.removePrice(itemId);
        
        const descRawMessage: RawMessage = {
          rawtext: [
            { text: "§a已删除 " },
            { translate: itemStack.localizationKey },
            { text: ` §a的出售价格设置\n§c该物品现在无法出售（价格为0）` },
          ],
        };
        
        openDialogForm(
          player,
          {
            title: "删除成功",
            desc: descRawMessage,
          },
          () => showItemPricesWithPagination(player, returnPage)
        );
        break;
      case 2:
        // 返回
        showItemPricesWithPagination(player, returnPage);
        break;
    }
  });
}

// 修改物品出售价格表单
function openModifyCustomPriceForm(player: Player, itemId: string, currentPrice: number, returnPage: number): void {
  const form = new ModalFormData();

  // 创建 ItemStack 对象以获取本地化键
  const itemStack = new ItemStack(itemId);
  const formTitleRawMessage: RawMessage = {
    rawtext: [
      {
        text: "§w",
      },
      {
        text: "修改物品出售价格 - ",
      },
      {
        translate: itemStack.localizationKey,
      },
    ],
  };

  form.title(formTitleRawMessage);
  form.textField(
    `§a当前出售价格: §e${currentPrice} §a金币\n§a请输入新的出售价格:`,
    "输入新的价格",
    {
      defaultValue: currentPrice.toString(),
    }
  );

  form.show(player).then((res) => {
    if (res.canceled) {
      openEditItemPriceForm(player, itemId, currentPrice, returnPage);
      return;
    }

    const priceStr = res.formValues?.[0] as string;
    if (!priceStr) {
      openDialogForm(
        player,
        {
          title: "设置失败",
          desc: "§c请输入有效的非负整数！",
        },
        () => openModifyCustomPriceForm(player, itemId, currentPrice, returnPage)
      );
      return;
    }

    const newPrice = parseInt(priceStr);

    if (isNaN(newPrice) || newPrice < 0) {
      openDialogForm(
        player,
        {
          title: "设置失败",
          desc: "§c请输入有效的非负整数！",
        },
        () => openModifyCustomPriceForm(player, itemId, currentPrice, returnPage)
      );
      return;
    }

    itemPriceDb.setPrice(itemId, newPrice);
    
    const successDescRawMessage: RawMessage = {
      rawtext: [
        { text: "§a成功设置 " },
        { translate: itemStack.localizationKey },
        { text: ` §a的出售价格为 §e${newPrice} §a金币` },
      ],
    };
    
    openDialogForm(
      player,
      {
        title: "设置成功",
        desc: successDescRawMessage,
      },
      () => showItemPricesWithPagination(player, returnPage)
    );
  });
}

// 搜索物品出售价格
function openSearchItemPriceForm(player: Player): void {
  const form = new ModalFormData();
  form.title("§w搜索物品出售价格");
  form.textField("§a物品名称或ID", "输入物品名称或ID的一部分");

  form.show(player).then((res) => {
    if (res.canceled) {
      openItemPriceManageForm(player);
      return;
    }

    const searchTerm = res.formValues?.[0] as string;
    if (!searchTerm || !searchTerm.trim()) {
      openDialogForm(
        player,
        {
          title: "搜索失败",
          desc: "§c请输入搜索关键词！",
        },
        () => openSearchItemPriceForm(player)
      );
      return;
    }

    showSearchResults(player, searchTerm.toLowerCase());
  });
}

// 显示搜索结果
function showSearchResults(player: Player, searchTerm: string): void {
  const form = new ActionFormData();
  form.title(`§w搜索结果 - "${searchTerm}"`);

  // 搜索所有物品（包括默认价格的物品）
  const allItemIds = itemPriceDb.getAllDefaultItemIds();
  const matchedItems = allItemIds
    .filter((itemId) => itemId.toLowerCase().includes(searchTerm))
    .map((itemId) => {
      const price = itemPriceDb.getPrice(itemId);
      const isCustom = itemPriceDb.hasCustomPrice(itemId);
      return { itemId, price, isCustom };
    });

  if (matchedItems.length === 0) {
    form.body("§c未找到匹配的物品");
    form.button("§w返回搜索", "textures/icons/back");

    form.show(player).then((res) => {
      if (!res.canceled) {
        openSearchItemPriceForm(player);
      }
    });
    return;
  }

  form.body(`找到 ${matchedItems.length} 个匹配的物品`);

  matchedItems.forEach(({ itemId, price }) => {
    const displayName = itemId.replace("minecraft:", "");
    
    // 创建 ItemStack 对象以获取本地化键
    const itemStack = new ItemStack(itemId);
    const itemNameRawMessage: RawMessage = {
      rawtext: [
        {
          text: "§t",
        },
        {
          translate: itemStack.localizationKey,
        },
        {
          text: `\n§e${price} 金币`,
        },
      ],
    };
    form.button(itemNameRawMessage, dynamicMatchIconPath(displayName));
  });

  form.button("§w返回搜索", "textures/icons/back");

  form.show(player).then((res) => {
    if (res.canceled) return;

    const selection = res.selection;
    if (selection === null || selection === undefined) return;

    if (selection < matchedItems.length) {
      // 选择了某个物品
      const { itemId, price } = matchedItems[selection];
      openEditItemPriceForm(player, itemId, price, 1);
    } else {
      // 返回搜索
      openSearchItemPriceForm(player);
    }
  });
}

// 删除所有自定义物品出售价格确认表单
// ==================== 初始化所有物品出售价格 ====================

// 初始化所有物品出售价格确认表单
function openInitializePricesConfirmForm(player: Player): void {
  const totalItemsCount = itemPriceDb.getAllDefaultItemIds().length;
  const currentPricesCount = Object.keys(itemPriceDb.getAllCustomPrices()).length;
  const uninitializedCount = totalItemsCount - currentPricesCount;

  const form = new ActionFormData();
  form.title("§w初始化所有物品出售价格确认");
  
  let bodyText = `§a说明：此操作将使用配置文件中的价格初始化未设置价格的物品。\n`;
  
  if (currentPricesCount > 0) {
    bodyText += `§a将初始化 ${uninitializedCount} 个未设置价格的物品。\n`;
    bodyText += `§e已设置价格的 ${currentPricesCount} 个物品将被保留（不会覆盖）。`;
  } else {
    bodyText += `§a共有 ${totalItemsCount} 个物品将被设置价格。\n`;
    bodyText += `§e当前所有物品均未设置价格（默认为0，不可出售）。`;
  }
  
  bodyText += `\n§e是否确认继续？`;

  form.body(bodyText);
  form.button("§a确认初始化", "textures/icons/accept");
  form.button("§c取消", "textures/icons/back");

  form.show(player).then((res) => {
    if (res.canceled || res.selection === 1) {
      openItemPriceManageForm(player);
      return;
    }

    if (res.selection === 0) {
      initializeAllPrices(player);
    }
  });
}

// 执行初始化所有物品出售价格
function initializeAllPrices(player: Player): void {
  const result = itemPriceDb.initializeAllPrices();
  
  let desc = `§a已成功初始化物品出售价格！\n§a新初始化了 ${result.initialized} 个物品价格。`;
  
  if (result.skipped > 0) {
    desc += `\n§e保留了 ${result.skipped} 个已手动设置的物品价格。`;
  }
  
  desc += `\n§a玩家现在可以出售这些物品了。`;

  openDialogForm(
    player,
    {
      title: "初始化成功",
      desc: desc,
    },
    () => openItemPriceManageForm(player)
  );
}

// ==================== 清空所有物品出售价格 ====================

// 清空所有物品出售价格确认表单
function openClearAllPricesConfirmForm(player: Player): void {
  const customPricesCount = Object.keys(itemPriceDb.getAllCustomPrices()).length;

  const form = new ActionFormData();
  form.title("§w清空所有物品出售价格确认");
  
  if (customPricesCount === 0) {
    form.body(`§e当前没有任何物品设置了价格。\n§a所有物品的价格都是默认值0（不可出售）。`);
    form.button("§a返回", "textures/icons/back");
    
    form.show(player).then(() => {
      openItemPriceManageForm(player);
    });
    return;
  }
  
  form.body(
    `§c警告：此操作将清空所有已设置的物品价格！\n§c当前有 ${customPricesCount} 个物品价格将被清空！\n§c清空后所有物品价格将恢复为0（不可出售）！\n§e是否确认继续？`
  );

  form.button("§c确认清空", "textures/icons/deny");
  form.button("§a取消", "textures/icons/back");

  form.show(player).then((res) => {
    if (res.canceled || res.selection === 1) {
      openItemPriceManageForm(player);
      return;
    }

    if (res.selection === 0) {
      clearAllPrices(player);
    }
  });
}

// 执行清空所有物品出售价格
function clearAllPrices(player: Player): void {
  const count = itemPriceDb.clearAllPrices();

  openDialogForm(
    player,
    {
      title: "清空成功",
      desc: `§a已成功清空所有物品出售价格！\n§a共清空了 ${count} 个物品价格。\n§c所有物品现在都无法出售。`,
    },
    () => openItemPriceManageForm(player)
  );
}

// ==================== 旧版重置功能（已废弃，保持兼容性）====================

function openResetPricesConfirmForm(player: Player): void {
  const customPricesCount = Object.keys(itemPriceDb.getAllCustomPrices()).length;

  const form = new ActionFormData();
  form.title("§w删除所有自定义物品出售价格确认");
  form.body(
    `§c警告：此操作将删除所有自定义物品出售价格！\n§c当前有 ${customPricesCount} 个自定义物品出售价格将被删除！\n§c删除后所有物品将恢复使用默认物品出售价格！\n§e是否确认继续？`
  );

  form.button("§c确认删除", "textures/icons/deny");
  form.button("§a取消", "textures/icons/back");

  form.show(player).then((res) => {
    if (res.canceled || res.selection === 1) {
      openItemPriceManageForm(player);
      return;
    }

    if (res.selection === 0) {
      resetAllPricesToDefault(player);
    }
  });
}

// 删除所有自定义物品出售价格
function resetAllPricesToDefault(player: Player): void {
  // 使用专门的重置方法
  itemPriceDb.resetToDefaultPrices();

  openDialogForm(
    player,
    {
      title: "删除成功",
      desc: "§a已成功删除所有自定义物品出售价格！\n§a所有物品现在都使用默认物品出售价格。",
    },
    () => openItemPriceManageForm(player)
  );
}

// 修改物品出售价格表单 - 显示背包物品列表
function openModifyItemPriceForm(player: Player): void {
  const { ChestFormData, ChestUIUtility } = require("../../components/chest-ui");
  const { getItemDurabilityPercent, hasAnyEnchantment } = ChestUIUtility;

  const inventory = player.getComponent("inventory");
  if (!inventory) {
    openDialogForm(player, { title: "错误", desc: "无法获取玩家背包" }, () => openItemPriceManageForm(player));
    return;
  }

  const chestForm = new ChestFormData("shop");
  chestForm.title("选择要设置价格的物品");

  const container = inventory.container;
  let hasItems = false;

  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    if (item && item.typeId !== "yuehua:sm") {
      hasItems = true;
      const currentPrice = itemPriceDb.getPrice(item.typeId);

      const lores: string[] = [];
      
      if (currentPrice > 0) {
        lores.push(`${colorCodes.gold}出售价格: ${colorCodes.yellow}${currentPrice} 金币`);
      } else {
        lores.push(`${colorCodes.red}未设置出售价格`);
      }

      chestForm.button(
        i,
        {
          rawtext: [
            {
              text: "§e",
            },
            {
              translate: item.localizationKey,
            },
          ],
        },
        lores,
        item.typeId,
        item.amount,
        Number(getItemDurabilityPercent(item)),
        hasAnyEnchantment(item)
      );
    }
  }

  if (!hasItems) {
    openDialogForm(player, { title: "背包为空", desc: "您的背包中没有物品" }, () => openItemPriceManageForm(player));
    return;
  }

  chestForm.button(49, "返回", ["返回上一级"], "textures/icons/back");

  chestForm.show(player).then((data: any) => {
    if (data.canceled) return;

    const selection = data.selection;
    if (selection === undefined) return;

    if (selection === 49) {
      openItemPriceManageForm(player);
      return;
    }

    const selectedItem = container.getItem(selection);
    if (!selectedItem) {
      openDialogForm(player, { title: "错误", desc: "无法获取物品信息" }, () => openModifyItemPriceForm(player));
      return;
    }

    // 打开价格设置表单
    openSetItemPriceForm(player, selectedItem);
  });
}

// 设置物品出售价格表单
function openSetItemPriceForm(player: Player, item: ItemStack): void {
  const itemId = item.typeId;
  const currentPrice = itemPriceDb.getPrice(itemId);
  const hasPrice = currentPrice > 0;

  const form = new ModalFormData();
  
  // 使用物品本地化名称作为标题
  const titleRawMessage: RawMessage = {
    rawtext: [
      { text: "§w设置物品出售价格 - " },
      { translate: item.localizationKey },
    ],
  };
  form.title(titleRawMessage);

  // 构建表单内容
  let bodyText = `§a物品ID: §e${itemId}\n`;
  
  if (hasPrice) {
    bodyText += `§a当前出售价格: §e${currentPrice} §a金币\n\n`;
    bodyText += `§e请输入新的价格（留空则删除价格设置）:`;
  } else {
    bodyText += `§c当前未设置价格（不可出售）\n\n`;
    bodyText += `§e请输入新的价格:`;
  }

  form.textField(bodyText, "输入价格", {
    defaultValue: hasPrice ? currentPrice.toString() : "",
  });

  form.show(player).then((res) => {
    if (res.canceled) {
      openModifyItemPriceForm(player);
      return;
    }

    const formValues = res.formValues;
    if (!formValues || formValues.length < 1) return;

    const priceStr = formValues[0] as string;

    // 如果留空，删除价格设置
    if (!priceStr || priceStr.trim() === "") {
      if (hasPrice) {
        itemPriceDb.removePrice(itemId);
        
        const descRawMessage: RawMessage = {
          rawtext: [
            { text: "§a已删除 " },
            { translate: item.localizationKey },
            { text: ` §a的出售价格\n§c该物品现在无法出售（价格为0）` },
          ],
        };
        
        openDialogForm(
          player,
          {
            title: "删除成功",
            desc: descRawMessage,
          },
          () => openItemPriceManageForm(player)
        );
      } else {
        openDialogForm(
          player,
          {
            title: "提示",
            desc: "§e该物品没有设置价格，无需删除",
          },
          () => openModifyItemPriceForm(player)
        );
      }
      return;
    }

    // 验证价格
    const price = parseInt(priceStr);
    if (isNaN(price) || price < 0) {
      openDialogForm(
        player,
        {
          title: "错误",
          desc: "§c请输入有效的非负整数价格",
        },
        () => openSetItemPriceForm(player, item)
      );
      return;
    }

    // 设置价格
    itemPriceDb.setPrice(itemId, price);
    
    const successDescRawMessage: RawMessage = {
      rawtext: [
        { text: "§a已将 " },
        { translate: item.localizationKey },
        { text: ` §a的出售价格设置为 §e${price} §a金币` },
      ],
    };
    
    openDialogForm(
      player,
      {
        title: "设置成功",
        desc: successDescRawMessage,
      },
      () => openItemPriceManageForm(player)
    );
  });
}
