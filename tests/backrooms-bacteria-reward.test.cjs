const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const rewards = fs.readFileSync(
  path.join(root, "scripts", "features", "economic", "data", "monster-by-gold.ts"),
  "utf8",
);
const service = fs.readFileSync(
  path.join(root, "scripts", "features", "economic", "services", "monster-kill-reward.ts"),
  "utf8",
);

test("Bacteria has an exact 100-gold reward in the shared monster reward table", () => {
  assert.match(rewards, /backrooms_lifeform:\s*\[100,\s*100\]/);
});

test("Bacteria gold goes only through the protected real-player kill pipeline", () => {
  assert.match(service, /if \(!setting\.getState\(["']economy["']\)\) return/);
  assert.match(service, /if \(!setting\.getState\(["']monsterKillGoldReward["']\)\) return/);
  assert.match(service, /damageSource\.damagingEntity\?\.typeId === ["']minecraft:player["']/);
  assert.match(service, /isRealPlayerEntity\(player\)/);
  assert.match(service, /economic\.addGold\(player\.name, amount,/);
  assert.match(service, /getMonsterLocalizationKey\(fullType\)/);
  assert.doesNotMatch(service, /addGold\([^\n]*true\)/, "monster kills must respect the daily earnings limit");
});

