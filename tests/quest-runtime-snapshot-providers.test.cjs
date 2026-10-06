const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { build } = require("esbuild");

const root = path.resolve(__dirname, "..");
const providerFile = path.join(root, "scripts", "features", "quest", "snapshots", "runtime-snapshot-providers.ts");
const queueFile = path.join(root, "scripts", "features", "quest", "snapshots", "runtime-snapshot-queue.ts");
const handlerFile = path.join(root, "scripts", "events", "handlers", "quest.ts");
const questFormFile = path.join(root, "scripts", "ui", "forms", "quest-system", "index.ts");
const queueSource = fs.readFileSync(queueFile, "utf8");
const handlerSource = fs.readFileSync(handlerFile, "utf8");
const questFormSource = fs.readFileSync(questFormFile, "utf8");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creeper-quest-runtime-snapshots-"));
const bundleFile = path.join(tempRoot, "providers.cjs");

let providers;

before(async () => {
  await build({
    entryPoints: [providerFile],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    outfile: bundleFile,
    logLevel: "silent",
    plugins: [
      {
        name: "minecraft-server-stub",
        setup(buildContext) {
          buildContext.onResolve({ filter: /^@minecraft\/server$/ }, () => ({
            path: "@minecraft/server",
            namespace: "minecraft-stub",
          }));
          buildContext.onLoad({ filter: /.*/, namespace: "minecraft-stub" }, () => ({
            loader: "ts",
            contents: `
              export class Player {}
              export class EntityEquippableComponent {}
              export class ItemEnchantableComponent { static componentId = "minecraft:enchantable"; }
              export const EquipmentSlot = {
                Head: "Head", Chest: "Chest", Legs: "Legs", Feet: "Feet", Mainhand: "Mainhand", Offhand: "Offhand"
              };
            `,
          }));
        },
      },
    ],
  });
  providers = require(bundleFile);
});

after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

function item(typeId, amount, enchantments = []) {
  return {
    typeId,
    amount,
    getComponent(id) {
      if (id !== "minecraft:enchantable" || enchantments.length === 0) return undefined;
      return { getEnchantments: () => enchantments };
    },
  };
}

test("runtime providers read exact enchantments from inventory and equipment components", () => {
  const swiftSneak = { type: { id: "swift_sneak" }, level: 3 };
  const protection = { type: { id: "minecraft:protection" }, level: 4 };
  const inventoryItems = [item("minecraft:enchanted_book", 1, [swiftSneak]), item("minecraft:diamond", 2)];
  const equipment = { Legs: item("minecraft:diamond_leggings", 1, [protection]) };
  const player = {
    name: "Alice",
    getComponent(id) {
      if (id === "inventory") {
        return {
          container: {
            size: inventoryItems.length,
            getItem(slot) {
              return inventoryItems[slot];
            },
          },
        };
      }
      if (id === "equippable") return { getEquipment: (slot) => equipment[slot] };
      return undefined;
    },
  };

  const inventory = providers.buildPlayerInventorySummary(player, 10);
  const equipped = providers.buildPlayerEquipmentSummary(player, 11);
  assert.equal(inventory.providerVersion, 2);
  assert.deepEqual(inventory.items.get("minecraft:enchanted_book").enchantments, [
    { typeId: "minecraft:swift_sneak", level: 3 },
  ]);
  assert.equal(inventory.items.get("minecraft:diamond").enchantments, undefined);
  assert.equal(equipped.providerVersion, 2);
  assert.deepEqual(equipped.slots.Legs.enchantments, [{ typeId: "minecraft:protection", level: 4 }]);
});

test("effects provider preserves id, amplifier and remaining duration", () => {
  const player = {
    getEffects: () => [
      { typeId: "trial_omen", amplifier: 1, duration: 1200 },
      { typeId: "minecraft:speed", amplifier: 2, duration: 400 },
    ],
  };
  const summary = providers.buildPlayerEffectsSummary(player, 20);
  assert.equal(summary.providerVersion, 1);
  assert.deepEqual(summary.effects.get("minecraft:trial_omen"), {
    typeId: "minecraft:trial_omen",
    amplifier: 1,
    duration: 1200,
  });
  assert.deepEqual(summary.effects.get("minecraft:speed"), {
    typeId: "minecraft:speed",
    amplifier: 2,
    duration: 400,
  });
});

test("markAll and existing spawn, accept, item and equipment triggers cover the expanded providers", () => {
  assert.match(queueSource, /this\.mark\(player, "inventory", reason\)/);
  assert.match(queueSource, /this\.mark\(player, "equipment", reason\)/);
  assert.match(queueSource, /this\.mark\(player, "effects", reason\)/);
  assert.match(queueSource, /buildPlayerEffectsSummary\(player\)/);
  assert.match(handlerSource, /questSnapshotRuntime\.markAll\(event\.player, "player_join"\)/);
  for (const provider of ["inventory", "equipment", "effects"]) {
    assert.ok(handlerSource.includes(`questSnapshotRuntime.mark(event.source, "${provider}", "item_use")`));
  }
  assert.ok(!handlerSource.includes('questSnapshotRuntime.mark(event.source, "creeper_state", "item_use")'));
  assert.match(handlerSource, /questSnapshotRuntime\.mark\(event\.player, "inventory", "inventory_change"\)/);
  assert.match(handlerSource, /questSnapshotRuntime\.mark\(player, "equipment", "low_frequency_fallback"\)/);
  assert.match(questFormSource, /questSnapshotRuntime\.markAll\(player, "quest_accept"\)/);
});
