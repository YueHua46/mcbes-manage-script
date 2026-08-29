const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const landSource = fs.readFileSync(path.join(root, "scripts/events/handlers/land.ts"), "utf8");
const logSource = fs.readFileSync(path.join(root, "scripts/features/behavior-log/services/behavior-log.ts"), "utf8");
const settingSource = fs.readFileSync(path.join(root, "scripts/features/system/services/setting.ts"), "utf8");
const fragileCacheSource = fs.readFileSync(
  path.join(root, "scripts/features/land/services/fragile-block-cache.ts"),
  "utf8"
);
const typeLocalizationSource = fs.readFileSync(path.join(root, "scripts/shared/utils/type-localization.ts"), "utf8");

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

test("piston-destroyed shulker boxes are cached, transactionally restored, and their delayed drops are removed", () => {
  assert.match(fragileCacheSource, /MAX_DESTROYED_CONTAINER_CACHE_ENTRIES = 4_096/);
  assert.match(fragileCacheSource, /StructureSaveMode\.Memory/);
  assert.match(landSource, /getDestroyedContainerSnapshots\(dimension, terminalLocations\)/);
  assert.match(landSource, /terminalSnapshots\.push\(cachedDestroyedContainer\)/);
  assert.match(landSource, /verifyTerminal\(snapshot\)/);
  assert.match(landSource, /blockContainerClosed\.subscribe/);
  assert.match(landSource, /trackPistonDestroyedContainerDrop\(event\.entity\)/);
  assert.match(landSource, /scheduleDestroyedContainerDropCleanup\(/);
  assert.match(landSource, /恢复特殊容器 \$\{restoredDestroyedContainers\.length\} 个/);
});

test("piston movement is planned by the pure phase-aware domain instead of negating retraction coordinates", () => {
  assert.match(landSource, /planPistonMovement\(\{/);
  assert.match(landSource, /phase: PistonMovementPhase = event\.isExpanding \? "expanding" : "retracting"/);
  assert.doesNotMatch(landSource, /const movementDirection = event\.isExpanding/);
});

test("rejected piston observations emit one concise high-risk reason", () => {
  assert.match(landSource, /logRejectedPistonObservation\(\{/);
  assert.match(landSource, /忽略不可信活塞事件：阶段=\$\{phase\} 原因=\$\{reason\}/);
  assert.doesNotMatch(landSource, /\[Land\]\[活塞诊断/);
});

test("denied piston plans retain phase and movement count in the behavior audit", () => {
  assert.match(
    landSource,
    /transactionMeta = `\$\{attribution\.meta\} 阶段=\$\{phase\} 移动=\$\{moves\.length\} 结果=observed`/
  );
  assert.match(landSource, /behaviorLog\.logLandPistonAttempt\(/);
});

test("routine legal piston events do not emit diagnostic console logs", () => {
  assert.match(landSource, /normalizeDimensionId\(land\.dimension\) !== normalizeDimensionId\(dimensionId\)/);
  assert.doesNotMatch(landSource, /\[Land\]\[活塞事件/);
  assert.doesNotMatch(landSource, /\[Land\]\[活塞判定/);
  assert.doesNotMatch(landSource, /活塞保护模型已启用/);
});

test("expansion reconciles API attachments with actual moving blocks in the piston corridor", () => {
  assert.match(landSource, /function reconcileExpansionAttachedLocations\(/);
  assert.match(landSource, /distance <= 13/);
  assert.match(landSource, /typeId\.includes\("moving_block"\)/);
});

test("piston log cooldown never skips protection and in-flight transactions are bounded", () => {
  assert.match(landSource, /const shouldLog =/);
  assert.doesNotMatch(
    landSource,
    /previousTick !== undefined && system\.currentTick - previousTick <= LAND_PISTON_EVENT_COOLDOWN_TICKS\) return/
  );
  assert.match(landSource, /LAND_PISTON_MAX_ACTIVE_TRANSACTIONS = 128/);
  assert.match(landSource, /activePistonRollbackTransactions\.set\(eventKey, transaction\)/);
});

test("rollback uses a precommit checkpoint transaction and never directly clears guessed coordinates", () => {
  assert.match(landSource, /executePistonRollbackCommit\(/);
  assert.match(landSource, /checkpointLocations: clearLocations/);
  assert.match(landSource, /checkpoint-restore-failed/);
  assert.doesNotMatch(landSource, /dimension\.getBlock\(pistonLocation\)\?\.setType\("minecraft:air"\)/);
});

test("fragile cache warmup enumerates only the boundary shell", () => {
  assert.match(landSource, /iterateBoundaryShell\(\{ minX, maxX, minY, maxY, minZ, maxZ \}, 12\)/);
  assert.doesNotMatch(landSource, /const boundaryDepth = Math\.min/);
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
