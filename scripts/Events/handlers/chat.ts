/**
 * 聊天相关事件处理器
 */

import { system, world } from "@minecraft/server";
import { eventRegistry } from "../registry";
import { useAllPlayers } from "../../shared/hooks/use-player";
import playerSettings from "../../features/player/services/player-settings";
import setting from "../../features/system/services/setting";

/**
 * 注册聊天事件处理器
 */
export function registerChatEvents(): void {
  // 服务器菜单命令
  world.beforeEvents.chatSend.subscribe((event) => {
    const { sender, message } = event;
    if (message === "服务器菜单") {
      system.run(async () => {
        event.cancel = true;
        const { openServerMenuForm } = await import("../../ui/forms/server");
        openServerMenuForm(sender);
      });
    }
  });

  // 聊天消息处理（包含别名显示和屏蔽功能）
  world.beforeEvents.chatSend.subscribe((e) => {
    const { message, sender } = e;
    e.cancel = true;

    // 获取玩家别名
    const alias = playerSettings.getPlayerAlias(sender);
    const playerNameColor = setting.getState("playerNameColor");
    const playerChatColor = setting.getState("playerChatColor");

    // 构建显示格式
    let displayText = "";
    if (alias) {
      displayText = `${playerNameColor}[${alias}] ${sender.name}： ${playerChatColor}${message}`;
    } else {
      displayText = `${playerNameColor}${sender.name}： ${playerChatColor}${message}`;
    }

    const allPlayers = useAllPlayers();
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
