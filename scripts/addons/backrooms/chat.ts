import { system, world } from "@minecraft/server";
import { BACKROOMS_DIMENSION_ID } from "./constants";

export function registerBackroomsChatIsolation(): void {
  world.beforeEvents.chatSend.subscribe((event) => {
    if (event.sender.dimension.id !== BACKROOMS_DIMENSION_ID) return;
    event.cancel = true;
    system.run(() => {
      if (event.sender.isValid && event.sender.dimension.id === BACKROOMS_DIMENSION_ID) {
        event.sender.sendMessage("§8无线电里只剩下荧光灯的嗡鸣。");
      }
    });
  });
}
