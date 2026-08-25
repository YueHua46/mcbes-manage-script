import { world } from "@minecraft/server";
import type { StringPropertyStore } from "./generation-store";

export class WorldStringPropertyStore implements StringPropertyStore {
  get(key: string): string | undefined {
    const value = world.getDynamicProperty(key);
    return typeof value === "string" ? value : undefined;
  }

  set(key: string, value: string | undefined): void {
    world.setDynamicProperty(key, value);
  }
}
