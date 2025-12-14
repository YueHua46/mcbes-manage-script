/**
 * 领地相关事件处理器
 * 完整迁移自 Modules/Land/Event.ts (504行)
 */

import { world, system, Entity, Player, BlockVolume } from "@minecraft/server";
import { eventRegistry } from "../registry";
import { color } from "../../shared/utils/color";
import { debounce, isAdmin } from "../../shared/utils/common";
import landManager from "../../features/land/services/land-manager";
import landParticle from "../../features/land/services/land-particle";
import { useNotify } from "../../shared/hooks";
import { MinecraftBlockTypes } from "@minecraft/vanilla-data";
import type { ILand, Vector3 } from "../../core/types";

interface LandArea {
  start?: Vector3;
  end?: Vector3;
  lastChangeTime: number;
}

/**
 * 检查实体是否在移动
 */
const isMoving = (entity: Entity): boolean => {
  const MathRound = (x: number) => Math.round(x * 1000) / 1000;

  const vector = {
    x: MathRound(entity.getVelocity().x),
    y: MathRound(entity.getVelocity().y),
    z: MathRound(entity.getVelocity().z),
  };

  return !(vector.x === 0 && vector.y === 0 && vector.z === 0);
};

// 领地标记区域存储
export const landAreas = new Map<string, LandArea>();

// 玩家当前所在领地记录
const LandLog = new Map<string, ILand>();

/**
 * 清除领地内的燃烧方块（通过getBlocks）
 */
function clearLandFireByGetBlocks(landData: ILand): void {
  const landArea = new BlockVolume(landData.vectors.start, landData.vectors.end);
  const blocks = world.getDimension(landData.dimension).getBlocks(landArea, {
    includeTypes: ["minecraft:lava", "minecraft:flowing_lava", "minecraft:fire", "minecraft:soul_fire"],
  });

  const blocksIterator = blocks.getBlockLocationIterator();
  for (const blockLocation of blocksIterator) {
    const block = world.getDimension(landData.dimension).getBlock(blockLocation);
    if (block) {
      block.setType("minecraft:air");
    }
  }
}

/**
 * 注册领地事件处理器
 */
export function registerLandEvents(): void {
  // ==================== 定时任务 ====================

  /**
   * 领地标记点管理和燃烧方块清理
   */
  system.runInterval(() => {
    // 1. 清除过期的领地标记坐标点
    landAreas.forEach((landArea, playerId) => {
      if (landArea.lastChangeTime < Date.now() - 1000 * 60 * 10) {
        const player = world.getPlayers().find((p) => p.name === playerId);
        player?.sendMessage(color.red("领地标记坐标点已过期，请重新设置"));
        landAreas.delete(playerId);
      }

      // 显示起始点粒子
      if (landArea.start) {
        const player = world.getPlayers().find((p) => p.name === playerId);
        if (player) {
          landParticle.createLandParticle(player, landArea.start);
        }
      }

      // 显示结束点粒子
      if (landArea.end) {
        const player = world.getPlayers().find((p) => p.name === playerId);
        if (player) {
          landParticle.createLandParticle(player, landArea.end);
        }
      }

      // 显示区域边框
      if (landArea.start && landArea.end) {
        const player = world.getPlayers().find((p) => p.name === playerId);
        if (player) {
          landParticle.createLandParticleArea(player, [landArea.start, landArea.end]);
        }
      }
    });

    // 2. 清除所有领地内的燃烧方块
    const lands = landManager.getLandList();
    for (const landName in lands) {
      const landData = lands[landName];

      // 修复旧存档burn权限初始化问题
      if (landData.public_auth.burn === undefined) {
        landData.public_auth.burn = false;
      }

      if (landData.public_auth.burn) continue;

      try {
        clearLandFireByGetBlocks(landData);
      } catch (error) {
        // 忽略区块未加载等错误
      }
    }
  }, 20);

  /**
   * 玩家进入/离开领地提示
   */
  system.runInterval(() => {
    world.getAllPlayers().forEach((p) => {
      if (!isMoving(p)) return;
      if (p.location.y <= -63) return;

      const location = p.dimension.getBlock(p.location)?.location;
      const { isInside, insideLand } = landManager.testLand(location ?? p.location, p.dimension.id);

      // 进入领地
      if (isInside && insideLand && !LandLog.get(p.name)) {
        useNotify(
          "actionbar",
          p,
          `${color.yellow("您已进入")} ${color.green(insideLand.owner)} ${color.yellow("的领地")} ${color.aqua(
            "『"
          )}${color.lightPurple(insideLand.name)}${color.aqua("』")}`
        );

        try {
          landParticle.createLandParticleArea(p, [insideLand.vectors.start, insideLand.vectors.end]);
        } catch (error) {}

        LandLog.set(p.name, insideLand);
      }
      // 离开领地
      else if (!isInside && LandLog.get(p.name)) {
        const landData = LandLog.get(p.name);
        if (landData) {
          useNotify(
            "actionbar",
            p,
            `${color.yellow("您已离开")} ${color.green(landData.owner)} ${color.yellow("的领地")} ${color.aqua(
              "『"
            )}${color.lightPurple(landData.name)}${color.aqua("』")}`
          );

          try {
            landParticle.createLandParticleArea(p, [landData.vectors.start, landData.vectors.end]);
          } catch (error) {}

          LandLog.delete(p.name);
        }
      }
    });
  }, 5);

  // ==================== 领地标记事件 ====================

  /**
   * 使用木棍标记领地坐标点
   */
  world.afterEvents.entityHitBlock.subscribe((event) => {
    const { damagingEntity, hitBlock: block } = event;

    if (damagingEntity.typeId !== "minecraft:player") return;
    const source = damagingEntity as Player;

    // @ts-ignore
    const itemTypeId = source?.getComponent("minecraft:equippable")?.getEquipment("Mainhand")?.typeId;
    if (!itemTypeId?.includes("minecraft:stick")) return;

    debounce(
      () => {
        const playerId = source.name;
        let landArea = landAreas.get(playerId) || { lastChangeTime: Date.now() };

        if (source.isSneaking) {
          // 潜行 + 木棍 = 设置结束点
          const endPos = {
            x: block.location.x,
            y: block.location.y + 1,
            z: block.location.z,
          };
          source.sendMessage(color.yellow(`已设置领地结束点：${endPos.x} ${endPos.y} ${endPos.z}`));
          landArea.end = endPos;
          landArea.lastChangeTime = Date.now();
        } else {
          // 木棍 = 设置起始点
          const startPos = {
            x: block.location.x,
            y: block.location.y + 1,
            z: block.location.z,
          };
          source.sendMessage(color.yellow(`已设置领地起始点：${startPos.x} ${startPos.y} ${startPos.z}`));
          landArea.start = startPos;
          landArea.lastChangeTime = Date.now();
        }

        landAreas.set(playerId, landArea);
      },
      1000,
      source
    );
  });

  // ==================== 领地保护事件 ====================

  /**
   * 玩家放置方块
   */
  world.beforeEvents.playerPlaceBlock.subscribe((event) => {
    const { player, block } = event;
    const { isInside, insideLand } = landManager.testLand(block.location, block.dimension.id);

    if (!isInside || !insideLand) return;
    if (insideLand.owner === player.name) return;
    if (isAdmin(player)) return;
    if (insideLand.members.includes(player.name)) return;
    if (insideLand.public_auth.place) return;

    event.cancel = true;
    // 必须延迟发送消息，beforeEvents 中直接调用 sendMessage 可能导致事件处理异常
    const playerName = player.name;
    const ownerName = insideLand.owner;
    system.run(() => {
      const p = world.getPlayers().find((pl) => pl.name === playerName);
      if (p) {
        useNotify("chat", p, color.red(`这里是 ${color.yellow(ownerName)} ${color.red("的领地，你没有权限这么做！")}`));
      }
    });
  });

  /**
   * 玩家破坏方块
   */
  world.beforeEvents.playerBreakBlock.subscribe((event) => {
    const { player, block } = event;
    const { isInside, insideLand } = landManager.testLand(block.location, block.dimension.id);

    if (!isInside || !insideLand) return;
    if (insideLand.owner === player.name) return;
    if (isAdmin(player)) return;
    if (insideLand.public_auth.break) return;
    if (insideLand.members.includes(player.name)) return;

    event.cancel = true;
    // 必须延迟发送消息，beforeEvents 中直接调用 sendMessage 可能导致事件处理异常
    const playerName = player.name;
    const ownerName = insideLand.owner;
    system.run(() => {
      const p = world.getPlayers().find((pl) => pl.name === playerName);
      if (p) {
        useNotify("chat", p, color.red(`这里是 ${color.yellow(ownerName)} ${color.red("的领地，你没有权限这么做！")}`));
      }
    });
  });

  /**
   * 玩家与方块交互
   */
  world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    const { player, block, itemStack } = event;
    const { isInside, insideLand } = landManager.testLand(block.location, block.dimension.id);

    if (!isInside || !insideLand) return;
    if (insideLand.owner === player.name) return;
    if (isAdmin(player)) return;
    if (insideLand.members.includes(player.name)) return;

    // 延迟发送领地警告消息的辅助函数
    const sendLandWarning = (playerName: string, ownerName: string) => {
      system.run(() => {
        const p = world.getPlayers().find((pl) => pl.name === playerName);
        if (p) {
          useNotify(
            "chat",
            p,
            color.red(`这里是 ${color.yellow(ownerName)} ${color.red("的领地，你没有权限这么做！")}`)
          );
        }
      });
    };

    // 方块类型分类
    const chests = [
      MinecraftBlockTypes.Chest,
      MinecraftBlockTypes.EnderChest,
      MinecraftBlockTypes.Beehive,
      MinecraftBlockTypes.TrappedChest,
      MinecraftBlockTypes.Barrel,
      MinecraftBlockTypes.RedShulkerBox,
      MinecraftBlockTypes.OrangeShulkerBox,
      MinecraftBlockTypes.YellowShulkerBox,
      MinecraftBlockTypes.LimeShulkerBox,
      MinecraftBlockTypes.GreenShulkerBox,
      MinecraftBlockTypes.LightBlueShulkerBox,
      MinecraftBlockTypes.CyanShulkerBox,
      MinecraftBlockTypes.BlueShulkerBox,
      MinecraftBlockTypes.PurpleShulkerBox,
      MinecraftBlockTypes.MagentaShulkerBox,
      MinecraftBlockTypes.PinkShulkerBox,
      MinecraftBlockTypes.GrayShulkerBox,
      MinecraftBlockTypes.LightGrayShulkerBox,
      MinecraftBlockTypes.BlackShulkerBox,
      MinecraftBlockTypes.BrownShulkerBox,
      MinecraftBlockTypes.WhiteShulkerBox,
      MinecraftBlockTypes.UndyedShulkerBox,
    ];

    const buttons = [
      MinecraftBlockTypes.StoneButton,
      MinecraftBlockTypes.BambooButton,
      MinecraftBlockTypes.SpruceButton,
      MinecraftBlockTypes.BirchButton,
      MinecraftBlockTypes.CherryButton,
      MinecraftBlockTypes.JungleButton,
      MinecraftBlockTypes.AcaciaButton,
      MinecraftBlockTypes.DarkOakButton,
      MinecraftBlockTypes.CrimsonButton,
      MinecraftBlockTypes.WarpedButton,
      MinecraftBlockTypes.MangroveButton,
      MinecraftBlockTypes.PolishedBlackstoneButton,
      MinecraftBlockTypes.WoodenButton,
      MinecraftBlockTypes.Lever,
    ];

    const smelting = [
      MinecraftBlockTypes.Furnace,
      MinecraftBlockTypes.BlastFurnace,
      MinecraftBlockTypes.Smoker,
      MinecraftBlockTypes.Campfire,
      MinecraftBlockTypes.SmithingTable,
      MinecraftBlockTypes.Anvil,
      MinecraftBlockTypes.Grindstone,
      MinecraftBlockTypes.CartographyTable,
      MinecraftBlockTypes.Loom,
      MinecraftBlockTypes.EnchantingTable,
      MinecraftBlockTypes.Jukebox,
      MinecraftBlockTypes.Beacon,
      MinecraftBlockTypes.CraftingTable,
      MinecraftBlockTypes.RespawnAnchor,
      MinecraftBlockTypes.BrewingStand,
      MinecraftBlockTypes.Bed,
      // MinecraftBlockTypes.Stonecutter,
    ];

    const redstone = [
      MinecraftBlockTypes.Observer,
      MinecraftBlockTypes.Dispenser,
      MinecraftBlockTypes.DaylightDetector,
      MinecraftBlockTypes.DaylightDetectorInverted,
      MinecraftBlockTypes.UnpoweredRepeater,
      MinecraftBlockTypes.UnpoweredComparator,
      MinecraftBlockTypes.Hopper,
      MinecraftBlockTypes.Crafter,
    ];

    const fireItems = [
      "minecraft:fire_charge",
      "minecraft:flint_and_steel",
      "minecraft:water_bucket",
      "minecraft:lava_bucket",
    ];

    // 预先保存玩家名和领地主人名，避免在 system.run 中访问 beforeEvent 的对象
    const playerName = player.name;
    const ownerName = insideLand.owner;

    // 检查箱子权限
    if (chests.includes(block.typeId as MinecraftBlockTypes)) {
      if (!insideLand.public_auth.isChestOpen) {
        event.cancel = true;
        sendLandWarning(playerName, ownerName);
      }
      return;
    }

    // 检查按钮权限
    if (buttons.includes(block.typeId as MinecraftBlockTypes)) {
      if (!insideLand.public_auth.useButton) {
        event.cancel = true;
        sendLandWarning(playerName, ownerName);
      }
      return;
    }

    // 检查告示牌权限
    if (block.typeId.endsWith("sign")) {
      if (!insideLand.public_auth.useSign) {
        event.cancel = true;
        sendLandWarning(playerName, ownerName);
      }
      return;
    }

    // 检查红石权限
    if (redstone.includes(block.typeId as MinecraftBlockTypes)) {
      if (!insideLand.public_auth.useRedstone) {
        event.cancel = true;
        sendLandWarning(playerName, ownerName);
      }
      return;
    }

    // 检查锻造类权限
    if (smelting.includes(block.typeId as MinecraftBlockTypes)) {
      if (!insideLand.public_auth.useSmelting) {
        event.cancel = true;
        sendLandWarning(playerName, ownerName);
      }
      return;
    }

    // 检查火焰物品权限
    if (fireItems.includes(itemStack?.typeId ?? "")) {
      if (!insideLand.public_auth.burn) {
        event.cancel = true;
        sendLandWarning(playerName, ownerName);
      }
      return;
    }

    // 检查通用方块交互权限
    if (!insideLand.public_auth.useBlock) {
      event.cancel = true;
      sendLandWarning(playerName, ownerName);
    }
  });

  /**
   * 玩家与实体交互
   */
  world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
    const { player, target } = event;
    const { isInside, insideLand } = landManager.testLand(target.location, target.dimension.id);

    if (!isInside || !insideLand) return;
    if (insideLand.owner === player.name) return;
    if (isAdmin(player)) return;
    if (insideLand.public_auth.useEntity) return;
    if (insideLand.members.includes(player.name)) return;

    event.cancel = true;
    // 必须延迟发送消息，beforeEvents 中直接调用 sendMessage 可能导致事件处理异常
    const playerName = player.name;
    const ownerName = insideLand.owner;
    system.run(() => {
      const p = world.getPlayers().find((pl) => pl.name === playerName);
      if (p) {
        useNotify("chat", p, color.red(`这里是 ${color.yellow(ownerName)} ${color.red("的领地，你没有权限这么做！")}`));
      }
    });
  });

  /**
   * 爆炸保护
   */
  world.beforeEvents.explosion.subscribe((event) => {
    const impactedBlocks = event.getImpactedBlocks();
    const impact = impactedBlocks.filter((block) => {
      const { isInside, insideLand } = landManager.testLand(block.location, event.dimension.id);
      // 如果在领地内且开放爆炸权限，则返回true
      // 如果不在领地内，则返回true
      // 否则返回false
      return isInside ? insideLand?.public_auth?.explode : true;
    });
    event.setImpactedBlocks(impact);
  });

  /**
   * 玩家攻击领地内生物
   */
  world.beforeEvents;
}

// 注册到事件中心
eventRegistry.register("land", registerLandEvents);
