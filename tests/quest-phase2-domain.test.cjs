const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const { buildSync } = require("esbuild");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creeper-quest-phase2-"));
const entryFile = path.join(tempRoot, "entry.ts");
const bundleFile = path.join(tempRoot, "quest-phase2.cjs");

fs.writeFileSync(
  entryFile,
  [
    `export * from ${JSON.stringify(path.join(root, "scripts", "features", "quest", "events", "index.ts"))};`,
    `export * from ${JSON.stringify(path.join(root, "scripts", "features", "quest", "snapshots", "index.ts"))};`,
    `export * from ${JSON.stringify(
      path.join(root, "scripts", "features", "quest", "catalog", "selector-registry.ts")
    )};`,
    `export * from ${JSON.stringify(
      path.join(root, "scripts", "features", "quest", "state", "quest-state-migration.ts")
    )};`,
  ].join("\n")
);

buildSync({
  entryPoints: [entryFile],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  outfile: bundleFile,
  logLevel: "silent",
});

const phase2 = require(bundleFile);

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function counterQuest(id, entity, acceptMode = "manual") {
  return {
    id,
    source: "custom",
    definitionVersion: 1,
    title: id,
    description: "",
    category: "custom",
    rarity: "common",
    reliability: "A",
    releaseState: "active",
    scope: "once",
    completeWhen: "all",
    acceptMode,
    claimMode: "manual",
    enabled: true,
    hidden: false,
    trackWhileHidden: false,
    contributesToProgress: false,
    unlockRule: { type: "always" },
    unlockEventPolicy: "exclude",
    requiredCapabilities: [],
    requiredGameplayExperiments: [],
    goals: [
      {
        id: `goal.${entity}`,
        semantics: "counter",
        eventType: "entity.kill",
        filters: { entity: { op: "eq", value: entity } },
        aggregation: "count",
        target: 1,
        backfillPolicy: "none",
      },
    ],
    rewards: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

test("event index narrows common selectors and tracks auto-accept definitions by catalog version", () => {
  const index = new phase2.QuestEventIndex();
  index.rebuild(
    [counterQuest("zombie", "minecraft:zombie", "auto"), counterQuest("skeleton", "minecraft:skeleton")],
    7
  );

  assert.equal(index.getVersion(), 7);
  assert.deepEqual(index.getAutoAcceptQuestIds(), ["zombie"]);
  assert.deepEqual(index.getCandidates("entity.kill", { entity: "minecraft:zombie" }), [
    { questId: "zombie", goalId: "goal.minecraft:zombie" },
  ]);
  assert.deepEqual(index.getCandidates("entity.kill", { entity: "minecraft:creeper" }), []);
  assert.equal(index.getDefinition("skeleton").id, "skeleton");
});

test("event bus validates its envelope and bounded persistent dedupe keeps the newest evidence", () => {
  const bus = new phase2.QuestEventBus();
  const seen = [];
  bus.subscribe((event) => seen.push(event.type));
  const event = {
    id: "operation:1",
    type: "creeper.market.trade",
    playerCmid: "cmid_test",
    timestamp: 10,
    payload: { amount: 1 },
    source: "market.trade.commit",
    dedupeKey: "trade:1",
  };
  bus.publish(event, {});
  assert.deepEqual(seen, ["creeper.market.trade"]);
  assert.throws(() => bus.publish({ ...event, id: "" }, {}), /event id/);

  const aggregate = phase2.createEmptyQuestPlayerAggregate("cmid_test", "Alice");
  phase2.markQuestEventProcessed(aggregate, "trade:1", 2);
  phase2.markQuestEventProcessed(aggregate, "trade:2", 2);
  phase2.markQuestEventProcessed(aggregate, "trade:3", 2);
  assert.deepEqual(aggregate.processedEventDedupe, ["trade:2", "trade:3"]);
  assert.equal(phase2.hasProcessedQuestEvent(aggregate, "trade:1"), false);
  assert.equal(phase2.hasProcessedQuestEvent(aggregate, "trade:3"), true);
});

test("one inventory summary is reused by current and peak snapshot goals", () => {
  const selectors = phase2.createDefaultQuestSelectorRegistry();
  const inventory = phase2.createInventorySnapshotSummary(
    [
      { typeId: "minecraft:oak_log", amount: 2 },
      { typeId: "minecraft:oak_log", amount: 3 },
      { typeId: "minecraft:stone", amount: 64 },
    ],
    10,
    1
  );
  assert.equal(inventory.items.get("minecraft:oak_log").amount, 5);

  const goals = [
    {
      id: "goal.current",
      semantics: "snapshot",
      provider: "inventory",
      selectorId: "selector.item.logs",
      target: 1,
      snapshotMode: "current",
    },
    {
      id: "goal.peak",
      semantics: "snapshot",
      provider: "inventory",
      selectorId: "selector.item.logs",
      target: 1,
      snapshotMode: "peak",
    },
  ];
  const progress = {};
  assert.deepEqual(phase2.reconcileSnapshotGoals({ goals, progress, selectors, inventory }), [
    "goal.current",
    "goal.peak",
  ]);
  assert.equal(progress["goal.current"].observedValue, 5);
  assert.equal(progress["goal.peak"].observedValue, 5);

  const empty = phase2.createInventorySnapshotSummary([], 20, 1);
  phase2.reconcileSnapshotGoals({ goals, progress, selectors, inventory: empty });
  assert.equal(progress["goal.current"].observedValue, 0);
  assert.equal(progress["goal.peak"].observedValue, 5);
});

test("equipment snapshots and dirty queue coalesce repeated triggers without per-goal scans", () => {
  const selectors = phase2.createDefaultQuestSelectorRegistry();
  const equipment = {
    slots: { Head: { typeId: "minecraft:iron_helmet", amount: 1 } },
    builtAt: 10,
    providerVersion: 1,
  };
  const progress = {};
  const goals = [
    {
      id: "goal.helmet",
      semantics: "snapshot",
      provider: "equipment",
      selectorId: "selector.equipment.iron_helmet",
      target: 1,
      snapshotMode: "current",
    },
  ];
  phase2.reconcileSnapshotGoals({ goals, progress, selectors, equipment });
  assert.equal(progress["goal.helmet"].observedValue, 1);

  const queue = new phase2.QuestSnapshotDirtyQueue();
  queue.mark("cmid_test", "inventory", "inventory_change");
  queue.mark("cmid_test", "inventory", "inventory_change");
  queue.mark("cmid_test", "equipment", "accept");
  queue.mark("cmid_test", "effects", "accept");
  assert.equal(queue.size, 1);
  assert.deepEqual(queue.takeBatch(10), [
    {
      playerCmid: "cmid_test",
      providers: ["inventory", "equipment", "effects"],
      reasons: ["inventory_change", "accept"],
    },
  ]);
  assert.equal(queue.size, 0);
});

test("swift sneak selectors inspect exact enchantments in inventory or equipment without proxy matches", () => {
  const selectors = phase2.createDefaultQuestSelectorRegistry();
  const swiftSneak = [{ typeId: "minecraft:swift_sneak", level: 2 }];
  const ordinary = [{ typeId: "minecraft:protection", level: 4 }];

  assert.equal(
    selectors.matchItem("selector.enchantment.swift_sneak.inventory", {
      typeId: "minecraft:enchanted_book",
      amount: 1,
      enchantments: swiftSneak,
    }),
    true
  );
  assert.equal(
    selectors.matchItem("selector.enchantment.swift_sneak.inventory", {
      typeId: "minecraft:enchanted_book",
      amount: 1,
      enchantments: ordinary,
    }),
    false
  );
  assert.equal(
    selectors.matchEquipment("selector.enchantment.swift_sneak.equipment", {
      slots: { Legs: { typeId: "minecraft:diamond_leggings", amount: 1, enchantments: swiftSneak } },
    }),
    true
  );
  assert.equal(
    selectors.matchEquipment("selector.enchantment.swift_sneak.equipment", {
      slots: { Legs: { typeId: "minecraft:diamond_leggings", amount: 1, enchantments: ordinary } },
    }),
    false
  );
});

test("enchantment inventory evidence preserves per-stack counts instead of proxying same-type ordinary items", () => {
  const selectors = phase2.createDefaultQuestSelectorRegistry();
  const inventory = phase2.createInventorySnapshotSummary(
    [
      {
        typeId: "minecraft:enchanted_book",
        amount: 1,
        enchantments: [{ typeId: "minecraft:swift_sneak", level: 1 }],
      },
      {
        typeId: "minecraft:enchanted_book",
        amount: 4,
        enchantments: [{ typeId: "minecraft:protection", level: 4 }],
      },
    ],
    10,
    2
  );
  const progress = {};
  const goal = {
    id: "goal.swift_sneak",
    semantics: "snapshot",
    provider: "inventory",
    selectorId: "selector.enchantment.swift_sneak.inventory",
    target: 2,
    snapshotMode: "current",
  };
  phase2.reconcileSnapshotGoals({ goals: [goal], progress, selectors, inventory });
  assert.equal(inventory.items.get("minecraft:enchanted_book").amount, 5);
  assert.equal(progress[goal.id].observedValue, 1);
});

test("effects summary backfills only the explicit current-effect evidence provider idempotently", () => {
  const selectors = phase2.createDefaultQuestSelectorRegistry();
  const effects = phase2.createEffectsSnapshotSummary(
    [{ typeId: "minecraft:trial_omen", amplifier: 1, duration: 1200 }],
    50,
    1
  );
  const goal = {
    id: "goal.gain_trial_omen",
    semantics: "milestone",
    eventType: "effect.gain",
    filters: { effect: { op: "eq", value: "minecraft:trial_omen" } },
    backfillPolicy: "current_state",
    evidenceProviderId: "evidence.effect.current",
  };
  const progress = {};

  assert.deepEqual(phase2.reconcileSnapshotGoals({ goals: [goal], progress, selectors, effects }), [goal.id]);
  assert.deepEqual(progress[goal.id], {
    kind: "milestone",
    achieved: true,
    achievedAt: 50,
    evidenceId: "evidence.effect.current:minecraft:trial_omen",
  });
  assert.deepEqual(phase2.reconcileSnapshotGoals({ goals: [goal], progress, selectors, effects }), []);

  const wrongProviderProgress = {};
  assert.deepEqual(
    phase2.reconcileSnapshotGoals({
      goals: [{ ...goal, evidenceProviderId: "evidence.effect.lookalike" }],
      progress: wrongProviderProgress,
      selectors,
      effects,
    }),
    []
  );
  assert.deepEqual(wrongProviderProgress, {});
});
