/**
 * 防刷物品（收纳袋）：事件订阅
 *
 * 仅使用 @minecraft/server 类型中 **未标 @beta** 的 World 事件。
 * `blockContainerOpened` / `entityContainerOpened` 等为 @beta，在部分 BDS 上 `afterEvents` 不挂载，
 * 直接 `.subscribe` 会报 undefined —— 故用 `playerInteractWithBlock` / `playerInteractWithEntity` 建立会话。
 */

import type { Block, Player } from "@minecraft/server";
import { system, world } from "@minecraft/server";
import { isBundleTypeId, isRestrictedBlockInventory, isRestrictedEntityContainer } from "./constants";
import {
  addWhitelistedBlock,
  isTrustedPlacer,
  isWhitelistedBlock,
  removeWhitelistedBlockAt,
} from "./whitelist-store";
import {
  clearSessionForPlayer,
  isAntiDupeBundleGuardEnabled,
  isAntiDupeMasterEnabled,
  scanAndPurgeSession,
  setOpenContainerSession,
} from "./bundle-guard";

function startRestrictedBlockSession(player: Player, block: Block): void {
  const x = Math.floor(block.location.x);
  const y = Math.floor(block.location.y);
  const z = Math.floor(block.location.z);
  setOpenContainerSession(player.id, {
    kind: "block",
    dimensionId: block.dimension.id,
    x,
    y,
    z,
  });
}

export function registerAntiDupeSubscriptions(): void {
  /**
   * 点开方块 UI：受限且非白名单 → 登记会话；否则清除会话（含点开箱子、地面等，避免漏斗会话常驻）
   */
  world.afterEvents.playerInteractWithBlock.subscribe((ev) => {
    if (!ev.isFirstEvent) return;
    if (!isAntiDupeBundleGuardEnabled()) return;
    const block = ev.block;
    if (isRestrictedBlockInventory(block) && !isWhitelistedBlock(block)) {
      startRestrictedBlockSession(ev.player, block);
    } else {
      clearSessionForPlayer(ev.player);
    }
  });

  /**
   * 漏斗矿车等实体容器（无 blockContainer* 稳定事件时用交互建立会话）
   */
  world.afterEvents.playerInteractWithEntity.subscribe((ev) => {
    if (!isAntiDupeBundleGuardEnabled()) return;
    const target = ev.target;
    if (isRestrictedEntityContainer(target.typeId)) {
      setOpenContainerSession(ev.player.id, { kind: "entity", entityId: target.id });
    } else {
      clearSessionForPlayer(ev.player);
    }
  });

  world.beforeEvents.playerLeave.subscribe((ev) => {
    clearSessionForPlayer(ev.player);
  });

  world.afterEvents.playerPlaceBlock.subscribe((ev) => {
    if (!isAntiDupeMasterEnabled()) return;
    const block = ev.block;
    if (!isRestrictedBlockInventory(block)) return;
    if (!isTrustedPlacer(ev.player.name)) return;
    addWhitelistedBlock(block);
  });

  world.beforeEvents.playerBreakBlock.subscribe((ev) => {
    removeWhitelistedBlockAt(ev.dimension, ev.block.location);
  });

  world.afterEvents.playerInventoryItemChange.subscribe((event) => {
    if (!isAntiDupeBundleGuardEnabled()) return;
    const stack = event.itemStack;
    if (!stack || !isBundleTypeId(stack.typeId)) return;
    system.run(() => {
      scanAndPurgeSession(event.player);
    });
  });
}
