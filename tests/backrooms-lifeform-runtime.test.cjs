const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const director = fs.readFileSync(path.join(
  root,
  "scripts/addons/backrooms/lifeform/director.ts",
), "utf8");
const voices = fs.readFileSync(path.join(root, "scripts/addons/backrooms/voices.ts"), "utf8");
const vocals = fs.readFileSync(path.join(
  root,
  "scripts/addons/backrooms/lifeform/vocals.ts",
), "utf8");

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
  assert.doesNotMatch(director, /triggerPhase\(encounter, "stagger"\)/);
  assert.match(director, /yuehua:despawn/);
  assert.match(director, /yuehua\.backrooms_lifeform_target_/);
  assert.match(director, /TARGET_SLOT_COUNT\s*=\s*4/);
  assert.match(director, /availableTargetSlot/);
  assert.match(director, /player\.addTag\(targetTag\(encounter\.targetSlot\)\)/);
  assert.match(director, /removeTag\(targetTag\(slot\)\)/);
  assert.match(director, /handoffEncounterTarget/);
  assert.match(director, /restoreRespawnedTarget/);
  assert.doesNotMatch(director, /target\?\.typeId[\s\S]*owner-unavailable/);
  assert.match(director, /yuehua\.backrooms\.lifeform\.hurt/);
  assert.match(director, /yuehua\.backrooms_lifeform_debug/);
  assert.match(director, /生成成功：实体/);
  assert.match(director, /spawn-site-unavailable/);
  assert.match(director, /function auditNativeTarget/);
  assert.match(director, /锁敌确认/);
});

test("target handoff keeps the original encounter session until the Bacteria dies", () => {
  assert.match(director, /if \(!sessions\.get\(event\.player\.id\)\?\.entityId\) sessions\.delete/);
  assert.match(director, /if \(!sessions\.get\(event\.player\.id\)\?\.entityId\) \{[\s\S]*createSession/);
  assert.match(director, /if \(session\?\.entityId === entityId\) session\.entityId = undefined/);
});

test("runtime accumulates horizontal travel and clamps legacy cooldowns", () => {
  assert.match(director, /session\.travelDistance\s*\+=\s*Math\.hypot\(dx,\s*dz\)/);
  assert.match(director, /player\.setDynamicProperty\(COOLDOWN_PROPERTY, maximumAllowed\)/);
  assert.match(director, /旧版超长冷却已压缩/);
  assert.match(director, /cooldownUntilMs:\s*travelGuaranteed\s*\?\s*0\s*:\s*cooldownUntilMs/);
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

test("all valid Lifeforms receive independently scheduled spatial imported vocals", () => {
  assert.match(vocals, /getEntities\(\{\s*type:\s*LIFEFORM_TYPE_ID\s*\}\)/);
  assert.match(vocals, /yuehua\.backrooms\.lifeform\.random_vocal/);
  assert.match(vocals, /yuehua\.backrooms\.lifeform\.roar/);
  assert.match(vocals, /player\.playSound/);
  assert.match(vocals, /entity\.location/);
  assert.match(vocals, /nextVocalTicks/);
  assert.match(vocals, /MIN_VOCAL_DELAY_TICKS/);
  assert.match(vocals, /MAX_VOCAL_DELAY_TICKS/);
  assert.match(vocals, /MIN_VOCAL_DELAY_TICKS\s*=\s*8\s*\*\s*20/);
  assert.match(vocals, /MAX_VOCAL_DELAY_TICKS\s*=\s*16\s*\*\s*20/);
  assert.match(vocals, /soundId\s*===\s*SIGNATURE_WAIL_SOUND_ID\s*\?\s*1\.45\s*:\s*1\.2/);
  assert.match(vocals, /yuehua\.backrooms\.lifeform\.signature_wail/);
  assert.match(vocals, /playedSignatureVocals/);
  assert.match(vocals, /entity\.isValid/);
});

test("manual summons get one immediate positional CJB123 wail without duplicating director spawns", () => {
  assert.match(vocals, /world\.afterEvents\.entitySpawn\.subscribe/);
  assert.match(vocals, /MANUAL_SPAWN_DELAY_TICKS\s*=\s*2/);
  assert.match(vocals, /MANUAL_SPAWN_AUDIBLE_DISTANCE\s*=\s*96/);
  assert.match(vocals, /MANUAL_SPAWN_VOLUME\s*=\s*1\.6/);
  assert.match(vocals, /getDynamicProperty\(OWNER_PROPERTY\)\s*!==\s*undefined/);
  assert.match(vocals, /lifeform:manual-spawn-wail/);
  assert.match(vocals, /maxDistance\s*=\s*MANUAL_SPAWN_AUDIBLE_DISTANCE/);
  assert.match(vocals, /entity\.dimension\.getPlayers\(\{\s*location,\s*maxDistance\s*\}\)/);
  assert.match(vocals, /playSpatialSound\(entity, SIGNATURE_WAIL_SOUND_ID,[\s\S]*MANUAL_SPAWN_VOLUME/);
});

test("manual and director Lifeforms continuously repair dropped native targets", () => {
  assert.match(vocals, /Reflect\.set\(entity, ["']target["'], target\)/);
  assert.match(vocals, /triggerEvent\(["']yuehua:manual_retarget["']\)/);
  assert.match(director, /Reflect\.set\(encounter\.entity, ["']target["'], target\)/);
  assert.match(director, /lastTargetRepairTick/);
  assert.match(director, /triggerEvent\(`yuehua:target_slot_\$\{encounter\.targetSlot\}`\)/);
});
