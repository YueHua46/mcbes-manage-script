const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function load(source, globals = {}, requireFn = require, file = "fixture.ts") {
  const exports = {};
  const module = { exports };
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { exports, module, require: requireFn, console, __dirname: path.dirname(path.join(root, file)), ...globals }
  );
  return exports;
}

test("icon generation retains stairs, rejects unknown versions and checks actual resource files", () => {
  const file = "tools/build-vanilla-icon-map.ts";
  const generator = load(read(file), {}, require, file);
  for (const id of ["oak_stairs", "poplar_stairs", "white_concrete_slab"]) {
    assert.equal(generator.isObtainableTypeId(`minecraft:${id}`), true);
  }
  assert.equal(generator.isObtainableTypeId("minecraft:air"), false);
  assert.equal(generator.isObtainableTypeId("minecraft:oak_double_slab"), false);
  const source = JSON.parse(read("tools/vanilla-icon-source.json"));
  assert.equal(generator.resolveGitRef("1.26.52"), source.commit);
  assert.throws(() => generator.resolveGitRef("1.26.60"), /正式版图标数据源/);
  assert.equal(generator.hasTextureFile("textures/items/missing_upgrade_fixture", new Set()), false);
  assert.equal(
    generator.hasTextureFile("textures/blocks/poplar_log", new Set(["resource_pack/textures/blocks/poplar_log.tga"])),
    true
  );
  assert.equal(
    generator.resolveVanillaItemTexture("minecraft:shelf_mushroom", {}).texturePath,
    "textures/blocks/shelf_mushroom_small"
  );
  const map = load(read("scripts/assets/vanilla-item-icon-paths.ts")).vanillaItemIconPaths;
  assert.equal(Object.keys(map).filter((id) => id.endsWith("_stairs")).length, 97);
  for (const color of [
    "white",
    "orange",
    "magenta",
    "light_blue",
    "yellow",
    "lime",
    "pink",
    "gray",
    "light_gray",
    "cyan",
    "purple",
    "blue",
    "brown",
    "green",
    "red",
    "black",
  ]) {
    assert.ok(map[`minecraft:${color}_concrete_slab`]);
    assert.ok(map[`minecraft:${color}_cushion`]);
  }
});

const landSource = read("scripts/events/handlers/land.ts");
const landAst = ts.createSourceFile("land.ts", landSource, ts.ScriptTarget.Latest, true);
function callback(signal) {
  let found;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(landAst) === `world.beforeEvents.${signal}.subscribe`)
      found = node.arguments[0].getText(landAst);
    ts.forEachChild(node, visit);
  }
  visit(landAst);
  assert.ok(found, signal);
  return found;
}
const placementSource = landSource.slice(
  landSource.indexOf("const LAND_SENSITIVE_ENTITY_PLACE_ITEMS"),
  landSource.indexOf("const LAND_SENSITIVE_ENTITY_SPAWN_TRACK_TICKS")
);
const placement = load(
  placementSource + "\nexport { LAND_SENSITIVE_ENTITY_PLACE_ITEMS, LAND_BREAK_PROTECTED_ENTITY_TYPE_IDS };"
);

test("all cushion colors and new boats participate in denied-placement cleanup and attack protection", () => {
  for (const color of [
    "white",
    "orange",
    "magenta",
    "light_blue",
    "yellow",
    "lime",
    "pink",
    "gray",
    "light_gray",
    "cyan",
    "purple",
    "blue",
    "brown",
    "green",
    "red",
    "black",
  ]) {
    assert.deepEqual(Array.from(placement.LAND_SENSITIVE_ENTITY_PLACE_ITEMS.get(`minecraft:${color}_cushion`)), [
      "minecraft:cushion",
    ]);
  }
  for (const id of ["poplar_boat", "pale_oak_boat", "poplar_chest_boat", "bamboo_chest_raft"])
    assert.ok(placement.LAND_SENSITIVE_ENTITY_PLACE_ITEMS.has(`minecraft:${id}`));
  assert.equal(placement.LAND_BREAK_PROTECTED_ENTITY_TYPE_IDS.has("minecraft:cushion"), true);
});

test("actual land callbacks honor dedicated permissions, including placing across the boundary", () => {
  const land = {
    owner: "owner",
    public_auth: { place: false, break: false, useButton: false, useSmelting: false, useBlock: true, useEntity: true },
  };
  let supportInside = true;
  const globals = {
    ...placement,
    landManager: {
      testLand: (location) => ({
        insideLand: location.y === 65 || supportInside ? land : undefined,
        isInside: supportInside,
      }),
      isPlayerTrustedOnLand: () => false,
    },
    isAdmin: () => false,
    MinecraftBlockTypes: require("@minecraft/vanilla-data").MinecraftBlockTypes,
    EntityEquippableComponent: { componentId: "minecraft:equippable" },
    EquipmentSlot: { Offhand: "Offhand", Mainhand: "Mainhand" },
    system: { run: () => {} },
    getOnlineRealPlayers: () => [],
    CONTAINER_BLOCK_KEYWORDS: ["chest", "barrel"],
    DOOR_BLOCK_KEYWORDS: ["door", "trapdoor", "fence_gate"],
    blockTypeContainsAny: (id, keywords) => keywords.some((key) => id.includes(key)),
    getTargetLocationFromUseOn: (location) => ({ ...location, y: location.y + 1 }),
    isLandPlaceAllowed: (_player, targetLand) => targetLand.public_auth.place,
    isLandBreakAllowed: () => land.public_auth.break,
    EntityDamageCause: { fire: "fire", fireTick: "fireTick" },
    warnDeniedLandEntityBreaking: () => {},
  };
  const blockHandler = load("export const handler = " + callback("playerInteractWithBlock"), globals).handler;
  const player = { name: "visitor", getComponent: () => undefined };
  function interact(typeId, itemTypeId) {
    const event = {
      player,
      block: { typeId, location: { x: 0, y: 64, z: 0 }, dimension: { id: "minecraft:overworld" } },
      blockFace: "Up",
      itemStack: itemTypeId ? { typeId: itemTypeId } : undefined,
      cancel: false,
    };
    blockHandler(event);
    return event.cancel;
  }
  assert.equal(interact("minecraft:poplar_button"), true);
  assert.equal(interact("minecraft:pale_oak_button"), true);
  assert.equal(interact("minecraft:straw_bed"), true);
  assert.equal(interact("minecraft:bed"), true);
  land.public_auth.useButton = land.public_auth.useSmelting = true;
  assert.equal(interact("minecraft:poplar_button"), false);
  assert.equal(interact("minecraft:straw_bed"), false);
  supportInside = false;
  assert.equal(interact("minecraft:stone", "minecraft:white_cushion"), true);
  assert.equal(interact("minecraft:stone", "minecraft:poplar_chest_boat"), true);
  land.public_auth.place = true;
  assert.equal(interact("minecraft:stone", "minecraft:white_cushion"), false);
  supportInside = true;
  const entityHandler = load("export const handler = " + callback("playerInteractWithEntity"), globals).handler;
  const event = {
    player,
    target: { typeId: "minecraft:cushion", location: { x: 0, y: 64, z: 0 }, dimension: { id: "minecraft:overworld" } },
    cancel: false,
  };
  entityHandler(event);
  assert.equal(event.cancel, false, "sitting requires useEntity, not break");
  land.public_auth.useEntity = false;
  entityHandler(event);
  assert.equal(event.cancel, true);
  const hurtHandler = load("export const handler = " + callback("entityHurt"), globals).handler;
  const hurt = {
    hurtEntity: event.target,
    damageSource: { cause: "entityAttack", damagingEntity: { ...player, typeId: "minecraft:player" } },
    cancel: false,
  };
  hurtHandler(hurt);
  assert.equal(hurt.cancel, true, "removing the cushion requires break even when useEntity is allowed");
  land.public_auth.break = true;
  hurt.cancel = false;
  hurtHandler(hurt);
  assert.equal(hurt.cancel, false);
});

test("red shrub enters the piston rollback cache while solid blocks remain excluded", () => {
  const fragile = load(read("scripts/features/land/services/fragile-block-cache.ts"), {}, () => ({}));
  assert.equal(fragile.isFragilePistonAffectedBlock("minecraft:red_shrub"), true);
  assert.equal(fragile.isFragilePistonAffectedBlock("minecraft:shelf_mushroom"), true);
  assert.equal(fragile.isFragilePistonAffectedBlock("minecraft:poplar_sapling"), true);
  assert.equal(fragile.isFragilePistonAffectedBlock("minecraft:stone"), false);
});
