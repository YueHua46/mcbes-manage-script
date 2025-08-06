import { EntityComponentTypes, Player, system, world } from "@minecraft/server";
import { color } from "../../utils/color";
// import prefix from "./Prefix"; // 注释掉prefix功能
import { useGetAllPlayer } from "../../hooks/hooks";
import setting from "../System/Setting";
import playerSetting from "../Player/PlayerSetting";

// 聊天消息处理
world.beforeEvents.chatSend.subscribe((e) => {
  const { message, sender } = e;
  e.cancel = true;

  // 获取玩家别名
  const alias = playerSetting.getPlayerAlias(sender);
  const playerNameColor = setting.getState("playerNameColor");
  const playerChatColor = setting.getState("playerChatColor");

  // 调试信息
  // console.warn(`聊天事件触发 - 玩家: ${sender.name}, 别名: ${alias}, 消息: ${message}`);

  // 构建显示格式：[别名] 玩家名：消息 或 玩家名：消息
  let displayText = "";
  if (alias) {
    displayText = `${playerNameColor}[${alias}] ${sender.name}： ${playerChatColor}${message}`;
  } else {
    displayText = `${playerNameColor}${sender.name}： ${playerChatColor}${message}`;
  }

  // console.warn(`显示文本: ${displayText}`);

  const allPlayers = useGetAllPlayer();
  allPlayers.forEach((player) => {
    const isOpenChat = player.getDynamicProperty("Chat") as boolean | undefined;
    if (typeof isOpenChat === "undefined") {
      player.setDynamicProperty("Chat", true);
      player.sendMessage({
        rawtext: [
          {
            text: displayText,
          },
        ],
      });
    }
    if (isOpenChat) {
      if (player.getDynamicProperty("ChatBlackList")) {
        const blackList = JSON.parse(player.getDynamicProperty("ChatBlackList") as string) as string[];
        if (blackList.includes(sender.name)) return;
      }
      player.sendMessage({
        rawtext: [
          {
            text: displayText,
          },
        ],
      });
    }
  });
});

// 玩家生成时设置显示名称
world.afterEvents.playerSpawn.subscribe((e) => {
  const { player } = e;
  // 使用玩家的显示名称（包含别名）设置nameTag
  const alias = playerSetting.getPlayerAlias(player);
  const nameColor = playerSetting.getPlayerNameColor(player);

  if (alias) {
    player.nameTag = `${nameColor}[${alias}] ${player.name}`;
  } else {
    player.nameTag = `${nameColor}${player.name}`;
  }
});

// lastDeath
world.afterEvents.entityDie.subscribe((event) => {
  const { deadEntity } = event;
  if (deadEntity.typeId === "minecraft:player") {
    (deadEntity as Player).sendMessage(
      "§e你死了，但你可以通过 §b服务器菜单 -> 其他功能 -> 回到上次死亡地点 §e来传送回上次死亡点。"
    );
    deadEntity.setDynamicProperty(
      "lastDeath",
      JSON.stringify({
        location: deadEntity.location,
        dimension: deadEntity.dimension,
      })
    );
  }
});
