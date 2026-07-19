/**
 * 玩家系统表单
 * 完整迁移自 Modules/Player/Forms.ts (497行)
 */

import { Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { openServerMenuForm } from "../server";
import { useAllPlayers } from "../../../shared/hooks/use-player";
import { color } from "../../../shared/utils/color";
import PlayerSetting, { EFunNames, nameColors } from "../../../features/player/services/player-settings";
import nameDisplay from "../../../features/player/services/name-display";
import { openDialogForm } from "../../../ui/components/dialog";
import { namePrefixMap } from "../../../assets/glyph-map";
import setting from "../../../features/system/services/setting";
import { isAdmin } from "../../../shared/utils/common";
import { teleportPlayer as doTpaTeleport, notifyReject } from "../../../features/player/services/tpa-logic";
import * as tpaRequest from "../../../features/player/services/tpa-request";
import { openFakePlayerMenu } from "./fake-player";

// ==================== TPA传送系统 ====================

function createRequestTpaForm(
  title: string,
  requestPlayer: Player,
  targetPlayer: Player,
  type: "to" | "come"
): ActionFormData {
  const form = new ActionFormData();
  form.title(title);
  form.body({
    rawtext: [
      {
        text:
          type === "to"
            ? `${color.green("玩家")} ${color.yellow(requestPlayer.name)} ${color.green("请求传送到你的旁边\n")}`
            : `${color.green("玩家")} ${color.yellow(requestPlayer.name)} ${color.green("请求你传送到他的旁边\n")}`,
      },
      {
        text: `${color.green("是否接受?")}`,
      },
    ],
  });
  form.button("接受", "textures/ui/realms_green_check");
  form.button("拒绝", "textures/ui/realms_red_x");
  return form;
}

export function openRequestTpaForm(requestPlayer: Player, targetPlayer: Player, type: "to" | "come"): void {
  const title = `${"玩家传送请求"}`;
  const form = createRequestTpaForm(title, requestPlayer, targetPlayer, type);

  form.show(targetPlayer).then((data) => {
    if (data.cancelationReason) {
      return requestPlayer.sendMessage(color.red("用户正处于其他UI界面！传送失败"));
    }
    switch (data.selection) {
      case 0:
        doTpaTeleport(requestPlayer, targetPlayer, type);
        break;
      case 1:
        notifyReject(requestPlayer, targetPlayer);
        break;
    }
  });
}

function createPlayerTpaForm(allPlayer: Player[]): ModalFormData {
  const form = new ModalFormData();
  form.title(`${"玩家传送"}`);
  form.dropdown(
    "选择玩家",
    allPlayer.map((player) => ` ${player.name}`)
  );
  form.dropdown("选择传送方式", ["传送到玩家", "请求玩家传送到你"]);
  form.submitButton("确认");
  return form;
}

export function openPlayerTpaForm(player: Player): void {
  const allPlayer = useAllPlayers();
  const form = createPlayerTpaForm(allPlayer);

  form.show(player).then((data) => {
    const { formValues } = data;
    if (formValues) {
      const targetPlayer = allPlayer[Number(formValues[0])];
      if (!targetPlayer) {
        return player.sendMessage(color.red("目标玩家不存在或已离线，请重新打开传送菜单"));
      }
      if (player.name === targetPlayer.name) {
        return player.sendMessage("§c不能传送到自己");
      }
      const type = Number(formValues[1]) === 0 ? "to" : "come";

      if (PlayerSetting.getTPADoNotDisturb(targetPlayer)) {
        tpaRequest.addPendingRequest(targetPlayer, player, type);
        const typeDesc = type === "to" ? "请求传送到你旁边" : "请求你传送到他旁边";
        targetPlayer.sendMessage(
          `${color.yellow("【TPA】")} ${color.yellow(player.name)} ${color.green(typeDesc)}。` +
            `${color.gray(` 在聊天输入 tpaccept 接受 或 tpreject 拒绝，${tpaRequest.TPA_TIMEOUT_SECONDS}秒内有效。`)}`
        );
        player.sendMessage(color.green("对方开启了勿扰模式，已通过聊天提示对方，请等待回复。"));
        return;
      }

      player.sendMessage(color.green("已发送传送请求"));
      openRequestTpaForm(player, targetPlayer, type);
    } else {
      player.sendMessage(color.red("传送请求失败"));
    }
  });
}

// ==================== 玩家操作主菜单 ====================

function createPlayerActionForm(): ActionFormData {
  const form = new ActionFormData();
  form.title("玩家操作");
  form.button("TPA玩家传送", "textures/icons/social");
  form.button("TPA设置", "textures/icons/chatCooldown");
  form.button("假人管理", "textures/icons/spectator");
  form.button("聊天栏配置", "textures/icons/chat_bubble_white");
  form.button("名字显示设置", "textures/icons/profile");
  form.button("状态栏显示设置", "textures/icons/info");
  form.button("返回", "textures/icons/back");
  return form;
}

export function openPlayerActionForm(player: Player): void {
  const form = createPlayerActionForm();

  form.show(player).then((data) => {
    if (data.cancelationReason || data.canceled) return;
    switch (data.selection) {
      case 0:
        openPlayerTpaForm(player);
        break;
      case 1:
        openTpaSettingsForm(player);
        break;
      case 2:
        openFakePlayerMenu(player, () => openPlayerActionForm(player));
        break;
      case 3:
        openChatForm(player);
        break;
      case 4:
        openPlayerDisplaySettingsForm(player);
        break;
      case 5:
        openPlayerHudSettingsForm(player);
        break;
      case 6:
        openServerMenuForm(player);
        break;
    }
  });
}

/** TPA 设置（勿扰模式等） */
export function openTpaSettingsForm(player: Player): void {
  const form = new ModalFormData();
  form.title("TPA设置");
  const dnd = PlayerSetting.getTPADoNotDisturb(player);
  form.toggle("TPA勿扰模式", {
    defaultValue: dnd,
    tooltip: "§a开启后，他人发来的传送请求不会弹窗，改为聊天提示；你可通过输入 /tpaccept 或 /tpreject 在限定时间内处理。",
  });
  form.submitButton("确认");

  form.show(player).then((data) => {
    if (data.cancelationReason || data.canceled) return;
    const formValues = data.formValues;
    if (formValues) {
      const enabled = formValues[0] as boolean;
      PlayerSetting.turnPlayerFunction(EFunNames.TPADoNotDisturb, player, enabled);
      player.sendMessage(
        enabled ? "§a已开启 §bTPA勿扰模式§a，传送请求将通过聊天提示。" : "§a已关闭 §bTPA勿扰模式§a。"
      );
    }
    openPlayerActionForm(player);
  });
}

/** 玩家个人右上角状态栏开关。 */
function openPlayerHudSettingsForm(player: Player): void {
  const form = new ModalFormData();
  form.title("状态栏显示设置");
  const economyEnabled = setting.getState("economy") === true;
  form.toggle(economyEnabled ? "显示金币、TPS 和在线人数" : "显示 TPS 和在线人数", {
    defaultValue: PlayerSetting.getPlayerHudEnabled(player),
    tooltip: economyEnabled
      ? "经济系统开启时状态栏会包含金币。关闭后只会隐藏你自己的右上角状态栏，不影响其他玩家。"
      : "经济系统当前已关闭，因此不显示金币。关闭此项只会隐藏你自己的右上角状态栏。",
  });
  form.submitButton("保存");
  form.show(player).then((data) => {
    if (data.cancelationReason || data.canceled || !data.formValues) {
      openPlayerActionForm(player);
      return;
    }
    const enabled = data.formValues[0] as boolean;
    PlayerSetting.setPlayerHudEnabled(player, enabled);
    player.sendMessage(enabled ? "§a已开启右上角玩家状态栏。" : "§e已关闭右上角玩家状态栏。");
    openPlayerActionForm(player);
  });
}

// ==================== 聊天栏配置 ====================

export function openChatForm(player: Player): void {
  const form = new ActionFormData();
  form.title("聊天栏");

  const buttons = [
    {
      text: "聊天黑名单配置",
      icon: "textures/icons/chatSpam",
      action: () => openChatBlackForm(player),
    },
    {
      text: "静音聊天栏配置",
      icon: "textures/icons/chatCooldown",
      action: () => openMuteChatForm(player),
    },
  ];

  buttons.forEach((button) => {
    form.button(button.text, button.icon);
  });
  form.button("返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.cancelationReason || data.canceled) return;
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

export function openDeleteChatBlackListForm(player: Player): void {
  const form = new ActionFormData();
  form.title("聊天黑名单列表");
  const blackList = player.getDynamicProperty("ChatBlackList") as string | undefined;
  const _blackList = JSON.parse(blackList ?? "[]") as string[];

  _blackList.forEach((name) => {
    form.button(name, "textures/ui/Friend2");
  });
  form.button("返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.cancelationReason || data.canceled) return;
    if (typeof data.selection !== "number") return;

    switch (data.selection) {
      case _blackList.length:
        openChatBlackForm(player);
        break;
      default:
        const targetPlayer = _blackList[data.selection];
        const index = _blackList.indexOf(targetPlayer);
        _blackList.splice(index, 1);
        player.setDynamicProperty("ChatBlackList", JSON.stringify(_blackList));
        openDialogForm(player, {
          title: "删除成功",
          desc: `§a已成功将 §b${targetPlayer} §a从聊天黑名单中移除！`,
        });
        break;
    }
  });
}

export function openAddChatBlackListForm(player: Player): void {
  const form = new ModalFormData();
  form.title("添加聊天黑名单");
  const allPlayers = useAllPlayers();

  form.dropdown(
    "选择对应玩家",
    allPlayers.map((p) => p.name)
  );
  form.submitButton("确认");

  form.show(player).then((data) => {
    if (data.cancelationReason || data.canceled) return;
    const { formValues } = data;
    if (formValues) {
      const blackList = player.getDynamicProperty("ChatBlackList") as string | undefined;
      const targetPlayer = allPlayers[formValues[0] as number].name;

      if (blackList && blackList.length) {
        const _blackList = JSON.parse(blackList);
        _blackList.push(targetPlayer);
        player.setDynamicProperty("ChatBlackList", JSON.stringify(_blackList));
      } else {
        player.setDynamicProperty("ChatBlackList", JSON.stringify([targetPlayer]));
      }
      openDialogForm(player, {
        title: "添加成功",
        desc: `§a已成功将 §b${targetPlayer} §a添加到聊天黑名单中！`,
      });
    }
  });
}

export function openChatBlackForm(player: Player): void {
  const form = new ActionFormData();
  form.title("聊天拉黑配置");

  const buttons = [
    {
      text: "添加聊天黑名单",
      icon: "textures/icons/add",
      action: () => openAddChatBlackListForm(player),
    },
    {
      text: "删除聊天黑名单",
      icon: "textures/icons/deny",
      action: () => openDeleteChatBlackListForm(player),
    },
  ];

  buttons.forEach((button) => {
    form.button(button.text, button.icon);
  });
  form.button("返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.cancelationReason || data.canceled) return;
    switch (data.selection) {
      case buttons.length:
        openChatForm(player);
        break;
      default:
        if (typeof data.selection !== "number") return;
        buttons[data.selection].action();
        break;
    }
  });
}

export function openMuteChatForm(player: Player): void {
  const form = new ModalFormData();
  form.title("聊天栏");

  const isOpenChat = player.getDynamicProperty("Chat") as string | undefined;
  if (isOpenChat === undefined) {
    player.setDynamicProperty("Chat", true);
  }
  const _isOpenChat = JSON.parse(player.getDynamicProperty("Chat") as string) as boolean;

  form.toggle("是否开启聊天栏", {
    defaultValue: _isOpenChat,
    tooltip: `§a当前状态: ${_isOpenChat ? "§a开启" : "§c关闭"}`,
  });
  form.submitButton("确认");

  form.show(player).then((data) => {
    if (data.cancelationReason || data.canceled) return;
    const { formValues } = data;
    if (formValues) {
      PlayerSetting.turnPlayerFunction(EFunNames.Chat, player, formValues[0] as boolean);
      player.sendMessage(`§b已${formValues[0] ? " §a开启 " : " §c关闭 "}§b聊天栏`);
    }
  });
}

// ==================== 玩家名字显示设置 ====================

export function openPlayerDisplaySettingsForm(player: Player): void {
  // 检查是否允许玩家编辑名字显示设置（管理员始终可以访问）
  const allowPlayerDisplaySettings = setting.getState("allowPlayerDisplaySettings") as boolean;
  if (!allowPlayerDisplaySettings && !isAdmin(player)) {
    openDialogForm(
      player,
      {
        title: "功能已禁用",
        desc: "§c管理员已禁用玩家编辑名字显示设置功能！",
      },
      () => {
        openPlayerActionForm(player);
      }
    );
    return;
  }

  const form = new ActionFormData();
  form.title("名字显示设置");

  const currentSettings = PlayerSetting.getPlayerDisplaySettings(player);
  const colorName = nameColors[currentSettings.nameColor as keyof typeof nameColors] || "§f白色";
  const alias = currentSettings.alias || "无";

  form.body({
    rawtext: [
      { text: `§a当前设置:\n` },
      { text: `§a名字颜色: ${currentSettings.nameColor}${colorName}\n` },
      { text: `§a别名: §f${alias}\n` },
      { text: `§a预览: ${PlayerSetting.getPlayerDisplayName(player)}\n` },
    ],
  });

  form.button("设置名字颜色", "textures/icons/asker");
  form.button("设置别名", "textures/icons/edit2");
  form.button("重置设置", "textures/icons/leave_queue");
  form.button("返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.cancelationReason || data.canceled) return;
    switch (data.selection) {
      case 0:
        openNameColorSettingsForm(player);
        break;
      case 1:
        openAliasSettingsForm(player);
        break;
      case 2:
        PlayerSetting.resetPlayerDisplaySettings(player);
        nameDisplay.forceUpdatePlayerNameDisplay(player);
        openDialogForm(player, {
          title: "设置重置",
          desc: "§a名字显示设置已重置为默认值！",
        });
        break;
      case 3:
        openPlayerActionForm(player);
        break;
    }
  });
}

export function openNameColorSettingsForm(player: Player): void {
  const form = new ActionFormData();
  form.title("设置名字颜色");

  const currentColor = PlayerSetting.getPlayerNameColor(player);
  form.body({
    rawtext: [
      { text: `§a选择你喜欢的名字颜色:\n` },
      { text: `§a当前颜色: ${currentColor}${nameColors[currentColor]}\n` },
    ],
  });

  const colorEntries = Object.entries(nameColors);
  colorEntries.forEach(([, name]) => {
    form.button(name);
  });

  form.button("返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.cancelationReason || data.canceled) return;

    if (data.selection === colorEntries.length) {
      openPlayerDisplaySettingsForm(player);
      return;
    }

    if (typeof data.selection === "number" && data.selection < colorEntries.length) {
      const selectedColor = colorEntries[data.selection][0];
      const colorName = colorEntries[data.selection][1];

      PlayerSetting.setPlayerNameColor(player, selectedColor);
      nameDisplay.forceUpdatePlayerNameDisplay(player);
      openDialogForm(player, {
        title: "设置成功",
        desc: `§a名字颜色已设置为 ${selectedColor}${colorName}§a！`,
      });
    }
  });
}

export function openAliasSettingsForm(player: Player): void {
  const form = new ModalFormData();
  form.title("设置别名");

  const currentAlias = PlayerSetting.getPlayerAlias(player);
  form.textField("别名", "请输入别名(最多20个字符)", {
    defaultValue: currentAlias,
  });
  form.submitButton("确认");

  form.show(player).then((data) => {
    if (data.cancelationReason || data.canceled) return;

    const { formValues } = data;
    if (formValues) {
      const alias = formValues[0] as string;

      if (alias.length > 20) {
        openDialogForm(player, {
          title: "设置失败",
          desc: "§c别名长度不能超过20个字符！",
        });
        return;
      }

      const success = PlayerSetting.setPlayerAlias(player, alias);
      if (success) {
        const finalAlias = PlayerSetting.getPlayerAlias(player);
        nameDisplay.forceUpdatePlayerNameDisplay(player);
        openDialogForm(player, {
          title: "设置成功",
          desc: finalAlias ? `§a别名已设置为: §f${finalAlias}` : "§a别名已清空！",
        });
      } else {
        openDialogForm(player, {
          title: "设置失败",
          desc: "§c设置别名失败，请检查输入内容！",
        });
      }
    }
  });
}
