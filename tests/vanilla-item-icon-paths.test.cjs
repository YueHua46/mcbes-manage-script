const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("shield UI icons do not use the entity model atlas", () => {
  const source = fs.readFileSync(
    path.join(root, "scripts/features/system/services/vanilla-item-icon-paths.ts"),
    "utf8"
  );

  assert.match(source, /"minecraft:shield":\s*"textures\/ui\/empty_armor_slot_shield"/);
  assert.match(source, /vanillaItemIconOverrides\[typeId\]\s*\?\?/);
});
