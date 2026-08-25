const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const { buildSync } = require("esbuild");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creeper-world-preset-"));
const bundleFile = path.join(tempRoot, "world-catalog.cjs");

buildSync({
  entryPoints: [path.join(root, "scripts", "features", "quest", "presets", "world", "catalog.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  outfile: bundleFile,
  logLevel: "silent",
});

const content = require(bundleFile);

after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

// id, reliability, rarity, gold, experience
const expected = [
  ["preset.world.village.first_trade", "B", "common", 100, 35],
  ["preset.world.village.trader", "B", "rare", 200, 70],
  ["preset.world.village.cure", "B", "epic", 350, 120],
  ["preset.world.village.ominous_bottle", "A", "rare", 180, 60],
  ["preset.world.village.raid", "B", "epic", 700, 260],
  ["preset.world.village.totem", "A", "epic", 500, 180],
  ["preset.world.ocean.enter", "B", "common", 120, 40],
  ["preset.world.ocean.treasure_map", "B", "rare", 150, 50],
  ["preset.world.ocean.heart", "A", "epic", 350, 120],
  ["preset.world.ocean.guardians", "A", "rare", 220, 80],
  ["preset.world.ocean.elder_guardian", "A", "epic", 600, 220],
  ["preset.world.ocean.sponge", "A", "rare", 220, 80],
  ["preset.world.ocean.conduit", "B", "epic", 700, 260],
  ["preset.world.archaeology.brush", "A", "common", 80, 25],
  ["preset.world.archaeology.brush_suspicious", "B", "rare", 160, 55],
  ["preset.world.archaeology.sherd", "A", "rare", 180, 60],
  ["preset.world.archaeology.pot", "A", "rare", 220, 80],
  ["preset.world.archaeology.sniffer_egg", "A", "epic", 450, 160],
  ["preset.world.archaeology.ancient_plants", "A", "epic", 350, 120],
  ["preset.world.deepdark.sculk", "A", "common", 120, 40],
  ["preset.world.deepdark.enter", "B", "rare", 220, 80],
  ["preset.world.deepdark.ancient_city", "C", "epic", 450, 160],
  ["preset.world.deepdark.echo_shard", "A", "epic", 450, 160],
  ["preset.world.deepdark.recovery_compass", "A", "epic", 500, 180],
  ["preset.world.deepdark.swift_sneak", "B", "epic", 600, 220],
  ["preset.world.trials.enter", "C", "rare", 250, 90],
  ["preset.world.trials.breeze", "A", "rare", 250, 90],
  ["preset.world.trials.breeze_rod", "A", "rare", 220, 80],
  ["preset.world.trials.trial_key", "A", "rare", 220, 80],
  ["preset.world.trials.vault", "B", "epic", 350, 120],
  ["preset.world.trials.ominous", "B", "epic", 350, 120],
  ["preset.world.trials.ominous_key", "A", "epic", 400, 140],
  ["preset.world.trials.heavy_core", "A", "epic", 700, 260],
  ["preset.world.trials.mace", "A", "legendary", 1000, 400],
  ["preset.world.farm.plant", "B", "common", 100, 30],
  ["preset.world.farm.harvest", "B", "rare", 180, 60],
  ["preset.world.farm.breed", "B", "common", 120, 40],
  ["preset.world.farm.rancher", "B", "rare", 260, 90],
  ["preset.world.farm.tame", "B", "rare", 220, 80],
  ["preset.world.farm.honey", "A", "common", 120, 40],
  ["preset.world.redstone.redstone", "A", "common", 80, 25],
  ["preset.world.redstone.piston", "A", "common", 100, 35],
  ["preset.world.redstone.observer", "A", "common", 100, 35],
  ["preset.world.redstone.comparator", "A", "common", 100, 35],
  ["preset.world.redstone.hopper", "A", "common", 100, 35],
  ["preset.world.redstone.crafter", "A", "rare", 180, 60],
  ["preset.world.redstone.crafter_use", "B", "rare", 260, 90],
  ["preset.world.pale_garden.enter", "B", "rare", 180, 60],
  ["preset.world.pale_garden.pale_oak", "A", "common", 100, 35],
  ["preset.world.pale_garden.creaking", "B", "rare", 250, 90],
  ["preset.world.pale_garden.heart", "A", "epic", 350, 120],
  ["preset.world.pale_garden.resin", "A", "rare", 220, 80],
];

const expectedByChapter = {
  "world.village": 6,
  "world.ocean": 7,
  "world.archaeology": 6,
  "world.deepdark": 6,
  "world.trials": 9,
  "world.farm": 6,
  "world.redstone": 7,
  "world.pale_garden": 5,
};

test("world preset catalog contains the exact fifty-two v1.4 tasks", () => {
  const quests = content.worldPresetQuests;
  assert.equal(quests.length, 52);
  assert.equal(new Set(quests.map((quest) => quest.id)).size, 52);
  assert.deepEqual(quests.map((quest) => quest.id).sort(), expected.map(([id]) => id).sort());
  assert.equal(content.worldPresetChapters.length, 8);
  assert.deepEqual(
    Object.fromEntries(
      content.worldPresetChapters.map((chapter) => [
        chapter.id,
        quests.filter((quest) => quest.chapterId === chapter.id).length,
      ])
    ),
    expectedByChapter
  );
  assert.deepEqual(content.worldPresetPack.chapterIds, Object.keys(expectedByChapter));
  assert.equal(content.worldPresetPack.defaultEnabled, false);
});

test("world reliability, rarity and default rewards exactly match v1.4", () => {
  const byId = new Map(content.worldPresetQuests.map((quest) => [quest.id, quest]));
  for (const [id, reliability, rarity, gold, experience] of expected) {
    const quest = byId.get(id);
    assert.ok(quest, id);
    assert.equal(quest.reliability, reliability, `${id} reliability`);
    assert.equal(quest.rarity, rarity, `${id} rarity`);
    assert.equal(quest.rewards[0].params.amount, gold, `${id} gold`);
    assert.equal(quest.rewards[1].params.amount, experience, `${id} experience`);
  }
  assert.deepEqual(
    Object.fromEntries(
      ["A", "B", "C"].map((reliability) => [
        reliability,
        content.worldPresetQuests.filter((quest) => quest.reliability === reliability).length,
      ])
    ),
    { A: 30, B: 20, C: 2 }
  );
});

test("world copy, goals, stable ids and release gates are complete", () => {
  for (const quest of content.worldPresetQuests) {
    assert.match(quest.id, /^preset\.world\.[a-z0-9_.-]+$/);
    assert.equal(quest.source, "preset", quest.id);
    assert.equal(quest.definitionVersion, 1, quest.id);
    assert.ok(quest.title.length >= 6, `${quest.id} title`);
    assert.ok(quest.description.length >= 30, `${quest.id} description`);
    assert.ok(quest.completionMessage.length >= 12 && quest.completionMessage.length <= 40, `${quest.id} completion`);
    assert.ok(quest.requiredCapabilities.length > 0, `${quest.id} capabilities`);
    assert.ok(quest.goals.length > 0, `${quest.id} goals`);
    assert.equal(
      quest.goals.every((goal) => goal.displayText && goal.displayText.length >= 4),
      true,
      `${quest.id} goal copy`
    );
    assert.equal(
      quest.reliability === "A"
        ? quest.releaseState === "active"
        : quest.reliability === "B"
          ? quest.releaseState === "experimental"
          : quest.releaseState === "planned",
      true,
      `${quest.id} release gate`
    );
  }
});

test("world structure tasks stay planned and never use loot proxies", () => {
  const planned = content.worldPresetQuests.filter((quest) => quest.reliability === "C");
  assert.deepEqual(planned.map((quest) => quest.id).sort(), [
    "preset.world.deepdark.ancient_city",
    "preset.world.trials.enter",
  ]);
  assert.equal(
    planned.every(
      (quest) =>
        quest.releaseState === "planned" &&
        quest.goals.every((goal) => goal.semantics === "milestone" && goal.eventType === "structure.enter")
    ),
    true
  );
});
