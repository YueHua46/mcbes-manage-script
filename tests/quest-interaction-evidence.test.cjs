const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const { buildSync } = require("esbuild");

const root = path.resolve(__dirname, "..");
const helperFile = path.join(root, "scripts", "features", "quest", "integrations", "interaction-evidence.ts");
const handlerFile = path.join(root, "scripts", "events", "handlers", "quest.ts");
const handlerSource = fs.readFileSync(handlerFile, "utf8");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creeper-quest-interaction-evidence-"));
const bundleFile = path.join(tempRoot, "interaction-evidence.cjs");

buildSync({
  entryPoints: [helperFile],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  outfile: bundleFile,
  logLevel: "silent",
});

const evidence = require(bundleFile);

after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

test("taming requires a fresh ownership transition, exact tame item and real consumption", () => {
  const untamed = {
    componentKind: "tameable",
    isTamed: false,
    tameItemIds: ["minecraft:bone"],
  };
  const owned = {
    componentKind: "tameable",
    isTamed: true,
    ownerPlayerId: "player-1",
    tameItemIds: ["minecraft:bone"],
  };
  const bone2 = { typeId: "minecraft:bone", amount: 2 };
  const bone1 = { typeId: "minecraft:bone", amount: 1 };

  assert.deepEqual(evidence.resolveTameEvidence("player-1", untamed, owned, bone2, bone1), {
    tamingItem: "minecraft:bone",
  });
  assert.equal(evidence.resolveTameEvidence("player-1", undefined, owned, bone2, bone1), undefined);
  assert.equal(evidence.resolveTameEvidence("player-1", owned, owned, bone2, bone1), undefined);
  assert.equal(evidence.resolveTameEvidence("other-player", untamed, owned, bone2, bone1), undefined);
  assert.equal(evidence.resolveTameEvidence("player-1", untamed, owned, bone2, bone2), undefined);
  assert.equal(
    evidence.resolveTameEvidence(
      "player-1",
      untamed,
      owned,
      { typeId: "minecraft:cod", amount: 2 },
      { typeId: "minecraft:cod", amount: 1 }
    ),
    undefined
  );
});

test("tamemount ownership transitions still require a consumed interaction item", () => {
  const before = { componentKind: "tamemount", isTamed: false };
  const after = { componentKind: "tamemount", isTamed: true, ownerPlayerId: "player-1" };
  const item = { typeId: "minecraft:golden_carrot", amount: 1 };
  assert.deepEqual(evidence.resolveTameEvidence("player-1", before, after, item, undefined), {
    tamingItem: "minecraft:golden_carrot",
  });
  assert.equal(evidence.resolveTameEvidence("player-1", before, after, item, item), undefined);
});

test("vault unlock evidence requires matching vault state and corresponding consumed key", () => {
  const key2 = { typeId: "minecraft:trial_key", amount: 2 };
  const key1 = { typeId: "minecraft:trial_key", amount: 1 };
  const ominousKey = { typeId: "minecraft:ominous_trial_key", amount: 1 };

  assert.deepEqual(evidence.resolveVaultUnlockEvidence("minecraft:vault", false, key2, key1), {
    vaultType: "normal",
    key: "minecraft:trial_key",
  });
  assert.deepEqual(evidence.resolveVaultUnlockEvidence("minecraft:vault", true, ominousKey, undefined), {
    vaultType: "ominous",
    key: "minecraft:ominous_trial_key",
  });
  assert.deepEqual(evidence.resolveVaultUnlockEvidence("minecraft:ominous_vault", undefined, ominousKey, undefined), {
    vaultType: "ominous",
    key: "minecraft:ominous_trial_key",
  });
  assert.equal(evidence.resolveVaultUnlockEvidence("minecraft:vault", undefined, key2, key1), undefined);
  assert.equal(evidence.resolveVaultUnlockEvidence("minecraft:vault", true, key2, key1), undefined);
  assert.equal(evidence.resolveVaultUnlockEvidence("minecraft:vault", false, key2, key2), undefined);
  assert.equal(evidence.resolveVaultUnlockEvidence("minecraft:chest", false, key2, key1), undefined);
});

test("archaeology evidence requires brush plus final suspicious-to-base block transition", () => {
  assert.deepEqual(
    evidence.resolveArchaeologyEvidence("minecraft:suspicious_sand", "minecraft:sand", "minecraft:brush"),
    { suspiciousBlock: "minecraft:suspicious_sand", resultingBlock: "minecraft:sand" }
  );
  assert.deepEqual(
    evidence.resolveArchaeologyEvidence("minecraft:suspicious_gravel", "minecraft:gravel", "minecraft:brush"),
    { suspiciousBlock: "minecraft:suspicious_gravel", resultingBlock: "minecraft:gravel" }
  );
  assert.equal(
    evidence.resolveArchaeologyEvidence("minecraft:suspicious_sand", "minecraft:suspicious_sand", "minecraft:brush"),
    undefined
  );
  assert.equal(evidence.resolveArchaeologyEvidence("minecraft:sand", "minecraft:sand", "minecraft:brush"), undefined);
  assert.equal(
    evidence.resolveArchaeologyEvidence("minecraft:suspicious_sand", "minecraft:sand", "minecraft:wooden_shovel"),
    undefined
  );
});

test("runtime captures before-state but emits all progress only from successful after-event evidence", () => {
  assert.match(handlerSource, /subscribeQuestEvent\(world\.beforeEvents\.playerInteractWithEntity/);
  assert.match(handlerSource, /pendingEntityInteractions\.set/);
  assert.match(handlerSource, /subscribeQuestEvent\(world\.afterEvents\.playerInteractWithEntity/);
  assert.match(handlerSource, /resolveTameEvidence\(/);
  assert.match(handlerSource, /"entity\.tame"/);

  assert.match(handlerSource, /subscribeQuestEvent\(world\.afterEvents\.playerInteractWithBlock/);
  assert.match(handlerSource, /event\.block\.permutation\.getState\("ominous"\)/);
  assert.match(handlerSource, /resolveVaultUnlockEvidence\(/);
  assert.match(handlerSource, /"vault\.unlock"/);

  assert.match(handlerSource, /subscribeQuestEvent\(world\.beforeEvents\.playerInteractWithBlock/);
  assert.match(handlerSource, /scheduleQuestRun\(\(\) =>/);
  assert.match(handlerSource, /dimension\.getBlock\(location\)\?\.typeId/);
  assert.match(handlerSource, /resolveArchaeologyEvidence\(/);
  assert.match(handlerSource, /"archaeology\.brush_success"/);

  assert.doesNotMatch(handlerSource, /straw_bed|future_interaction/);
  assert.match(handlerSource, /resolveQuestMountEvents\(previous, current\)/);
});
