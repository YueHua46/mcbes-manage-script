const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const { buildSync } = require("esbuild");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creeper-quest-rewards-"));
const bundleFile = path.join(tempRoot, "quest-rewards.cjs");

buildSync({
  entryPoints: [path.join(root, "scripts", "features", "quest", "rewards", "index.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  outfile: bundleFile,
  logLevel: "silent",
});

const rewardsModule = require(bundleFile);

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function definition(rewards = [{ id: "reward.gold", action: "add_money", params: { amount: 51 } }]) {
  return {
    id: "preset.test",
    source: "preset",
    definitionVersion: 7,
    title: "奖励测试",
    description: "完成后冻结奖励",
    category: "core",
    rarity: "rare",
    reliability: "A",
    releaseState: "active",
    scope: "once",
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
    rewards,
    createdAt: 1,
    updatedAt: 1,
  };
}

function completedAggregate(rewardDefinitions) {
  const questDefinition = definition(rewardDefinitions);
  const instanceId = "preset.test@once#1";
  const instance = {
    instanceId,
    questId: questDefinition.id,
    definitionVersion: questDefinition.definitionVersion,
    periodKey: "once",
    attempt: 1,
    acceptedAt: 10,
    lifecycle: "accepted",
    progress: {},
  };
  rewardsModule.completeQuestInstance(instance, questDefinition, 20, 1);
  return {
    aggregate: {
      schemaVersion: 2,
      playerCmid: "cmid_test",
      displayName: "Alice",
      activeByQuestId: { [questDefinition.id]: instanceId },
      instances: { [instanceId]: instance },
      facts: {},
      rewardLedger: {},
    },
    instanceId,
  };
}

function registry(handler) {
  const result = new rewardsModule.QuestRewardHandlerRegistry();
  result.register(handler);
  return result;
}

test("completion freezes scaled rewards and cannot replace an existing snapshot", () => {
  const questDefinition = definition([
    { id: "reward.gold", action: "add_money", params: { amount: 51 } },
    { id: "reward.command", action: "run_command", params: { command: "say done", amount: 8 } },
  ]);
  const instance = {
    instanceId: "preset.test@once#1",
    questId: questDefinition.id,
    definitionVersion: questDefinition.definitionVersion,
    periodKey: "once",
    attempt: 1,
    acceptedAt: 10,
    lifecycle: "accepted",
    progress: {},
  };

  assert.equal(rewardsModule.completeQuestInstance(instance, questDefinition, 20, 0.5), true);
  assert.equal(instance.lifecycle, "completed");
  assert.equal(instance.completionSnapshot.rewardScale, 0.5);
  assert.equal(instance.completionSnapshot.rewards[0].params.amount, 25);
  assert.equal(instance.completionSnapshot.rewards[0].scaledFrom, 51);
  assert.equal(instance.completionSnapshot.rewards[1].params.amount, 8);

  questDefinition.rewards[0].params.amount = 999;
  assert.equal(instance.completionSnapshot.rewards[0].params.amount, 25);
  assert.equal(rewardsModule.completeQuestInstance(instance, questDefinition, 30, 2), false);
  assert.equal(instance.completionSnapshot.completedAt, 20);
});

test("all frozen rewards are validated before lifecycle, persistence, or effects change", async () => {
  const { aggregate, instanceId } = completedAggregate([
    { id: "reward.valid", action: "valid", params: {} },
    { id: "reward.invalid", action: "invalid", params: {} },
  ]);
  const handlers = new rewardsModule.QuestRewardHandlerRegistry();
  let grantCount = 0;
  handlers.register({
    id: "valid",
    version: 1,
    action: "valid",
    idempotency: "strong",
    validate: () => ({ ok: true }),
    grant: () => {
      grantCount += 1;
    },
  });
  handlers.register({
    id: "invalid",
    version: 1,
    action: "invalid",
    idempotency: "strong",
    validate: () => ({ ok: false, error: "invalid reward configuration" }),
    grant: () => {
      grantCount += 1;
    },
  });
  let persistCount = 0;

  const result = await rewardsModule.claimQuestRewards({
    aggregate,
    instanceId,
    handlers,
    context: {},
    persist: () => {
      persistCount += 1;
    },
    now: () => 30,
  });

  assert.deepEqual(result, { status: "validation_failed", error: "invalid reward configuration" });
  assert.equal(aggregate.instances[instanceId].lifecycle, "completed");
  assert.equal(persistCount, 0);
  assert.equal(grantCount, 0);
});

test("strong handler safely replays the same key after a crash between execute and granted persist", async () => {
  const initial = completedAggregate();
  let durable = clone(initial.aggregate);
  const externalKeys = new Set();
  let externalCredits = 0;
  const handlers = registry({
    id: "economy.creditOnce",
    version: 1,
    action: "add_money",
    idempotency: "strong",
    validate: () => ({ ok: true }),
    grant: (_reward, _context, key) => {
      if (!externalKeys.has(key)) {
        externalKeys.add(key);
        externalCredits += 1;
      }
    },
  });
  let persistCount = 0;

  await assert.rejects(
    rewardsModule.claimQuestRewards({
      aggregate: clone(durable),
      instanceId: initial.instanceId,
      handlers,
      context: {},
      persist: (aggregate) => {
        persistCount += 1;
        if (persistCount === 3) throw new Error("simulated crash");
        durable = clone(aggregate);
      },
      now: () => 30,
    }),
    /simulated crash/
  );

  const deliveryKey = rewardsModule.createRewardDeliveryKey("cmid_test", initial.instanceId, "reward.gold");
  assert.equal(durable.rewardLedger[deliveryKey].state, "prepared");
  assert.equal(externalCredits, 1);

  const restarted = clone(durable);
  const result = await rewardsModule.claimQuestRewards({
    aggregate: restarted,
    instanceId: initial.instanceId,
    handlers,
    context: {},
    persist: (aggregate) => {
      durable = clone(aggregate);
    },
    now: () => 40,
  });

  assert.deepEqual(result, { status: "claimed" });
  assert.equal(externalCredits, 1);
  assert.equal(durable.rewardLedger[deliveryKey].state, "granted");
  assert.equal(durable.instances[initial.instanceId].lifecycle, "claimed");
});

test("non-idempotent prepared reward enters recovery_required instead of executing twice", async () => {
  const initial = completedAggregate();
  let durable = clone(initial.aggregate);
  let grants = 0;
  const handlers = registry({
    id: "minecraft.giveItem",
    version: 1,
    action: "add_money",
    idempotency: "non_idempotent",
    validate: () => ({ ok: true }),
    grant: () => {
      grants += 1;
    },
  });
  let persistCount = 0;

  await assert.rejects(
    rewardsModule.claimQuestRewards({
      aggregate: clone(durable),
      instanceId: initial.instanceId,
      handlers,
      context: {},
      persist: (aggregate) => {
        persistCount += 1;
        if (persistCount === 3) throw new Error("simulated crash");
        durable = clone(aggregate);
      },
      now: () => 30,
    }),
    /simulated crash/
  );
  assert.equal(grants, 1);

  const result = await rewardsModule.claimQuestRewards({
    aggregate: clone(durable),
    instanceId: initial.instanceId,
    handlers,
    context: {},
    persist: (aggregate) => {
      durable = clone(aggregate);
    },
    now: () => 40,
  });

  assert.equal(result.status, "recovery_required");
  assert.equal(grants, 1);
  assert.equal(durable.instances[initial.instanceId].lifecycle, "recovery_required");
});

test("recoverable handler queries prepared delivery before deciding whether to replay", async () => {
  const initial = completedAggregate();
  const deliveryKey = rewardsModule.createRewardDeliveryKey("cmid_test", initial.instanceId, "reward.gold");
  initial.aggregate.instances[initial.instanceId].lifecycle = "claiming";
  initial.aggregate.rewardLedger[deliveryKey] = {
    rewardId: "reward.gold",
    instanceId: initial.instanceId,
    state: "prepared",
    idempotencyKey: deliveryKey,
    preparedAt: 25,
    handlerId: "entitlement",
    handlerVersion: 1,
  };
  let grants = 0;
  let recoveries = 0;
  const handlers = registry({
    id: "entitlement",
    version: 1,
    action: "add_money",
    idempotency: "recoverable",
    validate: () => ({ ok: true }),
    grant: () => {
      grants += 1;
    },
    recover: () => {
      recoveries += 1;
      return "granted";
    },
  });

  const result = await rewardsModule.claimQuestRewards({
    aggregate: initial.aggregate,
    instanceId: initial.instanceId,
    handlers,
    context: {},
    persist: () => {},
    now: () => 40,
  });

  assert.deepEqual(result, { status: "claimed" });
  assert.equal(recoveries, 1);
  assert.equal(grants, 0);
  assert.equal(initial.aggregate.rewardLedger[deliveryKey].state, "granted");
});

test("reward ledger keys isolate repeatable quest attempts", () => {
  const first = rewardsModule.createRewardDeliveryKey("cmid_test", "repeat@daily:1#1", "reward.gold");
  const second = rewardsModule.createRewardDeliveryKey("cmid_test", "repeat@daily:1#2", "reward.gold");
  assert.notEqual(first, second);
});
