/**
 * 玩家相关事件处理器
 */

import { Player, RawMessage, system, world } from "@minecraft/server";
import { eventRegistry } from "../registry";
import { welcomeFoxGlyphs, welcomeGlyphs } from "../../assets/glyph-map";
import playerSettings from "../../features/player/services/player-settings";
import setting from "../../features/system/services/setting";

/**
 * 注册玩家事件处理器
 */
export function registerPlayerEvents(): void {
  // 玩家欢迎事件（首次加入）
  world.afterEvents.playerSpawn.subscribe(async (event) => {
    const { player } = event;
    let serverName: string = (world.getDynamicProperty("serverName") as string) || "服务器";

    const isJoin = player.getDynamicProperty("join") as boolean;
    if (isJoin) return;

    player.setDynamicProperty("join", true);
    await system.waitTicks(70);

    system.run(() => {
      player.onScreenDisplay.setTitle({ text: "\n\n" });

      const left = `${welcomeGlyphs[1]}${welcomeGlyphs[8]}${welcomeGlyphs[6]}${welcomeGlyphs[7]}${welcomeGlyphs[4]}${welcomeGlyphs[2]}`;
      const right = `${welcomeGlyphs[3]}${welcomeGlyphs[4]}${welcomeGlyphs[7]}${welcomeGlyphs[6]}${welcomeGlyphs[8]}${welcomeGlyphs[0]}`;
      const fox = `${welcomeFoxGlyphs[0]}`;

      player.runCommand(
        `titleraw @s subtitle {"rawtext":[{"text":"${fox}\\n\\n${left} §d欢迎来到 ${right}\\n§s${serverName}"}]}`
      );
      player.playSound("yuehua.welcome");

      const sendMessageRaw: RawMessage = {
        rawtext: [
          { text: "§a欢迎使用杜绝熊孩服务器插件~\n" },
          { text: "§a此插件由 §eYuehua §a制作，B站ID： §e月花zzZ\n" },
          { text: "§a管理员请输入命令 §b/tag @s add admin §a来获取服务器菜单管理员权限\n" },
        ],
      };
      player.sendMessage(sendMessageRaw);
    });
  });

  // 玩家首次加入服务器初始化
  world.afterEvents.playerSpawn.subscribe((event) => {
    const { player } = event;

    const isFirstJoin = player?.getDynamicProperty("isFirst");
    const worldInit = world.getDynamicProperty("init");

    if (!isFirstJoin) {
      player?.setDynamicProperty("isFirst", true);
      player?.sendMessage(
        `§e欢迎你加入服务器！使用服务器菜单可以快捷执行一些服务器操作，如果你丢失了菜单，可以在聊天栏里输入：服务器菜单，然后点击功能：给予服务器菜单即可。`
      );
      player?.runCommand("give @s yuehua:sm");
    }

    if (!worldInit) {
      world.setDynamicProperty("init", true);
      setting.init();
    }
  });

  // 玩家生成时设置显示名称
  world.afterEvents.playerSpawn.subscribe((e) => {
    const { player } = e;

    const alias = playerSettings.getPlayerAlias(player);
    const nameColor = playerSettings.getPlayerNameColor(player);

    if (alias) {
      player.nameTag = `${nameColor}[${alias}] ${player.name}`;
    } else {
      player.nameTag = `${nameColor}${player.name}`;
    }
  });

  // 玩家离开事件
  world.beforeEvents.playerLeave.subscribe((event) => {
    const { player } = event;
    player.setDynamicProperty("join", false);
  });

  // 玩家死亡事件
  world.afterEvents.entityDie.subscribe((event) => {
    const { deadEntity } = event;
    if (deadEntity.typeId === "minecraft:player") {
      const backToDeath = setting.getState("backToDeath") as boolean;

      // 只有在功能开启时才显示提示消息
      if (backToDeath) {
        (deadEntity as Player).sendMessage(
          "§e你死了，但你可以通过 §b服务器菜单 -> 其他功能 -> 回到上次死亡地点 §e来传送回上次死亡点。"
        );
      }

      // 保存死亡地点（即使功能关闭也保存，以防以后开启时使用）
      deadEntity.setDynamicProperty(
        "lastDeath",
        JSON.stringify({
          location: deadEntity.location,
          dimension: deadEntity.dimension,
        })
      );
    }
  });

  // 使用物品事件（打开服务器菜单）
  world.afterEvents.itemUse.subscribe(async (event) => {
    const { itemStack, source } = event;
    if (itemStack.typeId.includes("yuehua:sm")) {
      const { openServerMenuForm } = await import("../../ui/forms/server");
      openServerMenuForm(source);
    }
  });
}

// 注册到事件中心
eventRegistry.register("player", registerPlayerEvents);
