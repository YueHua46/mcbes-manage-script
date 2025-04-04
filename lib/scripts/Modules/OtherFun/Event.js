import { world } from "@minecraft/server";
import { color } from "../../utils/color";
import prefix from "./Prefix";
import { useGetAllPlayer } from "../../hooks/hooks";
import setting from "../System/Setting";
// name prefix
world.beforeEvents.chatSend.subscribe((e) => {
    const { message, sender } = e;
    e.cancel = true;
    const _prefix = prefix.getPrefix(sender);
    if (!_prefix)
        prefix.initPrefix(sender);
    const allPlayers = useGetAllPlayer();
    const playerNameColor = setting.getState("playerNameColor");
    const playerChatColor = setting.getState("playerChatColor");
    allPlayers.forEach((player) => {
        const isOpenChat = player.getDynamicProperty("Chat");
        if (typeof isOpenChat === "undefined") {
            player.setDynamicProperty("Chat", true);
            player.sendMessage({
                rawtext: [
                    {
                        text: `[${_prefix}] ${playerNameColor}${sender.name}： ${playerChatColor}${message}`,
                    },
                ],
            });
        }
        if (isOpenChat) {
            if (player.getDynamicProperty("ChatBlackList")) {
                const blackList = JSON.parse(player.getDynamicProperty("ChatBlackList"));
                if (blackList.includes(sender.name))
                    return;
            }
            player.sendMessage({
                rawtext: [
                    {
                        text: `[${_prefix}] ${playerNameColor}${sender.name}： ${playerChatColor}${message}`,
                    },
                ],
            });
        }
    });
});
// name prefix
world.afterEvents.playerSpawn.subscribe((e) => {
    const { player } = e;
    const _prefix = prefix.getPrefix(player);
    if (!_prefix)
        prefix.initPrefix(player);
    player.nameTag = `${_prefix} ${color.aqua(player.name)}`;
});
// lastDeath
world.afterEvents.entityDie.subscribe((event) => {
    const { deadEntity } = event;
    if (deadEntity.typeId === "minecraft:player") {
        deadEntity.sendMessage("§e你死了，但你可以通过 §b服务器菜单 -> 其他功能 -> 回到上次死亡地点 §e来传送回上次死亡点。");
        deadEntity.setDynamicProperty("lastDeath", JSON.stringify({
            location: deadEntity.location,
            dimension: deadEntity.dimension,
        }));
    }
});
//# sourceMappingURL=Event.js.map