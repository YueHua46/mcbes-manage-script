const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const landSource = fs.readFileSync(path.join(root, "scripts/events/handlers/land.ts"), "utf8");
const logSource = fs.readFileSync(
  path.join(root, "scripts/features/behavior-log/services/behavior-log.ts"),
  "utf8"
);
const settingSource = fs.readFileSync(path.join(root, "scripts/features/system/services/setting.ts"), "utf8");
const fragileCacheSource = fs.readFileSync(
  path.join(root, "scripts/features/land/services/fragile-block-cache.ts"),
  "utf8"
);
const typeLocalizationSource = fs.readFileSync(
  path.join(root, "scripts/shared/utils/type-localization.ts"),
  "utf8"
);

test("piston attribution only records successful redstone player actions", () => {
  assert.match(landSource, /afterEvents\.playerPlaceBlock\.subscribe/);
  assert.match(landSource, /afterEvents\.playerBreakBlock\.subscribe/);
  assert.match(landSource, /afterEvents\.playerInteractWithBlock\.subscribe/);
  assert.match(landSource, /resolvePistonAttribution\(pistonLocation, dimensionId\)/);
});

test("illegal piston attempts are first-class dangerous behavior-log events", () => {
  assert.match(logSource, /\| "landPistonAttempt"/);
  assert.match(logSource, /type: "landPistonAttempt"[\s\S]*?isDangerous: true/);
  assert.match(logSource, /logLandPistonAttempt\(/);
  assert.match(settingSource, /logLandPistonAttempt: true/);
});

test("unknown attribution is explicit instead of assigning an arbitrary player", () => {
  assert.match(landSource, /置信=未知 证据=自动红石或无近期玩家操作/);
  assert.match(logSource, /suspectedPlayerName \|\| "未知操作者"/);
});

test("fragile piston cache covers reported breakable block families", () => {
  for (const keyword of [
    "torch",
    "button",
    "pressure_plate",
    "repeater",
    "comparator",
    "redstone_wire",
    "tripwire",
    "sapling",
    "mushroom",
    "crop",
    "snow_layer",
    "sign",
  ]) {
    assert.match(fragileCacheSource, new RegExp(`typeId\\.includes\\(\\"${keyword}\\"\\)`));
  }
});

test("fragile cache is event-driven, bounded, and restored after piston reversal", () => {
  assert.match(fragileCacheSource, /MAX_FRAGILE_BLOCK_CACHE_ENTRIES = 50_000/);
  assert.match(landSource, /fragileBlockCache\.captureBlock\(event\.block\)/);
  assert.match(landSource, /fragileBlockCache\.remove\(event\.block\.dimension\.id, event\.block\.location\)/);
  assert.match(landSource, /fragileBlockCache\.refreshPistonCorridor/);
  assert.match(landSource, /fragileBlockCache\.restoreAffected\(dimension, rollbackLocations\)/);
});

test("behavior logs retain type ids but render object names through localization keys", () => {
  assert.match(logSource, /v\?: string;/);
  assert.match(logSource, /k\?: string;/);
  assert.match(logSource, /typeNameRawMessage\(entry\.v, entry\.k\)/);
  assert.match(logSource, /\): RawMessage \{/);
  assert.match(typeLocalizationSource, /BlockTypes\.get\(normalized\)\?\.localizationKey/);
  assert.match(typeLocalizationSource, /EntityTypes\.get\(normalized as any\)\?\.localizationKey/);
  assert.match(typeLocalizationSource, /new ItemStack\(normalized, 1\)\.localizationKey/);
});

test("piston evidence stores a separate localization key instead of embedding a type id in remarks", () => {
  assert.match(logSource, /a\?: string;/);
  assert.match(logSource, /evidenceLocalizationKey\?: string/);
  assert.match(logSource, /\{ translate: entry\.a \}/);
  assert.match(logSource, /legacyMatched = meta\.match/);
  assert.match(logSource, /typeNameRawMessage\(legacyMatched\[2\]\)/);
  assert.doesNotMatch(landSource, /return `放置\$\{record\.blockTypeId/);
});
