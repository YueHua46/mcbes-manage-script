const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("server statistics query dropped items by their canonical entity type id", () => {
  const sources = [
    read("scripts/features/system/services/server-info.ts"),
    read("scripts/features/command/services/command.ts"),
  ].join("\n");

  assert.doesNotMatch(sources, /type\s*:\s*["']item["']/);
  assert.doesNotMatch(sources, /excludeTypes\s*:\s*\[\s*["']item["']\s*\]/);
  assert.match(sources, /type\s*:\s*["']minecraft:item["']/);
});

test("live panel labels the complement as other entities instead of mobs", () => {
  const source = read("scripts/ui/forms/system/live-server-panel.ts");

  assert.match(source, /其他实体/);
  assert.doesNotMatch(source, /color\.green\(["']生物["']\)/);
});
