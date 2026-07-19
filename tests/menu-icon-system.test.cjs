const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const scriptsRoot = path.join(root, "scripts");
const iconRoot = path.join(root, "resource_packs", "CreeperMenu", "textures", "icons");

function walk(directory, extension) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(target, extension);
    return entry.name.endsWith(extension) ? [target] : [];
  });
}

test("every referenced custom menu icon is a native 32x32 RGBA PNG", () => {
  const references = new Set();
  const pattern = /textures\/icons\/([A-Za-z0-9_]+)/g;

  for (const file of walk(scriptsRoot, ".ts")) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(pattern)) references.add(match[1]);
  }

  assert.ok(references.size >= 80);
  for (const name of references) {
    const file = path.join(iconRoot, `${name}.png`);
    assert.ok(fs.existsSync(file), `missing icon: ${name}`);
    const png = fs.readFileSync(file);
    assert.equal(png.toString("ascii", 1, 4), "PNG", `${name} is not a PNG`);
    assert.equal(png.readUInt32BE(16), 32, `${name} width`);
    assert.equal(png.readUInt32BE(20), 32, `${name} height`);
    assert.equal(png[25], 6, `${name} must use RGBA color type`);
  }
});

test("main menu entries use dedicated function-semantic icons", () => {
  const source = fs.readFileSync(path.join(scriptsRoot, "ui", "forms", "server", "index.ts"), "utf8");
  const expected = {
    player: "menu_player",
    wayPoint: "menu_waypoint",
    land: "menu_land",
    economy: "menu_economy",
    guild: "menu_guild",
    floatingText: "menu_floating_text",
    pvp: "menu_pvp",
    stats: "menu_stats",
    quest: "menu_quest",
    other: "menu_other",
    help: "menu_help",
    sm: "menu_item",
    setting: "menu_server_settings",
  };

  for (const [id, icon] of Object.entries(expected)) {
    const entry = new RegExp(`id: ["']${id}["'][\\s\\S]{0,160}?icon: ["']textures/icons/${icon}["']`);
    assert.match(source, entry, `${id} must use ${icon}`);
  }
});
