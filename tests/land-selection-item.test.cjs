const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("land selection accepts only an exact minecraft:stick item id", () => {
  const source = fs.readFileSync(path.join(root, "scripts/events/handlers/land.ts"), "utf8");

  assert.doesNotMatch(source, /typeId\?\.includes\("minecraft:stick"\)/);
  assert.match(source, /itemTypeId !== "minecraft:stick"/);
  assert.match(source, /itemStack\?\.typeId !== "minecraft:stick"/);
});
