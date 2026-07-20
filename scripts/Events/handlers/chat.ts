/**
 * 聊天相关事件处理器
 */

import { system, world } from "@minecraft/server";
import { eventRegistry } from "../registry";
import { useAllPlayers } from "../../shared/hooks/use-player";
import playerSettings from "../../features/player/services/player-settings";
import setting from "../../features/system/services/setting";
import { guildFacade } from "../../features/guild/services/guild-facade";
import { isMenuChatTrigger } from "../../core/constants";
import { isRealPlayerEntity } from "../../shared/utils/online-players";
import { BACKROOMS_DIMENSION_ID } from "../../features/backrooms/constants";

/**
 * 注册聊天事件处理器
 */
export function registerChatEvents(): void {
  // 苦力怕菜单命令
  world.beforeEvents.chatSend.subscribe((event) => {
    const { sender, message } = event;
    if (!isRealPlayerEntity(sender)) return;
    if (isMenuChatTrigger(message)) {
      event.cancel = true;
      system.run(async () => {
        const { openServerMenuForm } = await import("../../ui/forms/server");
        openServerMenuForm(sender);
      });
    }
  });

  // 聊天消息处理（包含别名显示和屏蔽功能）
  world.beforeEvents.chatSend.subscribe((e) => {
    const { message, sender } = e;
    if (!isRealPlayerEntity(sender)) return;
    if (isMenuChatTrigger(message)) return;
    e.cancel = true;

    // Level 0 的 Isolation Effect：消息不能跨越 manifestation，也不能传回现实。
    if (sender.dimension.id === BACKROOMS_DIMENSION_ID) {
      system.run(() => sender.isValid && sender.sendMessage("§8无线电里只剩下荧光灯的嗡鸣。"));
      return;
    }

    // 获取玩家别名
    const alias = playerSettings.getPlayerAlias(sender);
    const playerNameColor = setting.getState("playerNameColor");
    const playerChatColor = setting.getState("playerChatColor");

    const guildPrefix =
      guildFacade.isGuildModuleEnabled() && setting.getState("guildShowTagInChat") === true
        ? guildFacade.getGuildTagPrefixForChat(sender.name)
        : undefined;
    const guildPart = guildPrefix ? `${guildPrefix} ` : "";

    // 构建显示格式
    let displayText = "";
    if (alias) {
      displayText = `${playerNameColor}${guildPart}[${alias}] ${sender.name}： ${playerChatColor}${message}`;
    } else {
      displayText = `${playerNameColor}${guildPart}${sender.name}： ${playerChatColor}${message}`;
    }

    const allPlayers = useAllPlayers().filter((player) => player.dimension.id !== BACKROOMS_DIMENSION_ID);
    allPlayers.forEach((player) => {
      const isOpenChat = player.getDynamicProperty("Chat") as boolean | undefined;
      if (typeof isOpenChat === "undefined") {
        player.setDynamicProperty("Chat", true);
        player.sendMessage({ rawtext: [{ text: displayText }] });
      }
      if (isOpenChat) {
        if (player.getDynamicProperty("ChatBlackList")) {
          const blackList = JSON.parse(player.getDynamicProperty("ChatBlackList") as string) as string[];
          if (blackList.includes(sender.name)) return;
        }
        player.sendMessage({ rawtext: [{ text: displayText }] });
      }
    });
  });
}

// 注册到事件中心
eventRegistry.register("chat", registerChatEvents);
