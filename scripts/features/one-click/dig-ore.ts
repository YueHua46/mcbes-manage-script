/**
 * 一键挖矿功能
 * 完整迁移自 Modules/OneClick/DigOre/DigOre.ts (178行)
 */

import {
  world,
  ItemStack,
  ItemLockMode,
  GameMode,
  Player,
  Vector3,
  Dimension,
  EquipmentSlot,
  EntityEquippableComponent,
  ItemDurabilityComponent,
  ItemEnchantableComponent,
} from "@minecraft/server";
import { splitGroups, getRandomRangeValue, getRadiusRange } from "@mcbe-mods/utils";
import setting from "../system/services/setting";

// ==================== 镐子等级配置 ====================
const wooden = [
  "minecraft:coal_ore",
  "minecraft:deepslate_coal_ore",
  "minecraft:quartz_ore",
  "minecraft:nether_gold_ore",
];
const golden = wooden;
const stone = [
  ...wooden,
  "minecraft:copper_ore",
  "minecraft:deepslate_copper_ore",
  "minecraft:lapis_ore",
  "minecraft:deepslate_lapis_ore",
  "minecraft:iron_ore",
  "minecraft:deepslate_iron_ore",
];
const copper = stone;
const iron = [
  ...stone,
  "minecraft:gold_ore",
  "minecraft:deepslate_gold_ore",
  "minecraft:nether_gold_ore",
  "minecraft:redstone_ore",
  "minecraft:deepslate_redstone_ore",
  "minecraft:lit_redstone_ore",
  "minecraft:lit_deepslate_redstone_ore",
  "minecraft:diamond_ore",
  "minecraft:deepslate_diamond_ore",
  "minecraft:emerald_ore",
  "minecraft:deepslate_emerald_ore",
];
const diamond = [...iron, "minecraft:ancient_debris", "minecraft:obsidian", "minecraft:crying_obsidian"];
const netherite = diamond;

const pickaxe_level = {
  "minecraft:wooden_pickaxe": wooden,
  "minecraft:stone_pickaxe": stone,
  "minecraft:copper_pickaxe": copper,
  "minecraft:iron_pickaxe": iron,
  "minecraft:golden_pickaxe": golden,
  "minecraft:diamond_pickaxe": diamond,
  "minecraft:netherite_pickaxe": netherite,
};

// ==================== 矿石掉落配置 ====================
const iron_ore = {
  item: "raw_iron",
  xp: [0, 0],
  probability: [1, 1],
  support: {
    fortune: true,
    silk_touch: true,
  },
};

const gold_ore = {
  item: "raw_gold",
  xp: [0, 0],
  probability: [1, 1],
  support: {
    fortune: true,
    silk_touch: true,
  },
};

const nether_gold_ore = {
  item: "gold_nugget",
  xp: [0, 1],
  probability: [2, 6],
  support: {
    fortune: true,
    silk_touch: true,
  },
};

const diamond_ore = {
  item: "diamond",
  xp: [3, 7],
  probability: [1, 1],
  support: {
    fortune: true,
    silk_touch: true,
  },
};

const lapis_ore = {
  item: "lapis_lazuli",
  xp: [2, 5],
  probability: [4, 9],
  support: {
    fortune: true,
    silk_touch: true,
  },
};

const redstone_ore = {
  item: "redstone",
  xp: [1, 5],
  probability: [4, 5],
  support: {
    fortune: true,
    silk_touch: true,
  },
};

const copper_ore = {
  item: "raw_copper",
  xp: [0, 0],
  probability: [2, 5],
  support: {
    fortune: true,
    silk_touch: true,
  },
};

const emerald_ore = {
  item: "emerald",
  xp: [3, 7],
  probability: [1, 1],
  support: {
    fortune: true,
    silk_touch: true,
  },
};

const coal_ore = {
  item: "coal",
  xp: [0, 2],
  probability: [1, 1],
  support: {
    fortune: true,
    silk_touch: true,
  },
};

const quartz_ore = {
  item: "quartz",
  xp: [2, 5],
  probability: [1, 1],
  support: {
    fortune: true,
    silk_touch: true,
  },
};

const ancient_debris = {
  item: "ancient_debris",
  xp: [0, 0],
  probability: [1, 1],
  support: {
    fortune: false,
    silk_touch: false,
  },
};

const obsidian_drop = {
  item: "obsidian",
  xp: [0, 0],
  probability: [1, 1],
  support: {
    fortune: false,
    silk_touch: true,
  },
};

const crying_obsidian_drop = {
  item: "crying_obsidian",
  xp: [0, 0],
  probability: [1, 1],
  support: {
    fortune: false,
    silk_touch: true,
  },
};

const ore_map = {
  "minecraft:iron_ore": iron_ore,
  "minecraft:deepslate_iron_ore": iron_ore,
  "minecraft:gold_ore": gold_ore,
  "minecraft:deepslate_gold_ore": gold_ore,
  "minecraft:nether_gold_ore": nether_gold_ore,
  "minecraft:diamond_ore": diamond_ore,
  "minecraft:deepslate_diamond_ore": diamond_ore,
  "minecraft:lapis_ore": lapis_ore,
  "minecraft:deepslate_lapis_ore": lapis_ore,
  "minecraft:redstone_ore": redstone_ore,
  "minecraft:deepslate_redstone_ore": redstone_ore,
  "minecraft:lit_redstone_ore": redstone_ore,
  "minecraft:lit_deepslate_redstone_ore": redstone_ore,
  "minecraft:copper_ore": copper_ore,
  "minecraft:deepslate_copper_ore": copper_ore,
  "minecraft:emerald_ore": emerald_ore,
  "minecraft:deepslate_emerald_ore": emerald_ore,
  "minecraft:coal_ore": coal_ore,
  "minecraft:deepslate_coal_ore": coal_ore,
  "minecraft:quartz_ore": quartz_ore,
  "minecraft:ancient_debris": ancient_debris,
  "minecraft:obsidian": obsidian_drop,
  "minecraft:crying_obsidian": crying_obsidian_drop,
};

// ==================== 主逻辑 ====================

const isSurvivalPlayer = (dimension: Dimension, player: Player) =>
  dimension.getPlayers({ gameMode: GameMode.Survival }).some((p) => p.name === player.name);

/**
 * 一键挖矿主函数
 */
async function digOre(player: Player, dimension: Dimension, location: Vector3, blockTypeId: string) {
  const equipmentInventory = player.getComponent(EntityEquippableComponent.componentId) as EntityEquippableComponent;
  if (!equipmentInventory) return;

  const mainHand = equipmentInventory.getEquipmentSlot(EquipmentSlot.Mainhand);

  if (!mainHand || !mainHand.hasItem()) return;

  try {
    const currentSlotItem = mainHand.getItem();
    if (!currentSlotItem) return;

    const pickaxe = pickaxe_level[currentSlotItem.typeId as keyof typeof pickaxe_level];

    // 必须潜行且持有镐子
    if (!player.isSneaking || !currentSlotItem.hasTag("is_pickaxe")) return;

    const survivalPlayer = isSurvivalPlayer(dimension, player);

    if (survivalPlayer) mainHand.lockMode = ItemLockMode.slot;

    const itemDurability = currentSlotItem.getComponent(ItemDurabilityComponent.componentId) as ItemDurabilityComponent;
    const enchantments = currentSlotItem.getComponent(ItemEnchantableComponent.componentId) as ItemEnchantableComponent;

    if (!enchantments || !itemDurability) return;

    const unbreaking = enchantments.getEnchantment("unbreaking")?.level || 0;
    const silk_touch = enchantments.hasEnchantment("silk_touch");
    const fortune = enchantments.getEnchantment("fortune")?.level || 0;

    let itemMaxDamage = itemDurability.damage * (1 + unbreaking);
    const itemMaxDurability = itemDurability.maxDurability * (1 + unbreaking);

    const blockTypeIdRemoveLit = blockTypeId.replace("lit_", "");

    const set = new Set();
    const stack = [...getRadiusRange(location)];

    // 迭代处理相邻方块
    while (stack.length > 0) {
      const _block = dimension.getBlock(stack.shift()!);

      if (!_block) continue;

      const typeId = _block.typeId;

      // 处理lit_redstone_ore
      const isEqual = typeId.replace("lit_", "") === blockTypeIdRemoveLit;
      if (isEqual && pickaxe.includes(typeId)) {
        const pos = JSON.stringify(_block.location);

        if (set.has(pos)) continue;

        itemMaxDamage++;
        if (survivalPlayer && itemMaxDamage >= itemMaxDurability) {
          continue;
        }

        await new Promise<void>((resolve) => {
          _block.setType("air");
          resolve();
        });

        set.add(pos);
        stack.push(...getRadiusRange(_block.location));
      }
    }

    const _ore = ore_map[blockTypeId as keyof typeof ore_map];
    if (!_ore) return;

    if (silk_touch && _ore.support.silk_touch) {
      // 精准采集
      splitGroups(set.size).forEach((group) => {
        dimension.spawnItem(new ItemStack(blockTypeIdRemoveLit, group), location);
      });
    } else {
      // 普通掉落
      const ore = {
        item: _ore.item,
        xp: [..._ore.xp],
        probability: [..._ore.probability],
      };

      // 添加时运效果
      if (fortune && _ore.support.fortune) {
        const maxProbability = ore.probability.pop() as number;
        ore.probability.push(maxProbability + fortune);
      }

      // 计算掉落概率
      const oreMap = { item: 0, xp: 0 };
      for (let i = 0; i < set.size; i++) {
        oreMap.xp += getRandomRangeValue(ore.xp[0], ore.xp[1]);
        oreMap.item += getRandomRangeValue(ore.probability[0], ore.probability[1]);
      }

      // 生成经验球
      for (let i = 0; i < oreMap.xp; i++) {
        dimension.spawnEntity("minecraft:xp_orb", player.location);
      }

      // 生成掉落物
      splitGroups(oreMap.item).forEach((group) => {
        dimension.spawnItem(new ItemStack(ore.item, group), location);
      });
    }

    if (survivalPlayer) {
      // 设置镐子耐久
      const damage = Math.ceil((itemMaxDamage * 1) / (1 + unbreaking));
      itemDurability.damage = damage > itemDurability.maxDurability ? itemDurability.maxDurability : damage;
      mainHand.setItem(currentSlotItem);
    }
  } catch (_error) {
    const error = _error as Error;
    // console.error(error.name);
    // console.error(error.message);
    // console.error(error);
  } finally {
    mainHand.lockMode = ItemLockMode.none;
  }
}

// 监听方块破坏事件
world.afterEvents.playerBreakBlock.subscribe(async (e) => {
  if (!setting.getState("enableDigOreOneClick")) return;
  const { dimension, player, block } = e;
  const currentBreakBlock = e.brokenBlockPermutation;
  const blockTypeId = currentBreakBlock.type.id;
  digOre(player, dimension, block.location, blockTypeId);
});

export {};
