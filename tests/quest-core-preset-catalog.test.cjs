const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const { buildSync } = require("esbuild");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creeper-core-preset-"));
const bundleFile = path.join(tempRoot, "core-remaining.cjs");

buildSync({
  entryPoints: [path.join(root, "scripts", "features", "quest", "presets", "core", "remaining.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  outfile: bundleFile,
  logLevel: "silent",
});

const content = require(bundleFile);

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const expectedByChapter = {
  "core.survival": 3,
  "core.mining": 4,
  "core.magic": 5,
  "core.nether": 7,
  "core.eye": 5,
  "core.end": 3,
  "core.endcity": 7,
  "core.apex": 5,
};

const expectedQuestIds = [
  "preset.core.survival.torches",
  "preset.core.survival.bed",
  "preset.core.survival.shield",
  "preset.core.mining.bucket",
  "preset.core.mining.redstone",
  "preset.core.mining.lapis",
  "preset.core.mining.diamond_miner",
  "preset.core.magic.enchanting_table",
  "preset.core.magic.bookshelves",
  "preset.core.magic.first_enchant",
  "preset.core.magic.anvil",
  "preset.core.magic.enchanted_book",
  "preset.core.nether.quartz",
  "preset.core.nether.piglin_barter",
  "preset.core.nether.blaze_rods",
  "preset.core.nether.nether_wart",
  "preset.core.nether.brewing_stand",
  "preset.core.nether.ancient_debris",
  "preset.core.nether.netherite_ingot",
  "preset.core.eye.ender_pearls",
  "preset.core.eye.blaze_powder",
  "preset.core.eye.eyes",
  "preset.core.eye.stronghold",
  "preset.core.eye.enter_end",
  "preset.core.end.kill_dragon",
  "preset.core.end.dragon_breath",
  "preset.core.end.gateway",
  "preset.core.endcity.chorus",
  "preset.core.endcity.shulkers",
  "preset.core.endcity.shells",
  "preset.core.endcity.city",
  "preset.core.endcity.elytra",
  "preset.core.endcity.shulker_box",
  "preset.core.endcity.fly",
  "preset.core.apex.wither_skulls",
  "preset.core.apex.kill_wither",
  "preset.core.apex.nether_star",
  "preset.core.apex.beacon",
  "preset.core.apex.full_beacon",
];

const expectedRewardAmounts = Object.fromEntries(
  [
    ["preset.core.survival.torches", 40, 10],
    ["preset.core.survival.bed", 50, 15],
    ["preset.core.survival.shield", 60, 20],
    ["preset.core.mining.bucket", 60, 20],
    ["preset.core.mining.redstone", 70, 20],
    ["preset.core.mining.lapis", 70, 20],
    ["preset.core.mining.diamond_miner", 250, 100],
    ["preset.core.magic.enchanting_table", 160, 70],
    ["preset.core.magic.bookshelves", 180, 80],
    ["preset.core.magic.first_enchant", 200, 90],
    ["preset.core.magic.anvil", 120, 50],
    ["preset.core.magic.enchanted_book", 150, 60],
    ["preset.core.nether.quartz", 100, 35],
    ["preset.core.nether.piglin_barter", 180, 70],
    ["preset.core.nether.blaze_rods", 220, 90],
    ["preset.core.nether.nether_wart", 120, 40],
    ["preset.core.nether.brewing_stand", 150, 60],
    ["preset.core.nether.ancient_debris", 300, 120],
    ["preset.core.nether.netherite_ingot", 500, 180],
    ["preset.core.eye.ender_pearls", 160, 60],
    ["preset.core.eye.blaze_powder", 120, 50],
    ["preset.core.eye.eyes", 220, 80],
    ["preset.core.eye.stronghold", 300, 120],
    ["preset.core.eye.enter_end", 600, 250],
    ["preset.core.end.kill_dragon", 3000, 2000],
    ["preset.core.end.dragon_breath", 300, 120],
    ["preset.core.end.gateway", 500, 180],
    ["preset.core.endcity.chorus", 120, 40],
    ["preset.core.endcity.shulkers", 300, 100],
    ["preset.core.endcity.shells", 250, 90],
    ["preset.core.endcity.city", 400, 150],
    ["preset.core.endcity.elytra", 1200, 600],
    ["preset.core.endcity.shulker_box", 350, 120],
    ["preset.core.endcity.fly", 500, 180],
    ["preset.core.apex.wither_skulls", 500, 180],
    ["preset.core.apex.kill_wither", 2000, 1200],
    ["preset.core.apex.nether_star", 600, 220],
    ["preset.core.apex.beacon", 600, 220],
    ["preset.core.apex.full_beacon", 2500, 1500],
  ].map(([id, gold, experience]) => [id, { gold, experience }])
);

test("the remaining core catalog defines all thirty-nine stable quests", () => {
  const quests = content.coreRemainingQuests;
  assert.equal(quests.length, 39);
  assert.equal(new Set(quests.map((quest) => quest.id)).size, 39);
  assert.deepEqual(quests.map((quest) => quest.id).sort(), [...expectedQuestIds].sort());
  assert.deepEqual(
    Object.fromEntries(
      Object.keys(expectedByChapter).map((chapterId) => [
        chapterId,
        quests.filter((quest) => quest.chapterId === chapterId).length,
      ])
    ),
    expectedByChapter
  );
  assert.equal(content.coreRemainingChapters.length, 5);
  assert.deepEqual(Object.keys(content.coreExistingChapterQuestAdditions).sort(), [
    "core.mining",
    "core.nether",
    "core.survival",
  ]);
});

test("core reliability gates match the v1.4 contract", () => {
  const quests = content.coreRemainingQuests;
  const counts = Object.fromEntries(
    ["A", "B", "C"].map((reliability) => [
      reliability,
      quests.filter((quest) => quest.reliability === reliability).length,
    ])
  );
  assert.deepEqual(counts, { A: 32, B: 5, C: 2 });
  assert.deepEqual(
    quests
      .filter((quest) => quest.reliability === "B")
      .map((quest) => quest.id)
      .sort(),
    [
      "preset.core.apex.full_beacon",
      "preset.core.end.gateway",
      "preset.core.endcity.fly",
      "preset.core.magic.first_enchant",
      "preset.core.nether.piglin_barter",
    ]
  );
  assert.deepEqual(
    quests
      .filter((quest) => quest.reliability === "C")
      .map((quest) => quest.id)
      .sort(),
    ["preset.core.endcity.city", "preset.core.eye.stronghold"]
  );
  assert.equal(
    quests.every((quest) =>
      quest.reliability === "A"
        ? quest.releaseState === "active"
        : quest.reliability === "B"
          ? quest.releaseState === "experimental"
          : quest.releaseState === "planned"
    ),
    true
  );
});

test("every remaining core quest has clear Chinese copy, stable goals, rewards and capability metadata", () => {
  for (const quest of content.coreRemainingQuests) {
    assert.match(quest.id, /^preset\.core\.[a-z0-9_.-]+$/);
    assert.equal(quest.source, "preset", quest.id);
    assert.equal(quest.definitionVersion, 1, quest.id);
    assert.ok(quest.title.length >= 6, `${quest.id} title`);
    assert.ok(quest.description.length >= 30, `${quest.id} description`);
    assert.ok(quest.completionMessage.length >= 12 && quest.completionMessage.length <= 40, `${quest.id} completion`);
    assert.ok(quest.requiredCapabilities.length > 0, `${quest.id} capabilities`);
    assert.equal(new Set(quest.goals.map((goal) => goal.id)).size, quest.goals.length, `${quest.id} goal ids`);
    assert.equal(
      quest.goals.every((goal) => goal.displayText && goal.displayText.length >= 4),
      true,
      `${quest.id} goal copy`
    );
    assert.deepEqual(
      quest.rewards.map((reward) => reward.id),
      ["reward.gold", "reward.exp"],
      `${quest.id} rewards`
    );
    assert.deepEqual(
      {
        gold: quest.rewards[0].params.amount,
        experience: quest.rewards[1].params.amount,
      },
      expectedRewardAmounts[quest.id],
      `${quest.id} reward amounts`
    );
  }
});

test("C reliability structure quests remain planned and use no loot proxy", () => {
  const planned = content.coreRemainingQuests.filter((quest) => quest.reliability === "C");
  assert.deepEqual(planned.map((quest) => quest.id).sort(), ["preset.core.endcity.city", "preset.core.eye.stronghold"]);
  assert.equal(
    planned.every(
      (quest) =>
        quest.releaseState === "planned" &&
        quest.goals.every((goal) => goal.semantics === "milestone" && goal.eventType === "structure.enter")
    ),
    true
  );
});
