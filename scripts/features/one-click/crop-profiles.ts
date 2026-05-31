/**
 * 作物 profile 定义（不含可可豆）
 */

export type HarvestMode =
  | "break-mature"
  | "clip-mature"
  | "sugar-cane-column"
  | "column-above-base"
  | "berry-blocks";

export type PlantMode =
  | "farmland-air"
  | "substrate-air"
  | "water-adjacent-air"
  | "farmland-double"
  | "underwater-air"
  | "bamboo-sapling"
  | "ceiling-vine";

export type MaturityRule = {
  stateKey: "growth" | "age" | "kelp_age";
  min: number;
};

export type CropProfile = {
  id: string;
  blockTypeIds: string[];
  seedTypeId: string;
  plantBlockId: string;
  /** 是否参与一键播种（果实方块等仅收割） */
  plantEnabled?: boolean;
  plant: {
    mode: PlantMode;
    substrates?: readonly string[];
  };
  harvest: {
    mode: HarvestMode;
    maturity?: MaturityRule;
    /** clip 后重置的状态 */
    clipReset?: { stateKey: "growth" | "age"; value: number };
    /** berry-blocks 模式可收割的方块 id */
    berryBlockIds?: readonly string[];
  };
  clipInteract?: boolean;
};

const SOLID_FARM_SUBSTRATES = [
  "minecraft:grass_block",
  "minecraft:dirt",
  "minecraft:coarse_dirt",
  "minecraft:podzol",
  "minecraft:farmland",
  "minecraft:moss_block",
  "minecraft:mud",
  "minecraft:muddy_mangrove_roots",
  "minecraft:dirt_with_roots",
] as const;

const CANE_SUBSTRATES = [
  "minecraft:grass_block",
  "minecraft:dirt",
  "minecraft:coarse_dirt",
  "minecraft:sand",
  "minecraft:red_sand",
  "minecraft:podzol",
  "minecraft:moss_block",
  "minecraft:mud",
] as const;

const BAMBOO_SUBSTRATES = [
  "minecraft:grass_block",
  "minecraft:dirt",
  "minecraft:sand",
  "minecraft:gravel",
  "minecraft:podzol",
  "minecraft:mud",
  "minecraft:bamboo",
  "minecraft:bamboo_block",
] as const;

const KELP_SUBSTRATES = [
  "minecraft:grass_block",
  "minecraft:dirt",
  "minecraft:sand",
  "minecraft:gravel",
  "minecraft:clay",
  "minecraft:kelp",
] as const;

export const CROP_PROFILES: CropProfile[] = [
  {
    id: "wheat",
    blockTypeIds: ["minecraft:wheat"],
    seedTypeId: "minecraft:wheat_seeds",
    plantBlockId: "minecraft:wheat",
    plant: { mode: "farmland-air" },
    harvest: { mode: "clip-mature", maturity: { stateKey: "growth", min: 7 }, clipReset: { stateKey: "growth", value: 0 } },
    clipInteract: true,
  },
  {
    id: "carrots",
    blockTypeIds: ["minecraft:carrots"],
    seedTypeId: "minecraft:carrot",
    plantBlockId: "minecraft:carrots",
    plant: { mode: "farmland-air" },
    harvest: { mode: "break-mature", maturity: { stateKey: "growth", min: 7 } },
  },
  {
    id: "potatoes",
    blockTypeIds: ["minecraft:potatoes"],
    seedTypeId: "minecraft:potato",
    plantBlockId: "minecraft:potatoes",
    plant: { mode: "farmland-air" },
    harvest: { mode: "break-mature", maturity: { stateKey: "growth", min: 7 } },
  },
  {
    id: "beetroot",
    blockTypeIds: ["minecraft:beetroot"],
    seedTypeId: "minecraft:beetroot_seeds",
    plantBlockId: "minecraft:beetroot",
    plant: { mode: "farmland-air" },
    harvest: { mode: "break-mature", maturity: { stateKey: "growth", min: 3 } },
  },
  {
    id: "nether_wart",
    blockTypeIds: ["minecraft:nether_wart"],
    seedTypeId: "minecraft:nether_wart",
    plantBlockId: "minecraft:nether_wart",
    plant: { mode: "substrate-air", substrates: ["minecraft:soul_sand", "minecraft:soul_soil"] },
    harvest: { mode: "break-mature", maturity: { stateKey: "age", min: 3 } },
  },
  {
    id: "sweet_berry",
    blockTypeIds: ["minecraft:sweet_berry_bush"],
    seedTypeId: "minecraft:sweet_berries",
    plantBlockId: "minecraft:sweet_berry_bush",
    plant: { mode: "substrate-air", substrates: SOLID_FARM_SUBSTRATES },
    harvest: {
      mode: "clip-mature",
      maturity: { stateKey: "growth", min: 3 },
      clipReset: { stateKey: "growth", value: 1 },
    },
    clipInteract: true,
  },
  {
    id: "sugar_cane",
    blockTypeIds: ["minecraft:reeds"],
    seedTypeId: "minecraft:sugar_cane",
    plantBlockId: "minecraft:reeds",
    plant: { mode: "water-adjacent-air", substrates: CANE_SUBSTRATES },
    harvest: { mode: "sugar-cane-column" },
  },
  {
    id: "melon_stem",
    blockTypeIds: ["minecraft:melon_stem"],
    seedTypeId: "minecraft:melon_seeds",
    plantBlockId: "minecraft:melon_stem",
    plant: { mode: "farmland-air" },
    harvest: { mode: "break-mature", maturity: { stateKey: "growth", min: 7 } },
  },
  {
    id: "pumpkin_stem",
    blockTypeIds: ["minecraft:pumpkin_stem"],
    seedTypeId: "minecraft:pumpkin_seeds",
    plantBlockId: "minecraft:pumpkin_stem",
    plant: { mode: "farmland-air" },
    harvest: { mode: "break-mature", maturity: { stateKey: "growth", min: 7 } },
  },
  {
    id: "melon",
    blockTypeIds: ["minecraft:melon_block"],
    seedTypeId: "minecraft:melon_seeds",
    plantBlockId: "minecraft:melon_stem",
    plantEnabled: false,
    plant: { mode: "farmland-air" },
    harvest: { mode: "break-mature" },
  },
  {
    id: "pumpkin",
    blockTypeIds: ["minecraft:pumpkin"],
    seedTypeId: "minecraft:pumpkin_seeds",
    plantBlockId: "minecraft:pumpkin_stem",
    plantEnabled: false,
    plant: { mode: "farmland-air" },
    harvest: { mode: "break-mature" },
  },
  {
    id: "torchflower",
    blockTypeIds: ["minecraft:torchflower_crop"],
    seedTypeId: "minecraft:torchflower_seeds",
    plantBlockId: "minecraft:torchflower_crop",
    plant: { mode: "farmland-double" },
    harvest: { mode: "break-mature", maturity: { stateKey: "growth", min: 1 } },
  },
  {
    id: "pitcher",
    blockTypeIds: ["minecraft:pitcher_crop"],
    seedTypeId: "minecraft:pitcher_pod",
    plantBlockId: "minecraft:pitcher_crop",
    plant: { mode: "farmland-double" },
    harvest: { mode: "break-mature", maturity: { stateKey: "growth", min: 4 } },
  },
  {
    id: "kelp",
    blockTypeIds: ["minecraft:kelp"],
    seedTypeId: "minecraft:kelp",
    plantBlockId: "minecraft:kelp",
    plant: { mode: "underwater-air", substrates: KELP_SUBSTRATES },
    harvest: { mode: "column-above-base" },
  },
  {
    id: "bamboo",
    blockTypeIds: ["minecraft:bamboo"],
    seedTypeId: "minecraft:bamboo",
    plantBlockId: "minecraft:bamboo",
    plant: { mode: "bamboo-sapling", substrates: BAMBOO_SUBSTRATES },
    harvest: { mode: "column-above-base" },
  },
  {
    id: "cave_berries",
    blockTypeIds: ["minecraft:cave_vines", "minecraft:cave_vines_body_with_berries", "minecraft:cave_vines_head_with_berries"],
    seedTypeId: "minecraft:glow_berries",
    plantBlockId: "minecraft:cave_vines",
    plant: { mode: "ceiling-vine" },
    harvest: {
      mode: "berry-blocks",
      berryBlockIds: ["minecraft:cave_vines_body_with_berries", "minecraft:cave_vines_head_with_berries"],
    },
  },
];

const profileByBlock = new Map<string, CropProfile>();
const profileBySeed = new Map<string, CropProfile>();
const profileByHarvestBlock = new Map<string, CropProfile>();

for (const profile of CROP_PROFILES) {
  for (const id of profile.blockTypeIds) {
    profileByBlock.set(id, profile);
  }
  if (profile.plantEnabled !== false) {
    profileBySeed.set(profile.seedTypeId, profile);
  }
  if (profile.harvest.berryBlockIds) {
    for (const id of profile.harvest.berryBlockIds) {
      profileByHarvestBlock.set(id, profile);
    }
  }
}

export function getProfileByBlock(typeId: string): CropProfile | undefined {
  return profileByBlock.get(typeId) ?? profileByHarvestBlock.get(typeId);
}

export function getProfileBySeed(seedTypeId: string): CropProfile | undefined {
  return profileBySeed.get(seedTypeId);
}

export function getClipInteractProfiles(): CropProfile[] {
  return CROP_PROFILES.filter((p) => p.clipInteract);
}
