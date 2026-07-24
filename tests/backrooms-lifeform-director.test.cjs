const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const previousTsLoader = require.extensions[".ts"];
require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

const config = require(path.join(root, "scripts/addons/backrooms/lifeform/config.ts"));
const contracts = require(path.join(root, "scripts/addons/backrooms/lifeform/contracts.ts"));
const directorSource = fs.readFileSync(
  path.join(root, "scripts/addons/backrooms/lifeform/director.ts"),
  "utf8",
);

test.after(() => {
  if (previousTsLoader) require.extensions[".ts"] = previousTsLoader;
  else delete require.extensions[".ts"];
});

test("encounter eligibility requires both three minutes and four unique regions", () => {
  assert.equal(config.evaluateEncounterEligibility({ sessionTicks: 3_600, uniqueRegions: 3, failedChecks: 0 }).eligible, false);
  assert.equal(config.evaluateEncounterEligibility({ sessionTicks: 3_599, uniqueRegions: 4, failedChecks: 0 }).eligible, false);
  assert.deepEqual(
    config.evaluateEncounterEligibility({ sessionTicks: 3_600, uniqueRegions: 4, failedChecks: 0 }),
    { eligible: true, guaranteed: false, probability: 0.08 },
  );
});

test("failed checks escalate from 8 percent by 1 percent and cap at 25 percent", () => {
  assert.equal(config.encounterProbability(0), 0.08);
  assert.equal(config.encounterProbability(1), 0.09);
  assert.equal(config.encounterProbability(5), 0.13);
  assert.equal(config.encounterProbability(17), 0.25);
  assert.equal(config.encounterProbability(999), 0.25);
});

test("eight-minute guarantee cannot be blocked by staying inside fewer than four regions", () => {
  assert.equal(config.evaluateEncounterEligibility({ sessionTicks: 9_599, uniqueRegions: 9, failedChecks: 99 }).guaranteed, false);
  assert.equal(config.evaluateEncounterEligibility({ sessionTicks: 9_600, uniqueRegions: 4, failedChecks: 0 }).guaranteed, true);
  assert.equal(config.evaluateEncounterEligibility({ sessionTicks: 3_600, uniqueRegions: 10, failedChecks: 0 }).guaranteed, true);
  const timeGuaranteed = config.evaluateEncounterEligibility({ sessionTicks: 9_600, uniqueRegions: 1, failedChecks: 0 });
  assert.equal(timeGuaranteed.guaranteed, true);
  assert.equal(config.canStartEncounter({
    eligible: timeGuaranteed.eligible,
    guaranteed: timeGuaranteed.guaranteed,
    roll: 0.999,
    sessionEncountered: false,
    manifestationActive: false,
    activeGlobal: 0,
    nowMs: 1_000_000,
    cooldownUntilMs: 0,
  }), true);
});

test("five hundred blocks of horizontal travel also guarantees an encounter", () => {
  assert.equal(config.GUARANTEE_TRAVEL_DISTANCE, 500);
  assert.equal(config.evaluateEncounterEligibility({
    sessionTicks: 0,
    uniqueRegions: 1,
    failedChecks: 0,
    travelDistance: 499.99,
  }).guaranteed, false);
  assert.equal(config.evaluateEncounterEligibility({
    sessionTicks: 0,
    uniqueRegions: 1,
    failedChecks: 0,
    travelDistance: 500,
  }).guaranteed, true);
});

test("director limits block repeat sessions, duplicate manifestations, global overflow, and wall-clock cooldown", () => {
  const base = {
    eligible: true,
    guaranteed: false,
    roll: 0,
    sessionEncountered: false,
    manifestationActive: false,
    activeGlobal: 0,
    nowMs: 1_000_000,
    cooldownUntilMs: 0,
  };
  assert.equal(config.canStartEncounter(base), true);
  assert.equal(config.canStartEncounter({ ...base, sessionEncountered: true }), false);
  assert.equal(config.canStartEncounter({ ...base, manifestationActive: true }), false);
  assert.equal(config.canStartEncounter({ ...base, activeGlobal: 4 }), false);
  assert.equal(config.canStartEncounter({ ...base, cooldownUntilMs: base.nowMs + 1 }), false);
  assert.equal(config.canStartEncounter({ ...base, roll: 0.08, probability: 0.08 }), false);
  assert.equal(config.canStartEncounter({ ...base, roll: 0.999, guaranteed: true }), true);
  assert.equal(config.ENCOUNTER_COOLDOWN_MS, 5 * 60 * 1000);
  assert.equal(config.DIRECTOR_CHECK_TICKS, 400);
});

test("ordinary voices use independent timing and a seventy/twenty/ten approach outcome", () => {
  assert.deepEqual(config.voiceFirstDelayTicks(0), { min: 900, max: 2_400 });
  assert.deepEqual(config.voiceRepeatDelayTicks(), { min: 2_400, max: 6_000 });
  assert.equal(config.voiceApproachOutcome(0), "disappear");
  assert.equal(config.voiceApproachOutcome(0.699999), "disappear");
  assert.equal(config.voiceApproachOutcome(0.7), "relocate");
  assert.equal(config.voiceApproachOutcome(0.899999), "relocate");
  assert.equal(config.voiceApproachOutcome(0.9), "lure-eligible");
  assert.equal(config.voiceApproachOutcome(0.999999), "lure-eligible");
});

test("a director-owned manifestation emits one loud spatial roar from behind the wall", () => {
  const spawnStart = directorSource.indexOf("function spawnEncounter");
  const eligibilityStart = directorSource.indexOf("function checkEligibility", spawnStart);
  const spawnEncounter = directorSource.slice(spawnStart, eligibilityStart);
  const roarCalls = spawnEncounter.match(/playSound\(["']yuehua\.backrooms\.lifeform\.roar["']/g) ?? [];
  assert.equal(roarCalls.length, 1, "spawn must issue exactly one Lifeform roar");
  assert.match(spawnEncounter, /volume:\s*1\.35/);
  assert.match(spawnEncounter, /lifeform:spawn-roar/);
  assert.ok(
    spawnEncounter.indexOf('triggerPhase(encounter, "dormant")') < spawnEncounter.indexOf("assignEncounterTarget(encounter, target)"),
    "manual targeting must be removed before the director target slot is installed",
  );
});

test("state reducer follows the event-driven encounter phases and cleanup paths", () => {
  let state = contracts.createEncounterState("owner", 17, 100);
  assert.equal(state.phase, "dormant");
  state = contracts.reduceEncounterState(state, { type: "tick", tick: 101 });
  assert.equal(state.phase, "lure");
  state = contracts.reduceEncounterState(state, { type: "lure-complete", tick: 140 });
  assert.equal(state.phase, "stalk");
  state = contracts.reduceEncounterState(state, { type: "mutual-sight", tick: 180 });
  assert.equal(state.phase, "inspect");
  state = contracts.reduceEncounterState(state, { type: "phase-timeout", tick: 228 });
  assert.equal(state.phase, "roar");
  state = contracts.reduceEncounterState(state, { type: "phase-timeout", tick: 257 });
  assert.equal(state.phase, "chase");
  state = contracts.reduceEncounterState(state, { type: "sight-lost", tick: 377 });
  assert.equal(state.phase, "search");
  state = contracts.reduceEncounterState(state, { type: "target-seen", tick: 400 });
  assert.equal(state.phase, "chase");
  state = contracts.reduceEncounterState(state, { type: "owner-unavailable", tick: 401 });
  assert.equal(state.phase, "retreat");
});

test("a replacement target resumes a searching or retreating Bacteria without scripted stagger state", () => {
  let state = contracts.createEncounterState("owner", 2, 10);
  state = contracts.reduceEncounterState(state, { type: "tick", tick: 11 });
  state = contracts.reduceEncounterState(state, { type: "lure-complete", tick: 20 });
  state = contracts.reduceEncounterState(state, { type: "mutual-sight", tick: 21 });
  state = contracts.reduceEncounterState(state, { type: "phase-timeout", tick: 69 });
  state = contracts.reduceEncounterState(state, { type: "phase-timeout", tick: 98 });
  state = contracts.reduceEncounterState(state, { type: "sight-lost", tick: 120 });
  assert.equal(state.phase, "search");
  state = contracts.reduceEncounterState(state, { type: "target-reassigned", tick: 121 });
  assert.equal(state.phase, "chase");
  assert.equal("staggerUntilTick" in state, false);
  assert.equal("nextStaggerTick" in state, false);
});
