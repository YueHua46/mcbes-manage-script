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

function teleportPlayer(requestPlayer: Player, targetPlayer: Player, type: "to" | "come"): void {
  if (type === "to") {
    requestPlayer.teleport(targetPlayer.location, {
      dimension: targetPlayer.dimension,
    });
    requestPlayer.sendMessage(
      `${color.green("你已")}${color.green("传送到")} ${color.yellow(targetPlayer.name)} ${color.green("的旁边")}`
    );
    targetPlayer.sendMessage(
      `${color.green("玩家")} ${color.yellow(requestPlayer.name)} ${color.green("已传送到你的旁边")}`
    );
  } else {
    targetPlayer.teleport(requestPlayer.location, {
      dimension: requestPlayer.dimension,
    });
    requestPlayer.sendMessage(`${color.yellow(targetPlayer.name)} ${color.green("已传送到你的旁边")}`);
    targetPlayer.sendMessage(
      `${color.green("你已")}${color.green("传送到")} ${color.yellow(requestPlayer.name)} ${color.green("的旁边")}`
    );
  }
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
        teleportPlayer(requestPlayer, targetPlayer, type);
        break;
      case 1:
        requestPlayer.sendMessage(
          `${color.red("玩家")} ${color.yellow(targetPlayer.name)} ${color.red("拒绝了你的传送请求")}`
        );
        targetPlayer.sendMessage(
          `${color.red("你已")}${color.red("拒绝了")} ${color.yellow(requestPlayer.name)} ${color.red("的传送请求")}`
        );
        break;
    }
  });
}

function createPlayerTpaForm(allPlayer: Player[]): ModalFormData {
  const form = new ModalFormData();
  form.title(`${"玩家传送"}`);
  form.dropdown(
    "§w选择玩家",
    allPlayer.map((player) => ` ${player.name}`)
  );
  form.dropdown("§w选择传送方式", ["§w传送到玩家", "§w请求玩家传送到你"]);
  form.submitButton("§w确认");
  return form;
}

export function openPlayerTpaForm(player: Player): void {
  const allPlayer = useAllPlayers();
  const form = createPlayerTpaForm(allPlayer);

  form.show(player).then((data) => {
    const { formValues } = data;
    if (formValues) {
      const targetPlayer = allPlayer[Number(formValues[0])];
      if (player.name === targetPlayer.name) {
        return player.sendMessage("§c不能传送到自己");
      }
      const type = Number(formValues[1]) === 0 ? "to" : "come";
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
  form.title("§w玩家操作");
  form.button("§wTPA玩家传送", "textures/icons/social");
  form.button("§w聊天栏配置", "textures/icons/chat_bubble_white");
  form.button("§w名字显示设置", "textures/icons/profile");
  form.button("§w返回", "textures/icons/back");
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
        openChatForm(player);
        break;
      case 2:
        openPlayerDisplaySettingsForm(player);
        break;
      case 3:
        openServerMenuForm(player);
        break;
    }
  });
}

// ==================== 聊天栏配置 ====================

export function openChatForm(player: Player): void {
  const form = new ActionFormData();
  form.title("§w聊天栏");

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
  form.title("§w聊天黑名单列表");
  const blackList = player.getDynamicProperty("ChatBlackList") as string | undefined;
  const _blackList = JSON.parse(blackList ?? "[]") as string[];

  _blackList.forEach((name) => {
    form.button(name, "textures/ui/Friend2");
  });
  form.button("§w返回", "textures/icons/back");

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
  form.title("§w添加聊天黑名单");
  const allPlayers = useAllPlayers();

  form.dropdown(
    "§w选择对应玩家",
    allPlayers.map((p) => p.name)
  );
  form.submitButton("§w确认");

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
  form.title("§w聊天拉黑配置");

  const buttons = [
    {
      text: "§w添加聊天黑名单",
      icon: "textures/icons/add",
      action: () => openAddChatBlackListForm(player),
    },
    {
      text: "§w删除聊天黑名单",
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
  form.title("§w聊天栏");

  const isOpenChat = player.getDynamicProperty("Chat") as string | undefined;
  if (isOpenChat === undefined) {
    player.setDynamicProperty("Chat", true);
  }
  const _isOpenChat = JSON.parse(player.getDynamicProperty("Chat") as string) as boolean;

  form.toggle("§w是否开启聊天栏", {
    defaultValue: _isOpenChat,
    tooltip: `§a当前状态: ${_isOpenChat ? "§a开启" : "§c关闭"}`,
  });
  form.submitButton("§w确认");

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
  const form = new ActionFormData();
  form.title("§w名字显示设置");

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

  form.button("§w设置名字颜色", "textures/icons/asker");
  form.button("§w设置别名", "textures/icons/dragon");
  form.button("§w重置设置", "textures/icons/leave_queue");
  form.button("§w返回", "textures/icons/back");

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
  form.title("§w设置名字颜色");

  const currentColor = PlayerSetting.getPlayerNameColor(player);
  form.body({
    rawtext: [
      { text: `§a选择你喜欢的名字颜色:\n` },
      { text: `§a当前颜色: ${currentColor}${nameColors[currentColor]}\n` },
    ],
  });

  const colorEntries = Object.entries(nameColors);
  colorEntries.forEach(([code, name]) => {
    form.button(`${code}${name}`);
  });

  form.button("§w返回", "textures/icons/back");

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
  form.title("§w设置别名");

  const currentAlias = PlayerSetting.getPlayerAlias(player);
  form.textField("§w别名", "请输入别名(最多20个字符)", {
    defaultValue: currentAlias,
  });
  form.submitButton("§w确认");

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
