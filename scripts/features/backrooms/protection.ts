import { system, world } from "@minecraft/server";
import { isAdmin } from "../../shared/utils/common";
import { BACKROOMS_DIMENSION_ID } from "./constants";
import { LIFEFORM_TYPE_ID } from "./lifeform/config";

const warnedAt = new Map<string, number>();

function warnProtected(playerId: string, message: string): void {
  const now = Date.now();
  if (now - (warnedAt.get(playerId) ?? 0) < 1500) return;
  warnedAt.set(playerId, now);
  if (warnedAt.size > 512) {
    for (const [id, timestamp] of warnedAt) {
      if (now - timestamp > 60_000) warnedAt.delete(id);
    }
  }
  system.run(() => {
    const player = world.getAllPlayers().find((candidate) => candidate.id === playerId);
    if (player?.isValid) player.sendMessage(`§7${message}`);
  });
}

export function registerBackroomsProtection(): void {
  world.beforeEvents.playerBreakBlock.subscribe((event) => {
    if (event.block.dimension.id !== BACKROOMS_DIMENSION_ID || isAdmin(event.player)) return;
    event.cancel = true;
    warnProtected(event.player.id, "墙纸后面只有更多墙。这里无法被破坏。 ");
  });

  world.beforeEvents.playerPlaceBlock.subscribe((event) => {
    if (event.block.dimension.id !== BACKROOMS_DIMENSION_ID || isAdmin(event.player)) return;
    event.cancel = true;
    warnProtected(event.player.id, "这里不允许留下可靠的路标。 ");
  });

  world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    if (event.block.dimension.id !== BACKROOMS_DIMENSION_ID || isAdmin(event.player)) return;
    event.cancel = true;
  });

  world.beforeEvents.explosion.subscribe((event) => {
    if (event.dimension.id === BACKROOMS_DIMENSION_ID) event.setImpactedBlocks([]);
  });

  world.afterEvents.entitySpawn.subscribe((event) => {
    const entity = event.entity;
    try {
      // A projectile or other transient entity can invalidate during the same
      // spawn callback.  Validate before reading dimension/typeId; both getters
      // throw InvalidEntityError after removal.
      if (!entity.isValid) return;
      if (entity.dimension.id !== BACKROOMS_DIMENSION_ID) return;
      if (entity.typeId === "minecraft:player"
        || entity.typeId === LIFEFORM_TYPE_ID
        || entity.typeId === "minecraft:xp_orb") return;
    } catch {
      return;
    }
    system.run(() => {
      try {
        if (entity.isValid) entity.remove();
      } catch {
        // 某些瞬时实体在下一 tick 前已经自行失效。
      }
    });
  });
}
