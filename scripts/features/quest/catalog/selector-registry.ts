export interface QuestItemSnapshot {
  typeId: string;
  amount: number;
  componentIds?: readonly string[];
  enchantments?: readonly QuestEnchantmentSnapshot[];
}

export interface QuestEnchantmentSnapshot {
  typeId: string;
  level: number;
}

export interface QuestEquipmentSnapshot {
  slots: Readonly<Record<string, QuestItemSnapshot | undefined>>;
}

export type QuestSelectorDefinition =
  | {
      id: string;
      kind: "item_ids";
      itemIds: readonly string[];
    }
  | {
      id: string;
      kind: "equipment_slot";
      slot: string;
      itemIds: readonly string[];
    }
  | {
      id: string;
      kind: "enchantment";
      scope: "inventory" | "equipment";
      enchantmentIds: readonly string[];
    }
  | {
      id: string;
      /** Registered for catalog validation, but deliberately cannot match until its dedicated provider exists. */
      kind: "deferred";
      source: "component" | "world_state" | "historical_counter";
    };

export class QuestSelectorRegistry {
  private readonly selectors = new Map<string, QuestSelectorDefinition>();

  register(definition: QuestSelectorDefinition): void {
    if (this.selectors.has(definition.id)) throw new Error(`Duplicate quest selector: ${definition.id}`);
    this.selectors.set(definition.id, definition);
  }

  has(id: string): boolean {
    return this.selectors.has(id);
  }

  get(id: string): QuestSelectorDefinition | undefined {
    return this.selectors.get(id);
  }

  getAll(): QuestSelectorDefinition[] {
    return Array.from(this.selectors.values());
  }

  matchItem(selectorId: string, item: QuestItemSnapshot): boolean {
    const selector = this.selectors.get(selectorId);
    if (!selector) return false;
    if (selector.kind === "item_ids") return selector.itemIds.includes(item.typeId);
    if (selector.kind !== "enchantment" || selector.scope !== "inventory") return false;
    return (item.enchantments ?? []).some((entry) => selector.enchantmentIds.includes(entry.typeId));
  }

  matchEquipment(selectorId: string, equipment: QuestEquipmentSnapshot): boolean {
    const selector = this.selectors.get(selectorId);
    if (!selector) return false;
    if (selector.kind === "equipment_slot") {
      const item = equipment.slots[selector.slot];
      return !!item && selector.itemIds.includes(item.typeId);
    }
    if (selector.kind !== "enchantment" || selector.scope !== "equipment") return false;
    return Object.values(equipment.slots).some((item) =>
      (item?.enchantments ?? []).some((entry) => selector.enchantmentIds.includes(entry.typeId))
    );
  }
}

export function createDefaultQuestSelectorRegistry(): QuestSelectorRegistry {
  const registry = new QuestSelectorRegistry();
  const itemSelectors: Array<[string, readonly string[]]> = [
    [
      "selector.item.logs",
      [
        "minecraft:oak_log",
        "minecraft:spruce_log",
        "minecraft:birch_log",
        "minecraft:jungle_log",
        "minecraft:acacia_log",
        "minecraft:dark_oak_log",
        "minecraft:mangrove_log",
        "minecraft:cherry_log",
        "minecraft:pale_oak_log",
        "minecraft:crimson_stem",
        "minecraft:warped_stem",
      ],
    ],
    ["selector.item.crafting_table", ["minecraft:crafting_table"]],
    ["selector.item.stone_pickaxe", ["minecraft:stone_pickaxe"]],
    ["selector.item.furnace", ["minecraft:furnace"]],
    ["selector.item.iron_pickaxe", ["minecraft:iron_pickaxe"]],
    ["selector.item.diamond_pickaxe", ["minecraft:diamond_pickaxe"]],
    ["selector.item.torches", ["minecraft:torch", "minecraft:soul_torch"]],
    [
      "selector.item.beds",
      [
        "minecraft:white_bed",
        "minecraft:orange_bed",
        "minecraft:magenta_bed",
        "minecraft:light_blue_bed",
        "minecraft:yellow_bed",
        "minecraft:lime_bed",
        "minecraft:pink_bed",
        "minecraft:gray_bed",
        "minecraft:light_gray_bed",
        "minecraft:cyan_bed",
        "minecraft:purple_bed",
        "minecraft:blue_bed",
        "minecraft:brown_bed",
        "minecraft:green_bed",
        "minecraft:red_bed",
        "minecraft:black_bed",
      ],
    ],
    ["selector.item.shield", ["minecraft:shield"]],
    ["selector.item.bucket", ["minecraft:bucket"]],
    ["selector.item.enchanting_table", ["minecraft:enchanting_table"]],
    ["selector.item.bookshelves", ["minecraft:bookshelf"]],
    ["selector.item.anvil", ["minecraft:anvil", "minecraft:chipped_anvil", "minecraft:damaged_anvil"]],
    ["selector.item.enchanted_book", ["minecraft:enchanted_book"]],
    ["selector.item.nether_wart", ["minecraft:nether_wart"]],
    ["selector.item.brewing_stand", ["minecraft:brewing_stand"]],
    ["selector.item.netherite_ingot", ["minecraft:netherite_ingot"]],
    ["selector.item.blaze_powder", ["minecraft:blaze_powder"]],
    ["selector.item.ender_eyes", ["minecraft:ender_eye"]],
    ["selector.item.dragon_breath", ["minecraft:dragon_breath"]],
    ["selector.item.chorus_fruit", ["minecraft:chorus_fruit"]],
    ["selector.item.elytra", ["minecraft:elytra"]],
    [
      "selector.item.shulker_boxes",
      [
        "minecraft:shulker_box",
        "minecraft:white_shulker_box",
        "minecraft:orange_shulker_box",
        "minecraft:magenta_shulker_box",
        "minecraft:light_blue_shulker_box",
        "minecraft:yellow_shulker_box",
        "minecraft:lime_shulker_box",
        "minecraft:pink_shulker_box",
        "minecraft:gray_shulker_box",
        "minecraft:light_gray_shulker_box",
        "minecraft:cyan_shulker_box",
        "minecraft:purple_shulker_box",
        "minecraft:blue_shulker_box",
        "minecraft:brown_shulker_box",
        "minecraft:green_shulker_box",
        "minecraft:red_shulker_box",
        "minecraft:black_shulker_box",
      ],
    ],
    ["selector.item.wither_skeleton_skulls", ["minecraft:wither_skeleton_skull"]],
    ["selector.item.nether_star", ["minecraft:nether_star"]],
    ["selector.item.beacon", ["minecraft:beacon"]],
    ["selector.item.ominous_bottles", ["minecraft:ominous_bottle"]],
    ["selector.item.totem_of_undying", ["minecraft:totem_of_undying"]],
    ["selector.item.heart_of_the_sea", ["minecraft:heart_of_the_sea"]],
    ["selector.item.sponges", ["minecraft:sponge", "minecraft:wet_sponge"]],
    ["selector.item.brush", ["minecraft:brush"]],
    [
      "selector.item.pottery_sherds",
      [
        "minecraft:angler_pottery_sherd",
        "minecraft:archer_pottery_sherd",
        "minecraft:arms_up_pottery_sherd",
        "minecraft:blade_pottery_sherd",
        "minecraft:brewer_pottery_sherd",
        "minecraft:burn_pottery_sherd",
        "minecraft:danger_pottery_sherd",
        "minecraft:explorer_pottery_sherd",
        "minecraft:friend_pottery_sherd",
        "minecraft:heart_pottery_sherd",
        "minecraft:heartbreak_pottery_sherd",
        "minecraft:howl_pottery_sherd",
        "minecraft:miner_pottery_sherd",
        "minecraft:mourner_pottery_sherd",
        "minecraft:plenty_pottery_sherd",
        "minecraft:prize_pottery_sherd",
        "minecraft:sheaf_pottery_sherd",
        "minecraft:shelter_pottery_sherd",
        "minecraft:skull_pottery_sherd",
        "minecraft:snort_pottery_sherd",
      ],
    ],
    ["selector.item.decorated_pot", ["minecraft:decorated_pot"]],
    ["selector.item.sniffer_egg", ["minecraft:sniffer_egg"]],
    ["selector.item.torchflower_seeds", ["minecraft:torchflower_seeds"]],
    ["selector.item.pitcher_pod", ["minecraft:pitcher_pod"]],
    ["selector.item.sculk", ["minecraft:sculk"]],
    ["selector.item.echo_shards", ["minecraft:echo_shard"]],
    ["selector.item.recovery_compass", ["minecraft:recovery_compass"]],
    ["selector.item.breeze_rod", ["minecraft:breeze_rod"]],
    ["selector.item.trial_key", ["minecraft:trial_key"]],
    ["selector.item.ominous_trial_key", ["minecraft:ominous_trial_key"]],
    ["selector.item.heavy_core", ["minecraft:heavy_core"]],
    ["selector.item.mace", ["minecraft:mace"]],
    ["selector.item.honey_bottle", ["minecraft:honey_bottle"]],
    ["selector.item.redstone", ["minecraft:redstone"]],
    ["selector.item.piston", ["minecraft:piston"]],
    ["selector.item.observer", ["minecraft:observer"]],
    ["selector.item.comparator", ["minecraft:comparator"]],
    ["selector.item.hopper", ["minecraft:hopper"]],
    ["selector.item.crafter", ["minecraft:crafter"]],
    ["selector.item.pale_oak_logs", ["minecraft:pale_oak_log"]],
    ["selector.item.creaking_heart", ["minecraft:creaking_heart"]],
    ["selector.item.resin_items", ["minecraft:resin_clump", "minecraft:resin_brick"]],
    ["selector.item.copper_pickaxe", ["minecraft:copper_pickaxe"]],
    ["selector.item.copper_chest", ["minecraft:copper_chest"]],
    ["selector.item.dried_ghast", ["minecraft:dried_ghast"]],
    [
      "selector.item.happy_ghast_harness",
      [
        "minecraft:white_harness",
        "minecraft:orange_harness",
        "minecraft:magenta_harness",
        "minecraft:light_blue_harness",
        "minecraft:yellow_harness",
        "minecraft:lime_harness",
        "minecraft:pink_harness",
        "minecraft:gray_harness",
        "minecraft:light_gray_harness",
        "minecraft:cyan_harness",
        "minecraft:purple_harness",
        "minecraft:blue_harness",
        "minecraft:brown_harness",
        "minecraft:green_harness",
        "minecraft:red_harness",
        "minecraft:black_harness",
      ],
    ],
    [
      "selector.item.spears",
      [
        "minecraft:wooden_spear",
        "minecraft:stone_spear",
        "minecraft:copper_spear",
        "minecraft:iron_spear",
        "minecraft:golden_spear",
        "minecraft:diamond_spear",
        "minecraft:netherite_spear",
      ],
    ],
    ["selector.item.name_tag", ["minecraft:name_tag"]],
    ["selector.item.sulfur_materials", ["minecraft:sulfur", "minecraft:sulfur_dust"]],
    ["selector.item.cinnabar_materials", ["minecraft:cinnabar", "minecraft:raw_cinnabar"]],
    ["selector.item.bucket_of_sulfur_cube", ["minecraft:bucket_of_sulfur_cube"]],
    ["selector.item.bounce_music_disc", ["minecraft:music_disc_bounce"]],
    ["selector.item.poplar_log", ["minecraft:poplar_log"]],
    ["selector.item.shelf_mushroom", ["minecraft:shelf_mushroom"]],
    ["selector.item.red_shrub", ["minecraft:red_shrub"]],
  ];
  for (const [id, itemIds] of itemSelectors) registry.register({ id, kind: "item_ids", itemIds });

  for (const [id, slot, itemId] of [
    ["selector.equipment.iron_helmet", "Head", "minecraft:iron_helmet"],
    ["selector.equipment.iron_chestplate", "Chest", "minecraft:iron_chestplate"],
    ["selector.equipment.iron_leggings", "Legs", "minecraft:iron_leggings"],
    ["selector.equipment.iron_boots", "Feet", "minecraft:iron_boots"],
    ["selector.equipment.copper_helmet", "Head", "minecraft:copper_helmet"],
    ["selector.equipment.copper_chestplate", "Chest", "minecraft:copper_chestplate"],
    ["selector.equipment.copper_leggings", "Legs", "minecraft:copper_leggings"],
    ["selector.equipment.copper_boots", "Feet", "minecraft:copper_boots"],
  ] as const) {
    registry.register({ id, kind: "equipment_slot", slot, itemIds: [itemId] });
  }

  registry.register({
    id: "selector.enchantment.swift_sneak.inventory",
    kind: "enchantment",
    scope: "inventory",
    enchantmentIds: ["minecraft:swift_sneak"],
  });
  registry.register({
    id: "selector.enchantment.swift_sneak.equipment",
    kind: "enchantment",
    scope: "equipment",
    enchantmentIds: ["minecraft:swift_sneak"],
  });

  for (const [id, source] of [
    ["selector.item.treasure_maps", "component"],
    ["selector.world.active_conduit", "world_state"],
    ["selector.world.full_beacon", "world_state"],
    ["selector.counter.boss_kill_count", "historical_counter"],
  ] as const) {
    registry.register({ id, kind: "deferred", source });
  }
  return registry;
}
