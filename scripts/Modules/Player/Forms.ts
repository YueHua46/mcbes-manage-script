import { Player, world } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { openServerMenuForm } from "../Forms/Forms";
import { useGetAllPlayer } from "../../hooks/hooks";
import { color } from "../../utils/color";
import PlayerSetting, { EFunNames, nameColors } from "./PlayerSetting";
import { openDialogForm } from "../Forms/Dialog";
import { namePrefixMap } from "../../glyphMap";

// 创建传送请求表单
function createRequestTpaForm(title: string, requestPlayer: Player, targetPlayer: Player, type: "to" | "come") {
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
function teleportPlayer(requestPlayer: Player, targetPlayer: Player, type: "to" | "come") {
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
    requestPlayer.sendMessage(
      `${color.green("你已")}${color.green("传送到")} ${color.yellow(targetPlayer.name)} ${color.green("的旁边")}`
    );
    targetPlayer.sendMessage(
      `${color.green("玩家")} ${color.yellow(requestPlayer.name)} ${color.green("已传送到你的旁边")}`
    );
  }
}

export function openRequestTpaForm(requestPlayer: Player, targetPlayer: Player, type: "to" | "come") {
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

// 创建玩家传送表单
function createPlayerTpaForm(allPlayer: Player[]) {
  const form = new ModalFormData();
  form.title(`${"玩家传送"}`);
  form.dropdown(
    "§w选择玩家",
    allPlayer.map((player) => ` ${player.name}`)
  );
  form.dropdown("§w选择传送方式", ["§w传送到玩家", "§w请求玩家传送到你"]);
  form.submitButton("§w确认");
  return form;
}

export function openPlayerTpaForm(player: Player) {
  const allPlayer = useGetAllPlayer();
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

// 玩家操作
// 创建玩家操作表单
function createPlayerActionForm() {
  const form = new ActionFormData();
  form.title("§w玩家操作");
  form.button("§wTPA玩家传送", "textures/ui/enable_editor");
  form.button("§w聊天栏配置", "textures/icons/chat");
  form.button("§w名字显示设置", "textures/icons/usertrue");
  form.button("§w返回", "textures/icons/back");
  return form;
}

// 打开玩家操作表单
export function openPlayerActionForm(player: Player) {
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

// 聊天栏配置表单
export function openChatForm(player: Player) {
  const form = new ActionFormData();
  form.title("§w聊天栏");

  const buttons = [
    {
      text: "聊天黑名单配置",
      icon: "textures/icons/chatBlockText",
      action: () => openChatBlackForm(player),
    },
    {
      text: "静音聊天栏配置",
      icon: "textures/icons/chatSpam",
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

// 移除聊天黑名单
export function openDeleteChatBlackListForm(player: Player) {
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
// 添加聊天黑名单
export function openAddChatBlackListForm(player: Player) {
  const form = new ModalFormData();
  form.title("§w添加聊天黑名单");
  const allPlayers = useGetAllPlayer();
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
// 聊天黑名单配置
export function openChatBlackForm(player: Player) {
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
        openServerMenuForm(player);
        break;
      default:
        if (typeof data.selection !== "number") return;
        buttons[data.selection].action();
        break;
    }
  });
}
// 静音聊天栏配置
export function openMuteChatForm(player: Player) {
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

// 玩家名字显示设置主界面
export function openPlayerDisplaySettingsForm(player: Player) {
  const form = new ActionFormData();
  form.title("§w名字显示设置");

  const currentSettings = PlayerSetting.getPlayerDisplaySettings(player);
  const colorName = nameColors[currentSettings.nameColor as keyof typeof nameColors] || "§f白色";
  const alias = currentSettings.alias || "无";
  // const avatarIndex = PlayerSetting.getPlayerAvatarIndex(player);

  form.body({
    rawtext: [
      { text: `§a当前设置:\n` },
      // { text: `§a头像: ${currentSettings.avatar} (第${avatarIndex + 1}个)\n` },
      { text: `§a名字颜色: ${currentSettings.nameColor}${colorName}\n` },
      { text: `§a别名: §f${alias}\n` },
      { text: `§a预览: ${PlayerSetting.getPlayerDisplayName(player)}\n` },
    ],
  });

  // form.button("§w设置头像", "textures/icons/pixel_003");
  form.button("§w设置名字颜色", "textures/icons/pixel_002");
  form.button("§w设置别名", "textures/icons/pixel_001");
  form.button("§w重置设置", "textures/icons/pixel_006");
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.cancelationReason || data.canceled) return;
    switch (data.selection) {
      // case 0:
      //   openAvatarSettingsForm(player);
      //   break;
      case 0:
        openNameColorSettingsForm(player);
        break;
      case 1:
        openAliasSettingsForm(player);
        break;
      case 2:
        PlayerSetting.resetPlayerDisplaySettings(player);
        // 立即更新名字显示
        import("../Player/NameDisplay").then(({ default: nameDisplay }) => {
          nameDisplay.forceUpdatePlayerNameDisplay(player);
        });
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

// 设置名字颜色
export function openNameColorSettingsForm(player: Player) {
  const form = new ActionFormData();
  form.title("§w设置名字颜色");

  const currentColor = PlayerSetting.getPlayerNameColor(player);
  form.body({
    rawtext: [
      { text: `§a选择你喜欢的名字颜色:\n` },
      { text: `§a当前颜色: ${currentColor}${nameColors[currentColor]}\n` },
    ],
  });

  // 添加颜色选项
  const colorEntries = Object.entries(nameColors);
  colorEntries.forEach(([code, name]) => {
    form.button(`${code}${name}`);
  });

  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.cancelationReason || data.canceled) return;

    if (data.selection === colorEntries.length) {
      // 返回按钮
      openPlayerDisplaySettingsForm(player);
      return;
    }

    if (typeof data.selection === "number" && data.selection < colorEntries.length) {
      const selectedColor = colorEntries[data.selection][0];
      const colorName = colorEntries[data.selection][1];

      PlayerSetting.setPlayerNameColor(player, selectedColor);
      // 立即更新名字显示
      import("../Player/NameDisplay").then(({ default: nameDisplay }) => {
        nameDisplay.forceUpdatePlayerNameDisplay(player);
      });
      openDialogForm(player, {
        title: "设置成功",
        desc: `§a名字颜色已设置为 ${selectedColor}${colorName}§a！`,
      });
    }
  });
}

// 设置别名
export function openAliasSettingsForm(player: Player) {
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
        // 立即更新名字显示
        import("../Player/NameDisplay").then(({ default: nameDisplay }) => {
          nameDisplay.forceUpdatePlayerNameDisplay(player);
        });
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

// 头像设置表单
// export function openAvatarSettingsForm(player: Player) {
//   const form = new ModalFormData();
//   form.title("§w设置头像");

//   const currentAvatarIndex = PlayerSetting.getPlayerAvatarIndex(player);
//   const avatarOptions = namePrefixMap.map((avatar: string, index: number) => `${avatar} 头像${index + 1}`);

//   form.dropdown("§w选择头像", avatarOptions, {
//     defaultValueIndex: currentAvatarIndex,
//     tooltip: "选择你喜欢的头像",
//   });

//   form.submitButton("§w确认");

//   form.show(player).then((data) => {
//     if (data.cancelationReason || data.canceled) return;
//     const { formValues } = data;
//     if (formValues) {
//       const selectedIndex = formValues[0] as number;
//       if (PlayerSetting.setPlayerAvatar(player, selectedIndex)) {
//         // 立即更新名字显示
//         import("../Player/NameDisplay").then(({ default: nameDisplay }) => {
//           nameDisplay.forceUpdatePlayerNameDisplay(player);
//         });
//         openDialogForm(
//           player,
//           {
//             title: "头像设置成功",
//             desc: `§a头像设置成功！\n§a当前头像: ${namePrefixMap[selectedIndex]}`,
//           },
//           () => openPlayerDisplaySettingsForm(player)
//         );
//       } else {
//         openDialogForm(
//           player,
//           {
//             title: "设置失败",
//             desc: "§c头像设置失败，请重试！",
//           },
//           () => openPlayerDisplaySettingsForm(player)
//         );
//       }
//     }
//   });
// }
