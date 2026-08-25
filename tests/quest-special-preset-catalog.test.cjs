const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const { buildSync } = require("esbuild");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creeper-special-presets-"));
const bundleFile = path.join(tempRoot, "special-catalog.cjs");

buildSync({
  entryPoints: [path.join(root, "scripts", "features", "quest", "presets", "special-catalog.ts")],
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
  ["preset.experiment.drop3.dappled_forest", "B", "rare", 150, 50],
  ["preset.experiment.drop3.poplar", "A", "common", 100, 35],
  ["preset.experiment.drop3.shelf_mushroom", "A", "common", 120, 40],
  ["preset.experiment.drop3.red_shrub", "A", "common", 120, 40],
  ["preset.experiment.drop3.camp", "C", "epic", 300, 100],
  ["preset.experiment.drop3.straw_bed", "B", "rare", 180, 60],
  ["preset.experiment.drop3.cushion", "B", "rare", 150, 50],
  ["preset.hidden.warden", "A", "legendary", 1500, 800],
  ["preset.hidden.dragon_again", "B", "legendary", 1200, 600],
  ["preset.hidden.mace_smash", "C", "epic", 800, 300],
  ["preset.hidden.happy_ghast_party", "B", "epic", 800, 300],
  ["preset.hidden.elytra_distance", "B", "legendary", 1000, 400],
];

test("experiment and hidden catalogs contain the exact twelve v1.4 tasks", () => {
  const quests = content.specialPresetQuests;
  assert.equal(quests.length, 12);
  assert.equal(new Set(quests.map((quest) => quest.id)).size, 12);
  assert.deepEqual(quests.map((quest) => quest.id).sort(), expected.map(([id]) => id).sort());
  assert.deepEqual(
    content.specialPresetPacks.map((pack) => pack.id),
    ["preset.experiment.drop3", "preset.hidden"]
  );
  assert.equal(content.specialPresetChapters.length, 2);
  assert.deepEqual(
    Object.fromEntries(
      content.specialPresetPacks.map((pack) => [pack.id, quests.filter((quest) => quest.packId === pack.id).length])
    ),
    { "preset.experiment.drop3": 7, "preset.hidden": 5 }
  );
});

test("special reliability, rarity and rewards exactly match v1.4", () => {
  const byId = new Map(content.specialPresetQuests.map((quest) => [quest.id, quest]));
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
        content.specialPresetQuests.filter((quest) => quest.reliability === reliability).length,
      ])
    ),
    { A: 4, B: 6, C: 2 }
  );
});

test("Drop 3 remains disabled behind explicit content and gameplay experiment gates", () => {
  const pack = content.specialPresetPacks.find((candidate) => candidate.id === "preset.experiment.drop3");
  const quests = content.specialPresetQuests.filter((quest) => quest.packId === pack.id);
  assert.equal(pack.defaultEnabled, false);
  assert.equal(pack.releaseState, "experimental");
  assert.deepEqual(pack.requiredCapabilities, ["cap.content.minecraft.drop3_experiment.v1"]);
  assert.deepEqual(pack.requiredGameplayExperiments, ["minecraft:drop_3"]);
  assert.equal(
    quests.every(
      (quest) =>
        quest.requiredCapabilities.includes(pack.requiredCapabilities[0]) &&
        quest.requiredGameplayExperiments.includes(pack.requiredGameplayExperiments[0])
    ),
    true
  );
});

test("hidden challenges track silently and never inflate visible progression", () => {
  const pack = content.specialPresetPacks.find((candidate) => candidate.id === "preset.hidden");
  const quests = content.specialPresetQuests.filter((quest) => quest.packId === pack.id);
  assert.equal(pack.defaultEnabled, true);
  assert.equal(
    quests.every(
      (quest) => quest.hidden === true && quest.trackWhileHidden === true && quest.contributesToProgress === false
    ),
    true
  );
  assert.equal(
    quests.every((quest) => quest.claimMode === "manual" && quest.acceptMode === "auto"),
    true
  );
});

test("special release gates, copy and exact challenge semantics stay explicit", () => {
  for (const quest of content.specialPresetQuests) {
    assert.equal(
      quest.reliability === "A"
        ? quest.releaseState === "active"
        : quest.reliability === "B"
          ? quest.releaseState === "experimental"
          : quest.releaseState === "planned",
      true,
      `${quest.id} release gate`
    );
    assert.ok(quest.title.length >= 6, `${quest.id} title`);
    assert.ok(quest.description.length >= 30, `${quest.id} description`);
    assert.ok(quest.completionMessage.length >= 12 && quest.completionMessage.length <= 40, `${quest.id} completion`);
    assert.ok(
      quest.goals.every((goal) => goal.displayText && goal.displayText.length >= 4),
      `${quest.id} goals`
    );
  }

  const byId = new Map(content.specialPresetQuests.map((quest) => [quest.id, quest]));
  assert.equal(byId.get("preset.experiment.drop3.camp").goals[0].eventType, "structure.enter");
  assert.equal(byId.get("preset.hidden.dragon_again").goals[0].backfillPolicy, "historical");
  assert.equal(byId.get("preset.hidden.elytra_distance").goals[0].target, 10000);
  assert.equal(byId.get("preset.hidden.elytra_distance").goals[0].aggregation, "sum");
});
