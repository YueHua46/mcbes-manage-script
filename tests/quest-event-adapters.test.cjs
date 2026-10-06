const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { build } = require("esbuild");

const root = path.resolve(__dirname, "..");
const handler = path.join(root, "scripts", "events", "handlers", "quest.ts");
const source = fs.readFileSync(handler, "utf8");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creeper-quest-adapters-"));
const bundleFile = path.join(tempRoot, "quest-adapters.cjs");

const stubs = new Map([
  [
    "@minecraft/server",
    `
      export class Player {}
      export const PlayerInventoryType = { Hotbar: "Hotbar", Inventory: "Inventory" };
      const signals = [];
      const signal = () => {
        const callbacks = new Set();
        const value = {
          subscribe(callback) { callbacks.add(callback); return callback; },
          unsubscribe(callback) { callbacks.delete(callback); },
          size() { return callbacks.size; },
        };
        signals.push(value);
        return value;
      };
      export const world = {
        beforeEvents: { playerInteractWithEntity: signal(), playerInteractWithBlock: signal() },
        afterEvents: {
          entityDie: signal(), playerBreakBlock: signal(), playerInventoryItemChange: signal(),
          playerPlaceBlock: signal(), itemUse: signal(), playerInteractWithBlock: signal(),
          playerInteractWithEntity: signal(), effectAdd: signal(), playerSpawn: signal(),
          playerDimensionChange: signal(),
        },
      };
      export const system = { currentTick: 0, run: () => 1, runTimeout: () => 2, clearRun: () => undefined };
      globalThis.__questWorldSubscriptionCount = () => signals.reduce((total, entry) => total + entry.size(), 0);
    `,
  ],
  [
    "../registry",
    `export const eventRegistry = { register(_name, handler) { globalThis.__registerQuestEvents = handler; } };`,
  ],
  ["../../features/quest/services/quest-player", `export default {};`],
  [
    "../../features/quest/services/quest-runtime-policy",
    `
      let enabled = true;
      let settingListener;
      export const isQuestSystemEnabled = () => enabled;
      export const subscribeQuestSystemEnabled = (listener) => { settingListener = listener; return () => { settingListener = undefined; }; };
      export const whenQuestSettingsReady = (listener) => { listener(); return () => {}; };
      globalThis.__setQuestEnabled = (next) => { enabled = next; settingListener?.(next); };
    `,
  ],
  [
    "../../features/platform/scheduler",
    `
      let activeTasks = 0;
      export const taskScheduler = { register() { activeTasks += 1; return () => { activeTasks -= 1; }; } };
      globalThis.__questTaskCount = () => activeTasks;
    `,
  ],
  ["../../features/player/services/online-time", `export const ONLINE_TIME_TICK_INTERVAL = 20;`],
  [
    "../../features/quest/snapshots/runtime-snapshot-queue",
    `
      let activeConsumers = 0;
      const queue = { subscribe() { activeConsumers += 1; return () => { activeConsumers -= 1; }; } };
      globalThis.__questSnapshotConsumerCount = () => activeConsumers;
      export default queue;
    `,
  ],
  [
    "../../features/quest/notifications/quest-notification-service",
    `export const QUEST_AUTO_ACCEPT_FOLLOW_UP_DELAY_TICKS = 1; export default {};`,
  ],
  [
    "../../shared/utils/online-players",
    `export const getOnlineRealPlayers = () => []; export const isRealPlayerEntity = () => true;`,
  ],
]);

let adapters;

before(async () => {
  await build({
    entryPoints: [handler],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    outfile: bundleFile,
    logLevel: "silent",
    plugins: [
      {
        name: "quest-runtime-stubs",
        setup(buildContext) {
          buildContext.onResolve({ filter: /.*/ }, (args) => {
            if (!stubs.has(args.path)) return undefined;
            return { path: args.path, namespace: "quest-stub" };
          });
          buildContext.onLoad({ filter: /.*/, namespace: "quest-stub" }, (args) => ({
            contents: stubs.get(args.path),
            loader: "ts",
          }));
        },
      },
    ],
  });
  adapters = require(bundleFile);
});

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("quest runtime really unsubscribes events and unregisters tasks while disabled", () => {
  globalThis.__registerQuestEvents();
  assert.equal(globalThis.__questWorldSubscriptionCount(), 12);
  assert.equal(globalThis.__questSnapshotConsumerCount(), 1);
  assert.equal(globalThis.__questTaskCount(), 4);

  globalThis.__setQuestEnabled(false);
  assert.equal(globalThis.__questWorldSubscriptionCount(), 0);
  assert.equal(globalThis.__questSnapshotConsumerCount(), 0);
  assert.equal(globalThis.__questTaskCount(), 0);

  globalThis.__setQuestEnabled(true);
  assert.equal(globalThis.__questWorldSubscriptionCount(), 12);
  assert.equal(globalThis.__questSnapshotConsumerCount(), 1);
  assert.equal(globalThis.__questTaskCount(), 4);
});

test("quest adapters subscribe only to successful after-events with explicit payloads", () => {
  const contracts = [
    ["playerPlaceBlock", "block.place", ["block", "dimension"]],
    ["itemUse", "item.use", ["item", "amount", "dimension"]],
    ["playerInteractWithBlock", "player.interact_block", ["block", "item", "dimension"]],
    ["playerInteractWithEntity", "player.interact_entity", ["entity", "item", "dimension"]],
    ["effectAdd", "effect.gain", ["effect", "amplifier", "duration", "dimension"]],
  ];

  for (const [signal, eventType, fields] of contracts) {
    assert.match(source, new RegExp(`subscribeQuestEvent\\(world\\.afterEvents\\.${signal}`));
    assert.match(source, new RegExp(`"${eventType.replace(".", "\\.")}"`));
    for (const field of fields) assert.match(source, new RegExp(`${field}:`));
  }
  assert.doesNotMatch(source, /world\.beforeEvents\.(?:playerPlaceBlock|itemUse|effectAdd)/);
  assert.match(source, /if \(!isRealPlayerEntity\(event\.player\)\) return;/);
  assert.match(source, /if \(!event\.isFirstEvent\) return;/);
  assert.match(source, /questSnapshotRuntime\.markAll\(event\.source, "item_use"\)/);
  assert.match(source, /itemStackChanged\(event\.beforeItemStack, event\.itemStack\)/);
});

test("movement edge detection emits once per glide start and once per changed mount", () => {
  const edge = adapters.resolveQuestMovementTransitions;

  assert.deepEqual(edge(undefined, { gliding: false }), { startedGliding: false, rideChanged: false });
  assert.deepEqual(edge({ gliding: false }, { gliding: true }), { startedGliding: true, rideChanged: false });
  assert.deepEqual(edge({ gliding: true }, { gliding: true }), { startedGliding: false, rideChanged: false });
  assert.deepEqual(
    edge(undefined, { gliding: false, ridingEntityId: "horse-1", ridingEntityTypeId: "minecraft:horse" }),
    { startedGliding: false, rideChanged: true }
  );
  assert.deepEqual(
    edge(
      { gliding: false, ridingEntityId: "horse-1", ridingEntityTypeId: "minecraft:horse" },
      { gliding: false, ridingEntityId: "horse-1", ridingEntityTypeId: "minecraft:horse" }
    ),
    { startedGliding: false, rideChanged: false }
  );
  assert.deepEqual(
    edge(
      { gliding: false, ridingEntityId: "horse-1", ridingEntityTypeId: "minecraft:horse" },
      { gliding: false, ridingEntityId: "boat-1", ridingEntityTypeId: "minecraft:boat" }
    ),
    { startedGliding: false, rideChanged: true }
  );
  assert.deepEqual(
    edge({ gliding: false, ridingEntityId: "boat-1", ridingEntityTypeId: "minecraft:boat" }, { gliding: false }),
    { startedGliding: false, rideChanged: false }
  );
});

test("cushion success requires an actual new mount and does not count boats or continued sitting", () => {
  const events = adapters.resolveQuestMountEvents;
  const sitting = { gliding: false, ridingEntityId: "cushion-1", ridingEntityTypeId: "minecraft:cushion" };
  assert.deepEqual(events(undefined, { gliding: false }), []);
  assert.deepEqual(events(undefined, sitting), ["player.ride", "cushion.ride_successfully"]);
  assert.deepEqual(events(sitting, sitting), []);
  assert.deepEqual(events(sitting, { gliding: false }), []);
  assert.deepEqual(
    events(undefined, { gliding: false, ridingEntityId: "boat", ridingEntityTypeId: "minecraft:boat" }),
    ["player.ride"]
  );
  assert.deepEqual(events(undefined, { gliding: false, ridingEntityTypeId: "minecraft:cushion" }), []);
});

test("glide distance counts only continuous same-dimension flight and rejects teleport-sized segments", () => {
  const distance = adapters.resolveQuestGlideDistance;
  const point = (gliding, dimensionId, x, y, z) => ({
    gliding,
    dimensionId,
    location: { x, y, z },
  });

  assert.equal(distance(undefined, point(true, "overworld", 0, 64, 0)), 0);
  assert.equal(distance(point(false, undefined, 0, 0, 0), point(true, "overworld", 0, 64, 0)), 0);
  assert.equal(distance(point(true, "overworld", 0, 64, 0), point(true, "overworld", 3, 68, 12)), 13);
  assert.equal(distance(point(true, "overworld", 0, 64, 0), point(true, "nether", 3, 68, 12)), 0);
  assert.equal(distance(point(true, "overworld", 0, 64, 0), point(false, undefined, 3, 68, 12)), 0);
  assert.equal(distance(point(true, "overworld", 0, 64, 0), point(true, "overworld", 1000, 64, 0)), 0);
});

test("movement runtime samples low-frequency state and records only transition events", () => {
  assert.match(source, /QUEST_MOVEMENT_SAMPLE_INTERVAL_TICKS = 10/);
  assert.match(source, /player\.getComponent\("minecraft:riding"\)/);
  assert.match(source, /player\.isGliding/);
  assert.match(source, /if \(transitions\.startedGliding\)/);
  assert.match(source, /"player\.glide"/);
  assert.match(source, /for \(const eventType of resolveQuestMountEvents\(previous, current\)\)/);
  assert.match(source, /"player\.ride"/);
  assert.match(source, /resolveQuestGlideDistance\(previous, current\)/);
  assert.match(source, /"elytra\.distance"/);
  assert.match(source, /distance: glideDistance/);
  assert.match(source, /\.\.\.\(gliding \? \{ dimensionId, location: \{ \.\.\.player\.location \} \} : \{\}\)/);
  assert.match(source, /if \(!onlineIds\.has\(playerId\)\) movementSamples\.delete\(playerId\)/);
});

test("crop adapters whitelist planted blocks and accept only authoritative mature states", () => {
  const planted = adapters.resolvePlantedCrop;
  const harvested = adapters.resolveMatureCropHarvest;

  assert.equal(planted("minecraft:wheat"), "wheat");
  assert.equal(planted("minecraft:nether_wart"), "nether_wart");
  assert.equal(planted("minecraft:torchflower_crop"), "torchflower");
  assert.equal(planted("minecraft:stone"), undefined);
  assert.equal(planted("minecraft:melon_block"), undefined);

  assert.deepEqual(harvested("minecraft:wheat", { growth: 7 }), { crop: "wheat", amount: 1 });
  assert.deepEqual(harvested("minecraft:beetroot", { growth: 3 }), { crop: "beetroot", amount: 1 });
  assert.deepEqual(harvested("minecraft:nether_wart", { age: 3 }), { crop: "nether_wart", amount: 1 });
  assert.equal(harvested("minecraft:wheat", { growth: 6 }), undefined);
  assert.equal(harvested("minecraft:wheat", { age: 7 }), undefined);
  assert.equal(harvested("minecraft:wheat", { growth: "7" }), undefined);
  assert.equal(harvested("minecraft:melon_block", { growth: 7 }), undefined);
});

test("crop runtime records planting after successful placement and mature harvest from broken permutation", () => {
  assert.match(source, /subscribeQuestEvent\(world\.afterEvents\.playerPlaceBlock/);
  assert.match(source, /resolvePlantedCrop\(blockTypeId\)/);
  assert.match(source, /"crop\.plant"/);
  assert.match(source, /subscribeQuestEvent\(world\.afterEvents\.playerBreakBlock/);
  assert.match(source, /event\.brokenBlockPermutation\.getAllStates\(\)/);
  assert.match(source, /resolveMatureCropHarvest\(blockTypeId,/);
  assert.match(source, /"crop\.harvest"/);
  assert.doesNotMatch(source, /world\.beforeEvents\.(?:playerPlaceBlock|playerBreakBlock)/);
});

test("biome sampler emits initial and changed biome edges while ignoring identical or unreadable samples", () => {
  const changed = adapters.resolveBiomeTransition;
  const category = adapters.resolveBiomeCategory;

  assert.equal(changed(undefined, "minecraft:plains"), true);
  assert.equal(changed("minecraft:plains", "minecraft:plains"), false);
  assert.equal(changed("minecraft:plains", "minecraft:forest"), true);
  assert.equal(changed("minecraft:plains", undefined), false);
  assert.equal(category("minecraft:ocean"), "ocean");
  assert.equal(category("minecraft:deep_frozen_ocean"), "ocean");
  assert.equal(category("minecraft:plains"), undefined);

  assert.match(source, /QUEST_BIOME_SAMPLE_INTERVAL_TICKS = 40/);
  assert.match(source, /player\.dimension\.getBiome\(player\.location\)\.id/);
  assert.match(source, /resolveBiomeTransition\(biomeSamples\.get\(player\.id\), biomeId\)/);
  assert.match(source, /"player\.biome_enter"/);
  assert.match(source, /if \(!onlineIds\.has\(playerId\)\) biomeSamples\.delete\(playerId\)/);
});
