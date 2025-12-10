/**
 * 系统设置表单
 * 迁移自 Modules/System/Forms.ts（主要部分）
 */

import { Player, RawMessage, world } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { color, colorCodes } from "../../../shared/utils/color";
import setting from "../../../features/system/services/setting";
import { openServerMenuForm } from "../server";
import { openDialogForm } from "../../../ui/components/dialog";
import { isAdmin } from "../../../shared/utils/common";
import { officeShopSettingForm } from "./office-shop-setting";
import { openNotifyForms } from "../notify";
import itemPriceDb from "../../../features/economic/services/item-price-database";
import { getItemLocalizationKey } from "../../../shared/utils/item-utils";
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
  form.button("§w物品价格管理", "textures/icons/clock");
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
        openEconomyFeatureToggleForm(player);
        break;
      case 3:
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

// ==================== 物品价格管理 ====================

// 物品价格管理主界面
function openItemPriceManageForm(player: Player): void {
  const customPricesCount = Object.keys(itemPriceDb.getAllCustomPrices()).length;
  const totalItemsCount = itemPriceDb.getAllDefaultItemIds().length;

  const form = new ActionFormData()
    .title("§w物品出售价格管理")
    .body(
      `§a当前状态:\n§e自定义物品出售价格: ${customPricesCount} 个\n§e默认物品出售价格: ${totalItemsCount} 个\n§e友情提示，对应物品没有自定义价格，则使用默认物品出售价格\n§a请选择要进行的操作:`
    )
    .button("§w浏览自定义物品出售价格", "textures/icons/quest_chest")
    .button("§w手动修改物品出售价格", "textures/icons/edit2")
    .button("§w搜索物品出售价格", "textures/ui/magnifyingGlass")
    .button("§w删除所有自定义物品出售价格", "textures/icons/deny")
    .button("§w返回", "textures/icons/back");

  form.show(player).then((res) => {
    if (res.canceled) return;
    switch (res.selection) {
      case 0:
        showItemPricesWithPagination(player, 1);
        break;
      case 1:
        openModifyItemPriceForm(player);
        break;
      case 2:
        openSearchItemPriceForm(player);
        break;
      case 3:
        openResetPricesConfirmForm(player);
        break;
      case 4:
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
    const defaultPrice = itemPriceDb.getDefaultPrice(itemId);
    const priceIndicator = price > defaultPrice ? "§a↑" : price < defaultPrice ? "§c↓" : "§e=";
    const itemTexture = dynamicMatchIconPath(displayName);
    const itemNameRawMessage: RawMessage = {
      rawtext: [
        {
          text: "§t",
        },
        {
          translate: getItemLocalizationKey(itemId),
        },
        {
          text: `\n§e${price} 金币 ${priceIndicator} 默认:${defaultPrice}`,
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
  const defaultPrice = itemPriceDb.getDefaultPrice(itemId);
  const isCustomPrice = itemPriceDb.hasCustomPrice(itemId);

  const formTitleRawMessage: RawMessage = {
    rawtext: [
      {
        text: "§w",
      },
      {
        text: "编辑物品出售价格 - ",
      },
      {
        translate: getItemLocalizationKey(itemId),
      },
    ],
  };

  form.title(formTitleRawMessage);

  if (isCustomPrice) {
    form.body(
      `§a当前自定义物品出售价格: §e${currentPrice} §a金币\n§a默认物品出售价格: §e${defaultPrice} §a金币\n§a请选择操作:`
    );
    form.button("§w修改自定义物品出售价格", "textures/icons/edit2");
    form.button("§w删除自定义物品出售价格（恢复默认）", "textures/icons/deny");
  } else {
    form.body(`§a当前使用默认物品出售价格: §e${currentPrice} §a金币\n§a请选择操作:`);
    form.button("§w设置自定义物品出售价格", "textures/icons/add");
  }

  form.button("§w返回", "textures/icons/back");

  form.show(player).then((res) => {
    if (res.canceled) {
      showItemPricesWithPagination(player, returnPage);
      return;
    }

    switch (res.selection) {
      case 0:
        // 修改/设置自定义价格
        openModifyCustomPriceForm(player, itemId, currentPrice, returnPage);
        break;
      case 1:
        if (isCustomPrice) {
          // 删除自定义物品出售价格
          itemPriceDb.removePrice(itemId);
          openDialogForm(
            player,
            {
              title: "删除成功",
              desc: `§a已删除 §b${displayName} §a的自定义物品出售价格，恢复使用默认物品出售价格 §e${defaultPrice} §a金币`,
            },
            () => showItemPricesWithPagination(player, returnPage)
          );
        }
        break;
      case 2:
        // 返回
        showItemPricesWithPagination(player, returnPage);
        break;
    }
  });
}

// 修改自定义物品出售价格表单
function openModifyCustomPriceForm(player: Player, itemId: string, currentPrice: number, returnPage: number): void {
  const form = new ModalFormData();
  const displayName = itemId.replace("minecraft:", "");
  const defaultPrice = itemPriceDb.getDefaultPrice(itemId);

  const formTitleRawMessage: RawMessage = {
    rawtext: [
      {
        text: "§w",
      },
      {
        text: "设置自定义物品出售价格 - ",
      },
      {
        translate: getItemLocalizationKey(itemId),
      },
    ],
  };

  form.title(formTitleRawMessage);
  form.textField(
    `§a默认物品出售价格: §e${defaultPrice} §a金币\n§a当前自定义物品出售价格: §e${currentPrice} §a金币\n§a请输入新的自定义物品出售价格:`,
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
    openDialogForm(
      player,
      {
        title: "设置成功",
        desc: `§a成功设置 §b${displayName} §a的自定义物品出售价格为 §e${newPrice} §a金币`,
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

  matchedItems.forEach(({ itemId, price, isCustom }) => {
    const displayName = itemId.replace("minecraft:", "");
    const defaultPrice = itemPriceDb.getDefaultPrice(itemId);
    const priceIndicator = isCustom ? (price > defaultPrice ? "§a↑" : price < defaultPrice ? "§c↓" : "§e=") : "§6默认";
    const itemNameRawMessage: RawMessage = {
      rawtext: [
        {
          text: "§t",
        },
        {
          translate: getItemLocalizationKey(itemId),
        },
        {
          text: `\n§e${price} 金币 ${priceIndicator}`,
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

// 修改物品出售价格表单
function openModifyItemPriceForm(player: Player): void {
  const form = new ModalFormData()
    .title("手动修改物品出售价格")
    .textField("§a物品ID", "例如: minecraft:diamond")
    .textField("§a自定义物品出售价格", "请输入自定义物品出售价格（留空则删除自定义物品出售价格）");

  form.show(player).then((res) => {
    if (res.canceled) return;
    const formValues = res.formValues;
    if (!formValues || formValues.length < 2) return;

    const itemId = formValues[0] as string;
    const priceStr = formValues[1] as string;

    if (!itemId || !itemId.trim()) {
      openDialogForm(
        player,
        {
          title: "错误",
          desc: "§c请输入有效的物品ID",
        },
        () => openModifyItemPriceForm(player)
      );
      return;
    }

    // 检查物品是否有默认物品出售价格
    const defaultPrice = itemPriceDb.getDefaultPrice(itemId);
    if (defaultPrice === 0) {
      openDialogForm(
        player,
        {
          title: "错误",
          desc: "§c没有搜到该物品，请检查物品ID是否输入正确，引号要英文引号，如：minecraft:diamond，代表钻石这个物品",
        },
        () => openModifyItemPriceForm(player)
      );
      return;
    }

    if (!priceStr || priceStr.trim() === "") {
      // 删除自定义物品出售价格
      if (itemPriceDb.hasCustomPrice(itemId)) {
        itemPriceDb.removePrice(itemId);
        openDialogForm(
          player,
          {
            title: "删除成功",
            desc: `§a已删除 §b${itemId} §a的自定义物品出售价格，恢复使用默认物品出售价格 §e${defaultPrice} §a金币`,
          },
          () => openItemPriceManageForm(player)
        );
      } else {
        openDialogForm(
          player,
          {
            title: "无需删除",
            desc: `§a该物品没有自定义物品出售价格，当前使用默认物品出售价格 §e${defaultPrice} §a金币`,
          },
          () => openItemPriceManageForm(player)
        );
      }
      return;
    }

    const price = parseInt(priceStr);
    if (isNaN(price) || price < 0) {
      openDialogForm(
        player,
        {
          title: "错误",
          desc: "§c请输入有效的非负整数价格",
        },
        () => openModifyItemPriceForm(player)
      );
      return;
    }

    itemPriceDb.setPrice(itemId, price);
    const priceIndicator = price > defaultPrice ? "§a↑" : price < defaultPrice ? "§c↓" : "§e=";
    openDialogForm(
      player,
      {
        title: "设置成功",
        desc: `§a成功设置 §b${itemId} §a的自定义物品出售价格为 §e${price} §a金币 ${priceIndicator}\n§a默认物品出售价格: §e${defaultPrice} §a金币`,
      },
      () => openItemPriceManageForm(player)
    );
  });
}
