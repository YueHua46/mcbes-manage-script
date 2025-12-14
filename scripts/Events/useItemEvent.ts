import { world } from "@minecraft/server";
import { openServerMenuForm } from "../ui/forms/server";
import { eventRegistry } from "./registry";

function registerUseItemEvent(): void {
  world.afterEvents.itemUse.subscribe((event) => {
    const { itemStack, source } = event;
    if (itemStack.typeId.includes("yuehua:sm")) {
      openServerMenuForm(source);
    }
  });
}

eventRegistry.register("useItem", registerUseItemEvent);
