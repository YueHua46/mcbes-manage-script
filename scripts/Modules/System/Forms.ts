import { GameMode, Player, RawMessage, world } from "@minecraft/server";
import { ActionFormData, MessageFormData, ModalFormData } from "@minecraft/server-ui";
import { color, colorCodes } from "../../utils/color";
import setting, { IModules, IValueType } from "./Setting";
import { useGetAllPlayer, useNotify, usePlayerByName } from "../../hooks/hooks";
import { openAllPlayerLandManageForm, openLandDetailForm, openLandListForm } from "../Land/Forms";
import land, { ILand } from "../Land/Land";
import { openConfirmDialogForm, openDialogForm } from "../Forms/Dialog";
import { openServerMenuForm } from "../Forms/Forms";
import { openPlayerWayPointListForm, openSearchWayPointForm, openWayPointListForm } from "../WayPoint/Forms";
import { openNotifyForms } from "../Notify/Forms";
import { emojiKeyToEmojiPath, getItemLocalizationKey, isNumber, SystemLog, toNumber } from "../../utils/utils";
import WayPoint from "../WayPoint/WayPoint";
import { defaultSetting } from "./Setting";
import { officeShopForm } from "../Economic/OfficeShop/OfficeShopForm";
import ChestFormData from "../ChestUI/ChestForms";
import { GlyphKey, glyphKeys, glyphList, glyphMap } from "../../glyphMap";
import { officeShopSettingForm } from "../Economic/OfficeShop/OfficeShopSettingForm";
import { memberManager } from "./TrialMode";
import economic from "../Economic/Economic";
import { landAreas } from "../Land/Event";
import monitorLog from "../Monitor/MonitorLog";
import itemPriceDb from "../Economic/ItemPriceDatabase";
import { dynamicMatchIconPath } from "../../utils/texturePath";

// 创建搜索玩家领地表单
function createSearchLandForm() {
  const form = new ModalFormData();
  form.title("搜索玩家领地");
  form.textField("玩家名称", "请输入要搜索的玩家名称");
  form.submitButton("搜索");
  return form;
}

// 打开搜索玩家领地表单
export function openSearchLandForm(player: Player) {
  const form = createSearchLandForm();

  form.show(player).then((data) => {
    if (data.cancelationReason) return;
    const { formValues } = data;
    if (formValues?.[0]) {
      const playerName = formValues[0].toString();
      const playerLands = land.getPlayerLands(playerName);
      if (playerLands.length === 0) {
        openDialogForm(
          player,
          {
            title: "搜索结果",
            desc: color.red("未找到该玩家的领地"),
          },
          () => openSearchLandForm(player)
        );
      } else {
        openSearchResultsForm(player, playerLands, playerName);
      }
    }
  });
}

// 打开搜索结果表单
const openSearchResultsForm = (player: Player, lands: ILand[], playerName: string, page: number = 1) => {
  const form = new ActionFormData();

  form.title(`搜索结果 - ${playerName}`);
  const totalPages = Math.ceil(lands.length / 10);
  const start = (page - 1) * 10;
  const end = start + 10;
  const currentPageLands = lands.slice(start, end);

  currentPageLands.forEach((landData) => {
    form.button(landData.name, "textures/ui/World");
  });

  let previousButtonIndex = currentPageLands.length;
  let nextButtonIndex = currentPageLands.length;
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

  form.body(`第 ${page} 页 / 共 ${totalPages} 页`);

  form.show(player).then((data) => {
    if (data.cancelationReason) return;
    const selectionIndex = data.selection;
    if (selectionIndex === null || selectionIndex === undefined) return;

    // 当前页的领地数量
    const currentPageLandsCount = currentPageLands.length;

    if (selectionIndex < currentPageLandsCount) {
      // 选择的是某个领地
      openLandDetailForm(player, currentPageLands[selectionIndex], false);
    } else if (selectionIndex === previousButtonIndex - 1 && page > 1) {
      // 选择的是"上一页"
      openSearchResultsForm(player, lands, playerName, page - 1);
    } else if (selectionIndex === nextButtonIndex - 1 && page < totalPages) {
      // 选择的是"下一页"
      openSearchResultsForm(player, lands, playerName, page + 1);
    } else if (selectionIndex === nextButtonIndex) {
      // 选择的是"返回"
      openSearchLandForm(player);
    }
  });
};

// 打开搜索玩家坐标点表单
export const openSearchPlayerWayPointForm = (player: Player) => {
  const form = new ModalFormData();
  form.title("搜索玩家坐标点");
  form.textField("玩家名称", "请输入要搜索的玩家名称");
  form.submitButton("搜索");

  form.show(player).then((data) => {
    if (data.cancelationReason) return;
    const { formValues } = data;
    if (formValues?.[0]) {
      const playerName = formValues[0].toString();
      const wayPoints = WayPoint.getPointsByPlayer(playerName);
      if (wayPoints.length === 0) {
        openDialogForm(
          player,
          {
            title: "搜索结果",
            desc: color.red("未找到该玩家的坐标点或该玩家不存在"),
          },
          () => openSearchPlayerWayPointForm(player)
        );
      } else {
        openPlayerWayPointListForm(player, playerName, 1, true, () => openWayPointManageMenu(player));
      }
    }
  });
};

// 坐标点管理菜单
export const openWayPointManageMenu = (player: Player) => {
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
        openSearchPlayerWayPointForm(player);
        break;
      case 2:
        openSystemSettingForm(player);
        break;
    }
  });
};

// 打开玩家坐标点管理表单
export const openPlayerWayPointManageForm = (player: Player, page: number = 1) => {
  const form = new ActionFormData();
  form.title("§w玩家坐标点管理");

  // 从数据库中获取所有有坐标点记录的玩家列表
  const players = WayPoint.getWayPointPlayers();

  // 计算分页信息
  const pageSize = 10; // 每页显示10个玩家
  const totalPages = Math.ceil(players.length / pageSize);
  const start = (page - 1) * pageSize;
  const end = Math.min(start + pageSize, players.length);
  const currentPagePlayers = players.slice(start, end);

  // 为当前页的每个玩家添加按钮
  currentPagePlayers.forEach((playerName) => {
    const waypoints = WayPoint.getPointsByPlayer(playerName);
    const publicCount = waypoints.filter((p) => p.type === "public").length;
    const privateCount = waypoints.filter((p) => p.type === "private").length;
    form.button(
      `${color.blue(playerName)} 的所有坐标点\n ${color.darkPurple("公共坐标点:")} ${publicCount} | ${color.darkRed(
        "私有坐标点:"
      )} ${privateCount}`,
      "textures/ui/icon_steve"
    );
  });

  // 添加分页按钮
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

    // 当前页的玩家数量
    const currentPagePlayersCount = currentPagePlayers.length;

    if (selectionIndex < currentPagePlayersCount) {
      // 选择了某个玩家
      const selectedPlayerName = currentPagePlayers[selectionIndex];
      openPlayerWayPointListForm(player, selectedPlayerName, 1, true, () => openPlayerWayPointManageForm(player, page));
    } else if (selectionIndex === previousButtonIndex - 1 && page > 1) {
      // 点击了"上一页"
      openPlayerWayPointManageForm(player, page - 1);
    } else if (selectionIndex === nextButtonIndex - 1 && page < totalPages) {
      // 点击了"下一页"
      openPlayerWayPointManageForm(player, page + 1);
    } else if ((page === 1 && selectionIndex === nextButtonIndex) || (page > 1 && selectionIndex === nextButtonIndex)) {
      // 点击了"返回"
      openWayPointManageMenu(player);
    }
  });
};

// 打开领地管理表单
export const openLandManageForm = (player: Player) => {
  const form = new ActionFormData();
  form.title("§w领地管理");

  form.button("§w所有玩家领地管理", "textures/ui/icon_new");
  form.button("§w删除当前所在区域领地", "textures/icons/deny");
  // form.button("§w搜索玩家领地", "textures/ui/magnifyingGlass");
  form.button("§w创建领地时每方块需花费金币管理", "textures/packs/15174544");
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    switch (data.selection) {
      case 0:
        openAllPlayerLandManageForm(player);
        break;
      case 1:
        const { insideLand, isInside } = land.testLand(
          player.dimension.getBlock(player.location)?.location ?? player.location,
          player.dimension.id
        );
        if (!isInside)
          return openDialogForm(player, { title: "领地删除失败", desc: color.red("你不在任何领地内！") }, () =>
            openLandManageForm(player)
          );
        const res = land.removeLand(insideLand?.name ?? "");
        if (typeof res === "string") return openDialogForm(player, { title: "领地删除失败", desc: color.red(res) });
        openDialogForm(player, {
          title: "领地删除成功",
          desc: color.green(`${insideLand?.owner} 的领地 ${insideLand?.name} 删除成功！`),
        });
        break;
      case 2:
        openCreateLand1BlockPerPrice(player);
        break;
      case 3:
        openSystemSettingForm(player);
        break;
    }
  });
};
// 打开创建领地每方块价格设置表单
export const openCreateLand1BlockPerPrice = (player: Player) => {
  const form = new ModalFormData();
  form.title("§w创建领地每方块价格设置");
  form.textField("价格", "请输入价格");
  form.submitButton("§w确定");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    const { formValues } = data;
    // 存在且可转换为数字
    if (formValues?.[0] && !isNaN(toNumber(formValues?.[0] as string))) {
      const price = formValues[0].toString();
      setting.setState("land1BlockPerPrice", price);
      openDialogForm(
        player,
        { title: "创建领地每方块价格设置成功", desc: color.green("创建领地每方块价格设置成功！") },
        () => openSystemSettingForm(player)
      );
    }
  });
};

// 打开服务器名称设置表单
export const openServerNameForm = (player: Player) => {
  const form = new ModalFormData();
  form.title("§w设置服务器名称");
  form.textField("服务器名称", "请输入服务器名称");
  form.submitButton("§w确定");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    const { formValues } = data;
    if (formValues?.[0]) {
      const serverName = formValues[0].toString();
      world.setDynamicProperty("serverName", serverName);
      openDialogForm(player, { title: "服务器名称设置成功", desc: color.green("服务器名称设置成功！") }, () =>
        openSystemSettingForm(player)
      );
    } else {
      useNotify("chat", player, "§c服务器名称设置失败");
    }
  });
};

// 打开功能开关表单
export const openFunctionSwitchForm = (player: Player) => {
  const form = new ModalFormData();

  const buttons: { text: string; id: IModules; state: IValueType }[] = [
    {
      text: "§w玩家操作",
      id: "player",
      state: setting.getState("player") ?? true,
    },
    {
      text: "§w领地功能",
      id: "land",
      state: setting.getState("land") ?? true,
    },
    {
      text: "§w坐标点管理",
      id: "wayPoint",
      state: setting.getState("wayPoint") ?? true,
    },
    {
      text: "§w经济系统",
      id: "economy",
      state: setting.getState("economy") ?? true,
    },
    {
      text: "§w其他功能",
      id: "other",
      state: setting.getState("other") ?? true,
    },
    {
      text: "§w帮助",
      id: "help",
      state: setting.getState("help") ?? true,
    },
    {
      text: "§w掉落物清理",
      id: "killItem",
      state: setting.getState("killItem") ?? true,
    },
    {
      text: "§w随机传送",
      id: "randomTeleport",
      state: setting.getState("randomTeleport") ?? true,
    },
    {
      text: "§w回到死亡点",
      id: "backToDeath",
      state: setting.getState("backToDeath") ?? true,
    },
  ];
  form.title("§w功能开关");
  buttons.forEach(({ text, state }) => {
    form.toggle(text, {
      defaultValue: state === true,
      tooltip: state === true ? "§a已开启" : "§c已关闭",
    });
  });

  form.submitButton("§w确定");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    const { formValues } = data;
    if (formValues) {
      formValues.forEach((value, index) => {
        if (value) setting.turnOn(buttons[index].id);
        else setting.turnOff(buttons[index].id);
      });
      openDialogForm(player, { title: "功能开关设置成功", desc: color.green("功能开关设置成功！") }, () =>
        openSystemSettingForm(player)
      );
    } else {
      useNotify("chat", player, "§c功能开关设置失败");
    }
  });
};

export const openKillItemSettingForm = (player: Player) => {
  SystemLog("openKillItemSettingForm enter");
  const form = new ModalFormData();
  const killItemAmount = (setting.getState("killItemAmount") as string) || "1500";
  try {
    SystemLog("killItemAmount -->" + killItemAmount);
    form.title("§w触发掉落物清理的上限设置");
    form.textField("触发掉落物清理的数量上限", killItemAmount.toString());
    form.submitButton("§w确定");
    form.show(player).then((data) => {
      if (data.canceled || data.cancelationReason) return;
      const { formValues } = data;
      if (formValues?.[0]) {
        const num = formValues[0].toString();
        setting.setState("killItemAmount", num);
        openDialogForm(
          player,
          {
            title: "掉落物清理设置成功",
            desc: color.green("掉落物清理设置成功！当世界当中的掉落物数量超过设置数量时，会触发自动清理掉落物。"),
          },
          () => openSystemSettingForm(player)
        );
      } else {
        useNotify("chat", player, "§c掉落物清理设置失败");
      }
    });
  } catch (error) {
    SystemLog("openKillItemSettingForm error -->" + error);
  }
};

export const openRandomTpSettingForm = (player: Player) => {
  const form = new ModalFormData();
  const randomTpRange = setting.getState("randomTpRange") || 50000;
  form.title("§w设置随机传送范围");
  form.textField("随机传送范围", randomTpRange.toString());
  form.submitButton("§w确定");
  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    const { formValues } = data;
    if (formValues?.[0]) {
      const num = formValues[0].toString();
      setting.setState("randomTpRange", num);
    }
  });
};

// 设置每个玩家最大领地数量的表单
export const openMaxLandPerPlayerSettingForm = (player: Player) => {
  const form = new ModalFormData();
  form.title("设置玩家最大领地数量");

  const currentValue = setting.getState("maxLandPerPlayer") || defaultSetting.maxLandPerPlayer;

  form.textField(color.white("每个玩家最大领地数量"), color.gray("请输入每个玩家最大可创建的领地数量"), {
    defaultValue: currentValue.toString(),
    tooltip: color.gray("请输入一个正整数"),
  });

  form.show(player).then((data) => {
    if (data.cancelationReason) return;
    const { formValues } = data;

    if (formValues && formValues[0]) {
      const value = formValues[0].toString();
      const numValue = parseInt(value);

      if (isNaN(numValue) || numValue <= 0) {
        return openDialogForm(
          player,
          {
            title: "设置失败",
            desc: color.red("请输入有效的正整数！"),
          },
          () => openMaxLandPerPlayerSettingForm(player)
        );
      }

      setting.setState("maxLandPerPlayer", value);

      openDialogForm(
        player,
        {
          title: "设置成功",
          desc: color.green(`成功设置每个玩家最大领地数量为 ${value}`),
        },
        () => openCommonSettingForm(player)
      );
    }
  });
};
// 设置领地方块上限
export const openLandBlockLimitForm = (player: Player) => {
  const form = new ModalFormData();
  const maxLandBlocks = (setting.getState("maxLandBlocks") as string) || "30000";
  form.title("§w设置领地方块上限");
  form.textField("领地方块上限", maxLandBlocks.toString());
  form.submitButton("§w确定");
  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    const { formValues } = data;
    if (formValues?.[0]) {
      const num = formValues[0].toString();
      setting.setState("maxLandBlocks", num);
      openDialogForm(
        player,
        {
          title: "领地方块上限设置成功",
          desc: color.green("领地方块上限设置成功！创建领地时方块数量不能超过设置的上限。"),
        },
        () => openSystemSettingForm(player)
      );
    } else {
      useNotify("chat", player, "§c领地方块上限设置失败");
    }
  });
};

// 设置 chat 聊天颜色的表单
export const openChatColorForm = (player: Player) => {
  const form = new ActionFormData();
  form.title("§w设置聊天颜色");
  form.body("§w请选择聊天颜色");
  const chatColors = [
    {
      text: "§w玩家名字颜色",
      icon: "textures/ui/text_color_paintbrush",
      action: () => openChatColorSelectForm(player, "playerName"),
    },
    {
      text: "§w玩家聊天颜色",
      icon: "textures/ui/comment",
      action: () => openChatColorSelectForm(player, "playerChat"),
    },
  ];
  chatColors.forEach(({ text, icon, action }) => {
    form.button(text, icon);
  });
  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    const selectionIndex = data.selection;
    if (selectionIndex === null || selectionIndex === undefined) return;
    chatColors[selectionIndex].action();
  });
};
// 打开聊天颜色选择表单
export const openChatColorSelectForm = (player: Player, type: "playerName" | "playerChat") => {
  const form = new ActionFormData();
  form.title("§w选择颜色");
  form.body("§w请选择颜色");
  const colors = [
    color.white("白色"),
    color.red("红色"),
    color.green("绿色"),
    color.blue("蓝色"),
    color.yellow("黄色"),
    color.aqua("青色"),
    color.lightPurple("浅紫色"),
    color.darkPurple("深紫色"),
    color.darkRed("深红色"),
    color.darkGreen("深绿色"),
    color.darkBlue("深蓝色"),
    color.darkAqua("深青色"),
    color.black("黑色"),
    color.gold("金色"),
    color.gray("灰色"),
    color.darkGray("深灰色"),
  ];
  colors.forEach((color) => {
    form.button(color);
  });
  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    const selectionIndex = data.selection;
    if (selectionIndex === null || selectionIndex === undefined) return;
    const _color = colors[selectionIndex];
    if (type === "playerName") {
      const colorCode = _color.match(/§./g)?.join("") ?? "";
      setting.setState("playerNameColor", colorCode);
      openDialogForm(
        player,
        {
          title: "设置成功",
          desc: color.green(`成功设置玩家名字颜色为 ${_color}`),
        },
        () => openCommonSettingForm(player)
      );
    } else {
      // 筛选出颜色
      const colorCode = _color.match(/§./g)?.join("") ?? "";
      setting.setState("playerChatColor", colorCode);
      openDialogForm(
        player,
        {
          title: "设置成功",
          desc: color.green(`成功设置玩家聊天颜色为 ${_color}`),
        },
        () => openCommonSettingForm(player)
      );
    }
  });
};

// 打开通用系统设置表单
/**
 * 功能点：
 * 1. 设置掉落物清理数量
 * 2. 设置随机传送范围
 * 3. 设置服务器名称
 * 4. 设置服务器通知
 * 5. 设置创建领地时，领地内方块上限
 * 6. 设置chat聊天颜色（玩家名字颜色和玩家聊天颜色）
 */
export const openCommonSettingForm = (player: Player) => {
  const form = new ActionFormData();
  form.title("§w通用系统设置");
  const buttons = [
    {
      text: "设置掉落物清理数量",
      icon: "textures/ui/icon_fall",
      action: () => openKillItemSettingForm(player),
    },
    {
      text: "设置随机传送范围",
      icon: "textures/ui/RTX_Sparkle",
      action: () => openRandomTpSettingForm(player),
    },
    {
      text: "设置服务器名称",
      icon: "textures/ui/hanging_sign",
      action: () => openServerNameForm(player),
    },
    {
      text: "设置服务器通知",
      icon: "textures/packs/023-caution",
      action: () => openNotifyForms(player),
    },
    // 新增领地设置主按钮
    {
      text: "领地设置",
      icon: "textures/ui/icon_recipe_construction",
      action: () => openLandSettingsForm(player),
    },
    // 新增坐标点上限设置按钮
    {
      text: "设置玩家最大坐标点数量",
      icon: "textures/ui/realmsIcon",
      action: () => openMaxWayPointPerPlayerSettingForm(player),
    },
    {
      text: "设置聊天颜色",
      icon: "textures/ui/color_picker",
      action: () => openChatColorForm(player),
    },
    {
      text: "试玩模式设置",
      icon: "textures/ui/permissions_visitor_hand_hover",
      action: () => openTrialModeMainForm(player),
    },
    {
      text: "一键砍树/挖矿设置",
      icon: "textures/ui/haste_effect",
      action: () => openOneClickMineTreeSettingForm(player),
    },
  ];
  buttons.forEach(({ text, icon }) => form.button(text, icon));

  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    switch (data.selection) {
      case buttons.length:
        openSystemSettingForm(player);
        break;
      default:
        if (typeof data.selection === "number") buttons[data.selection].action();
        break;
    }
  });
};
// 打开系统设置表单
export const openSystemSettingForm = (player: Player) => {
  const form = new ActionFormData();
  form.title("§w服务器设置");

  const buttons = [
    {
      text: "功能开关",
      icon: "textures/ui/craft_toggle_on_hover",
      action: () => openFunctionSwitchForm(player),
    },
    {
      text: "坐标点管理",
      icon: "textures/packs/14321635",
      action: () => openWayPointManageMenu(player),
    },
    {
      text: "经济管理",
      icon: "textures/packs/12873003",
      action: () => openEconomyMenuForm(player),
    },
    {
      text: "领地管理",
      icon: "textures/packs/14828093",
      action: () => openLandManageForm(player),
    },
    {
      text: "官方商店设置",
      icon: "textures/packs/024-disco-ball",
      action: () => officeShopSettingForm.openOfficeShopSettingMainMenu(player),
    },
    {
      text: "通用系统设置",
      icon: "textures/ui/settings_glyph_color_2x",
      action: () => openCommonSettingForm(player),
    },
    // TODO: 监控日志管理
    // {
    //   text: "监控日志管理（仅限VPS服务器，详细使用方式必须看视频教程来操作）",
    //   icon: "textures/ui/settings_glyph_color",
    //   action: () => monitorLog.openMonitorLogMenu(player),
    // },
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
        if (typeof data.selection === "number") buttons[data.selection].action();
        break;
    }
  });
};

// 新增添加VIP会员的表单
export const openAddVipMemberForm = (player: Player) => {
  const form = new ModalFormData();
  form.title("§w添加正式会员");

  // 获取所有在线玩家
  const allPlayers = world.getPlayers().map((p) => p.name);

  form.dropdown("§w选择玩家", allPlayers);
  form.submitButton("§w确认");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;

    const { formValues } = data;
    if (formValues?.[0] !== undefined) {
      const selectedPlayerName = allPlayers[Number(formValues[0])];
      const targetPlayer = world.getPlayers().find((p) => p.name === selectedPlayerName);

      if (targetPlayer) {
        targetPlayer.addTag("vip");
        targetPlayer.removeTag("trialed");
        targetPlayer.setGameMode(GameMode.Survival);

        openDialogForm(
          player,
          {
            title: "添加成功",
            desc: color.green(`已成功将 ${selectedPlayerName} 添加为正式会员!`),
          },
          () => openTrialModeMainForm(player)
        );
      }
    }
  });
};

// 修改后的试玩模式主表单
// export const openTrialModeMainForm = (player: Player) => {
//   const form = new ActionFormData();
//   form.title("§w试玩模式管理");

//   form.button("§w试玩模式设置", "textures/ui/permissions_visitor_hand_hover");
//   form.button("§w添加正式会员", "textures/ui/village_hero_effect");
//   form.button("§w移除正式会员", "textures/icons/deny");
//   form.button("§w返回", "textures/icons/back");

//   form.show(player).then((data) => {
//     if (data.canceled || data.cancelationReason) return;

//     switch (data.selection) {
//       case 0:
//         openTrialModeSettingForm(player);
//         break;
//       case 1:
//         openAddVipMemberForm(player);
//         break;
//       case 2:
//         openRemoveVipMemberForm(player);
//         break;
//       case 3:
//         openCommonSettingForm(player);
//         break;
//     }
//   });
// };

// 修改原来的试玩模式设置表单（保持原有功能）
export const openTrialModeSettingForm = (player: Player) => {
  const form = new ModalFormData();
  form.title("§w试玩模式设置");

  // 获取当前设置
  const isEnabled = (setting.getState("trialMode") as boolean) ?? (defaultSetting.trialMode as boolean);
  const duration = setting.getState("trialModeDuration") ?? defaultSetting.trialModeDuration;

  // 添加表单元素
  form.toggle("§w启用试玩模式", {
    defaultValue: isEnabled,
    tooltip: `当前状态：${isEnabled ? "启用" : "禁用"}`,
  });
  form.textField("§w试玩时长(秒) 玩家在线达到此时长后，会自动退出试玩模式（变为冒险模式）", "请输入试玩时长(秒)", {
    defaultValue: duration.toString(),
    tooltip: `当前时长：${duration}秒`,
  });
  form.submitButton("§w确认");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    const { formValues } = data;
    if (formValues) {
      // 保存设置
      setting.setState("trialMode", formValues[0] as boolean);
      setting.setState("trialModeDuration", formValues[1]?.toString() ?? "3600");

      openDialogForm(player, { title: "设置成功", desc: color.green("试玩模式设置已保存!") }, () =>
        openTrialModeMainForm(player)
      );
    }
  });
};

// 新增删除VIP会员的表单
// export const openRemoveVipMemberForm = (player: Player) => {
//   const form = new ModalFormData();
//   form.title("§w删除正式会员");

//   // 获取所有VIP玩家
//   const vipPlayers = world
//     .getPlayers()
//     .filter((p) => p.hasTag("vip"))
//     .map((p) => p.name);

//   if (vipPlayers.length === 0) {
//     return openDialogForm(
//       player,
//       {
//         title: "删除正式会员",
//         desc: color.red("当前没有正式会员可删除"),
//       },
//       () => openTrialModeMainForm(player)
//     );
//   }

//   form.dropdown("§w选择VIP会员", vipPlayers);
//   form.submitButton("§w确认删除");

//   form.show(player).then((data) => {
//     if (data.canceled || data.cancelationReason) return;

//     const { formValues } = data;
//     if (formValues?.[0] !== undefined) {
//       const selectedPlayerName = vipPlayers[Number(formValues[0])];
//       const targetPlayer = world.getPlayers().find((p) => p.name === selectedPlayerName);

//       if (targetPlayer) {
//         targetPlayer.removeTag("vip");

//         openDialogForm(
//           player,
//           {
//             title: "删除成功",
//             desc: color.green(`已成功将 ${selectedPlayerName} 从正式会员中移除!`),
//           },
//           () => openTrialModeMainForm(player)
//         );
//       }
//     }
//   });
// };

export const openMaxWayPointPerPlayerSettingForm = (player: Player) => {
  const form = new ModalFormData();
  form.title("设置玩家最大坐标点数量");

  const currentValue = setting.getState("maxPointsPerPlayer") || defaultSetting.maxPointsPerPlayer;

  form.textField(color.white("每个玩家最大坐标点数量"), color.gray("请输入每个玩家最大可创建的坐标点数量"), {
    defaultValue: currentValue.toString(),
    tooltip: color.gray(`当前值: ${currentValue}`),
  });

  form.show(player).then((data) => {
    if (data.cancelationReason) return;
    const { formValues } = data;

    if (formValues && formValues[0]) {
      const value = formValues[0].toString();
      const numValue = parseInt(value);

      if (isNaN(numValue) || numValue <= 0) {
        return openDialogForm(
          player,
          {
            title: "设置失败",
            desc: color.red("请输入有效的正整数！"),
          },
          () => openMaxWayPointPerPlayerSettingForm(player)
        );
      }

      setting.setState("maxPointsPerPlayer", value);

      openDialogForm(
        player,
        {
          title: "设置成功",
          desc: color.green(`成功设置每个玩家最大坐标点数量为 ${value}`),
        },
        () => openCommonSettingForm(player)
      );
    }
  });
};
// 领地设置主表单
export const openLandSettingsForm = (player: Player) => {
  const form = new ActionFormData();
  form.title("§w领地设置");

  const buttons = [
    {
      text: "设置领地方块上限",
      icon: "textures/ui/random_dice",
      action: () => openLandBlockLimitForm(player),
    },
    {
      text: "设置玩家最大领地数量",
      icon: "textures/ui/icon_new",
      action: () => openMaxLandPerPlayerSettingForm(player),
    },
    {
      text: "§w返回",
      icon: "textures/icons/back",
      action: () => openCommonSettingForm(player),
    },
  ];

  buttons.forEach(({ text, icon }) => form.button(text, icon));

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    const selectionIndex = data.selection;
    if (selectionIndex === null || selectionIndex === undefined) return;

    if (selectionIndex < buttons.length - 1) {
      buttons[selectionIndex].action();
    } else {
      openCommonSettingForm(player);
    }
  });
};

export const openOneClickMineTreeSettingForm = (player: Player) => {
  const form = new ModalFormData();
  const enableTreeCut = setting.getState("enableTreeCutOneClick") === true;
  const enableDigOre = setting.getState("enableDigOreOneClick") === true;

  form.title("§w一键砍树/挖矿设置");
  form.toggle("开启一键砍树", {
    defaultValue: enableTreeCut,
    tooltip: "开启后，蹲下，然后拿着对应斧头工具可以快速砍树",
  });
  form.toggle("开启一键挖矿", {
    defaultValue: enableDigOre,
    tooltip: "开启后，蹲下，然后拿着对应镐子工具可以快速挖矿石",
  });
  form.submitButton("§w确定");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    const { formValues } = data;
    if (formValues) {
      setting.setState("enableTreeCutOneClick", !!formValues[0]);
      setting.setState("enableDigOreOneClick", !!formValues[1]);
      openDialogForm(
        player,
        {
          title: "设置成功",
          desc: color.green("一键砍树/挖矿设置已更新！"),
        },
        () => openCommonSettingForm(player)
      );
    } else {
      useNotify("chat", player, "§c设置失败");
    }
  });
};

export const openTrialModeMainForm = (player: Player) => {
  const form = new ActionFormData();
  form.title("§w试玩模式管理");

  form.button("§w试玩模式设置", "textures/ui/settings_glyph_color_2x");
  form.button("§w会员管理", "textures/ui/icon_multiplayer");
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    switch (data.selection) {
      case 0:
        openTrialModeSettingForm(player);
        break;
      case 1:
        openMemberManageForm(player);
        break;
      case 2:
        openSystemSettingForm(player);
        break;
    }
  });
};

// 添加会员管理表单
export const openMemberManageForm = (player: Player) => {
  const form = new ActionFormData();
  form.title("§w会员管理");

  form.button("§w添加会员", "textures/icons/add");
  form.button("§w移除会员", "textures/icons/deny");
  form.button("§w查看会员列表", "textures/icons/friends");
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    switch (data.selection) {
      case 0:
        openAddMemberForm(player);
        break;
      case 1:
        openRemoveMemberForm(player);
        break;
      case 2:
        openMemberListForm(player);
        break;
      case 3:
        openTrialModeMainForm(player);
        break;
    }
  });
};

// 添加会员表单
export const openAddMemberForm = (player: Player) => {
  const form = new ModalFormData();
  form.title("§w添加会员");
  form.textField("§w玩家名称", "请输入要添加为会员的玩家名称");
  form.submitButton("§w确认");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    const { formValues } = data;
    if (formValues && formValues[0]) {
      const playerName = formValues[0].toString();
      const result = memberManager.addMember(playerName);
      if (result) {
        openDialogForm(
          player,
          {
            title: "添加成功",
            desc: color.green(`已成功将 ${color.yellow(playerName)} 添加为会员！`),
          },
          () => openMemberManageForm(player)
        );
      } else {
        openDialogForm(
          player,
          {
            title: "添加失败",
            desc: color.red("添加会员失败，请检查玩家名称是否正确！"),
          },
          () => openAddMemberForm(player)
        );
      }
    }
  });
};

// 移除会员表单
export const openRemoveMemberForm = (player: Player) => {
  const form = new ModalFormData();
  form.title("§w移除会员");
  form.textField("§w玩家名称", "请输入要移除会员资格的玩家名称");
  form.submitButton("§w确认");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    const { formValues } = data;
    if (formValues && formValues[0]) {
      const playerName = formValues[0].toString();
      const result = memberManager.removeMember(playerName);
      if (result) {
        openDialogForm(
          player,
          {
            title: "移除成功",
            desc: color.green(`已成功移除 ${color.yellow(playerName)} 的会员资格！`),
          },
          () => openMemberManageForm(player)
        );
      } else {
        openDialogForm(
          player,
          {
            title: "移除失败",
            desc: color.red("移除会员失败，请检查玩家名称是否正确！"),
          },
          () => openRemoveMemberForm(player)
        );
      }
    }
  });
};

// 会员列表表单
export const openMemberListForm = (player: Player, page: number = 1) => {
  const form = new ActionFormData();
  form.title("§w会员列表");

  const members = memberManager.getAllMembers();

  if (members.length === 0) {
    form.body(color.yellow("当前没有任何会员"));
  } else {
    // 分页显示
    const pageSize = 10;
    const totalPages = Math.ceil(members.length / pageSize);
    const start = (page - 1) * pageSize;
    const end = Math.min(start + pageSize, members.length);
    const currentPageMembers = members.slice(start, end);

    form.body(`第 ${page} 页 / 共 ${totalPages} 页`);

    // 显示当前页的会员
    currentPageMembers.forEach((memberName) => {
      form.button(memberName, "textures/ui/icon_steve");
    });

    // 添加分页按钮
    if (page > 1) {
      form.button("§w上一页", "textures/icons/left_arrow");
    }

    if (page < totalPages) {
      form.button("§w下一页", "textures/icons/right_arrow");
    }
  }

  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;

    const members = memberManager.getAllMembers();
    const pageSize = 10;
    const totalPages = Math.ceil(members.length / pageSize);
    const currentPageSize = Math.min(pageSize, members.length - (page - 1) * pageSize);

    if (members.length === 0) {
      // 如果没有会员，只有一个返回按钮
      if (data.selection === 0) {
        openMemberManageForm(player);
      }
    } else {
      // 有会员的情况
      if (data.selection && data.selection < currentPageSize) {
        // 点击了会员名称，暂时不做任何操作，直接返回列表
        openMemberListForm(player, page);
      } else if (page > 1 && data.selection === currentPageSize) {
        // 点击了上一页
        openMemberListForm(player, page - 1);
      } else if (
        page < totalPages &&
        ((page > 1 && data.selection === currentPageSize + 1) || (page === 1 && data.selection === currentPageSize))
      ) {
        // 点击了下一页
        openMemberListForm(player, page + 1);
      } else {
        // 点击了返回
        openMemberManageForm(player);
      }
    }
  });
};

// 经济系统管理
export const openEconomyMenuForm = (player: Player) => {
  const form = new ActionFormData();
  form.title("§w经济系统管理");

  form.button("§w设置玩家金币数量", "textures/packs/13107521");
  form.button("§w设置玩家可获得的每日金币上限", "textures/packs/004-trophy");
  form.button("§w设置新玩家初始金币数量", "textures/packs/15174541");
  form.button("§w物品出售价格管理", "textures/packs/12065264");
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled) return;
    switch (data.selection) {
      case 0:
        openSetPlayerMoneyForm(player);
        break;
      case 1:
        openManageDailyGoldLimitForm(player);
        break;
      case 2:
        openSetStartingGoldForm(player);
        break;
      case 3:
        openItemPriceManageForm(player);
        break;
      case 4:
        openSystemSettingForm(player);
        break;
    }
  });
};

// 物品价格管理主界面
function openItemPriceManageForm(player: Player) {
  const customPricesCount = Object.keys(itemPriceDb.getAllCustomPrices()).length;
  const totalItemsCount = itemPriceDb.getAllDefaultItemIds().length;

  const form = new ActionFormData()
    .title("§w物品出售价格管理")
    .body(
      `§a当前状态:\n§e自定义物品出售价格: ${customPricesCount} 个\n§e默认物品出售价格: ${totalItemsCount} 个\n§e友情提示，对应物品没有自定义价格，则使用默认物品出售价格\n§a请选择要进行的操作:`
    )
    .button("§w浏览自定义物品出售价格", "textures/packs/12065264")
    .button("§w手动修改物品出售价格", "textures/icons/edit")
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
        openEconomyMenuForm(player);
        break;
    }
  });
}

// 分页显示自定义物品出售价格列表
function showItemPricesWithPagination(player: Player, page: number = 1) {
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
    // `§t${displayName}\n§e${price} 金币 ${priceIndicator} 默认:${defaultPrice}`;
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

    const selection = res.selection!;
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
function openEditItemPriceForm(player: Player, itemId: string, currentPrice: number, returnPage: number) {
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
    form.button("§w修改自定义物品出售价格", "textures/icons/edit");
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
function openModifyCustomPriceForm(player: Player, itemId: string, currentPrice: number, returnPage: number) {
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

    const priceStr = res.formValues![0] as string;
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
function openSearchItemPriceForm(player: Player) {
  const form = new ModalFormData();
  form.title("§w搜索物品出售价格");
  form.textField("§a物品名称或ID", "输入物品名称或ID的一部分");

  form.show(player).then((res) => {
    if (res.canceled) {
      openItemPriceManageForm(player);
      return;
    }

    const searchTerm = res.formValues![0] as string;
    if (!searchTerm.trim()) {
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
function showSearchResults(player: Player, searchTerm: string) {
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

    const selection = res.selection!;

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
function openResetPricesConfirmForm(player: Player) {
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
function resetAllPricesToDefault(player: Player) {
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

// 显示所有物品出售价格（兼容性保留，但建议使用搜索功能）
function showAllItemPrices(player: Player) {
  const messageForm = new MessageFormData();
  messageForm.title("物品出售价格列表");
  const prices = itemPriceDb.getAllPrices();
  let messageBody = "§e========物品出售价格列表========\n\n";
  Object.entries(prices).forEach(([itemId, price]) => {
    const isCustom = itemPriceDb.hasCustomPrice(itemId);
    const indicator = isCustom ? "§a[自定义]" : "§7[默认]";
    messageBody += `§b${itemId}§f: §e${price} §f金币 ${indicator}\n`;
  });
  messageBody += "§e========物品出售价格列表========\n\n";
  messageBody += "§a提示：建议使用搜索功能来查找特定物品";

  messageForm.body(messageBody);
  messageForm.button1("§w确定");
  messageForm.button2("§w返回");
  messageForm.show(player).then((res) => {
    if (res.canceled) return;
    if (res.selection === 0 || res.selection === 1) {
      openItemPriceManageForm(player);
    }
  });
}

// 修改物品出售价格表单
function openModifyItemPriceForm(player: Player) {
  const form = new ModalFormData()
    .title("手动修改物品出售价格")
    .textField("§a物品ID", "例如: minecraft:diamond")
    .textField("§a自定义物品出售价格", "请输入自定义物品出售价格（留空则删除自定义物品出售价格）");

  form.show(player).then((res) => {
    if (res.canceled) return;
    const [itemId, priceStr] = res.formValues as [string, string];

    if (!itemId) {
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

// 设置玩家金币数量表单
export const openSetPlayerMoneyForm = (player: Player) => {
  const allPlayer = useGetAllPlayer();
  const allPlayerNames = allPlayer.map((player) => player.name);

  const form = new ModalFormData();
  form.title("§w管理玩家金币数量");
  form.dropdown("§w玩家选择（和玩家名称二选一即可）", allPlayerNames, {
    defaultValueIndex: 0,
    tooltip: "选择要设置金币数量的玩家",
  });
  form.textField("§w玩家名称（和玩家选择二选一即可）", "请输入要设置金币数量的玩家名称");
  form.dropdown("§w操作类型", ["§w增加", "§w减少"], {
    defaultValueIndex: 0,
    tooltip: "选择操作类型",
  });
  form.textField("§w金币数量", "请输入要操作的金币数量", {
    defaultValue: "100",
    tooltip: "请输入要设置的金币数量",
  });
  form.submitButton("§w确认");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    const { formValues } = data;
    if (formValues) {
      // 获取玩家名称（二选一结果）
      const selectPlayerName = allPlayer[Number(formValues?.[0])].name;
      const inputPlayerName = formValues?.[1] as string;

      const playerName = inputPlayerName || selectPlayerName;
      const amount = parseInt(formValues[3]?.toString() ?? "0");
      const operation = formValues[2]?.toString() ?? "0";

      if (isNaN(amount) || amount <= 0) {
        openDialogForm(player, {
          title: "设置失败",
          desc: color.red("请输入有效的正整数！"),
        });
        return;
      }

      if (operation === "0") {
        economic.addGold(playerName, amount, "管理员增加金币数量", true);
      } else if (operation === "1") {
        economic.removeGold(playerName, amount, "管理员减少金币数量");
      }

      openDialogForm(
        player,
        {
          title: "操作成功",
          desc: color.green(
            `已成功将 ${color.yellow(playerName)} 的金币${operation === "0" ? "增加" : "减少"} ${color.green(
              amount.toString()
            )}`
          ),
        },
        () => openEconomyMenuForm(player)
      );
    }
  });
};

// 设置玩家默认金币数量
export const openSetStartingGoldForm = (player: Player) => {
  const form = new ModalFormData();
  form.title("§w设置新玩家默认金币数量");
  form.textField("§w金币数量", "请输入要设置的金币数量", {
    defaultValue: "500",
  });
  form.submitButton("§w确认");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;

    const amount = parseInt(data.formValues?.[0] as string);
    if (isNaN(amount) || amount <= 0) {
      openDialogForm(player, {
        title: "设置失败",
        desc: color.red("请输入有效的正整数！"),
      });
      return;
    }

    setting.setState("startingGold", amount.toString());
    openDialogForm(player, {
      title: "设置成功",
      desc: color.green(`已成功将新玩家默认金币数量设置为 ${color.yellow(amount.toString())}`),
    });
  });
};
// 管理每日金币上限的表单
export const openManageDailyGoldLimitForm = (player: Player) => {
  const currentLimit = economic.getDailyGoldLimit();

  const form = new ActionFormData();
  form.title("§w管理每日金币上限");
  form.body(
    `§a当前每日金币上限: §e${currentLimit} §a金币\n\n§a此限制适用于所有玩家，每天零点自动重置\n§a只计算出售物品和击杀怪物获得的金币\n§a玩家之间的转账不计入每日限制`
  );

  form.button("§w修改每日金币上限", "textures/packs/15174556");
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((response) => {
    if (response.canceled) return;

    switch (response.selection) {
      case 0:
        openSetDailyLimitForm(player);
        break;
      case 1:
        openEconomyMenuForm(player);
        break;
    }
  });
};

// 设置每日金币上限表单
export const openSetDailyLimitForm = (player: Player) => {
  const currentLimit = economic.getDailyGoldLimit();

  const form = new ModalFormData();
  form.title("§w设置每日金币上限");
  form.textField(`§a当前每日金币上限: §e${currentLimit} §a金币\n§a请输入新的每日金币上限:`, "输入数字", {
    defaultValue: currentLimit.toString(),
  });

  form.show(player).then((response) => {
    if (response.canceled) {
      openManageDailyGoldLimitForm(player);
      return;
    }

    const limitStr = response.formValues?.[0] as string;
    const limit = parseInt(limitStr);

    if (isNaN(limit) || limit < 0) {
      openDialogForm(
        player,
        {
          title: "设置失败",
          desc: "§c请输入有效的数字，且不能小于0",
        },
        () => openSetDailyLimitForm(player)
      );
      return;
    }

    economic.setGlobalDailyLimit(limit);
    openDialogForm(
      player,
      {
        title: "设置成功",
        desc: `§a每日金币上限已设置为: §e${limit} §a金币`,
      },
      () => openManageDailyGoldLimitForm(player)
    );
  });
};
