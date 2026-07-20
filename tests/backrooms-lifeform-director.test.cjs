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

const config = require(path.join(root, "scripts/features/backrooms/lifeform/config.ts"));
const contracts = require(path.join(root, "scripts/features/backrooms/lifeform/contracts.ts"));
const directorSource = fs.readFileSync(
  path.join(root, "scripts/features/backrooms/lifeform/director.ts"),
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
  assert.equal(config.ENCOUNTER_COOLDOWN_MS, 30 * 60 * 1000);
  assert.equal(config.DIRECTOR_CHECK_TICKS, 400);
});

test("ordinary voices use independent timing and a seventy/twenty/ten approach outcome", () => {
  assert.deepEqual(config.voiceFirstDelayTicks(0), { min: 3_600, max: 7_200 });
  assert.deepEqual(config.voiceRepeatDelayTicks(), { min: 1_800, max: 3_600 });
  assert.equal(config.voiceApproachOutcome(0), "disappear");
  assert.equal(config.voiceApproachOutcome(0.699999), "disappear");
  assert.equal(config.voiceApproachOutcome(0.7), "relocate");
  assert.equal(config.voiceApproachOutcome(0.899999), "relocate");
  assert.equal(config.voiceApproachOutcome(0.9), "lure-eligible");
  assert.equal(config.voiceApproachOutcome(0.999999), "lure-eligible");
});

test("a director-owned manifestation emits one muffled spatial warning from behind the wall", () => {
  const spawnStart = directorSource.indexOf("function spawnEncounter");
  const eligibilityStart = directorSource.indexOf("function checkEligibility", spawnStart);
  const spawnEncounter = directorSource.slice(spawnStart, eligibilityStart);
  const warningCalls = spawnEncounter.match(/playSound\(["']yuehua\.backrooms\.lifeform\.distant["']/g) ?? [];
  assert.equal(warningCalls.length, 1, "spawn must issue exactly one distant Lifeform warning");
  assert.match(spawnEncounter, /volume:\s*0\.[23][0-9]?/);
  assert.match(spawnEncounter, /pitch:\s*0\.[89]/);
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

test("stagger requires six damage and has a three-second cooldown without replacing the logical phase", () => {
  let state = contracts.createEncounterState("owner", 2, 10);
  state = contracts.reduceEncounterState(state, { type: "tick", tick: 11 });
  state = contracts.reduceEncounterState(state, { type: "damage", amount: 5, tick: 20 });
  assert.equal(state.staggerUntilTick, 0);
  state = contracts.reduceEncounterState(state, { type: "damage", amount: 6, tick: 21 });
  assert.equal(state.staggerUntilTick, 32);
  assert.equal(state.nextStaggerTick, 81);
  const unchanged = contracts.reduceEncounterState(state, { type: "damage", amount: 20, tick: 50 });
  assert.equal(unchanged.nextStaggerTick, 81);
  assert.equal(unchanged.phase, "lure");
});
