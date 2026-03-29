/**
 * 收纳袋放入非常规容器：附近玩家判定、开盖会话、容器扫描与移出
 */

import type { Container, Dimension, Player, Vector3 } from "@minecraft/server";
import { system, world } from "@minecraft/server";
import { getBlockInventoryContainer, getEntityInventoryContainer } from "./block-inventory-access";
import { isBundleTypeId } from "./constants";
import setting from "../system/services/setting";

const ANTI_DUPE_MSG =
  "§c当前服务器已禁止在非常规箱子类容器内放入收纳袋（防止刷物）。如有特殊需求请联系管理员将你加入防刷白名单后再放置。";

/** 仅当容器 10 格内有玩家时才扫描（固定值，不可配置） */
const MONITOR_RADIUS_BLOCKS = 10;

export type OpenContainerSession =
  | {
      kind: "block";
      dimensionId: string;
      x: number;
      y: number;
      z: number;
    }
  | {
      kind: "entity";
      entityId: string;
    };

const sessions = new Map<string, OpenContainerSession>();
const lastNotifyTick = new Map<string, number>();
let tickLoopStarted = false;
let purging = false;

export function isAntiDupeMasterEnabled(): boolean {
  return setting.getState("antiDupeEnabled" as never) !== false;
}

/** 收纳袋防刷是否实际生效（总开关开 且 收纳袋子开关开） */
export function isAntiDupeBundleGuardEnabled(): boolean {
  if (!isAntiDupeMasterEnabled()) return false;
  return setting.getState("antiDupeBundleRestrictEnabled" as never) !== false;
}

function distSq(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function hasPlayerNearPosition(dimension: Dimension, pos: Vector3, radiusBlocks: number): boolean {
  const r = radiusBlocks;
  const r2 = r * r;
  const players = world.getPlayers();
  for (const p of players) {
    if (!p.isValid || p.dimension.id !== dimension.id) continue;
    if (distSq(p.location, pos) <= r2) return true;
  }
  return false;
}

export function setOpenContainerSession(playerId: string, session: OpenContainerSession | undefined): void {
  if (session === undefined) {
    sessions.delete(playerId);
  } else {
    sessions.set(playerId, session);
  }
  ensureTickLoop();
}

export function clearSessionForPlayer(player: Player): void {
  sessions.delete(player.id);
}

function resolveContainer(session: OpenContainerSession): { container: Container; dimension: Dimension; pos: Vector3 } | undefined {
  try {
    if (session.kind === "block") {
      const dim = world.getDimension(session.dimensionId);
      const block = dim.getBlock({ x: session.x, y: session.y, z: session.z });
      if (!block?.isValid) return undefined;
      const c = getBlockInventoryContainer(block);
      if (!c?.isValid) return undefined;
      return { container: c, dimension: dim, pos: { x: session.x, y: session.y, z: session.z } };
    }
    const ent = world.getEntity(session.entityId);
    if (!ent?.isValid) return undefined;
    const c = getEntityInventoryContainer(ent);
    if (!c?.isValid) return undefined;
    return { container: c, dimension: ent.dimension, pos: ent.location };
  } catch {
    return undefined;
  }
}

function notifyPlayerThrottled(player: Player, nowTick: number): void {
  const prev = lastNotifyTick.get(player.id) ?? 0;
  if (nowTick - prev < 40) return;
  lastNotifyTick.set(player.id, nowTick);
  player.sendMessage(ANTI_DUPE_MSG);
}

export function scanAndPurgeSession(player: Player, nowTick: number = system.currentTick): void {
  if (!isAntiDupeBundleGuardEnabled() || purging) return;
  const session = sessions.get(player.id);
  if (!session) return;

  const resolved = resolveContainer(session);
  if (!resolved) return;

  if (!hasPlayerNearPosition(resolved.dimension, resolved.pos, MONITOR_RADIUS_BLOCKS)) {
    return;
  }

  purging = true;
  try {
    const n = purgeIllegalBundlesFromContainer(resolved.container, player, resolved.dimension, resolved.pos);
    if (n > 0) {
      notifyPlayerThrottled(player, nowTick);
    }
  } finally {
    purging = false;
  }
}

/** 返回移出的收纳袋堆叠数（件数） */
export function purgeIllegalBundlesFromContainer(
  container: Container,
  contextPlayer: Player | undefined,
  dimension: Dimension,
  fallbackSpawnLoc: Vector3
): number {
  let movedStacks = 0;
  const size = container.size;
  for (let i = 0; i < size; i++) {
    const stack = container.getItem(i);
    if (!stack || !isBundleTypeId(stack.typeId)) continue;
    container.setItem(i, undefined);
    movedStacks++;
    const give = stack.clone();
    if (contextPlayer?.isValid) {
      const inv = contextPlayer.getComponent("inventory")?.container;
      if (inv) {
        const leftover = inv.addItem(give);
        if (leftover && leftover.amount > 0) {
          dimension.spawnItem(leftover, contextPlayer.location);
        }
      } else {
        dimension.spawnItem(give, contextPlayer.location);
      }
    } else {
      dimension.spawnItem(give, fallbackSpawnLoc);
    }
  }
  return movedStacks;
}

function processAllSessionsTick(nowTick: number): void {
  if (!isAntiDupeBundleGuardEnabled()) {
    sessions.clear();
    return;
  }
  if (sessions.size === 0) return;

  for (const player of world.getPlayers()) {
    if (!player.isValid) continue;
    if (!sessions.has(player.id)) continue;
    scanAndPurgeSession(player, nowTick);
  }
}

function ensureTickLoop(): void {
  if (tickLoopStarted) return;
  tickLoopStarted = true;
  system.runInterval(() => {
    processAllSessionsTick(system.currentTick);
  }, 4);
}
