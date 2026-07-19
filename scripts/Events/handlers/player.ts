/**
 * 玩家相关事件处理器
 */

import { Player, RawMessage, system, world } from "@minecraft/server";
import { eventRegistry } from "../registry";
import { welcomeCharacterGlyphs, welcomeGlyphs } from "../../assets/glyph-map";
import playerSettings from "../../features/player/services/player-settings";
import setting from "../../features/system/services/setting";
import { showJoinPopupAnnouncements } from "../../features/system/services/join-popup-announcement";
import economic from "../../features/economic/services/economic";
import { BRANDING } from "../../core/constants";
import { isFakePlayer } from "../../features/fake-player/services/fake-player";

/**
 * 注册玩家事件处理器
 */
export function registerPlayerEvents(): void {
  // 玩家欢迎事件（首次加入）
  world.afterEvents.playerSpawn.subscribe(async (event) => {
    const { player } = event;
    if (isFakePlayer(player)) return;

    const isJoin = player.getDynamicProperty("join") as boolean;
    if (isJoin) return;

    player.setDynamicProperty("join", true);
    await system.waitTicks(70);

    system.run(() => {
      player.onScreenDisplay.setTitle({ text: "\n\n" });

      const left = `${welcomeGlyphs[1]}${welcomeGlyphs[8]}${welcomeGlyphs[6]}${welcomeGlyphs[7]}${welcomeGlyphs[4]}${welcomeGlyphs[2]}`;
      const right = `${welcomeGlyphs[3]}${welcomeGlyphs[4]}${welcomeGlyphs[7]}${welcomeGlyphs[6]}${welcomeGlyphs[8]}${welcomeGlyphs[0]}`;
      const welcomeCharacter =
        welcomeCharacterGlyphs[Math.floor(Math.random() * welcomeCharacterGlyphs.length)];
      const serverName = (setting.getState("serverName") as string) || "服务器";

      player.runCommand(
        `titleraw @s subtitle {"rawtext":[{"text":"${welcomeCharacter}\\n\\n\\n${left} §d欢迎来到 ${right}\\n§s${serverName}"}]}`
      );
      player.playSound("yuehua.welcome");

      // 获取自定义的欢迎消息并处理换行符
      const welcomeMessageRaw = (setting.getState("welcomeMessage") as string) || "";
      const welcomeMessage = welcomeMessageRaw.replace(/\\n/g, "\n");

      if (welcomeMessage) {
        player.sendMessage(welcomeMessage);
      }

      system.runTimeout(() => {
        showJoinPopupAnnouncements(player);
      }, 40);
    });
  });

  // 玩家首次加入服务器初始化
  world.afterEvents.playerSpawn.subscribe((event) => {
    const { player } = event;
    if (isFakePlayer(player)) return;

    const isFirstJoin = player?.getDynamicProperty("isFirst");

    if (!isFirstJoin) {
      player?.setDynamicProperty("isFirst", true);
      player?.sendMessage(
        `§e欢迎你加入服务器！使用${BRANDING.MENU_ITEM_LABEL}可以快捷执行一些服务器操作，如果你丢失了菜单，可以在聊天栏里输入：${BRANDING.MENU_ITEM_LABEL}，然后点击功能：给予${BRANDING.MENU_ITEM_LABEL}即可。`
      );
      player?.runCommand("give @s yuehua:sm");
    }
  });

  // 玩家生成时设置显示名称
  world.afterEvents.playerSpawn.subscribe((e) => {
    const { player } = e;
    if (isFakePlayer(player)) return;

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
    if (isFakePlayer(player)) return;
    player.setDynamicProperty("join", false);
  });

  // 玩家死亡事件
  world.afterEvents.entityDie.subscribe((event) => {
    const { deadEntity } = event;
    if (deadEntity.typeId === "minecraft:player") {
      const player = deadEntity as Player;
      if (isFakePlayer(player)) return;
      const backToDeath = setting.getState("backToDeath") as boolean;

      // 只有在功能开启时才显示提示消息
      if (backToDeath) {
        player.sendMessage(
          `§e你死了，但你可以通过 §b${BRANDING.MENU_ITEM_LABEL} -> 其他功能 -> 回到上次死亡地点 §e来传送回上次死亡点。`
        );
      }

      const killedByOtherPlayer =
        event.damageSource.damagingEntity?.typeId === "minecraft:player" &&
        event.damageSource.damagingEntity.id !== player.id;

      if (
        !killedByOtherPlayer &&
        setting.getState("economy") === true &&
        setting.getState("deathGoldPenaltyEnabled") === true
      ) {
        const configuredAmount = Math.floor(Number(setting.getState("deathGoldPenaltyAmount")));
        if (Number.isFinite(configuredAmount) && configuredAmount > 0) {
          const wallet = economic.getWallet(player.name);
          const penaltyAmount = Math.min(configuredAmount, wallet.gold);
          if (penaltyAmount > 0 && economic.removeGold(player.name, penaltyAmount, "死亡金币惩罚")) {
            const currentGold = economic.getWallet(player.name).gold;
            player.sendMessage(`§c死亡惩罚：扣除 §e${penaltyAmount} §c金币，当前余额 §e${currentGold}§c。`);
          }
        }
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

  // 使用物品事件（打开苦力怕菜单）
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
