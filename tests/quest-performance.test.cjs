const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createQuestRuntime } = require("./helpers/quest-performance-runtime.cjs");

const player = (name) => ({ id: name, name, isValid: true });
const inventory = (name, builtAt) => ({
  playerCmid: "cmid_" + name,
  reasons: ["inventory_change"],
  inventory: { items: new Map(), entries: [], builtAt, providerVersion: 2 },
});
function quest(id, target = 5) {
  return {
    id,
    title: id,
    description: "",
    scope: "once",
    autoAccept: true,
    enabled: true,
    completeWhen: "all",
    goals: [
      {
        id: "goal",
        event: "item.obtain",
        filters: { item: { op: "eq", value: "minecraft:diamond" } },
        progress: { mode: "sum", field: "amount", target },
      },
    ],
    rewards: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

test("50-player unchanged snapshots neither save generations nor clone cached aggregates", async () => {
  const r = await createQuestRuntime();
  const players = Array.from({ length: 50 }, (_, i) => player("multi" + i));
  for (const p of players) {
    r.service.ensureAutoAccepted(p);
    r.service.reconcileSnapshots(p, inventory(p.name, 1));
  }
  r.mc.resetCounts();
  const original = JSON.stringify;
  let serializations = 0;
  JSON.stringify = (...args) => {
    serializations++;
    return original(...args);
  };
  try {
    for (const p of players) {
      const cached = r.repo.loadForPlayer(p);
      assert.equal(r.repo.loadForPlayer(p), cached);
      assert.deepEqual(r.service.reconcileSnapshots(p, inventory(p.name, 2)), []);
      assert.deepEqual(r.service.recordEvent(p, "item.obtain", { item: "minecraft:barrier", amount: 1 }), []);
    }
  } finally {
    JSON.stringify = original;
  }
  assert.deepEqual(r.mc.counts(), { reads: 0, writes: 0 });
  assert.equal(serializations, 0);
});

test("cache fast path still migrates a newly discovered alias exactly once", async () => {
  const r = await createQuestRuntime(),
    p = player("Alice");
  r.definitions.setDefinitions([quest("legacy")]);
  const previous = r.repo.loadForPlayer(p);
  r.database.getDatabase("quest_player_states").set("oldalice", {
    playerName: "OldAlice",
    quests: {
      legacy: {
        questId: "legacy",
        acceptedAt: 1,
        periodKey: "once",
        progress: { goal: 3 },
      },
    },
  });
  r.identity.setProfile("Alice", { id: "cmid_Alice", currentName: "Alice", knownNames: ["Alice", "OldAlice"] });
  const migrated = r.repo.loadForPlayer(p);
  assert.notEqual(migrated, previous);
  assert.ok(migrated.migration.migratedNames.includes("oldalice"));
  assert.ok(Object.values(migrated.instances).some((instance) => instance.questId === "legacy"));
  assert.equal(r.database.getDatabase("quest_player_states").get("oldalice"), undefined);
  r.mc.resetCounts();
  assert.equal(r.repo.loadForPlayer(p), migrated);
  assert.deepEqual(r.mc.counts(), { reads: 0, writes: 0 });
});

test("availability cache follows definition edits and preset toggles", async () => {
  const r = await createQuestRuntime(),
    p = player("config"),
    q = quest("edited");
  r.definitions.setDefinitions([q]);
  const aggregate = r.repo.loadForPlayer(p);
  assert.equal(r.catalog.getAvailability(q.id, aggregate), "available");
  r.definitions.setDefinitions([{ ...q, enabled: false }]);
  assert.notEqual(r.catalog.getAvailability(q.id, aggregate), "available");
  const preset = r.catalog.getAllDefinitions().find((q) => q.source === "preset" && q.unlockRule.type === "always");
  r.policy.setPresets(false);
  assert.notEqual(r.catalog.getAvailability(preset.id, aggregate), "available");
  r.policy.setPresets(true);
  assert.equal(r.catalog.getAvailability(preset.id, aggregate), "available");
});

test("skipping repeated auto scans preserves exact sum progress, completion and frozen rewards", async () => {
  const r = await createQuestRuntime(),
    p = player("progress"),
    q = quest("sum", 5);
  r.definitions.setDefinitions([q]);
  r.policy.setPresets(false);
  r.service.ensureAutoAccepted(p);
  r.service.recordEvent(p, "item.obtain", { item: "minecraft:diamond", amount: 2 });
  r.service.recordEvent(p, "item.obtain", { item: "minecraft:diamond", amount: 3 });
  const aggregate = r.repo.loadForPlayer(p),
    instance = aggregate.instances[aggregate.activeByQuestId[q.id]];
  assert.equal(instance.progress.goal.value, 5);
  assert.equal(instance.lifecycle, "completed");
  assert.ok(instance.completionSnapshot);
  r.service.recordEvent(p, "item.obtain", { item: "minecraft:diamond", amount: 20 });
  assert.equal(instance.progress.goal.value, 5);
});

test("shared work budget spreads jobs across ticks and charges throwing work", async () => {
  const { QuestWorkBudget } = await createQuestRuntime();
  const budget = new QuestWorkBudget(4, 16),
    original = Date.now;
  let now = 0,
    processed = 0;
  Date.now = () => now;
  try {
    for (let tick = 1; tick <= 25; tick++) {
      while (
        budget.run(tick, () => {
          processed++;
          now += 2;
        })
      ) {}
    }
    assert.equal(processed, 50);
    assert.equal(budget.canRun(25), false);
    assert.throws(
      () =>
        budget.run(26, () => {
          now += 5;
          throw new Error("failed");
        }),
      /failed/
    );
    assert.equal(budget.canRun(26), false);
    const countBudget = new QuestWorkBudget(4, 3);
    for (let i = 0; i < 3; i++)
      assert.equal(
        countBudget.run(1, () => {}),
        true
      );
    assert.equal(
      countBudget.run(1, () => {}),
      false
    );
    assert.equal(
      countBudget.run(2, () => {}),
      true
    );
  } finally {
    Date.now = original;
  }
});

test("fact and completion unlocks are accepted immediately without counting the unlock event twice", async () => {
  const r = await createQuestRuntime(),
    p = player("chain");
  r.service.ensureAutoAccepted(p);
  const aggregate = r.repo.loadForPlayer(p);
  assert.equal(aggregate.activeByQuestId["preset.core.mining.first_diamond"], undefined);
  r.service.recordEvent(p, "item.obtain", { item: "minecraft:iron_ingot", amount: 1 });
  assert.ok(aggregate.activeByQuestId["preset.core.mining.first_diamond"]);
  r.service.recordEvent(p, "item.obtain", { item: "minecraft:diamond", amount: 1 });
  const first = aggregate.instances[aggregate.activeByQuestId["preset.core.mining.first_diamond"]];
  assert.equal(first.lifecycle, "completed");
  const next = aggregate.instances[aggregate.activeByQuestId["preset.core.mining.diamond_miner"]];
  assert.ok(next);
  assert.equal(Object.keys(next.progress).length, 0);
  r.service.recordEvent(p, "item.obtain", { item: "minecraft:diamond", amount: 2 });
  assert.equal(next.progress.goal_obtain_ten_diamonds?.value ?? next.progress["goal.obtain_ten_diamonds"].value, 2);
});
