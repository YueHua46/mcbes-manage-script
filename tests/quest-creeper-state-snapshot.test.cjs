const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const { buildSync } = require("esbuild");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creeper-state-snapshot-"));
const bundleFile = path.join(tempRoot, "creeper-state.cjs");

buildSync({
  stdin: {
    contents: `
      export { createCreeperStateSnapshotSummary } from "./scripts/features/quest/snapshots/snapshot-summary";
      export { reconcileSnapshotGoals } from "./scripts/features/quest/snapshots/snapshot-reconciler";
      export { QuestSnapshotDirtyQueue } from "./scripts/features/quest/snapshots/snapshot-dirty-queue";
    `,
    resolveDir: root,
    sourcefile: "creeper-state-contract.ts",
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

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function milestone(id, evidenceProviderId, backfillPolicy = "current_state") {
  return {
    id,
    displayText: id,
    semantics: "milestone",
    eventType: `creeper.${id}`,
    filters: {},
    backfillPolicy,
    evidenceProviderId,
  };
}

test("creeper-state summary exposes only positively verified business evidence", () => {
  const summary = content.createCreeperStateSnapshotSummary(
    {
      playerCmid: "cmid_alice",
      playerName: "Alice",
      knownNames: ["Alice", "OldAlice", "Alice"],
      guildId: "guild_1",
      hasPrivateWaypoint: true,
      hasLand: false,
      hasGuild: true,
    },
    1234,
    1
  );
  assert.deepEqual([...summary.evidenceIds].sort(), [
    "evidence.creeper.guild.joined",
    "evidence.creeper.waypoint.exists",
  ]);
  assert.deepEqual(summary.knownNames, ["Alice", "OldAlice"]);
  assert.equal(summary.playerCmid, "cmid_alice");
  assert.equal(summary.guildId, "guild_1");
  assert.equal(summary.builtAt, 1234);
});

test("current-state milestones absorb waypoint, land and guild evidence exactly once", () => {
  const summary = content.createCreeperStateSnapshotSummary(
    {
      playerCmid: "cmid_alice",
      playerName: "Alice",
      knownNames: ["Alice"],
      hasPrivateWaypoint: true,
      hasLand: true,
      hasGuild: true,
    },
    2000,
    1
  );
  const goals = [
    milestone("waypoint", "evidence.creeper.waypoint.exists"),
    milestone("land", "evidence.creeper.land.exists"),
    milestone("guild", "evidence.creeper.guild.joined"),
    milestone("historical", "evidence.creeper.land.exists", "historical"),
    milestone("unknown", "evidence.creeper.unknown"),
  ];
  const progress = {};
  const changed = content.reconcileSnapshotGoals({
    goals,
    progress,
    selectors: {},
    creeperState: summary,
  });
  assert.deepEqual(changed, ["waypoint", "land", "guild"]);
  assert.equal(progress.waypoint.achieved, true);
  assert.equal(progress.land.achieved, true);
  assert.equal(progress.guild.achieved, true);
  assert.equal(progress.guild.evidenceId, "evidence.creeper.guild.joined:cmid_alice");
  assert.equal(progress.historical, undefined);
  assert.equal(progress.unknown, undefined);

  assert.deepEqual(
    content.reconcileSnapshotGoals({ goals, progress, selectors: {}, creeperState: summary }),
    []
  );
});

test("dirty queue treats Creeper state as an independent provider", () => {
  const queue = new content.QuestSnapshotDirtyQueue();
  queue.mark("cmid_alice", "creeper_state", "auto_accept");
  queue.mark("cmid_alice", "inventory", "player_join");
  assert.deepEqual(queue.takeBatch(1), [
    {
      playerCmid: "cmid_alice",
      providers: ["creeper_state", "inventory"],
      reasons: ["auto_accept", "player_join"],
    },
  ]);
});

test("runtime provider resolves CMID and aliases before querying read-only business APIs", () => {
  const provider = read("scripts/features/quest/integrations/creeper-state-provider.ts");
  assert.match(provider, /identityService\.getProfileForPlayer\(player\)/);
  assert.match(provider, /player\.name, profile\.currentName, \.\.\.profile\.knownNames/);
  assert.match(provider, /getPersistedGuildIdForIdentity\(profile\.id, knownNames\)/);
  assert.match(provider, /hasPrivatePointForKnownNames\(knownNames\)/);
  assert.match(provider, /hasLandForIdentity\(profile\.id, knownNames, guildId\)/);
  assert.match(provider, /playerCmid: profile\.id/);

  const waypoint = read("scripts/features/waypoint/services/waypoint.ts");
  const land = read("scripts/features/land/services/land-manager.ts");
  const guild = read("scripts/features/guild/services/guild-service.ts");
  assert.match(waypoint, /hasPrivatePointForKnownNames\(knownNames: readonly string\[\]\)/);
  assert.match(land, /hasLandForIdentity\(identityId: string, knownNames: readonly string\[\], guildId\?: string\)/);
  assert.match(guild, /getPersistedGuildIdForIdentity\(identityId: string, knownNames: readonly string\[\]\)/);
});

test("join and Creeper success paths schedule state reconciliation after auto-accept", () => {
  const queue = read("scripts/features/quest/snapshots/runtime-snapshot-queue.ts");
  assert.match(queue, /this\.mark\(player, "creeper_state", reason\)/);
  assert.match(queue, /buildPlayerCreeperStateSummary\(player\)/);

  const events = read("scripts/events/handlers/quest.ts");
  assert.match(events, /playerSpawn[\s\S]*event\.initialSpawn[\s\S]*questSnapshotRuntime\.markAll\(event\.player, "player_join"\)/);

  const integration = read("scripts/features/quest/integrations/creeper-quest-events.ts");
  assert.match(integration, /finally \{[\s\S]*snapshotQueue\.mark\(player, "creeper_state", `creeper_success:\$\{event\}`\)/);

  const playerService = read("scripts/features/quest/services/quest-player.ts");
  assert.match(playerService, /creeperState: batch\.creeperState/);
});
