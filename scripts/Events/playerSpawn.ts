import { RawMessage, world } from "@minecraft/server";
import { BRANDING } from "../core/constants";
import { eventRegistry } from "./registry";
import { isRealPlayerEntity } from "../shared/utils/online-players";

function registerPlayerSpawnEvent(): void {
  world.afterEvents.playerSpawn.subscribe((event) => {
    const { player } = event;
    if (!isRealPlayerEntity(player)) return;
    const isFirstJoin = player?.getDynamicProperty("isFirst");
    if (!isFirstJoin) {
      player?.setDynamicProperty("isFirst", true);
      player?.sendMessage(
        `§e欢迎你加入服务器！使用${BRANDING.MENU_ITEM_LABEL}可以快捷执行一些服务器操作，如果你丢失了菜单，可以在聊天栏里输入：${BRANDING.MENU_ITEM_LABEL}，然后点击功能：给予${BRANDING.MENU_ITEM_LABEL}即可。`
      );
      player?.runCommand("give @s yuehua:sm");
    }
  });
}

eventRegistry.register("playerSpawn", registerPlayerSpawnEvent);
