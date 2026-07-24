const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const rewards = fs.readFileSync(
  path.join(root, "scripts", "features", "economic", "data", "monster-by-gold.ts"),
  "utf8",
);
const entity = JSON.parse(fs.readFileSync(
  path.join(root, "behavior_packs", "Backrooms", "entities", "backrooms_lifeform.json"),
  "utf8",
))["minecraft:entity"];

test("Bacteria reward behavior is self-contained and does not configure CreeperMenu economy", () => {
  assert.doesNotMatch(rewards, /backrooms_lifeform/);
  assert.equal(entity.components["minecraft:experience_reward"].on_death, "50");
});
