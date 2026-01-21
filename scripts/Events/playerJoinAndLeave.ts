import { RawMessage, system, world } from "@minecraft/server";
import { welcomeFoxGlyphs, welcomeGlyphs } from "../assets/glyph-map";
import { eventRegistry } from "./registry";
import setting from "../features/system/services/setting";

function registerPlayerJoinEvent(): void {
  world.afterEvents.playerSpawn.subscribe(async (event) => {
    const { player } = event;

    const isJoin = player.getDynamicProperty("join") as boolean;
    if (isJoin) return;
    player.setDynamicProperty("join", true);
    await system.waitTicks(70);
    system.run(() => {
      player.onScreenDisplay.setTitle({
        text: "\n\n",
      });

      const left = `${welcomeGlyphs[1]}${welcomeGlyphs[8]}${welcomeGlyphs[6]}${welcomeGlyphs[7]}${welcomeGlyphs[4]}${welcomeGlyphs[2]}`;
      const right = `${welcomeGlyphs[3]}${welcomeGlyphs[4]}${welcomeGlyphs[7]}${welcomeGlyphs[6]}${welcomeGlyphs[8]}${welcomeGlyphs[0]}`;
      const fox = `${welcomeFoxGlyphs[0]}`;
      const serverName = (setting.getState("serverName") as string) || "服务器";
      player.runCommand(
        `titleraw @s subtitle {"rawtext":[{"text":"${fox}\n\n${left} §d欢迎来到 ${right}\n§s${serverName}"}]}`
      );
      player.playSound("yuehua.welcome");
      
      // 获取自定义的欢迎消息并处理换行符
      const welcomeMessageRaw = (setting.getState("welcomeMessage") as string) || "";
      const welcomeMessage = welcomeMessageRaw.replace(/\\n/g, "\n");
      
      if (welcomeMessage) {
        player.sendMessage(welcomeMessage);
      }
    });
  });
}

function registerPlayerLeaveEvent(): void {
  world.beforeEvents.playerLeave.subscribe((event) => {
    const { player } = event;
    player.setDynamicProperty("join", false);
  });
}

eventRegistry.register("playerJoin", registerPlayerJoinEvent);
eventRegistry.register("playerLeave", registerPlayerLeaveEvent);
