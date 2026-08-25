const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const { buildSync } = require("esbuild");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creeper-quest-registries-"));
const bundleFile = path.join(tempRoot, "registries.cjs");

buildSync({
  stdin: {
    contents: `
      import {
        AVAILABLE_QUEST_CAPABILITY_DEFINITIONS,
        EXPERIMENTAL_QUEST_CAPABILITY_DEFINITIONS,
        createDefaultQuestCapabilityRegistry,
      } from "./scripts/features/quest/catalog/capability-registry";
      import { createDefaultQuestSelectorRegistry } from "./scripts/features/quest/catalog/selector-registry";
      import { coreFirstSliceChapters, coreFirstSlicePack, coreFirstSliceQuests } from "./scripts/features/quest/presets/core/first-slice";
      import { coreRemainingChapters, coreRemainingQuests } from "./scripts/features/quest/presets/core/remaining";
      import { worldPresetChapters, worldPresetPack, worldPresetQuests } from "./scripts/features/quest/presets/world/catalog";
      import { creeperAndUpdateChapters, creeperAndUpdatePacks, creeperAndUpdateQuests } from "./scripts/features/quest/presets/creeper-updates-catalog";
      import { specialPresetChapters, specialPresetPacks, specialPresetQuests } from "./scripts/features/quest/presets/special-catalog";

      export { createDefaultQuestCapabilityRegistry, createDefaultQuestSelectorRegistry };
      export const availableCapabilityDefinitions = AVAILABLE_QUEST_CAPABILITY_DEFINITIONS;
      export const experimentalCapabilityDefinitions = EXPERIMENTAL_QUEST_CAPABILITY_DEFINITIONS;
      export const allQuests = [
        ...coreFirstSliceQuests,
        ...coreRemainingQuests,
        ...worldPresetQuests,
        ...creeperAndUpdateQuests,
        ...specialPresetQuests,
      ];
      export const allPacks = [coreFirstSlicePack, worldPresetPack, ...creeperAndUpdatePacks, ...specialPresetPacks];
      export const allChapters = [
        ...coreFirstSliceChapters,
        ...coreRemainingChapters,
        ...worldPresetChapters,
        ...creeperAndUpdateChapters,
        ...specialPresetChapters,
      ];
    `,
    resolveDir: root,
    sourcefile: "quest-registry-contract.ts",
    loader: "ts",
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  outfile: bundleFile,
  logLevel: "silent",
});

const content = require(bundleFile);

after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

function collectRuleCapabilities(rule, target) {
  if (!rule) return;
  if (rule.type === "capability") target.add(rule.capabilityId);
  if (rule.type === "all" || rule.type === "any") {
    for (const child of rule.rules) collectRuleCapabilities(child, target);
  }
}

test("all selectors referenced by the complete 158-task catalog are registered", () => {
  assert.equal(content.allQuests.length, 158);
  assert.equal(new Set(content.allQuests.map((quest) => quest.id)).size, 158);
  const registry = content.createDefaultQuestSelectorRegistry();
  const referenced = new Set(
    content.allQuests.flatMap((quest) => quest.goals.map((goal) => goal.selectorId).filter(Boolean))
  );
  assert.ok(referenced.size > 60);
  assert.deepEqual(
    [...referenced].filter((selectorId) => !registry.has(selectorId)),
    []
  );
});

test("current A-grade inventory and equipment snapshots use concrete type-id selectors", () => {
  const registry = content.createDefaultQuestSelectorRegistry();
  const currentSnapshotGoals = content.allQuests.flatMap((quest) => {
    if (quest.reliability !== "A") return [];
    if (quest.requiredCapabilities.some((capability) => capability.startsWith("cap.content."))) return [];
    return quest.goals.filter(
      (goal) => goal.semantics === "snapshot" && ["inventory", "equipment"].includes(goal.provider)
    );
  });

  assert.ok(currentSnapshotGoals.length > 30);
  for (const goal of currentSnapshotGoals) {
    const selector = registry.get(goal.selectorId);
    assert.ok(selector, goal.selectorId);
    assert.notEqual(selector.kind, "deferred", goal.selectorId);
    assert.ok(selector.itemIds.length > 0, goal.selectorId);
  }

  assert.equal(registry.matchItem("selector.item.beds", { typeId: "minecraft:red_bed", amount: 1 }), true);
  assert.equal(
    registry.matchItem("selector.item.pottery_sherds", {
      typeId: "minecraft:snort_pottery_sherd",
      amount: 1,
    }),
    true
  );
  assert.equal(
    registry.matchItem("selector.item.shulker_boxes", { typeId: "minecraft:cyan_shulker_box", amount: 1 }),
    true
  );
  assert.equal(
    registry.matchEquipment("selector.equipment.iron_chestplate", {
      slots: { Chest: { typeId: "minecraft:iron_chestplate", amount: 1 } },
    }),
    true
  );
  assert.equal(registry.matchItem("selector.item.elytra", { typeId: "minecraft:paper", amount: 1 }), false);
});

test("deferred world-state and historical selectors are registered but cannot proxy-match", () => {
  const registry = content.createDefaultQuestSelectorRegistry();
  const deferred = [
    "selector.item.treasure_maps",
    "selector.world.active_conduit",
    "selector.world.full_beacon",
    "selector.counter.boss_kill_count",
  ];
  for (const selectorId of deferred) {
    assert.equal(registry.get(selectorId)?.kind, "deferred", selectorId);
    assert.equal(registry.matchItem(selectorId, { typeId: "minecraft:map", amount: 1 }), false, selectorId);
  }
});

test("swift sneak selectors require the exact enchantment component evidence in their own scope", () => {
  const registry = content.createDefaultQuestSelectorRegistry();
  assert.equal(registry.get("selector.enchantment.swift_sneak.inventory")?.kind, "enchantment");
  assert.equal(registry.get("selector.enchantment.swift_sneak.equipment")?.kind, "enchantment");

  const enchantedBook = {
    typeId: "minecraft:enchanted_book",
    amount: 1,
    enchantments: [{ typeId: "minecraft:swift_sneak", level: 1 }],
  };
  const protectionBook = {
    typeId: "minecraft:enchanted_book",
    amount: 1,
    enchantments: [{ typeId: "minecraft:protection", level: 4 }],
  };
  assert.equal(registry.matchItem("selector.enchantment.swift_sneak.inventory", enchantedBook), true);
  assert.equal(registry.matchItem("selector.enchantment.swift_sneak.inventory", protectionBook), false);
  assert.equal(
    registry.matchEquipment("selector.enchantment.swift_sneak.equipment", { slots: { Legs: enchantedBook } }),
    true
  );
  assert.equal(
    registry.matchEquipment("selector.enchantment.swift_sneak.equipment", { slots: { Legs: protectionBook } }),
    false
  );
});

test("every required catalog capability is registered and only wired adapters are enabled", () => {
  const registry = content.createDefaultQuestCapabilityRegistry();
  const referenced = new Set();
  for (const pack of content.allPacks) {
    pack.requiredCapabilities.forEach((capability) => referenced.add(capability));
  }
  for (const chapter of content.allChapters) {
    collectRuleCapabilities(chapter.unlockRule, referenced);
  }
  for (const quest of content.allQuests) {
    quest.requiredCapabilities.forEach((capability) => referenced.add(capability));
    collectRuleCapabilities(quest.unlockRule, referenced);
  }

  assert.ok(referenced.size > 60);
  assert.deepEqual(
    [...referenced].filter((capabilityId) => !registry.has(capabilityId)),
    []
  );

  const availableIds = registry
    .getAll()
    .filter((definition) => definition.state === "available")
    .map((definition) => definition.id)
    .sort();
  assert.deepEqual(
    availableIds,
    content.availableCapabilityDefinitions.map((definition) => definition.id).sort()
  );
  for (const capabilityId of [
    "cap.event.creeper.market.trade.v1",
    "cap.snapshot.effects.v1",
    "cap.snapshot.item_enchantment.v1",
    "cap.snapshot.equipment_enchantment.v1",
    "cap.snapshot.creeper_state.v1",
  ]) {
    assert.equal(registry.get(capabilityId)?.state, "available", capabilityId);
  }

  const experimentalIds = registry
    .getAll()
    .filter((definition) => definition.state === "experimental")
    .map((definition) => definition.id)
    .sort();
  assert.deepEqual(
    experimentalIds,
    content.experimentalCapabilityDefinitions.map((definition) => definition.id).sort()
  );

  for (const capabilityId of referenced) {
    const definition = registry.get(capabilityId);
    assert.ok(definition, capabilityId);
    if (!availableIds.includes(capabilityId) && !experimentalIds.includes(capabilityId)) {
      assert.equal(definition.state, "unavailable", capabilityId);
      assert.equal(registry.isAvailable(capabilityId), false, capabilityId);
    }
  }
});
