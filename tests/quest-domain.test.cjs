const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const { buildSync } = require("esbuild");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creeper-quest-domain-"));
const bundleFile = path.join(tempRoot, "quest-domain.cjs");

buildSync({
  entryPoints: [path.join(root, "scripts", "features", "quest", "domain", "index.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  outfile: bundleFile,
  logLevel: "silent",
});

const domain = require(bundleFile);

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("quest domain bundles and runs without the Minecraft runtime", () => {
  const domainRoot = path.join(root, "scripts", "features", "quest", "domain");
  const sources = fs
    .readdirSync(domainRoot)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => fs.readFileSync(path.join(domainRoot, name), "utf8"));

  assert.equal(
    sources.some((source) => source.includes("@minecraft/server")),
    false
  );
  assert.equal(typeof domain.applyCounterProgress, "function");
  assert.equal(typeof domain.resolveAvailability, "function");
});

test("legacy counter evaluation preserves filters, count, sum, all, and any behavior", () => {
  const sumGoal = {
    id: "goal.iron",
    event: "item.obtain",
    filters: {
      item: { op: "eq", value: "minecraft:iron_ingot" },
      dimension: { op: "eq", value: "nether" },
    },
    progress: { mode: "sum", field: "amount", target: 10 },
  };
  const killGoal = {
    id: "goal.kill",
    event: "entity.kill",
    filters: { entity: { op: "in", value: ["minecraft:zombie", "minecraft:husk"] } },
    progress: { mode: "count", target: 2 },
  };

  assert.equal(
    domain.applyLegacyCounterProgress(0, sumGoal, {
      item: "minecraft:iron_ingot",
      amount: 4,
      dimension: "minecraft:nether",
    }),
    4
  );
  assert.equal(
    domain.applyLegacyCounterProgress(4, sumGoal, {
      item: "minecraft:gold_ingot",
      amount: 4,
      dimension: "minecraft:nether",
    }),
    4
  );
  assert.equal(domain.applyLegacyCounterProgress(1, killGoal, { entity: "minecraft:husk" }), 2);
  assert.equal(
    domain.applyLegacyCounterProgress(9, sumGoal, { item: "minecraft:iron_ingot", amount: 20, dimension: "nether" }),
    10
  );

  const allQuest = { scope: "once", completeWhen: "all", goals: [sumGoal, killGoal] };
  const anyQuest = { ...allQuest, completeWhen: "any" };
  assert.equal(domain.isLegacyQuestComplete(allQuest, { "goal.iron": 10, "goal.kill": 1 }), false);
  assert.equal(domain.isLegacyQuestComplete(anyQuest, { "goal.iron": 10, "goal.kill": 1 }), true);
});

test("typed goal primitives cover counter, snapshot, distinct set, and absorbing milestone", () => {
  assert.deepEqual(domain.applyCounterProgress(undefined, 3, 10), { kind: "number", value: 3 });
  assert.deepEqual(domain.applyCounterProgress({ kind: "number", value: 9 }, 5, 10), {
    kind: "number",
    value: 10,
  });
  assert.deepEqual(domain.applyCounterProgress({ kind: "number", value: 3 }, -5, 10), {
    kind: "number",
    value: 3,
  });

  const current = domain.applySnapshotProgress(undefined, 8, "current", 100, 1);
  const decreased = domain.applySnapshotProgress(current, 2, "current", 200, 1);
  const peak = domain.applySnapshotProgress(current, 2, "peak", 200, 1);
  assert.equal(decreased.observedValue, 2);
  assert.equal(peak.observedValue, 8);

  let species;
  for (const value of ["wolf", "cat", "wolf", "cow", "pig", "sheep"]) {
    species = domain.applyDistinctCounterProgress(species, value);
  }
  assert.deepEqual(species.values, ["wolf", "cat", "cow", "pig", "sheep"]);
  assert.equal(domain.isGoalStateComplete(species, 5), true);

  const milestone = domain.applyMilestoneProgress(undefined, 123, "event:dragon:1");
  const replayed = domain.applyMilestoneProgress(milestone, 456, "event:dragon:2");
  assert.deepEqual(replayed, milestone);
  assert.equal(domain.getGoalProgressValue(milestone), 1);
});

test("four stable equipment snapshots express the full iron armor composite", () => {
  const goals = ["helmet", "chestplate", "leggings", "boots"];
  const progress = Object.fromEntries(
    goals.map((goal, index) => [goal, domain.applySnapshotProgress(undefined, 1, "current", 100 + index, 1)])
  );

  assert.equal(
    goals.every((goal) => domain.isGoalStateComplete(progress[goal], 1)),
    true
  );
  progress.boots = domain.applySnapshotProgress(progress.boots, 0, "current", 200, 1);
  assert.equal(
    goals.every((goal) => domain.isGoalStateComplete(progress[goal], 1)),
    false
  );
});

test("structured rules express parallel chapter unlocks and claimed implies completed", () => {
  const rule = {
    type: "any",
    rules: [
      { type: "quest", questId: "preset.core.survival.stone_pickaxe", status: "completed" },
      { type: "fact", factId: "fact.item.iron_ingot", operator: "gte", value: 1 },
    ],
  };
  const base = { questStatuses: {}, facts: {}, capabilities: new Set() };

  assert.equal(domain.evaluateQuestRule(rule, base), false);
  assert.equal(
    domain.evaluateQuestRule(rule, {
      ...base,
      questStatuses: { "preset.core.survival.stone_pickaxe": "claimed" },
    }),
    true
  );
  assert.equal(domain.evaluateQuestRule(rule, { ...base, facts: { "fact.item.iron_ingot": 1 } }), true);
});

test("availability keeps release, capability, pack suspension, and locking separate", () => {
  const context = {
    questStatuses: {},
    facts: {},
    capabilities: new Set(["cap.snapshot.inventory.v1"]),
  };
  const input = {
    releaseState: "active",
    enabled: true,
    packEnabled: true,
    requiredCapabilities: ["cap.snapshot.inventory.v1"],
    requiredGameplayExperiments: [],
    availableGameplayExperiments: new Set(),
    unlockRule: { type: "always" },
  };

  assert.equal(domain.resolveAvailability(input, context), "available");
  assert.equal(domain.resolveAvailability({ ...input, packEnabled: false }, context), "suspended");
  assert.equal(domain.resolveAvailability({ ...input, releaseState: "planned" }, context), "unavailable");
  assert.equal(
    domain.resolveAvailability({ ...input, requiredCapabilities: ["cap.structure.enter.v1"] }, context),
    "unavailable"
  );
  assert.equal(
    domain.resolveAvailability(
      { ...input, unlockRule: { type: "fact", factId: "locked", operator: "eq", value: true } },
      context
    ),
    "locked"
  );
});

test("period resolution preserves legacy keys while supporting reset hours and ISO weeks", () => {
  const beforeMidnightUtc = Date.parse("2026-08-23T15:59:59Z");
  const atMidnightUtc = Date.parse("2026-08-23T16:00:00Z");
  assert.equal(domain.resolvePeriodKey("daily", beforeMidnightUtc, domain.LEGACY_QUEST_PERIOD_CONFIG), "2026-08-23");
  assert.equal(domain.resolvePeriodKey("daily", atMidnightUtc, domain.LEGACY_QUEST_PERIOD_CONFIG), "2026-08-24");

  const resetAtFour = {
    ...domain.DEFAULT_QUEST_PERIOD_CONFIG,
    dailyResetHour: 4,
  };
  assert.equal(domain.resolvePeriodKey("daily", Date.parse("2026-08-23T19:59:59Z"), resetAtFour), "2026-08-23");
  assert.equal(domain.resolvePeriodKey("daily", Date.parse("2026-08-23T20:00:00Z"), resetAtFour), "2026-08-24");

  const yearBoundary = Date.parse("2025-12-29T12:00:00Z");
  assert.equal(domain.resolvePeriodKey("weekly", yearBoundary, domain.LEGACY_QUEST_PERIOD_CONFIG), "2025-W52");
  assert.equal(domain.resolvePeriodKey("weekly", yearBoundary, domain.DEFAULT_QUEST_PERIOD_CONFIG), "2026-W01");
  assert.equal(domain.resolvePeriodKey("once", yearBoundary), "once");
  assert.equal(domain.resolvePeriodKey("repeatable", yearBoundary), "repeatable");
});

test("lifecycle, hidden tracking, unlock event propagation, and repeatable instance IDs are deterministic", () => {
  assert.equal(domain.resolveLifecycleState(undefined), "not_started");
  assert.equal(domain.resolveLifecycleState({ acceptedAt: 0 }), "accepted");
  assert.equal(domain.resolveLifecycleState({ acceptedAt: 1, completedAt: 2 }), "completed");
  assert.equal(domain.resolveLifecycleState({ acceptedAt: 1, completedAt: 2, claimedAt: 3 }), "claimed");
  assert.equal(domain.isCompletionAbsorbing("completed"), true);
  assert.equal(domain.canApplyQuestProgress("suspended", "accepted"), false);
  assert.equal(
    domain.shouldTrackQuest({
      hidden: true,
      trackWhileHidden: true,
      availability: "available",
      lifecycle: "accepted",
    }),
    true
  );
  assert.equal(
    domain.shouldTrackQuest({
      hidden: true,
      trackWhileHidden: false,
      availability: "available",
      lifecycle: "accepted",
    }),
    false
  );

  assert.equal(domain.shouldPropagateUnlockingEvent(false, "include_once"), true);
  assert.equal(domain.shouldPropagateUnlockingEvent(false, "exclude"), false);
  assert.equal(
    domain.createQuestInstanceId("preset.hidden.dragon_again", "repeatable", 1),
    "preset.hidden.dragon_again@repeatable#1"
  );
  assert.notEqual(
    domain.createQuestInstanceId("custom.repeatable_hunt", "repeatable", 1),
    domain.createQuestInstanceId("custom.repeatable_hunt", "repeatable", 2)
  );
});
