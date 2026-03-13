import { Player, system, Vector3, world } from "@minecraft/server";
import behaviorLog, { LandLogInfo } from "../../features/behavior-log/services/behavior-log";
import { landManager } from "../../features/land/services";
import { eventRegistry } from "../registry";

const JOIN_FLAG = "behaviorLogJoinState";
const LAND_SCAN_INTERVAL_TICKS = 20;
const WITHER_PREP_EXPIRE_MS = 15_000;

interface PlayerLandState {
  name: string;
  owner?: string;
  dimensionId: string;
}

interface WitherPrepRecord {
  playerName: string;
  location: Vector3;
  dimensionId: string;
  timestamp: number;
}

const playerLandState = new Map<string, PlayerLandState>();
const recentWitherPrep: WitherPrepRecord[] = [];

function toLandInfo(input: { isInside: boolean; insideLand: any | null }): LandLogInfo | undefined {
  if (!input.isInside || !input.insideLand) return undefined;
  return {
    name: input.insideLand.name,
    owner: input.insideLand.owner,
  };
}

function getLandInfoAt(location: Vector3, dimensionId: string): LandLogInfo | undefined {
  return toLandInfo(landManager.testLand(location, dimensionId));
}

function isWaterBlock(typeId: string): boolean {
  return typeId === "minecraft:water" || typeId === "minecraft:flowing_water";
}

function isLavaBlock(typeId: string): boolean {
  return typeId === "minecraft:lava" || typeId === "minecraft:flowing_lava";
}

function isWitherPrepBlock(typeId: string): boolean {
  return (
    typeId === "minecraft:soul_sand" ||
    typeId === "minecraft:soul_soil" ||
    typeId.includes("wither_skeleton_skull")
  );
}

function recordWitherPreparation(player: Player, location: Vector3, dimensionId: string): void {
  recentWitherPrep.push({
    playerName: player.name,
    location,
    dimensionId,
    timestamp: Date.now(),
  });
}

function cleanupWitherPreparation(): void {
  const now = Date.now();
  for (let i = recentWitherPrep.length - 1; i >= 0; i--) {
    if (now - recentWitherPrep[i].timestamp > WITHER_PREP_EXPIRE_MS) {
      recentWitherPrep.splice(i, 1);
    }
  }
}

function findWitherSummoner(location: Vector3, dimensionId: string): string | undefined {
  cleanupWitherPreparation();

  let closestRecord: WitherPrepRecord | undefined;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const record of recentWitherPrep) {
    if (record.dimensionId !== dimensionId) continue;
    const dx = record.location.x - location.x;
    const dy = record.location.y - location.y;
    const dz = record.location.z - location.z;
    const distance = dx * dx + dy * dy + dz * dz;
    if (distance < closestDistance) {
      closestDistance = distance;
      closestRecord = record;
    }
  }

  if (!closestRecord || closestDistance > 64) {
    return undefined;
  }

  return closestRecord.playerName;
}

export function registerBehaviorLogEvents(): void {
  world.afterEvents.playerSpawn.subscribe((event) => {
    const { player } = event;
    const joined = player.getDynamicProperty(JOIN_FLAG) as boolean | undefined;

    if (joined) return;

    player.setDynamicProperty(JOIN_FLAG, true);
    behaviorLog.logJoin(player);
  });

  world.beforeEvents.playerLeave.subscribe((event: any) => {
    const player = event.player as Player | undefined;
    const playerName = player?.name ?? event.playerName;

    if (player) {
      player.setDynamicProperty(JOIN_FLAG, false);
      playerLandState.delete(player.id);
    }

    if (playerName) {
      behaviorLog.logLeave(playerName);
    }
  });

  world.beforeEvents.chatSend.subscribe((event) => {
    const { sender, message } = event;
    if (!message.trim()) return;
    if (message === "服务器菜单") return;
    behaviorLog.logChat(sender, message);
  });

  world.afterEvents.playerPlaceBlock.subscribe((event: any) => {
    if (!event.block?.typeId) return;
    const blockTypeId = event.block.typeId;
    const { player, block } = event;

    if (isWaterBlock(blockTypeId)) {
      behaviorLog.logPlaceWater(player, block.location, block.dimension.id);
    } else if (isLavaBlock(blockTypeId)) {
      behaviorLog.logPlaceLava(player, block.location, block.dimension.id);
    } else if (blockTypeId === "minecraft:tnt") {
      behaviorLog.logPlaceTnt(player, block.location, block.dimension.id);
    }

    if (isWitherPrepBlock(blockTypeId)) {
      recordWitherPreparation(player, block.location, block.dimension.id);
    }
  });

  world.beforeEvents.playerInteractWithBlock.subscribe((event: any) => {
    if (event.cancel) return;
    const { player, block, itemStack } = event;
    const blockTypeId = block?.typeId;
    if (!blockTypeId) return;

    if (itemStack?.typeId === "minecraft:flint_and_steel") {
      behaviorLog.logIgniteFire(player, block.location, block.dimension.id, blockTypeId);
    }

    const containerEventType = behaviorLog.getContainerEventType(blockTypeId);
    if (!containerEventType) return;

    const landInfo = getLandInfoAt(block.location, block.dimension.id);
    behaviorLog.logOpenContainer(player, containerEventType, blockTypeId, block.location, block.dimension.id, landInfo);
  });

  world.beforeEvents.playerInteractWithEntity.subscribe((event: any) => {
    if (event.cancel) return;
    const { player, target } = event;
    if (!target) return;

    const containerEventType = behaviorLog.getContainerEventType(target.typeId);
    if (!containerEventType) return;

    const landInfo = getLandInfoAt(target.location, target.dimension.id);
    behaviorLog.logOpenContainer(player, containerEventType, target.typeId, target.location, target.dimension.id, landInfo);
  });

  world.beforeEvents.entityHurt.subscribe((event: any) => {
    if (event.cancel) return;
    const victim = event.hurtEntity;
    const attacker = event.damageSource?.damagingEntity;

    if (attacker?.typeId !== "minecraft:player") {
      return;
    }

    const source = attacker as Player;

    if (victim?.typeId === "minecraft:player") {
      if (victim.id === attacker.id) return;
      behaviorLog.logPvpHit(source, victim as Player);
      return;
    }

    const landInfo = getLandInfoAt(victim.location, victim.dimension.id);
    if (!landInfo) return;
    behaviorLog.logAttackMobInLand(source, victim.typeId, victim.location, victim.dimension.id, landInfo);
  });

  world.afterEvents.entityDie.subscribe((event: any) => {
    const victim = event.deadEntity;
    if (victim?.typeId !== "minecraft:player") return;

    const player = victim as Player;
    const killer = event.damageSource?.damagingEntity;
    const reason =
      killer?.typeId === "minecraft:player"
        ? `被玩家 ${(killer as Player).name} 击杀`
        : `原因:${String(event.damageSource?.cause ?? "unknown")}`;

    behaviorLog.logDeath(player, reason);
  });

  world.afterEvents.entitySpawn.subscribe((event: any) => {
    const entity = event.entity;
    if (!entity || entity.typeId !== "minecraft:wither") return;

    const playerName = findWitherSummoner(entity.location, entity.dimension.id) ?? "未知玩家";
    behaviorLog.logSummonWither(playerName, entity.location, entity.dimension.id, "检测到凋零生成");
  });

  system.runInterval(() => {
    const onlineIds = new Set(world.getAllPlayers().map((player) => player.id));

    for (const [playerId] of playerLandState) {
      if (!onlineIds.has(playerId)) {
        playerLandState.delete(playerId);
      }
    }

    for (const player of world.getAllPlayers()) {
      const landInfo = getLandInfoAt(player.location, player.dimension.id);
      const previous = playerLandState.get(player.id);

      if (!previous && landInfo) {
        playerLandState.set(player.id, {
          name: landInfo.name,
          owner: landInfo.owner,
          dimensionId: player.dimension.id,
        });
        behaviorLog.logEnterLand(player, landInfo);
        continue;
      }

      if (previous && !landInfo) {
        behaviorLog.logLeaveLand(player.name, player.location, player.dimension.id, previous);
        playerLandState.delete(player.id);
        continue;
      }

      if (
        previous &&
        landInfo &&
        (previous.name !== landInfo.name || previous.owner !== landInfo.owner || previous.dimensionId !== player.dimension.id)
      ) {
        behaviorLog.logLeaveLand(player.name, player.location, previous.dimensionId, previous);
        behaviorLog.logEnterLand(player, landInfo);
        playerLandState.set(player.id, {
          name: landInfo.name,
          owner: landInfo.owner,
          dimensionId: player.dimension.id,
        });
      }
    }
  }, LAND_SCAN_INTERVAL_TICKS);

  system.runInterval(() => {
    const intervalTicks = Math.max(20, behaviorLog.getLocationIntervalSeconds() * 20);
    if (system.currentTick % intervalTicks !== 0) {
      return;
    }

    for (const player of world.getAllPlayers()) {
      const landInfo = getLandInfoAt(player.location, player.dimension.id);
      behaviorLog.logLocationSnapshot(player, landInfo);
    }
  }, 20);
}

eventRegistry.register("behaviorLog", registerBehaviorLogEvents);
