import { Player, system, world } from "@minecraft/server";
import onlineTimeService, { ONLINE_TIME_TICK_INTERVAL } from "../../features/player/services/online-time";
import { eventRegistry } from "../registry";

export function registerOnlineTimeEvents(): void {
  world.afterEvents.playerSpawn.subscribe((event) => {
    onlineTimeService.onPlayerSpawn(event.player);
  });

  world.beforeEvents.playerLeave.subscribe((event) => {
    const player = event.player as Player | undefined;
    if (player) {
      onlineTimeService.onPlayerLeave(player);
    }
  });

  system.runInterval(() => {
    onlineTimeService.onTick();
  }, ONLINE_TIME_TICK_INTERVAL);
}

eventRegistry.register("onlineTime", registerOnlineTimeEvents);
