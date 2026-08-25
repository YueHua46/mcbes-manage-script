const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const { buildSync } = require("esbuild");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creeper-hud-broker-"));
const bundleFile = path.join(tempRoot, "hud-broker.cjs");

buildSync({
  entryPoints: [path.join(root, "scripts", "features", "hud", "hud-message-broker.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  outfile: bundleFile,
  logLevel: "silent",
});

const { HudMessageBroker } = require(bundleFile);

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("action hints preempt queued quest toasts and persistent status is restored after TTL", () => {
  const broker = new HudMessageBroker();
  broker.setPersistentStatus("cmid_test", "persistent");
  broker.enqueueQuestToast("cmid_test", { message: "toast one", ttl: 10 }, 0);
  broker.enqueueQuestToast("cmid_test", { message: "toast two", ttl: 10 }, 0);

  assert.deepEqual(broker.getFrame("cmid_test", 0), {
    actionBar: "toast one",
    title: "",
    actionSource: "quest",
    titleSource: undefined,
  });
  broker.showActionHint("cmid_test", "teleport hint", { source: "waypoint", priority: 50, ttl: 3 }, 2);
  assert.equal(broker.getFrame("cmid_test", 2).actionBar, "teleport hint");
  assert.equal(broker.getFrame("cmid_test", 5).actionBar, "toast one");
  assert.equal(broker.getFrame("cmid_test", 10).actionBar, "toast two");
  assert.equal(broker.getFrame("cmid_test", 19).actionBar, "toast two");
  assert.equal(broker.getFrame("cmid_test", 20).actionBar, "persistent");
});

test("chapter banners queue independently and replace keys collapse stale queued messages", () => {
  const broker = new HudMessageBroker();
  broker.showChapterBanner("cmid_test", { message: "chapter one", ttl: 5 }, 0);
  broker.showChapterBanner("cmid_test", { message: "old queued", ttl: 5, replaceKey: "chapter.next" }, 0);
  broker.showChapterBanner("cmid_test", { message: "new queued", ttl: 5, replaceKey: "chapter.next" }, 1);

  assert.equal(broker.getFrame("cmid_test", 1).title, "chapter one");
  assert.equal(broker.getFrame("cmid_test", 5).title, "new queued");
  assert.equal(broker.getFrame("cmid_test", 10).title, "");
});

test("delayed quest follow-ups wait until not-before and never overtake completion", () => {
  const broker = new HudMessageBroker();
  broker.setPersistentStatus("cmid_test", "persistent");
  broker.enqueueQuestToast(
    "cmid_test",
    { message: "new quest", priority: 50, ttl: 20, delayTicks: 80, replaceKey: "quest.accept:new" },
    0
  );
  broker.enqueueQuestToast(
    "cmid_test",
    { message: "completed quest", priority: 130, ttl: 70, replaceKey: "quest.complete:old" },
    0
  );

  assert.equal(broker.getFrame("cmid_test", 0).actionBar, "completed quest");
  assert.equal(broker.getFrame("cmid_test", 70).actionBar, "persistent");
  assert.equal(broker.getFrame("cmid_test", 79).actionBar, "persistent");
  assert.equal(broker.getFrame("cmid_test", 80).actionBar, "new quest");
});

test("higher-priority completion preempts an already visible task toast", () => {
  const broker = new HudMessageBroker();
  broker.enqueueQuestToast("cmid_test", { message: "new quest", priority: 50, ttl: 20 }, 0);
  assert.equal(broker.getFrame("cmid_test", 0).actionBar, "new quest");

  broker.enqueueQuestToast("cmid_test", { message: "completed quest", priority: 130, ttl: 10 }, 2);
  assert.equal(broker.getFrame("cmid_test", 2).actionBar, "completed quest");
  assert.equal(broker.getFrame("cmid_test", 12).actionBar, "new quest");
});

test("quest toast cues fire once on actual display and replaced delayed cues never fire", () => {
  const broker = new HudMessageBroker();
  const cues = [];
  broker.enqueueQuestToast(
    "cmid_test",
    {
      message: "old follow-up",
      delayTicks: 80,
      replaceKey: "quest.auto_accept.batch",
      onDisplay: () => cues.push("old"),
    },
    0
  );
  broker.enqueueQuestToast(
    "cmid_test",
    {
      message: "new follow-up",
      delayTicks: 80,
      replaceKey: "quest.auto_accept.batch",
      onDisplay: () => cues.push("new"),
    },
    1
  );

  assert.equal(broker.getFrame("cmid_test", 80).actionBar, "");
  assert.deepEqual(cues, []);
  assert.equal(broker.getFrame("cmid_test", 81).actionBar, "new follow-up");
  assert.deepEqual(cues, ["new"]);
  broker.getFrame("cmid_test", 82);
  assert.deepEqual(cues, ["new"]);
});

test("clearing a source and disconnect cleanup remove only broker-owned state", () => {
  const broker = new HudMessageBroker();
  broker.setPersistentStatus("cmid_test", "persistent", "status");
  broker.showActionHint("cmid_test", "quest hint", { source: "quest", priority: 20, ttl: 20 }, 0);
  broker.clearSource("cmid_test", "quest");
  assert.equal(broker.getFrame("cmid_test", 1).actionBar, "persistent");
  broker.disconnect("cmid_test");
  assert.equal(broker.getFrame("cmid_test", 1).actionBar, "");
});

test("quest notifications and persistent player HUD route through the runtime broker", () => {
  const playerHud = fs.readFileSync(
    path.join(root, "scripts", "features", "system", "services", "player-hud.ts"),
    "utf8"
  );
  const notifications = fs.readFileSync(
    path.join(root, "scripts", "features", "quest", "notifications", "quest-notification-service.ts"),
    "utf8"
  );
  assert.match(playerHud, /hudBroker\.setPersistentStatus/);
  assert.doesNotMatch(playerHud, /onScreenDisplay\.setActionBar/);
  assert.match(notifications, /hudBroker\.enqueueQuestToast/);
  assert.match(notifications, /hudBroker\.showActionHint/);
  assert.doesNotMatch(notifications, /onScreenDisplay/);
});

test("quest event notifications publish completion before delayed auto-accept follow-ups", () => {
  const questEvents = fs.readFileSync(path.join(root, "scripts", "events", "handlers", "quest.ts"), "utf8");
  const progressCall = questEvents.indexOf("questNotificationService.notifyProgressChanges(player, changes)");
  const autoAcceptCall = questEvents.indexOf(
    "questNotificationService.notifyAutoAccepted(player, autoAccepted, followUpDelay)"
  );

  assert.ok(progressCall >= 0 && autoAcceptCall > progressCall);
  assert.match(questEvents, /changes\.some\(\(change\) => change\.completedQuest\)/);
  assert.match(questEvents, /QUEST_AUTO_ACCEPT_FOLLOW_UP_DELAY_TICKS/);
});
