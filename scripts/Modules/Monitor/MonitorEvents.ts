import { world, Player } from "@minecraft/server";
import monitorLog from "./MonitorLog";
import { sendGameEvent } from "./MonitorHttp";
import land from "../Land/Land";

// 监控事件初始化
export function initMonitorEvents() {
  // 监控TNT点燃
  world.afterEvents.itemUse.subscribe((event) => {
    if (!monitorLog.isEnabled()) return;
    const events = monitorLog.getEvents();
    if (!events.tntIgnite) return;

    const player = event.source as Player;
    const item = event.itemStack;

    // 检查是否在领地内（不在则不触发记录）
    const { isInside, insideLand } = land.testLand(player.location, player.dimension.id);
    if (!isInside || !insideLand) return;

    if (item && item.typeId === "minecraft:tnt") {
      sendGameEvent("tntIgnite", {
        playerName: player.name,
        location: player.location,
        dimension: player.dimension.id,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // 监控打火石点燃
  world.afterEvents.itemUse.subscribe((event) => {
    if (!monitorLog.isEnabled()) return;
    const events = monitorLog.getEvents();
    if (!events.flintAndSteelUse) return;

    const player = event.source as Player;
    const item = event.itemStack;

    // 检查是否在领地内（不在则不触发记录）
    const { isInside, insideLand } = land.testLand(player.location, player.dimension.id);
    if (!isInside || !insideLand) return;

    if (item && item.typeId === "minecraft:flint_and_steel") {
      sendGameEvent("flintAndSteelUse", {
        playerName: player.name,
        location: player.location,
        dimension: player.dimension.id,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // 监控使用岩浆桶（全图监控）
  world.afterEvents.itemUse.subscribe((event) => {
    if (!monitorLog.isEnabled()) return;
    const events = monitorLog.getEvents();
    if (!events.lavaUse) return;

    const player = event.source as Player;
    const item = event.itemStack;

    if (item && item.typeId === "minecraft:lava_bucket") {
      sendGameEvent("lavaUse", {
        playerName: player.name,
        location: player.location,
        dimension: player.dimension.id,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // 监控领地内攻击部分中立生物
  world.afterEvents.entityHurt.subscribe((event) => {
    if (!monitorLog.isEnabled()) return;
    const events = monitorLog.getEvents();
    if (!events.attackNeutralMobs) return;

    const target = event.hurtEntity;
    const source = event.damageSource.damagingEntity;

    // 需要监听的实体
    const entityTypes = [
      "minecraft:villager", // 村民
      "minecraft:armor_stand", // 盔甲架
      "minecraft:cat", // 猫
      "minecraft:wolf", // 狼
      "minecraft:horse", // 马
      "minecraft:skeleton_horse", // 骷髅马
      "minecraft:donkey", // 驴
      "minecraft:mule", // 骡
      "minecraft:llama", // 羊驼
      "minecraft:parrot", // 鹦鹉
      "minecraft:sniffer", // 嗅探兽
      "minecraft:happy_ghast", // 快乐恶魂
    ];

    if (
      source &&
      source.typeId === "minecraft:player" &&
      (entityTypes.includes(target.typeId) || target.hasTag("pet"))
    ) {
      // 检查是否在领地内
      const { isInside, insideLand } = land.testLand(target.location, target.dimension.id);
      if (isInside && insideLand) {
        sendGameEvent("attackNeutralMobs", {
          playerName: (source as Player).name, // 攻击者的名字
          targetType: target.typeId, // 被攻击的实体类型
          landName: insideLand.name, // 领地名称
          landOwner: insideLand.owner, // 领地所有者
          location: target.location, // 实体位置
          dimension: target.dimension.id, // 实体维度
          timestamp: new Date().toISOString(),
        });
      }
    }
  });

  // 监控开箱子
  world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    if (!monitorLog.isEnabled()) return;
    const events = monitorLog.getEvents();
    if (!events.openChest) return;

    const { player, block } = event;

    // 检查是否是箱子类型的方块
    const chestTypes = [
      "minecraft:chest",
      "minecraft:trapped_chest",
      "minecraft:barrel",
      "minecraft:ender_chest",
      "minecraft:shulker_box",
    ];

    if (chestTypes.some((type) => block.typeId.includes(type))) {
      // 检查是否在领地内
      const { isInside, insideLand } = land.testLand(block.location, block.dimension.id);

      // 记录所有箱子交互，特别关注领地内的箱子
      sendGameEvent("openChest", {
        playerName: player.name,
        blockType: block.typeId,
        location: block.location,
        dimension: block.dimension.id,
        inLand: isInside,
        landOwner: isInside ? insideLand?.owner : "none",
        timestamp: new Date().toISOString(),
      });
    }
  });

  // 监控召唤凋零
  world.afterEvents.entitySpawn.subscribe((event) => {
    if (!monitorLog.isEnabled()) return;
    const events = monitorLog.getEvents();
    if (!events.summonWither) return;

    const { entity } = event;

    // 检查是否是凋零
    if (entity.typeId === "minecraft:wither") {
      // 尝试找出最近的玩家作为可能的召唤者
      const nearbyPlayers = entity.dimension.getPlayers({
        location: entity.location,
        maxDistance: 100, // 100格范围内的玩家
      });

      if (nearbyPlayers.length > 0) {
        sendGameEvent("summonWither", {
          possibleSummoner: nearbyPlayers.map((p) => p.name),
          location: entity.location,
          dimension: entity.dimension.id,
          timestamp: new Date().toISOString(),
        });
      }
    }
  });

  // 监控放置灵魂沙
  world.afterEvents.playerPlaceBlock.subscribe((event) => {
    if (!monitorLog.isEnabled()) return;
    const events = monitorLog.getEvents();
    if (!events.placeSoulSand) return;

    const { player, block } = event;

    // 检查是否是灵魂沙
    if (block.typeId === "minecraft:soul_sand") {
      sendGameEvent("placeSoulSand", {
        playerName: player.name,
        location: block.location,
        dimension: block.dimension.id,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // 监控与盔甲架的交互（偷盔甲架装备）
  world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
    if (!monitorLog.isEnabled()) return;
    const events = monitorLog.getEvents();
    if (!events.armorStandInteract) return;

    const { cancel, player, target: targetEntity, itemStack } = event;

    // 检查是否为盔甲架
    if (targetEntity.typeId !== "minecraft:armor_stand") return;
    const armorStand = targetEntity;

    // 检查是否在领地内
    const { isInside, insideLand } = land.testLand(armorStand.location, armorStand.dimension.id);

    if (isInside && insideLand && insideLand.owner !== player.name && !insideLand.members.includes(player.name)) {
      sendGameEvent("armorStandInteract", {
        playerName: player.name,
        itemInHand: itemStack?.typeId || "empty",
        location: armorStand.location,
        dimension: armorStand.dimension.id,
        landOwner: insideLand.owner,
        landName: insideLand.name,
        timestamp: new Date().toISOString(),
      });
    }
  });
}

// 初始化监控事件
initMonitorEvents();
