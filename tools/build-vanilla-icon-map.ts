/**
 * 从 Mojang bedrock-samples 生成 minecraft:typeId → Chest UI 贴图路径映射。
 *
 * 数据源（均来自 bedrock-samples @ main，随游戏版本更新后重新运行即可）：
 *   - mojang-items.json          → typeId 全集
 *   - item_texture.json          → 物品栏图标
 *   - blocks.json                → 方块 → terrain shortname
 *   - terrain_texture.json       → terrain shortname → textures/blocks/...
 *
 * 用法：
 *   npm run build:vanilla-icon-map
 *   npm run build:vanilla-icon-map -- 1.26.30
 */
import * as fs from "fs";
import * as path from "path";

const OWNER = "Mojang";
const REPO = "bedrock-samples";
const DEFAULT_BRANCH = "main";

const OUTPUT_RELATIVE = "../scripts/assets/vanilla-item-icon-paths.ts";
const LOCAL_OUTPUT = "../out/vanilla-icon-map/vanilla-item-icon-paths.ts";
const UNMAPPED_OUTPUT = "../out/vanilla-icon-map/unmapped-vanilla-items.json";
const CONVENTION_OUTPUT = "../out/vanilla-icon-map/convention-fallback-items.json";

/** 不可在 UI 中展示的内部/方块状态 id */
const EXCLUDE_PATTERNS: ReadonlySet<string> = new Set([
  "air",
  "double_slab",
  "wall_fan",
  "moving_block",
  "piston_head",
  "piston_arm_collision",
  "structure_void",
  "end_gateway",
  "barrier",
  "candle_cake",
  "item.",
  "lit_",
  "_with_berries",
  "netherreactor",
  "standing",
  "_wall_",
  "double_",
  "light_block",
]);

/** item_texture 聚合键：不对应单一 typeId，需专用解析器 */
const AGGREGATE_TEXTURE_KEYS: ReadonlySet<string> = new Set([
  "axe",
  "bed",
  "boat",
  "boots",
  "bow_pulling",
  "bucket",
  "chestplate",
  "crossbow_pulling",
  "dye_powder",
  "fishing_rod",
  "elytra",
  "helmet",
  "hoe",
  "leggings",
  "map_filled",
  "pickaxe",
  "potion_bottle_drinkable",
  "potion_bottle_lingering",
  "potion_bottle_splash",
  "shovel",
  "spawn_egg",
  "sword",
  "chalkboard",
  "tipped_arrow",
  "chest_boat",
  "wolf_armor",
  "fishing_rod",
]);

const SPEAR_TIER_MATERIALS = [
  "wooden",
  "stone",
  "copper",
  "iron",
  "golden",
  "diamond",
  "netherite",
] as const;

/** blocks.json 键与 typeId shortname 不一致 */
const BLOCK_ID_ALIASES: Record<string, string> = {
  grass_block: "grass",
  sugar_cane: "reeds",
  snowy_grass: "grass",
  cocoa_beans: "cocoa",
  sea_lantern: "seaLantern",
};

/** 旧版 spawn egg typeId 实体名 */
const SPAWN_EGG_ENTITY_ALIASES: Record<string, string> = {
  zombie_pigman: "zombified_piglin",
};

const TOOL_TIER_MATERIALS = [
  "wooden",
  "stone",
  "iron",
  "golden",
  "diamond",
  "netherite",
  "copper",
] as const;

const ARMOR_TIER_MATERIALS = [
  "leather",
  "chainmail",
  "iron",
  "golden",
  "diamond",
  "netherite",
  "copper",
] as const;

const TIER_TOOL_TYPES = new Set(["sword", "pickaxe", "axe", "shovel", "hoe"]);
const TIER_ARMOR_TYPES = new Set(["helmet", "chestplate", "leggings", "boots"]);

const BOAT_TYPE_IDS = [
  "oak_boat",
  "spruce_boat",
  "birch_boat",
  "jungle_boat",
  "acacia_boat",
  "dark_oak_boat",
  "mangrove_boat",
  "bamboo_raft",
  "cherry_boat",
  "pale_oak_boat",
] as const;

const CHEST_BOAT_TYPE_IDS = [
  "oak_chest_boat",
  "spruce_chest_boat",
  "birch_chest_boat",
  "jungle_chest_boat",
  "acacia_chest_boat",
  "dark_oak_chest_boat",
  "mangrove_chest_boat",
  "bamboo_chest_raft",
  "cherry_chest_boat",
  "pale_oak_chest_boat",
] as const;

const BED_COLOR_IDS = [
  "white",
  "orange",
  "magenta",
  "light_blue",
  "yellow",
  "lime",
  "pink",
  "gray",
  "silver",
  "cyan",
  "purple",
  "blue",
  "brown",
  "green",
  "red",
  "black",
] as const;

const DYE_COLOR_IDS = [
  "black",
  "red",
  "green",
  "brown",
  "blue",
  "purple",
  "cyan",
  "silver",
  "gray",
  "pink",
  "lime",
  "yellow",
  "light_blue",
  "magenta",
  "orange",
  "white",
] as const;

const BUCKET_TYPE_IDS = [
  "bucket",
  "milk_bucket",
  "water_bucket",
  "lava_bucket",
  "cod_bucket",
  "salmon_bucket",
  "tropical_fish_bucket",
  "pufferfish_bucket",
  "powder_snow_bucket",
  "axolotl_bucket",
  "tadpole_bucket",
  "sulfur_cube_bucket",
] as const;

/** typeId shortname → item_texture.json 键 */
const ITEM_TEXTURE_KEY_ALIASES: Record<string, string> = {
  golden_apple: "apple_golden",
  enchanted_golden_apple: "apple_golden",
  beef: "beef_raw",
  cod: "fish",
  cooked_cod: "cooked_fish",
  tropical_fish: "clownfish",
  enchanted_book: "book_enchanted",
  book: "book_normal",
  writable_book: "book_writable",
  written_book: "book_written",
  bow: "bow_standby",
  crossbow: "crossbow_standby",
  filled_map: "map_filled",
  firework_rocket: "fireworks",
  firework_star: "fireworks_charge",
  oak_sign: "sign",
  spruce_sign: "sign_spruce",
  birch_sign: "sign_birch",
  jungle_sign: "sign_jungle",
  acacia_sign: "sign_acacia",
  dark_oak_sign: "sign_darkoak",
  cherry_sign: "cherry_sign",
  pale_oak_sign: "pale_oak_sign",
  bamboo_sign: "bamboo_sign",
  mangrove_sign: "mangrove_sign",
  crimson_sign: "crimson_sign_item",
  warped_sign: "warped_sign_item",
  oak_hanging_sign: "sign_oak_hanging",
  spruce_hanging_sign: "sign_spruce_hanging",
  birch_hanging_sign: "sign_birch_hanging",
  jungle_hanging_sign: "sign_jungle_hanging",
  acacia_hanging_sign: "sign_acacia_hanging",
  dark_oak_hanging_sign: "sign_darkoak_hanging",
  cherry_hanging_sign: "sign_cherry_hanging",
  pale_oak_hanging_sign: "sign_pale_oak_hanging",
  bamboo_hanging_sign: "sign_bamboo_hanging",
  mangrove_hanging_sign: "sign_mangrove_hanging",
  crimson_hanging_sign: "sign_crimson_hanging",
  warped_hanging_sign: "sign_warped_hanging",
  chicken: "chicken_raw",
  mutton: "mutton_raw",
  porkchop: "porkchop_raw",
  poisonous_potato: "potato_poisonous",
  redstone: "redstone_dust",
  compass: "compass_item",
  clock: "clock_item",
  empty_map: "map_empty",
  glass_bottle: "potion_bottle_empty",
  golden_carrot: "carrot_golden",
  fermented_spider_eye: "spider_eye_fermented",
  fire_charge: "fireball",
  glistering_melon_slice: "melon_speckled",
  melon_slice: "melon",
  popped_chorus_fruit: "chorus_fruit_popped",
  totem_of_undying: "totem",
  turtle_scute: "turtle_shell_piece",
  iron_chain: "chain",
  lodestone_compass: "lodestonecompass_item",
  slime_ball: "slimeball",
  minecart: "minecart_normal",
  chest_minecart: "minecart_chest",
  hopper_minecart: "minecart_hopper",
  tnt_minecart: "minecart_tnt",
  command_block_minecart: "minecart_command_block",
  bone_meal: "dye_powder_white",
  ink_sac: "dye_powder_black",
  glow_ink_sac: "dye_powder_glow",
  lapis_lazuli: "dye_powder_blue",
  banner: "banner_pattern",
};

/** 旧版 spawn egg 文件名与实体名不一致 */
const SPAWN_EGG_LEGACY_ENTITY: Record<string, string> = {
  zombified_piglin: "pigzombie",
  elder_guardian: "elderguardian",
  magma_cube: "lava_slime",
  mooshroom: "mushroomcow",
  tropical_fish: "clownfish",
  skeleton_horse: "skeletonhorse",
  zombie_horse: "zombiehorse",
  zombie_villager: "zombievillager",
};

type ResolveSource =
  | "item_texture"
  | "item_alias"
  | "tier"
  | "spawn_egg"
  | "boat"
  | "bed"
  | "bucket"
  | "dye"
  | "potion"
  | "music_disc"
  | "food_pattern"
  | "basename"
  | "block"
  | "convention";

interface MojangItemRow {
  name?: string;
  command_name?: string;
}

interface MojangItemsJson {
  data_items?: MojangItemRow[];
}

interface ResolverContext {
  textureData: Record<string, unknown>;
  basenameIndex: Map<string, string>;
  blocks: Record<string, unknown>;
  terrainData: Record<string, unknown>;
}

interface ResolveResult {
  texturePath: string;
  source: ResolveSource;
}

function normalizeTexturePath(raw: unknown): string | undefined {
  if (typeof raw === "string") {
    let tex = raw.trim().replace(/\\/g, "/");
    if (!tex) return undefined;
    if (tex.endsWith(".png")) tex = tex.slice(0, -4);
    if (!tex.startsWith("textures/")) tex = `textures/${tex.replace(/^\/+/, "")}`;
    return tex;
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.default === "string") return normalizeTexturePath(obj.default);
    for (const value of Object.values(obj)) {
      const normalized = normalizeTexturePath(value);
      if (normalized) return normalized;
    }
  }
  return undefined;
}

function collectAllTexturePaths(entry: unknown): string[] {
  if (!entry || typeof entry !== "object") return [];
  const record = entry as Record<string, unknown>;
  const raw = record.textures ?? record.texture;
  if (Array.isArray(raw)) {
    return raw.map(normalizeTexturePath).filter((p): p is string => Boolean(p));
  }
  const single = normalizeTexturePath(raw);
  return single ? [single] : [];
}

function textureBasename(texturePath: string): string {
  return texturePath.split("/").pop() ?? texturePath;
}

function buildTextureBasenameIndex(textureData: Record<string, unknown>): Map<string, string> {
  const index = new Map<string, string>();
  for (const entry of Object.values(textureData)) {
    for (const texturePath of collectAllTexturePaths(entry)) {
      index.set(textureBasename(texturePath), texturePath);
    }
  }
  return index;
}

function resolveTextureEntry(entry: unknown, index = 0): string | undefined {
  const paths = collectAllTexturePaths(entry);
  return paths[index];
}

function resolveItemTextureKey(
  key: string,
  ctx: ResolverContext,
  index = 0
): string | undefined {
  const entry = ctx.textureData[key];
  if (!entry) return undefined;
  return resolveTextureEntry(entry, index);
}

function getPatternTextureKeyAliases(shortname: string): string[] {
  const aliases: string[] = [];
  const seeds = shortname.match(/^(.+)_seeds$/);
  if (seeds) aliases.push(`seeds_${seeds[1]}`);

  const bundle = shortname.match(/^(.+)_bundle$/);
  if (bundle) aliases.push(`bundle_${bundle[1]}`);

  const harness = shortname.match(/^(.+)_harness$/);
  if (harness) aliases.push(`harness_${harness[1]}`);

  if (shortname === "light_gray_dye") aliases.push("dye_powder_silver");

  return aliases;
}

function getItemTextureKeyAlias(shortname: string): string | undefined {
  if (ITEM_TEXTURE_KEY_ALIASES[shortname]) return ITEM_TEXTURE_KEY_ALIASES[shortname];
  if (shortname.startsWith("music_disc_")) return `record_${shortname.slice("music_disc_".length)}`;

  const baked = shortname.match(/^baked_(.+)$/);
  if (baked) return `${baked[1]}_baked`;

  const cooked = shortname.match(/^cooked_(.+)$/);
  if (cooked) return `${cooked[1]}_cooked`;

  return getPatternTextureKeyAliases(shortname)[0];
}

function getAllItemTextureKeyCandidates(shortname: string): string[] {
  const candidates = new Set<string>([shortname]);
  const primary = getItemTextureKeyAlias(shortname);
  if (primary) candidates.add(primary);
  for (const alias of getPatternTextureKeyAliases(shortname)) candidates.add(alias);
  if (shortname.startsWith("golden_")) candidates.add(shortname.replace(/^golden_/, "gold_"));
  if (shortname.startsWith("wooden_")) candidates.add(shortname.replace(/^wooden_/, "wood_"));
  return [...candidates];
}

function resolveTierItem(shortname: string, ctx: ResolverContext): string | undefined {
  const match = shortname.match(
    /^(wooden|stone|iron|golden|diamond|netherite|copper|leather|chainmail)_(sword|pickaxe|axe|shovel|hoe|helmet|chestplate|leggings|boots)$/
  );
  if (!match) return undefined;

  const [, material, itemType] = match;
  const materials = TIER_TOOL_TYPES.has(itemType) ? TOOL_TIER_MATERIALS : ARMOR_TIER_MATERIALS;
  const index = (materials as readonly string[]).indexOf(material);
  if (index < 0) return undefined;

  return resolveItemTextureKey(itemType, ctx, index);
}

function resolveSpearItem(shortname: string, ctx: ResolverContext): string | undefined {
  const match = shortname.match(/^(wooden|stone|copper|iron|golden|diamond|netherite)_spear$/);
  if (!match) return undefined;
  const index = SPEAR_TIER_MATERIALS.indexOf(match[1] as (typeof SPEAR_TIER_MATERIALS)[number]);
  if (index < 0) return undefined;
  const materialPrefix =
    match[1] === "wooden" ? "wood" : match[1] === "golden" ? "gold" : match[1];
  return resolveItemTextureKey(`${materialPrefix}_spear`, ctx) ?? ctx.basenameIndex.get(`${materialPrefix}_spear`);
}

function resolveFishingRod(shortname: string, ctx: ResolverContext): string | undefined {
  if (shortname !== "fishing_rod") return undefined;
  return resolveItemTextureKey("fishing_rod", ctx, 0);
}

function resolveSpawnEgg(shortname: string, ctx: ResolverContext): string | undefined {
  const match = shortname.match(/^(.+)_spawn_egg$/);
  if (!match) return undefined;

  const entity = SPAWN_EGG_ENTITY_ALIASES[match[1]] ?? match[1];
  const candidates = [
    `spawn_egg_${entity}`,
    `egg_${entity}`,
    ...(SPAWN_EGG_LEGACY_ENTITY[entity] ? [`egg_${SPAWN_EGG_LEGACY_ENTITY[entity]}`] : []),
  ];

  for (const key of candidates) {
    if (ctx.textureData[key]) {
      const path = resolveItemTextureKey(key, ctx);
      if (path) return path;
    }
    const fromIndex = ctx.basenameIndex.get(key);
    if (fromIndex) return fromIndex;
  }

  return undefined;
}

function resolveBoatItem(shortname: string, ctx: ResolverContext): string | undefined {
  const boatIndex = BOAT_TYPE_IDS.indexOf(shortname as (typeof BOAT_TYPE_IDS)[number]);
  if (boatIndex >= 0) return resolveItemTextureKey("boat", ctx, boatIndex);

  const chestIndex = CHEST_BOAT_TYPE_IDS.indexOf(shortname as (typeof CHEST_BOAT_TYPE_IDS)[number]);
  if (chestIndex >= 0) return resolveItemTextureKey("chest_boat", ctx, chestIndex);

  return undefined;
}

function resolveBedItem(shortname: string, ctx: ResolverContext): string | undefined {
  const match = shortname.match(/^(.+)_bed$/);
  if (!match) return undefined;
  const index = BED_COLOR_IDS.indexOf(match[1] as (typeof BED_COLOR_IDS)[number]);
  if (index < 0) return undefined;
  return resolveItemTextureKey("bed", ctx, index);
}

function resolveBucketItem(shortname: string, ctx: ResolverContext): string | undefined {
  const index = BUCKET_TYPE_IDS.indexOf(shortname as (typeof BUCKET_TYPE_IDS)[number]);
  if (index < 0) return undefined;
  return resolveItemTextureKey("bucket", ctx, index);
}

function resolveDyeItem(shortname: string, ctx: ResolverContext): string | undefined {
  const match = shortname.match(/^(.+)_dye$/);
  if (!match) return undefined;
  const index = DYE_COLOR_IDS.indexOf(match[1] as (typeof DYE_COLOR_IDS)[number]);
  if (index < 0) return undefined;
  return resolveItemTextureKey("dye_powder", ctx, index);
}

function resolvePotionItem(shortname: string, ctx: ResolverContext): string | undefined {
  switch (shortname) {
    case "potion":
      return resolveItemTextureKey("potion_bottle_drinkable", ctx, 0);
    case "splash_potion":
      return resolveItemTextureKey("potion_bottle_splash", ctx, 0);
    case "lingering_potion":
      return resolveItemTextureKey("potion_bottle_lingering", ctx, 0);
    default:
      return undefined;
  }
}

function getBasenameCandidates(shortname: string): string[] {
  return getAllItemTextureKeyCandidates(shortname);
}

function resolveFromBasenameIndex(shortname: string, ctx: ResolverContext): string | undefined {
  for (const candidate of getBasenameCandidates(shortname)) {
    const path = ctx.basenameIndex.get(candidate);
    if (path) return path;
  }
  return undefined;
}

function toCamelCaseBlockId(shortname: string): string {
  return shortname.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

function getBlockLookupKeys(shortname: string): string[] {
  const keys = new Set<string>([shortname, toCamelCaseBlockId(shortname)]);
  const alias = BLOCK_ID_ALIASES[shortname];
  if (alias) keys.add(alias);
  return [...keys];
}

function getBlockTerrainShortname(blockDef: unknown): string | undefined {
  if (!blockDef || typeof blockDef !== "object") return undefined;
  const textures = (blockDef as Record<string, unknown>).textures;
  if (typeof textures === "string") return textures;
  if (textures && typeof textures === "object") {
    const obj = textures as Record<string, unknown>;
    const preferred = ["up", "down", "side", "north", "all"];
    for (const key of preferred) {
      if (typeof obj[key] === "string") return obj[key] as string;
    }
    for (const value of Object.values(obj)) {
      if (typeof value === "string") return value;
    }
  }
  return undefined;
}

function resolveBlockItem(shortname: string, ctx: ResolverContext): string | undefined {
  for (const blockKey of getBlockLookupKeys(shortname)) {
    const blockDef = ctx.blocks[blockKey];
    if (!blockDef) continue;

    const terrainKey = getBlockTerrainShortname(blockDef);
    if (!terrainKey) continue;

    const terrainEntry = ctx.terrainData[terrainKey];
    if (!terrainEntry) continue;

    const path = normalizeTexturePath(
      typeof terrainEntry === "object"
        ? (terrainEntry as Record<string, unknown>).textures ?? terrainEntry
        : terrainEntry
    );
    if (path) return path;
  }
  return undefined;
}

function resolveConventionPath(shortname: string, ctx: ResolverContext): string {
  for (const blockKey of getBlockLookupKeys(shortname)) {
    if (ctx.blocks[blockKey]) return `textures/blocks/${shortname}`;
  }
  return `textures/items/${shortname}`;
}

function lookupItemTextureByCandidates(
  shortname: string,
  ctx: ResolverContext
): string | undefined {
  for (const key of getAllItemTextureKeyCandidates(shortname)) {
    if (ctx.textureData[key] && !AGGREGATE_TEXTURE_KEYS.has(key)) {
      const path = resolveItemTextureKey(key, ctx);
      if (path) return path;
    }
  }
  return undefined;
}

function resolveVanillaItemTexture(typeId: string, ctx: ResolverContext): ResolveResult {
  const shortname = typeId.slice("minecraft:".length);

  const tier = resolveTierItem(shortname, ctx);
  if (tier) return { texturePath: tier, source: "tier" };

  const spear = resolveSpearItem(shortname, ctx);
  if (spear) return { texturePath: spear, source: "tier" };

  const fishingRod = resolveFishingRod(shortname, ctx);
  if (fishingRod) return { texturePath: fishingRod, source: "item_texture" };

  const spawnEgg = resolveSpawnEgg(shortname, ctx);
  if (spawnEgg) return { texturePath: spawnEgg, source: "spawn_egg" };

  const boat = resolveBoatItem(shortname, ctx);
  if (boat) return { texturePath: boat, source: "boat" };

  const bed = resolveBedItem(shortname, ctx);
  if (bed) return { texturePath: bed, source: "bed" };

  const bucket = resolveBucketItem(shortname, ctx);
  if (bucket) return { texturePath: bucket, source: "bucket" };

  const dye = resolveDyeItem(shortname, ctx);
  if (dye) return { texturePath: dye, source: "dye" };

  const potion = resolvePotionItem(shortname, ctx);
  if (potion) return { texturePath: potion, source: "potion" };

  if (shortname.startsWith("music_disc_")) {
    const path = lookupItemTextureByCandidates(shortname, ctx);
    if (path) return { texturePath: path, source: "music_disc" };
  }

  const directItemTexture = lookupItemTextureByCandidates(shortname, ctx);
  if (directItemTexture) {
    const aliasKey = getItemTextureKeyAlias(shortname);
    const source: ResolveSource =
      aliasKey && aliasKey !== shortname
        ? aliasKey.includes("_baked") || aliasKey.includes("_cooked")
          ? "food_pattern"
          : "item_alias"
        : "item_texture";
    return { texturePath: directItemTexture, source };
  }

  const fromBasename = resolveFromBasenameIndex(shortname, ctx);
  if (fromBasename) return { texturePath: fromBasename, source: "basename" };

  const fromBlock = resolveBlockItem(shortname, ctx);
  if (fromBlock) return { texturePath: fromBlock, source: "block" };

  const convention = resolveConventionPath(shortname, ctx);
  return { texturePath: convention, source: "convention" };
}

function isObtainableTypeId(typeId: string): boolean {
  const stripped = typeId.replace(/^minecraft:/, "");
  if (stripped === "lit_furnace" || stripped === "lit_redstone_ore" || stripped === "fire") {
    return false;
  }
  for (const pattern of EXCLUDE_PATTERNS) {
    if (stripped.includes(pattern)) return false;
  }
  return true;
}

const DOWNLOAD_RETRIES = 3;
const DOWNLOAD_TIMEOUT_MS = 30_000;

function buildSourceUrls(relativePath: string, gitRef: string): string[] {
  const cleanPath = relativePath.replace(/^\/+/, "");
  return [
    `https://cdn.jsdelivr.net/gh/${OWNER}/${REPO}@${gitRef}/${cleanPath}`,
    `https://fastly.jsdelivr.net/gh/${OWNER}/${REPO}@${gitRef}/${cleanPath}`,
    `https://raw.githubusercontent.com/${OWNER}/${REPO}/${gitRef}/${cleanPath}`,
  ];
}

async function fetchJson<T>(relativePath: string, gitRef: string): Promise<T> {
  const failures: string[] = [];
  const urls = buildSourceUrls(relativePath, gitRef);

  for (const [sourceIndex, url] of urls.entries()) {
    for (let attempt = 1; attempt <= DOWNLOAD_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
      try {
        const resp = await fetch(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": "mcbes-manage-script-icon-map-generator",
          },
          signal: controller.signal,
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
        const text = await resp.text();
        if (sourceIndex > 0) console.warn(`⚠️  主下载源不可用，已切换镜像: ${new URL(url).host}`);
        return JSON.parse(stripJsonComments(text)) as T;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        failures.push(`${new URL(url).host} 第 ${attempt} 次: ${reason}`);
        if (attempt < DOWNLOAD_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
        }
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  throw new Error(`下载 ${relativePath} 失败：${failures.join("；")}`);
}

function stripJsonComments(source: string): string {
  return source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function resolveGitRef(_gameVersion?: string): string {
  return DEFAULT_BRANCH;
}

function serializeOutput(map: Map<string, string>, gameVersion: string, gitRef: string): string {
  const sorted = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const lines = sorted.map(([typeId, texturePath]) => `  "${typeId}": "${texturePath}",`).join("\n");
  return `/**
 * 原版物品 Chest UI 贴图路径（自动生成，请勿手改）
 * 游戏版本: ${gameVersion}
 * 数据源: ${OWNER}/${REPO} @ ${gitRef}
 * 生成命令: npm run build:vanilla-icon-map -- ${gameVersion}
 */
export const VANILLA_ITEM_ICON_PATHS_VERSION = "${gameVersion}";

export const vanillaItemIconPaths: Record<string, string> = {
${lines}
};
`;
}

async function main(): Promise<void> {
  const gameVersion = process.argv[2] ?? "1.26.30";
  const gitRef = resolveGitRef(process.argv[2]);

  console.log(`📦 目标版本: ${gameVersion} (git ref: ${gitRef})`);

  console.log("⬇️  下载数据源...");
  const [itemTextureJson, mojangItemsJson, blocksJson, terrainJson] = await Promise.all([
    fetchJson<{ texture_data?: Record<string, unknown> }>(
      "resource_pack/textures/item_texture.json",
      gitRef
    ),
    fetchJson<MojangItemsJson>("metadata/vanilladata_modules/mojang-items.json", gitRef),
    fetchJson<Record<string, unknown>>("resource_pack/blocks.json", gitRef),
    fetchJson<{ texture_data?: Record<string, unknown> }>(
      "resource_pack/textures/terrain_texture.json",
      gitRef
    ),
  ]);

  const textureData = itemTextureJson.texture_data ?? {};
  const mojangItems = mojangItemsJson.data_items ?? [];
  const terrainData = terrainJson.texture_data ?? {};
  const blocks = Object.fromEntries(
    Object.entries(blocksJson).filter(([key]) => key !== "format_version")
  );

  const ctx: ResolverContext = {
    textureData,
    basenameIndex: buildTextureBasenameIndex(textureData),
    blocks,
    terrainData,
  };

  const map = new Map<string, string>();
  const sourceStats = new Map<ResolveSource, number>();
  const conventionOnly: string[] = [];
  let excluded = 0;

  for (const row of mojangItems) {
    const typeId = row.name ?? row.command_name;
    if (!typeId?.startsWith("minecraft:")) continue;

    if (!isObtainableTypeId(typeId)) {
      excluded++;
      continue;
    }

    const resolved = resolveVanillaItemTexture(typeId, ctx);
    map.set(typeId, resolved.texturePath);
    sourceStats.set(resolved.source, (sourceStats.get(resolved.source) ?? 0) + 1);
    if (resolved.source === "convention") conventionOnly.push(typeId);
  }

  const obtainable = mojangItems.filter((row) => {
    const typeId = row.name ?? row.command_name;
    return typeId?.startsWith("minecraft:") && isObtainableTypeId(typeId);
  }).length;

  console.log(`✅ mojang-items: ${mojangItems.length}（可展示 ${obtainable}，排除 ${excluded}）`);
  console.log(`✅ 成功映射: ${map.size} / ${obtainable} (${((map.size / obtainable) * 100).toFixed(1)}%)`);
  if (conventionOnly.length > 0) {
    console.log(`ℹ️  约定路径兜底: ${conventionOnly.length}（见 ${CONVENTION_OUTPUT}）`);
  }
  console.log("📊 来源统计:");
  for (const [source, count] of [...sourceStats.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${source}: ${count}`);
  }

  const output = serializeOutput(map, gameVersion, gitRef);
  const localOut = path.resolve(__dirname, LOCAL_OUTPUT);
  const pluginOut = path.resolve(__dirname, OUTPUT_RELATIVE);
  const unmappedOut = path.resolve(__dirname, UNMAPPED_OUTPUT);
  const conventionOut = path.resolve(__dirname, CONVENTION_OUTPUT);

  fs.mkdirSync(path.dirname(localOut), { recursive: true });
  fs.writeFileSync(localOut, output, "utf-8");
  fs.mkdirSync(path.dirname(pluginOut), { recursive: true });
  fs.writeFileSync(pluginOut, output, "utf-8");
  fs.writeFileSync(unmappedOut, "[]\n", "utf-8");
  fs.writeFileSync(conventionOut, JSON.stringify(conventionOnly.sort(), null, 2), "utf-8");

  console.log(`💾 已写入:\n   ${localOut}\n   ${pluginOut}\n   ${conventionOut}`);
  if (conventionOnly.length > 0) {
    console.log(`\n约定路径样例: ${conventionOnly.slice(0, 10).join(", ")}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const cause =
    error && typeof error === "object" && "cause" in error
      ? String((error as { cause?: unknown }).cause ?? "")
      : "";
  console.error("❌ 生成失败:", cause ? `${message}（${cause}）` : message);
  process.exit(1);
});
