const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const { buildSync } = require("esbuild");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creeper-quest-history-"));
const bundleFile = path.join(tempRoot, "quest-history.cjs");

buildSync({
  stdin: {
    contents: `
      export * from "./scripts/features/quest/state";
      export { hiddenChallengeQuests } from "./scripts/features/quest/presets/hidden/challenges";
    `,
    resolveDir: root,
    sourcefile: "quest-history-entry.ts",
    loader: "ts",
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  outfile: bundleFile,
  logLevel: "silent",
});

const history = require(bundleFile);

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

class MemoryStringPropertyStore {
  constructor() {
    this.values = new Map();
  }
  get(key) {
    return this.values.get(key);
  }
  set(key, value) {
    if (value === undefined) this.values.delete(key);
    else this.values.set(key, value);
  }
}

function dragonAgainInstance() {
  return {
    instanceId: "preset.hidden.dragon_again@once#1",
    questId: "preset.hidden.dragon_again",
    definitionVersion: 1,
    periodKey: "once",
    attempt: 1,
    acceptedAt: 1,
    lifecycle: "accepted",
    progress: {},
  };
}

test("historical Boss counters persist and rehydrate dragon-again without counting the first kill twice", () => {
  const quest = history.hiddenChallengeQuests.find((entry) => entry.id === "preset.hidden.dragon_again");
  const aggregate = history.createEmptyQuestPlayerAggregate("cmid_dragon", "DragonTester");
  const instance = dragonAgainInstance();
  aggregate.instances[instance.instanceId] = instance;
  aggregate.activeByQuestId[instance.questId] = instance.instanceId;

  assert.equal(history.recordBossKillFact(aggregate, "minecraft:zombie", 5), false);
  assert.equal(history.recordBossKillFact(aggregate, "minecraft:ender_dragon", 10), true);
  assert.deepEqual(history.reconcileHistoricalBossCounterGoals(aggregate, quest, instance), [
    "goal.kill_ender_dragon_twice",
  ]);
  assert.equal(instance.progress["goal.kill_ender_dragon_twice"].value, 1);

  // Re-applying the same fact baseline (the unlock-causing first kill) is idempotent.
  assert.deepEqual(history.reconcileHistoricalBossCounterGoals(aggregate, quest, instance), []);
  assert.equal(instance.progress["goal.kill_ender_dragon_twice"].value, 1);

  const properties = new MemoryStringPropertyStore();
  const store = new history.GenerationStore(properties, "quest:dragon-history", 256);
  store.save(aggregate);
  const reloaded = store.load().value;
  const reloadedInstance = reloaded.instances[instance.instanceId];
  assert.equal(history.recordBossKillFact(reloaded, "minecraft:ender_dragon", 20), true);
  assert.deepEqual(history.reconcileHistoricalBossCounterGoals(reloaded, quest, reloadedInstance), [
    "goal.kill_ender_dragon_twice",
  ]);
  assert.equal(reloadedInstance.progress["goal.kill_ender_dragon_twice"].value, 2);
  assert.equal(reloaded.facts["fact.boss.ender_dragon.kill_count"].value, 2);
});

test("Boss facts keep dragon and wither histories separate", () => {
  const aggregate = history.createEmptyQuestPlayerAggregate("cmid_boss", "BossTester");
  history.recordBossKillFact(aggregate, "minecraft:wither", 10);
  history.recordBossKillFact(aggregate, "minecraft:wither", 20);
  history.recordBossKillFact(aggregate, "minecraft:ender_dragon", 30);

  assert.equal(aggregate.facts["fact.boss.wither.kill_count"].value, 2);
  assert.equal(aggregate.facts["fact.boss.ender_dragon.kill_count"].value, 1);
  assert.equal(history.resolveBossKillFactId("minecraft:warden"), undefined);
});

test("runtime source deduplicates attributed deaths and reconciles historical facts on accept and reload", () => {
  const handler = fs.readFileSync(path.join(root, "scripts/events/handlers/quest.ts"), "utf8");
  const service = fs.readFileSync(path.join(root, "scripts/features/quest/services/quest-player.ts"), "utf8");

  assert.match(handler, /dedupeKey: `quest:entity\.kill:\$\{deadEntity\.id\}`/);
  assert.match(service, /recordBossKillFact\(aggregate, event\.payload\.entity, event\.timestamp\)/);
  assert.match(service, /reconcileHistoricalBossCounterGoals\(aggregate, quest, instance\)/);
  assert.match(service, /resolveHistoricalBossCounterValue\(aggregate, goal\)/);
});
