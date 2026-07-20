const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const blockDirectory = path.join(root, "behavior_packs", "CreeperMenu", "blocks");

function readJson(...parts) {
  return JSON.parse(fs.readFileSync(path.join(root, ...parts), "utf8"));
}

function readBackroomsBlock(name) {
  return readJson("behavior_packs", "CreeperMenu", "blocks", `backrooms_${name}.json`)[
    "minecraft:block"
  ];
}

test("Backrooms blocks preserve the remastered physical and warm-light material policy", () => {
  const blocks = {
    carpet: readBackroomsBlock("carpet"),
    carpetDamp: readBackroomsBlock("carpet_damp"),
    ceiling: readBackroomsBlock("ceiling_tile"),
    lampDead: readBackroomsBlock("fluorescent_dead"),
    lampOn: readBackroomsBlock("fluorescent_on"),
    wallpaper: readBackroomsBlock("wallpaper"),
    wallpaperStained: readBackroomsBlock("wallpaper_stained"),
  };

  const dryFriction = blocks.carpet.components["minecraft:friction"];
  const dampFriction = blocks.carpetDamp.components["minecraft:friction"];
  assert.equal(dryFriction, 0.4, "dry carpet must retain vanilla-ground acceleration");
  assert.equal(dampFriction, 0.37, "damp carpet should be only mildly slower");

  // Bedrock's ground acceleration varies approximately with the inverse cube of
  // the remaining slip coefficient.  Values such as 0.65 turn the vanilla 0.4
  // baseline into about 5.04x acceleration: (0.6 / 0.35)^3.
  const accelerationRatio = (friction) => ((1 - 0.4) / (1 - friction)) ** 3;
  assert.ok(accelerationRatio(dryFriction) <= 1.05);
  assert.ok(accelerationRatio(dampFriction) > 0.75);
  assert.ok(accelerationRatio(dampFriction) < accelerationRatio(dryFriction));

  const expectedMapColors = {
    carpet: "#8D744C",
    carpetDamp: "#6F5B3D",
    ceiling: "#C8B98E",
    lampDead: "#756A49",
    lampOn: "#E3D39A",
    wallpaper: "#B5A35F",
    wallpaperStained: "#8E7C43",
  };
  for (const [name, expected] of Object.entries(expectedMapColors)) {
    assert.equal(blocks[name].components["minecraft:map_color"], expected, `${name} map color`);
    assert.equal(
      blocks[name].components["minecraft:light_dampening"],
      15,
      `${name} must fully block skylight and adjacent block light`,
    );
  }
  assert.equal(new Set(Object.values(expectedMapColors)).size, Object.keys(expectedMapColors).length);

  assert.ok(blocks.lampOn.components["minecraft:light_emission"] > 0);
  assert.ok(blocks.lampOn.components["minecraft:light_emission"] <= 8);
  assert.equal(blocks.lampDead.components["minecraft:light_emission"] ?? 0, 0);

  const expectedIdentifiers = new Set([
    "yuehua:backrooms_carpet",
    "yuehua:backrooms_carpet_damp",
    "yuehua:backrooms_ceiling_tile",
    "yuehua:backrooms_fluorescent_dead",
    "yuehua:backrooms_fluorescent_on",
    "yuehua:backrooms_wallpaper",
    "yuehua:backrooms_wallpaper_stained",
  ]);
  const actualIdentifiers = new Set(
    fs
      .readdirSync(blockDirectory)
      .filter((name) => name.startsWith("backrooms_") && name.endsWith(".json"))
      .map((name) => JSON.parse(fs.readFileSync(path.join(blockDirectory, name), "utf8"))["minecraft:block"])
      .map((block) => block.description.identifier),
  );
  assert.deepEqual(actualIdentifiers, expectedIdentifiers);

  const resourceManifest = readJson("resource_packs", "CreeperMenu", "manifest.json");
  assert.deepEqual(resourceManifest.capabilities, ["pbr"]);
});

test("PBR MER makes only the lit fluorescent material emissive", () => {
  const materials = [
    "wallpaper", "wallpaper_stained", "carpet", "carpet_damp",
    "ceiling_tile", "fluorescent_dead", "fluorescent_on",
  ];
  const emissive = new Map();
  for (const material of materials) {
    const relative = path.join(
      "resource_packs", "CreeperMenu", "textures", "blocks", "backrooms",
      `${material}.texture_set.json`,
    );
    const absolute = path.join(root, relative);
    assert.ok(fs.existsSync(absolute), `missing ${relative}`);
    const textureSet = JSON.parse(fs.readFileSync(absolute, "utf8"))["minecraft:texture_set"];
    assert.equal(textureSet.color, material);
    const mer = textureSet.metalness_emissive_roughness;
    assert.ok(Array.isArray(mer) && mer.length === 3, `${material} must use uniform MER`);
    assert.equal(mer[0], 0, `${material} must remain non-metallic`);
    assert.ok(mer[2] >= 200, `${material} must retain high roughness`);
    emissive.set(material, mer[1]);
  }

  for (const material of materials.filter((name) => name !== "fluorescent_on")) {
    assert.equal(emissive.get(material), 0, `${material} must not self-illuminate`);
  }
  assert.ok(emissive.get("fluorescent_on") > 0 && emissive.get("fluorescent_on") <= 64);
});
