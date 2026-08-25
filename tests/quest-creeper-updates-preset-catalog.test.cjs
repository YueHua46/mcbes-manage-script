const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const { buildSync } = require("esbuild");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creeper-update-presets-"));
const bundleFile = path.join(tempRoot, "creeper-updates-catalog.cjs");

buildSync({
  entryPoints: [path.join(root, "scripts", "features", "quest", "presets", "creeper-updates-catalog.ts")],
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
  ["preset.creeper.guide.open_menu", "A", "common", 30, 10],
  ["preset.creeper.guide.waypoint", "A", "common", 80, 25],
  ["preset.creeper.guide.tpa", "A", "common", 100, 35],
  ["preset.creeper.guide.random_tp", "A", "common", 80, 25],
  ["preset.creeper.guide.land", "A", "rare", 200, 70],
  ["preset.creeper.guide.public_waypoint", "A", "common", 80, 25],
  ["preset.creeper.guide.market", "A", "rare", 180, 60],
  ["preset.creeper.guide.red_packet", "A", "common", 120, 40],
  ["preset.creeper.guide.guild", "A", "rare", 200, 70],
  ["preset.update.copper.ingots", "A", "common", 120, 40],
  ["preset.update.copper.pickaxe", "A", "common", 120, 40],
  ["preset.update.copper.full_armor", "A", "rare", 260, 90],
  ["preset.update.copper.golem", "B", "epic", 350, 120],
  ["preset.update.copper.chest", "A", "rare", 220, 80],
  ["preset.update.copper.sorting", "B", "epic", 500, 180],
  ["preset.update.copper.shelf", "B", "rare", 180, 60],
  ["preset.update.skies.dried_ghast", "A", "rare", 180, 60],
  ["preset.update.skies.revive", "B", "rare", 250, 90],
  ["preset.update.skies.ghastling", "B", "epic", 300, 100],
  ["preset.update.skies.happy_ghast", "B", "epic", 500, 180],
  ["preset.update.skies.harness", "A", "rare", 220, 80],
  ["preset.update.skies.ride", "B", "legendary", 700, 260],
  ["preset.update.mounts.spear", "A", "rare", 180, 60],
  ["preset.update.mounts.spear_charge", "C", "epic", 350, 120],
  ["preset.update.mounts.zombie_horse", "B", "epic", 350, 120],
  ["preset.update.mounts.camel_husk", "B", "epic", 350, 120],
  ["preset.update.mounts.parched", "A", "rare", 220, 80],
  ["preset.update.mounts.nautilus", "B", "epic", 450, 160],
  ["preset.update.mounts.ride_nautilus", "B", "epic", 500, 180],
  ["preset.update.tiny.name_tag", "A", "common", 100, 35],
  ["preset.update.tiny.name_baby", "B", "rare", 180, 60],
  ["preset.update.tiny.golden_dandelion", "B", "epic", 300, 100],
  ["preset.update.tiny.baby_collection", "B", "epic", 350, 120],
  ["preset.update.tiny.trumpet", "B", "rare", 220, 80],
  ["preset.update.chaos.sulfur", "A", "common", 120, 40],
  ["preset.update.chaos.cinnabar", "A", "common", 120, 40],
  ["preset.update.chaos.cave", "B", "rare", 250, 90],
  ["preset.update.chaos.meet_cube", "B", "rare", 180, 60],
  ["preset.update.chaos.bucket_cube", "A", "epic", 300, 100],
  ["preset.update.chaos.feed_cube", "B", "epic", 300, 100],
  ["preset.update.chaos.tnt", "C", "epic", 500, 180],
  ["preset.update.chaos.geyser", "B", "epic", 350, 120],
  ["preset.update.chaos.bounce_disc", "A", "legendary", 700, 260],
];

const expectedByPack = {
  "preset.creeper": 9,
  "preset.update.copper": 7,
  "preset.update.skies": 6,
  "preset.update.mounts": 7,
  "preset.update.tiny": 5,
  "preset.update.chaos": 9,
};

test("creeper and update catalogs contain the exact forty-three v1.4 tasks", () => {
  const quests = content.creeperAndUpdateQuests;
  assert.equal(quests.length, 43);
  assert.equal(new Set(quests.map((quest) => quest.id)).size, 43);
  assert.deepEqual(quests.map((quest) => quest.id).sort(), expected.map(([id]) => id).sort());
  assert.equal(content.creeperAndUpdatePacks.length, 6);
  assert.equal(content.creeperAndUpdateChapters.length, 6);
  assert.deepEqual(
    Object.fromEntries(
      content.creeperAndUpdatePacks.map((pack) => [pack.id, quests.filter((quest) => quest.packId === pack.id).length])
    ),
    expectedByPack
  );
  assert.equal(
    content.creeperAndUpdatePacks.every((pack) => pack.defaultEnabled === false),
    true
  );
  assert.equal(
    content.creeperAndUpdatePacks.every((pack) => pack.chapterIds.length === 1),
    true
  );
});

test("creeper and update reliability, rarity and rewards exactly match v1.4", () => {
  const byId = new Map(content.creeperAndUpdateQuests.map((quest) => [quest.id, quest]));
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
        content.creeperAndUpdateQuests.filter((quest) => quest.reliability === reliability).length,
      ])
    ),
    { A: 22, B: 19, C: 2 }
  );
});

test("future content is capability-gated and lower-confidence tasks never masquerade as active", () => {
  const updatePacks = content.creeperAndUpdatePacks.filter((pack) => pack.id.startsWith("preset.update."));
  for (const pack of updatePacks) {
    assert.equal(pack.defaultEnabled, false, pack.id);
    assert.equal(pack.requiredCapabilities.length, 1, pack.id);
    assert.match(pack.requiredCapabilities[0], /^cap\.content\.minecraft\.[a-z0-9_]+\.v1$/, pack.id);
    const quests = content.creeperAndUpdateQuests.filter((quest) => quest.packId === pack.id);
    assert.equal(
      quests.every((quest) => quest.requiredCapabilities.includes(pack.requiredCapabilities[0])),
      true,
      pack.id
    );
  }

  for (const quest of content.creeperAndUpdateQuests) {
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

test("all forty-three definitions have actionable Chinese copy, goals and stable metadata", () => {
  for (const quest of content.creeperAndUpdateQuests) {
    assert.match(quest.id, /^preset\.(?:creeper|update)\.[a-z0-9_.-]+$/);
    assert.equal(quest.source, "preset", quest.id);
    assert.equal(quest.definitionVersion, 1, quest.id);
    assert.ok(quest.title.length >= 6, `${quest.id} title`);
    assert.ok(quest.description.length >= 30, `${quest.id} description`);
    assert.ok(quest.completionMessage.length >= 12 && quest.completionMessage.length <= 40, `${quest.id} completion`);
    assert.ok(quest.goals.length > 0, `${quest.id} goals`);
    assert.ok(quest.requiredCapabilities.length > 0, `${quest.id} capabilities`);
    assert.equal(
      quest.goals.every((goal) => goal.displayText && goal.displayText.length >= 4),
      true,
      `${quest.id} goal copy`
    );
  }
});
