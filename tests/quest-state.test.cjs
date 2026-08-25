const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const { buildSync } = require("esbuild");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creeper-quest-state-"));
const bundleFile = path.join(tempRoot, "quest-state.cjs");

buildSync({
  entryPoints: [path.join(root, "scripts", "features", "quest", "state", "index.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  outfile: bundleFile,
  logLevel: "silent",
});

const stateModule = require(bundleFile);

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

function definition(questId) {
  return {
    id: questId,
    source: "custom",
    definitionVersion: 3,
    title: "历史任务",
    description: "迁移测试",
    category: "custom",
    rarity: "rare",
    reliability: "A",
    releaseState: "active",
    scope: "daily",
    completeWhen: "all",
    acceptMode: "manual",
    claimMode: "manual",
    enabled: true,
    hidden: false,
    trackWhileHidden: false,
    contributesToProgress: false,
    unlockRule: { type: "always" },
    unlockEventPolicy: "exclude",
    requiredCapabilities: [],
    requiredGameplayExperiments: [],
    goals: [],
    rewards: [{ id: "reward.gold", action: "add_money", params: { amount: 50 } }],
    createdAt: 1,
    updatedAt: 2,
  };
}

test("generation store commits new chunks before the manifest and recovers the previous generation", () => {
  const properties = new MemoryStringPropertyStore();
  const store = new stateModule.GenerationStore(properties, "quest:test", 12);

  const firstManifest = store.save({ value: "first", padding: "a".repeat(30) });
  const secondManifest = store.save({ value: "second", padding: "b".repeat(30) });
  assert.equal(firstManifest.current.generation, 1);
  assert.equal(secondManifest.current.generation, 2);
  assert.equal(secondManifest.previous.generation, 1);
  assert.equal(store.load().value.value, "second");

  properties.set("quest:test:g2:0", "corrupt");
  const recovered = store.load();
  assert.equal(recovered.status, "recovered");
  assert.equal(recovered.generation, 1);
  assert.equal(recovered.value.value, "first");

  const thirdManifest = store.save({ value: "third", padding: "c".repeat(30) });
  assert.equal(thirdManifest.current.generation, 3);
  assert.equal(thirdManifest.previous.generation, 1);
  assert.equal(store.load().value.value, "third");
});

test("generation store reports corruption instead of silently returning an empty aggregate", () => {
  const properties = new MemoryStringPropertyStore();
  const store = new stateModule.GenerationStore(properties, "quest:broken", 20);
  store.save({ important: true });
  properties.set("quest:broken:g1:0", "broken");

  const result = store.load();
  assert.equal(result.status, "corrupt");
  assert.match(result.error, /Checksum mismatch/);
});

test("legacy name migration merges progress by max and claimed status wins", () => {
  const questId = "daily_kill_zombie";
  const legacyStates = {
    alice: {
      playerName: "Alice",
      quests: {
        [questId]: {
          questId,
          acceptedAt: 100,
          periodKey: "2026-08-24",
          progress: { "goal.kill": 5 },
          completedAt: 300,
        },
      },
    },
    oldalice: {
      playerName: "OldAlice",
      quests: {
        [questId]: {
          questId,
          acceptedAt: 50,
          periodKey: "2026-08-24",
          progress: { "goal.kill": 8 },
          completedAt: 250,
          claimedAt: 400,
        },
      },
    },
  };

  const migrated = stateModule.migrateLegacyNameStates({
    playerCmid: "cmid_test",
    displayName: "Alice",
    knownNames: ["Alice", "OldAlice", "NoStateName"],
    legacyStates,
    resolveDefinition: (id) => definition(id),
    migratedAt: 1_000,
  });
  const instanceId = `${questId}@2026-08-24#1`;
  const instance = migrated.aggregate.instances[instanceId];

  assert.deepEqual(migrated.migratedKeys, ["alice", "oldalice"]);
  assert.equal(instance.acceptedAt, 50);
  assert.equal(instance.progress["goal.kill"].value, 8);
  assert.equal(instance.lifecycle, "claimed");
  assert.equal(instance.completedAt, 250);
  assert.equal(instance.claimedAt, 400);
  assert.equal(instance.definitionVersion, 3);
  assert.equal(instance.completionSnapshot.rewards[0].id, "reward.gold");
  assert.equal(migrated.aggregate.activeByQuestId[questId], instanceId);
  assert.deepEqual(migrated.aggregate.migration.migratedNames.sort(), ["alice", "nostatename", "oldalice"]);
});

test("legacy migration is idempotent and only processes newly discovered names", () => {
  const questId = "once_task";
  const legacyStates = {
    alice: {
      playerName: "Alice",
      quests: {
        [questId]: {
          questId,
          acceptedAt: 10,
          periodKey: "once",
          progress: { goal: 1 },
        },
      },
    },
  };
  const first = stateModule.migrateLegacyNameStates({
    playerCmid: "cmid_test",
    displayName: "Alice",
    knownNames: ["Alice"],
    legacyStates,
    resolveDefinition: (id) => definition(id),
    migratedAt: 100,
  });
  const second = stateModule.migrateLegacyNameStates({
    playerCmid: "cmid_test",
    displayName: "Alice",
    knownNames: ["Alice"],
    existing: first.aggregate,
    legacyStates,
    resolveDefinition: (id) => definition(id),
    migratedAt: 200,
  });

  assert.equal(second.changed, false);
  assert.deepEqual(second.migratedKeys, []);
  assert.deepEqual(second.aggregate, first.aggregate);
});

test("aggregate merge unions distinct sets and granted reward ledger entries win", () => {
  const left = stateModule.createEmptyQuestPlayerAggregate("cmid_test", "Alice");
  const right = stateModule.createEmptyQuestPlayerAggregate("cmid_test", "Alice");
  const instanceId = "preset.test@once#1";
  left.instances[instanceId] = {
    instanceId,
    questId: "preset.test",
    definitionVersion: 1,
    periodKey: "once",
    attempt: 1,
    acceptedAt: 1,
    lifecycle: "accepted",
    progress: { species: { kind: "distinct_set", values: ["wolf", "cat"] } },
  };
  right.instances[instanceId] = {
    ...left.instances[instanceId],
    progress: { species: { kind: "distinct_set", values: ["cat", "cow"] } },
  };
  left.rewardLedger.delivery = {
    rewardId: "reward.gold",
    instanceId,
    state: "prepared",
    idempotencyKey: "delivery",
    handlerId: "money",
    handlerVersion: 1,
  };
  right.rewardLedger.delivery = {
    ...left.rewardLedger.delivery,
    state: "granted",
    grantedAt: 10,
  };

  const merged = stateModule.mergeQuestPlayerAggregates(left, right);
  assert.deepEqual(merged.instances[instanceId].progress.species.values, ["wolf", "cat", "cow"]);
  assert.equal(merged.rewardLedger.delivery.state, "granted");
});

test("quest fact store records only explicit counters, milestones, and snapshots", () => {
  const aggregate = stateModule.createEmptyQuestPlayerAggregate("cmid_test", "Alice");
  assert.equal(stateModule.recordQuestFactCounter(aggregate, "fact.boss.dragon.kill_count", 1, 10), 1);
  assert.equal(stateModule.recordQuestFactCounter(aggregate, "fact.boss.dragon.kill_count", 1, 20), 2);
  stateModule.setQuestFactMilestone(aggregate, "fact.creeper.market.traded", 30, "trade:1");
  stateModule.setQuestFactMilestone(aggregate, "fact.creeper.market.traded", 40, "trade:2");
  stateModule.setQuestFactSnapshot(aggregate, "fact.creeper.guild.joined", true, 50);

  assert.equal(stateModule.getQuestFactValue(aggregate, "fact.boss.dragon.kill_count"), 2);
  assert.equal(stateModule.getQuestFactValue(aggregate, "fact.creeper.market.traded"), true);
  assert.equal(stateModule.getQuestFactValue(aggregate, "fact.creeper.guild.joined"), true);
  assert.equal(aggregate.facts["fact.creeper.market.traded"].evidenceId, "trade:1");
});
