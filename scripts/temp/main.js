import { Entity, Player, world as mc, system } from "@minecraft/server";
import {
  playerAttackVillager,
  playerBrawlEvent,
  playerUnBox,
  playerUseFireEvent,
} from "./event";
import { getPlayerLocation } from "./utils";
mc.afterEvents.entityHitEntity.subscribe((e) => {
  var { hitEntity: e, damagingEntity: t } = e;
  e instanceof Player && t instanceof Player && playerBrawlEvent(e, t),
    e instanceof Entity &&
    t instanceof Player &&
    "minecraft:villager_v2" === e.typeId &&
    playerAttackVillager(e, t);
}),
  mc.beforeEvents.itemUseOn.subscribe((r) => {
    var { source: r, itemStack: n } = r;
    if (
      "minecraft:lava_bucket" === n.typeId ||
      "minecraft:flint_and_steel" === n.typeId ||
      "minecraft:tnt" === n.typeId
    ) {
      let e = getPlayerLocation(r),
        t = r.name,
        a = n.typeId;
      system.run(() => playerUseFireEvent(t, e, a));
    }
  }),
  mc.beforeEvents.playerInteractWithBlock.subscribe((e) => {
    var { block: e, player: a } = e;
    if ("minecraft:chest" === e.typeId || "minecraft:barrel" === e.typeId) {
      let e = getPlayerLocation(a),
        t = a.name;
      system.run(() => playerUnBox(t, e));
    }
  });
