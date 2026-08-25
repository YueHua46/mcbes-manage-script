const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const { buildSync } = require("esbuild");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creeper-quest-catalog-"));
const bundleFile = path.join(tempRoot, "quest-catalog.cjs");

buildSync({
  entryPoints: [path.join(root, "scripts", "features", "quest", "catalog", "index.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  outfile: bundleFile,
  logLevel: "silent",
});

const catalogModule = require(bundleFile);

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function createRegistries() {
  return {
    presets: catalogModule.createQuestPresetRegistry(),
    selectors: catalogModule.createDefaultQuestSelectorRegistry(),
    capabilities: catalogModule.createDefaultQuestCapabilityRegistry(),
  };
}

test("quest catalog and preset sources remain independent of the Minecraft runtime", () => {
  for (const relativeDirectory of [
    ["scripts", "features", "quest", "catalog"],
    ["scripts", "features", "quest", "presets"],
  ]) {
    const directory = path.join(root, ...relativeDirectory);
    const sources = [];
    const visit = (current) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const target = path.join(current, entry.name);
        if (entry.isDirectory()) visit(target);
        else if (entry.name.endsWith(".ts")) sources.push(fs.readFileSync(target, "utf8"));
      }
    };
    visit(directory);
    assert.equal(
      sources.some((source) => source.includes("@minecraft/server")),
      false
    );
  }
});

test("the complete preset catalog registers all 158 stable quests", () => {
  const { presets, selectors, capabilities } = createRegistries();
  const snapshot = presets.snapshot();
  const diagnostics = catalogModule.validatePresetRegistry(snapshot, selectors, capabilities);

  assert.equal(snapshot.packs.length, 10);
  assert.equal(snapshot.chapters.length, 24);
  assert.equal(snapshot.quests.length, 158);
  assert.deepEqual(diagnostics, []);
  assert.equal(
    snapshot.quests.every((quest) => quest.source === "preset"),
    true
  );
  assert.deepEqual(
    Object.fromEntries(
      ["A", "B", "C"].map((reliability) => [
        reliability,
        snapshot.quests.filter((quest) => quest.reliability === reliability).length,
      ])
    ),
    { A: 100, B: 50, C: 8 }
  );
  assert.equal(
    snapshot.quests.every((quest) => quest.id.startsWith("preset.")),
    true
  );
  assert.equal(
    snapshot.quests.every((quest) => quest.definitionVersion === 1),
    true
  );
  assert.equal(
    snapshot.quests.some((quest) => /\d{10,}/.test(quest.id)),
    false
  );
  assert.equal(snapshot.packs.find((pack) => pack.id === "preset.core")?.title, "方块世界，先活下来再说");
  assert.equal(
    snapshot.chapters.every((chapter) => chapter.description.length >= 18),
    true
  );
  assert.equal(
    snapshot.quests.every((quest) => quest.title.length >= 5),
    true
  );
  assert.equal(
    snapshot.quests.every((quest) => quest.description.length >= 24),
    true
  );
  assert.equal(
    snapshot.quests.every((quest) => quest.goals.every((goal) => goal.displayText?.trim().length >= 4)),
    true
  );
  assert.equal(
    snapshot.quests.some((quest) =>
      ["拥有第一个工作台。", "进入石制工具阶段。", "拥有铁镐。", "第一次进入下界。"].includes(quest.description)
    ),
    false
  );
});

test("full iron armor is four stable equipment snapshots and first-slice selectors resolve", () => {
  const { presets, selectors } = createRegistries();
  const armor = presets.getQuest("preset.core.mining.full_iron_armor");
  assert.ok(armor);
  assert.equal(armor.goals.length, 4);
  assert.equal(
    armor.goals.every((goal) => goal.semantics === "snapshot" && goal.provider === "equipment"),
    true
  );
  assert.equal(
    armor.goals.every((goal) => selectors.has(goal.selectorId)),
    true
  );

  assert.equal(selectors.matchItem("selector.item.logs", { typeId: "minecraft:oak_log", amount: 1 }), true);
  assert.equal(selectors.matchItem("selector.item.logs", { typeId: "minecraft:oak_planks", amount: 1 }), false);
  assert.equal(
    selectors.matchEquipment("selector.equipment.iron_boots", {
      slots: { Feet: { typeId: "minecraft:iron_boots", amount: 1 } },
    }),
    true
  );
});

test("legacy custom definitions normalize without changing stable goal or reward ids", () => {
  const legacy = {
    id: "daily_kill_zombie",
    title: "清理僵尸",
    description: "击杀僵尸",
    completionMessage: "僵尸下班，今天你值夜班。",
    scope: "daily",
    autoAccept: true,
    enabled: true,
    completeWhen: "all",
    goals: [
      {
        id: "goal_kill_zombie",
        event: "entity.kill",
        filters: { entity: { op: "eq", value: "minecraft:zombie" } },
        progress: { mode: "count", target: 10 },
      },
    ],
    rewards: [{ id: "reward_money", action: "add_money", params: { amount: 500 } }],
    createdAt: 1,
    updatedAt: 2,
  };
  const normalized = catalogModule.normalizeLegacyCustomQuest(legacy);

  assert.equal(normalized.id, legacy.id);
  assert.equal(normalized.source, "custom");
  assert.equal(normalized.definitionVersion, 1);
  assert.equal(normalized.acceptMode, "auto");
  assert.equal(normalized.completionMessage, legacy.completionMessage);
  assert.equal(normalized.goals[0].id, "goal_kill_zombie");
  assert.equal(normalized.goals[0].semantics, "counter");
  assert.equal(normalized.rewards[0].id, "reward_money");
});

test("effective catalog rejects preset/custom id conflicts without hiding active presets", () => {
  const { presets, selectors, capabilities } = createRegistries();
  const legacy = {
    id: "preset.core.survival.first_log",
    title: "冲突任务",
    description: "",
    scope: "once",
    autoAccept: false,
    enabled: true,
    completeWhen: "all",
    goals: [
      {
        id: "goal.custom",
        event: "entity.kill",
        filters: {},
        progress: { mode: "count", target: 1 },
      },
    ],
    rewards: [{ id: "reward.custom", action: "send_message", params: { message: "ok" } }],
    createdAt: 1,
    updatedAt: 1,
  };
  const conflicting = catalogModule.normalizeLegacyCustomQuest(legacy);
  const effective = new catalogModule.EffectiveQuestCatalog({
    presets,
    customQuests: [conflicting],
    selectors,
    capabilities,
  });

  assert.equal(effective.getAll().length, 150);
  assert.equal(effective.getAll({ includePlanned: true }).length, 158);
  assert.equal(
    effective.getDiagnostics().some((diagnostic) => diagnostic.code === "preset_custom_id_conflict"),
    true
  );
  assert.equal(effective.isValid(), false);
});

test("server overrides produce an effective pack view without mutating official presets", () => {
  const { presets, selectors, capabilities } = createRegistries();
  const questId = "preset.core.survival.first_log";
  const officialQuest = presets.getQuest(questId);
  const effective = new catalogModule.EffectiveQuestCatalog({
    presets,
    customQuests: [],
    selectors,
    capabilities,
    serverStates: [
      {
        packId: "preset.core",
        enabled: false,
        rewardScale: 1.5,
        overrideQuestEnabled: { [questId]: false },
        gameplayExperimentConfirmation: { "experiment.next_update": true, "experiment.disabled": false },
        updatedAt: 10,
      },
    ],
  });
  const entry = effective.getEffectiveQuest(questId);

  assert.equal(entry.packEnabled, false);
  assert.equal(entry.chapterEnabled, true);
  assert.equal(entry.questEnabled, false);
  assert.equal(entry.rewardScale, 1.5);
  assert.deepEqual([...entry.confirmedGameplayExperiments], ["experiment.next_update"]);
  assert.equal(officialQuest.enabled, true);
  assert.equal(officialQuest.rewards[0].params.amount, 40);
  assert.equal(effective.isValid(), true);
});

test("chapter switches and per-quest reward overrides are effective without mutating registry definitions", () => {
  const { presets, selectors, capabilities } = createRegistries();
  const questId = "preset.core.survival.first_log";
  const chapterId = "core.survival";
  const effective = new catalogModule.EffectiveQuestCatalog({
    presets,
    customQuests: [],
    selectors,
    capabilities,
    serverStates: [
      {
        packId: "preset.core",
        enabled: true,
        overrideChapterEnabled: { [chapterId]: false },
        overrideQuestEnabled: { [questId]: true },
        overrideQuestRewards: {
          [questId]: [
            { id: "reward.money", action: "add_money", params: { amount: 999 } },
            { id: "override.reward.add_exp.1", action: "add_exp", params: { amount: 77 } },
          ],
        },
        updatedAt: 10,
      },
    ],
  });
  const entry = effective.getEffectiveQuest(questId);

  assert.equal(entry.packEnabled, true);
  assert.equal(entry.chapterEnabled, false);
  assert.equal(entry.questEnabled, false, "a disabled task type must suspend every contained quest");
  assert.deepEqual(
    entry.definition.rewards.map((reward) => reward.params.amount),
    [999, 77]
  );
  assert.equal(presets.getQuest(questId).rewards[0].params.amount, 40);

  const escaped = presets.getQuest(questId);
  escaped.rewards[0].params.amount = 123456;
  assert.equal(presets.getQuest(questId).rewards[0].params.amount, 40, "registry getters must return defensive copies");
});

test("invalid chapter and reward overrides are diagnosed as server override conflicts", () => {
  const { presets, selectors, capabilities } = createRegistries();
  const effective = new catalogModule.EffectiveQuestCatalog({
    presets,
    customQuests: [],
    selectors,
    capabilities,
    serverStates: [
      {
        packId: "preset.core",
        enabled: true,
        overrideChapterEnabled: { "world.not_in_core": false },
        overrideQuestRewards: {
          "preset.unknown": [{ id: "reward.money", action: "add_money", params: { amount: 1 } }],
          "preset.core.survival.first_log": [
            { id: "reward.duplicate", action: "add_money", params: { amount: 1 } },
            { id: "reward.duplicate", action: "add_exp", params: { amount: 1 } },
          ],
        },
        updatedAt: 10,
      },
    ],
  });
  const codes = effective.getDiagnostics().map((diagnostic) => diagnostic.code);

  assert.equal(codes.includes("invalid_chapter_server_override"), true);
  assert.equal(codes.includes("invalid_quest_reward_override"), true);
  assert.equal(codes.includes("invalid_reward_server_override"), true);
  assert.equal(
    effective.getEffectiveQuest("preset.core.survival.first_log").definition.rewards[0].params.amount,
    40,
    "a corrupt reward override must fall back to the official rewards"
  );
  assert.equal(effective.isValid(), false);
});

test("preset server override service persists only its dedicated database and validates reward fields", () => {
  const source = fs.readFileSync(
    path.join(root, "scripts", "features", "quest", "services", "quest-catalog.ts"),
    "utf8"
  );

  assert.match(source, /SERVER_STATE_DB = "quest_preset_pack_states"/);
  assert.match(source, /new Database<PresetPackServerState>\(SERVER_STATE_DB\)/);
  assert.match(source, /this\.serverStateDb\.set\(state\.packId, persisted\)/);
  assert.match(source, /this\.serverStateDb\.save\(true\)/);
  assert.match(source, /overrideChapterEnabled/);
  assert.match(source, /overrideQuestEnabled/);
  assert.match(source, /overrideQuestRewards/);
  assert.match(source, /validateRewardOverride/);
  assert.doesNotMatch(source, /quest_definitions.*set|questDefinitionService\.save/);
});

test("invalid server overrides are diagnosed instead of silently targeting another pack", () => {
  const { presets, selectors, capabilities } = createRegistries();
  const effective = new catalogModule.EffectiveQuestCatalog({
    presets,
    customQuests: [],
    selectors,
    capabilities,
    serverStates: [
      {
        packId: "preset.core",
        enabled: true,
        rewardScale: -1,
        overrideQuestEnabled: { "preset.unknown": true },
        updatedAt: 10,
      },
      { packId: "preset.unknown_pack", enabled: true, updatedAt: 11 },
    ],
  });
  const codes = effective.getDiagnostics().map((diagnostic) => diagnostic.code);

  assert.equal(codes.includes("invalid_reward_scale"), true);
  assert.equal(codes.includes("unknown_server_override_pack"), true);
  assert.equal(effective.isValid(), false);
});

test("preset validator detects quest dependency cycles", () => {
  const { presets, selectors, capabilities } = createRegistries();
  const snapshot = structuredClone(presets.snapshot());
  const first = snapshot.quests.find((quest) => quest.id === "preset.core.survival.first_log");
  const second = snapshot.quests.find((quest) => quest.id === "preset.core.survival.crafting_table");
  first.unlockRule = { type: "quest", questId: second.id, status: "completed" };
  second.unlockRule = { type: "quest", questId: first.id, status: "completed" };

  const diagnostics = catalogModule.validatePresetRegistry(snapshot, selectors, capabilities);
  assert.equal(
    diagnostics.some((diagnostic) => diagnostic.code === "quest_dependency_cycle"),
    true
  );
});
