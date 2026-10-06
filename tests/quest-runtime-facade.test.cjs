const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { build } = require("esbuild");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creeper-quest-runtime-"));
const entryFile = path.join(tempRoot, "entry.ts");
const bundleFile = path.join(tempRoot, "quest-runtime.cjs");
const serviceFile = path.join(root, "scripts", "features", "quest", "services", "quest-player.ts");

fs.writeFileSync(
  entryFile,
  [
    `export { default as service } from ${JSON.stringify(serviceFile)};`,
    `export { resetAggregate, getAggregate, getSaveCount } from "quest-state-repository-test";`,
    `export { setDefinitions } from "quest-definition-test";`,
    `export { getGrantCount } from "runtime-reward-handlers-test";`,
  ].join("\n")
);

const virtualPlugin = {
  name: "quest-runtime-test-doubles",
  setup(build) {
    build.onResolve({ filter: /^@minecraft\/server$/ }, () => ({ path: "minecraft", namespace: "quest-test" }));
    build.onResolve({ filter: /online-players$/ }, () => ({ path: "online", namespace: "quest-test" }));
    build.onResolve({ filter: /quest-state-repository(?:-test)?$/ }, () => ({
      path: "repository",
      namespace: "quest-test",
    }));
    build.onResolve({ filter: /quest-definition(?:-test)?$/ }, () => ({
      path: "definitions",
      namespace: "quest-test",
    }));
    build.onResolve({ filter: /quest-catalog$/ }, () => ({ path: "catalog", namespace: "quest-test" }));
    build.onResolve({ filter: /quest-runtime-policy$/ }, () => ({ path: "runtime-policy", namespace: "quest-test" }));
    build.onResolve({ filter: /runtime-reward-handlers(?:-test)?$/ }, () => ({
      path: "handlers",
      namespace: "quest-test",
    }));

    build.onLoad({ filter: /.*/, namespace: "quest-test" }, (args) => {
      if (args.path === "minecraft") return { contents: "export class Player {}", loader: "ts" };
      if (args.path === "online") return { contents: "export const isRealPlayerEntity = () => true;", loader: "ts" };
      if (args.path === "runtime-policy") {
        return { contents: "export const isQuestSystemEnabled = () => true;", loader: "ts" };
      }
      if (args.path === "repository") {
        return {
          loader: "ts",
          contents: `
            let aggregate;
            let saveCount = 0;
            export function resetAggregate() {
              aggregate = {
                schemaVersion: 2,
                playerCmid: "cmid_test",
                displayName: "Alice",
                activeByQuestId: {},
                instances: {},
                facts: {},
                rewardLedger: {},
              };
              saveCount = 0;
            }
            export function getAggregate() { return aggregate; }
            export function getSaveCount() { return saveCount; }
            const repository = {
              isReady: () => true,
              loadForPlayer: () => aggregate,
              loadForName: () => aggregate,
              saveForPlayer: (_player, next) => { aggregate = next; saveCount += 1; },
            };
            resetAggregate();
            export default repository;
          `,
        };
      }
      if (args.path === "definitions") {
        return {
          loader: "ts",
          contents: `
            let definitions = [];
            let revision = 0;
            export function setDefinitions(next) { definitions = next; revision += 1; }
            const service = {
              isReady: () => true,
              getAll: () => definitions,
              get: (id) => definitions.find((definition) => definition.id === id),
              getRevision: () => revision,
            };
            export const formatFilterValue = (value) => String(value);
            export default service;
          `,
        };
      }
      if (args.path === "handlers") {
        return {
          loader: "ts",
          contents: `
            let grantCount = 0;
            const handler = {
              id: "test.creditOnce",
              version: 1,
              action: "add_money",
              idempotency: "strong",
              validate: () => ({ ok: true }),
              grant: () => { grantCount += 1; },
            };
            export const getGrantCount = () => grantCount;
            export function createRuntimeQuestRewardHandlers() {
              return { get: (action) => action === handler.action ? handler : undefined };
            }
          `,
        };
      }
      if (args.path === "catalog") {
        return {
          loader: "ts",
          contents: `
            import definitions from "quest-definition-test";
            const normalize = (quest) => ({
              ...quest,
              source: "custom",
              definitionVersion: 1,
              category: "custom",
              rarity: "common",
              reliability: "A",
              releaseState: "active",
              acceptMode: quest.autoAccept ? "auto" : "manual",
              claimMode: "manual",
              hidden: false,
              trackWhileHidden: false,
              contributesToProgress: true,
              unlockRule: { type: "always" },
              unlockEventPolicy: "exclude",
              requiredCapabilities: [],
              requiredGameplayExperiments: [],
              goals: quest.goals.map((goal) => ({
                id: goal.id,
                semantics: "counter",
                eventType: goal.event,
                filters: goal.filters,
                aggregation: goal.progress.mode,
                field: goal.progress.field,
                target: goal.progress.target,
                backfillPolicy: "none",
              })),
            });
            const service = {
              selectors: { matchItem: () => true },
              isReady: () => true,
              getAllDefinitions: () => definitions.getAll().map(normalize),
              getDefinition: (id) => {
                const found = definitions.get(id);
                return found ? normalize(found) : undefined;
              },
              getEffectiveQuest: (id) => definitions.get(id)
                ? { packEnabled: true, questEnabled: true, rewardScale: 1 }
                : undefined,
              getAvailability: () => "available",
              createRuleContext: () => ({}),
              getRewardScale: () => 1,
              getRevision: () => definitions.getRevision(),
            };
            export default service;
          `,
        };
      }
      throw new Error(`Unknown test double: ${args.path}`);
    });
  },
};

let runtime;

before(async () => {
  await build({
    entryPoints: [entryFile],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    outfile: bundleFile,
    plugins: [virtualPlugin],
    logLevel: "silent",
  });
  runtime = require(bundleFile);
});

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function repeatableQuest() {
  return {
    id: "custom.repeat",
    title: "重复任务",
    description: "验证兼容门面",
    scope: "repeatable",
    autoAccept: false,
    enabled: true,
    completeWhen: "all",
    goals: [
      {
        id: "goal.item",
        event: "item.obtain",
        filters: { item: { op: "eq", value: "minecraft:log" } },
        progress: { mode: "count", target: 1 },
      },
    ],
    rewards: [{ id: "reward.gold", action: "add_money", params: { amount: 10 } }],
    createdAt: 1,
    updatedAt: 1,
  };
}

test("runtime facade preserves history, freezes completion, and claims without the current definition", async () => {
  runtime.resetAggregate();
  const quest = repeatableQuest();
  runtime.setDefinitions([quest]);
  const player = { name: "Alice" };
  const originalNow = Date.now;
  let now = 100;
  Date.now = () => now;

  try {
    assert.equal(runtime.service.acceptQuest(player, quest.id), undefined);
    const firstId = "custom.repeat@repeatable#1";
    assert.equal(runtime.getAggregate().activeByQuestId[quest.id], firstId);

    now = 200;
    const changes = runtime.service.recordEvent(player, "item.obtain", { item: "minecraft:log" });
    assert.equal(changes.length, 1);
    assert.equal(changes[0].completedQuest, true);
    assert.equal(runtime.getAggregate().instances[firstId].lifecycle, "completed");
    assert.equal(runtime.getAggregate().instances[firstId].completionSnapshot.rewards[0].params.amount, 10);

    quest.rewards[0].params.amount = 999;
    quest.goals[0].progress.target = 999;
    runtime.setDefinitions([quest]);
    assert.equal(runtime.service.isCompleted(player, quest), true);
    runtime.setDefinitions([]);
    now = 300;
    assert.equal(await runtime.service.claimQuest(player, quest.id), undefined);
    assert.equal(runtime.getAggregate().instances[firstId].lifecycle, "claimed");
    assert.equal(runtime.getAggregate().instances[firstId].completionSnapshot.rewards[0].params.amount, 10);
    assert.equal(runtime.getGrantCount(), 1);

    runtime.setDefinitions([quest]);
    now = 400;
    assert.equal(runtime.service.acceptQuest(player, quest.id), undefined);
    const secondId = "custom.repeat@repeatable#2";
    assert.equal(runtime.getAggregate().activeByQuestId[quest.id], secondId);
    assert.equal(Object.keys(runtime.getAggregate().instances).length, 2);
    assert.ok(runtime.getAggregate().instances[firstId]);
    assert.ok(runtime.getAggregate().instances[secondId]);
    assert.ok(runtime.getSaveCount() >= 7);
  } finally {
    Date.now = originalNow;
  }
});
