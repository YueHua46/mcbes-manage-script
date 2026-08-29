const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const { buildSync } = require("esbuild");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creeper-quest-switch-"));
const entryFile = path.join(tempRoot, "quest-runtime-policy.ts");
const bundleFile = path.join(tempRoot, "quest-runtime-policy.cjs");

fs.writeFileSync(
  entryFile,
  read("scripts", "features", "quest", "services", "quest-runtime-policy.ts").replace(
    'import setting from "../../system/services/setting";',
    `const setting = {
      getState(key: string) { return globalThis.__questFeatureSettings[key]; },
      subscribe() { return () => undefined; },
      whenReady(listener: () => void) { listener(); return () => undefined; },
    };`
  )
);

buildSync({
  entryPoints: [entryFile],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  outfile: bundleFile,
  logLevel: "silent",
});

const policy = require(bundleFile);

after(() => {
  delete globalThis.__questFeatureSettings;
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("quest and preset switches have independent runtime semantics", () => {
  globalThis.__questFeatureSettings = { quest: true, questPresets: true };
  assert.equal(policy.isQuestSystemEnabled(), true);
  assert.equal(policy.arePresetQuestsEnabled(), true);

  globalThis.__questFeatureSettings.questPresets = false;
  assert.equal(policy.isQuestSystemEnabled(), true);
  assert.equal(policy.arePresetQuestsEnabled(), false);

  globalThis.__questFeatureSettings = { quest: false, questPresets: true };
  assert.equal(policy.isQuestSystemEnabled(), false);
  assert.equal(policy.arePresetQuestsEnabled(), false);
});

test("feature switches are persisted, exposed in management, and enforced at runtime boundaries", () => {
  const settings = read("scripts", "features", "system", "services", "setting.ts");
  const settingsForm = read("scripts", "ui", "forms", "system", "index.ts");
  const serverMenu = read("scripts", "ui", "forms", "server", "index.ts");
  const playerService = read("scripts", "features", "quest", "services", "quest-player.ts");
  const catalogService = read("scripts", "features", "quest", "services", "quest-catalog.ts");
  const snapshotQueue = read("scripts", "features", "quest", "snapshots", "runtime-snapshot-queue.ts");
  const integration = read("scripts", "features", "quest", "integrations", "creeper-quest-events.ts");
  const questEvents = read("scripts", "events", "handlers", "quest.ts");

  assert.match(settings, /\| "quest"/);
  assert.match(settings, /\| "questPresets"/);
  assert.match(settings, /quest: true/);
  assert.match(settings, /questPresets: true/);
  assert.match(settingsForm, /key: "quest"/);
  assert.match(settingsForm, /key: "questPresets"/);

  const questMenuStart = serverMenu.indexOf('id: "quest"');
  const questMenuEnd = serverMenu.indexOf('id: "other"', questMenuStart);
  const questMenuItem = serverMenu.slice(questMenuStart, questMenuEnd);
  assert.ok(questMenuStart >= 0 && questMenuEnd > questMenuStart);
  assert.doesNotMatch(questMenuItem, /alwaysVisible/);
  assert.match(playerService, /if \(!isQuestSystemEnabled\(\)[^\n]*return \[\]/);
  assert.match(playerService, /if \(!isQuestSystemEnabled\(\)\) return "任务系统当前已关闭。"/);
  assert.match(catalogService, /return \{ \.\.\.entry, packEnabled: false \}/);
  assert.match(snapshotQueue, /mark\([\s\S]*?if \(!isQuestSystemEnabled\(\)\) return;/);
  assert.match(integration, /if \(!isQuestSystemEnabled\(\)\) return;/);
  assert.match(questEvents, /signal\.unsubscribe\(subscribed\)/);
  assert.match(questEvents, /questRuntimeStops\.push\(\s*taskScheduler\.register/);
  assert.match(questEvents, /for \(const runId of questScheduledRunIds\) system\.clearRun\(runId\)/);
  assert.match(questEvents, /pendingEntityInteractions\.clear\(\)/);
  assert.match(questEvents, /subscribeQuestSystemEnabled\(\(\) => refreshQuestEventRuntime\(\)\)/);
  assert.match(questEvents, /whenQuestSettingsReady\(\(\) => refreshQuestEventRuntime\(\)\)/);
});
