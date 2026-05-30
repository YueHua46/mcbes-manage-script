import { Player, system, world } from "@minecraft/server";
import onlineTimeService, { ONLINE_TIME_TICK_INTERVAL } from "../../features/player/services/online-time";
import { taskScheduler } from "../../features/platform/scheduler";
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

  taskScheduler.register({
    id: "player.onlineTime",
    label: "在线时长累计",
    category: "player",
    intervalTicks: ONLINE_TIME_TICK_INTERVAL,
    run: () => onlineTimeService.onTick(),
  });
}

eventRegistry.register("onlineTime", registerOnlineTimeEvents);
