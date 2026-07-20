const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const director = fs.readFileSync(path.join(
  root,
  "scripts/features/backrooms/lifeform/director.ts",
), "utf8");
const voices = fs.readFileSync(path.join(root, "scripts/features/backrooms/voices.ts"), "utf8");

test("runtime director uses bounded low-frequency audits and never script-moves the Lifeform", () => {
  assert.match(director, /system\.runInterval\([\s\S]*ACTIVE_AUDIT_TICKS/);
  assert.match(director, /system\.runInterval\([\s\S]*DIRECTOR_CHECK_TICKS/);
  assert.doesNotMatch(director, /\.teleport\s*\(/);
  assert.doesNotMatch(director, /\.tryTeleport\s*\(/);
  assert.doesNotMatch(director, /\.applyKnockback\s*\(/);
});

test("an unseen automatic spawn does not consume the session or persistent cooldown", () => {
  const spawnBody = director.slice(
    director.indexOf("function spawnEncounter("),
    director.indexOf("function checkEligibility("),
  );
  assert.doesNotMatch(spawnBody, /session\.sessionEncountered\s*=\s*true/);
  assert.doesNotMatch(spawnBody, /setDynamicProperty\(COOLDOWN_PROPERTY/);
  assert.match(director, /function markEncounterRevealed\(/);
  assert.match(director, /encounter\.revealed\s*=\s*true/);
  assert.match(director, /session\.sessionEncountered\s*=\s*true/);
  assert.match(director, /setDynamicProperty\(COOLDOWN_PROPERTY/);
});

test("runtime owns entities through the documented property/event contract", () => {
  assert.match(director, /yuehua:backroomsLifeformOwner/);
  assert.match(director, /yuehua:manifestation_slot/);
  assert.match(director, /triggerEvent\(`yuehua:phase_\$\{phase\}`\)/);
  assert.match(director, /reduceEncounterState/);
  assert.match(director, /triggerPhase\(encounter, "stagger"\)/);
  assert.match(director, /yuehua:despawn/);
  assert.match(director, /yuehua\.backrooms_lifeform_target/);
  assert.match(director, /player\.addTag\(LIFEFORM_TARGET_TAG\)/);
  assert.match(director, /removeTag\(LIFEFORM_TARGET_TAG\)/);
  assert.match(director, /yuehua\.backrooms\.lifeform\.hurt/);
});

test("orphan cleanup preserves unowned manual summons and removes only broken director-owned entities", () => {
  assert.match(
    director,
    /if \(owner === undefined\) continue;/,
    "an entity without the director owner property is a manual summon and must survive cleanup",
  );
  assert.match(director, /typeof owner !== "string"/);
  assert.match(director, /!tracked[\s\S]*safeRemove\(entity\)/);
});

test("spawn clearance requires exactly the three low-room air blocks and rejects any occupied one", () => {
  assert.match(
    director,
    /for \(let y = BACKROOMS_WALK_Y; y <= BACKROOMS_WALK_Y \+ 2; y \+= 1\) \{[\s\S]*?if \(!dimension\.getBlock\(\{ x, y, z \}\)\?\.isAir\) return false;/,
  );
  assert.doesNotMatch(director, /y <= BACKROOMS_WALK_Y \+ 3/);
});

test("entity handles and source-less voice playback are guarded against invalidation", () => {
  assert.match(director, /function entityValid/);
  assert.match(director, /function safeRemove/);
  assert.match(director, /catch \{/);
  assert.match(voices, /isChunkLoaded/);
  assert.match(voices, /isWallOccluded/);
  assert.match(voices, /voiceApproachOutcome/);
  assert.match(voices, /onLureEligible/);
});
