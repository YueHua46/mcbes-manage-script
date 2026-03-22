/**
 * 玩家统计：怪物击杀、累计死亡、等级快照事件
 */

import { Player, world } from "@minecraft/server";
import { eventRegistry } from "../registry";
import playerStats from "../../features/statistics/services/player-stats";
import { ONLINE_TIME_TICK_INTERVAL } from "../../features/player/services/online-time";
import { system } from "@minecraft/server";

const IGNORE_MOB_KILL_TYPES = new Set(["minecraft:item", "minecraft:xp_orb"]);

export function registerPlayerStatsEvents(): void {
  world.afterEvents.entityDie.subscribe((event) => {
    const { deadEntity, damageSource } = event;

    if (deadEntity.typeId === "minecraft:player") {
      playerStats.incrementTotalDeath((deadEntity as Player).name);
      return;
    }

    const damager = damageSource.damagingEntity;
    if (damager?.typeId !== "minecraft:player") return;

    const deadType = deadEntity.typeId;
    if (IGNORE_MOB_KILL_TYPES.has(deadType)) return;

    playerStats.incrementMobKill((damager as Player).name);
  });

  world.afterEvents.playerSpawn.subscribe((event) => {
    playerStats.refreshLevelSnapshot(event.player);
  });

  world.beforeEvents.playerLeave.subscribe((event) => {
    const player = event.player as Player | undefined;
    if (player) {
      playerStats.refreshLevelSnapshot(player);
    }
  });

  system.runInterval(() => {
    playerStats.refreshAllOnlineLevels();
  }, ONLINE_TIME_TICK_INTERVAL);
}

eventRegistry.register("playerStats", registerPlayerStatsEvents);
