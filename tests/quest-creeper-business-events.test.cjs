const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assertOrdered(source, markers, label) {
  let cursor = -1;
  for (const marker of markers) {
    const next = source.indexOf(marker, cursor + 1);
    assert.ok(next > cursor, `${label}: missing or out of order: ${marker}`);
    cursor = next;
  }
}

function functionSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, endMarker);
  return source.slice(start, end);
}

test("the integration helper owns the exact nine stable CreeperMenu event keys", () => {
  const source = read("scripts/features/quest/integrations/creeper-quest-events.ts");
  const expected = [
    "creeper.menu.open",
    "creeper.waypoint.create",
    "creeper.tpa.complete",
    "creeper.random_tp.complete",
    "creeper.land.create",
    "creeper.public_waypoint.use",
    "creeper.market.trade",
    "creeper.red_packet",
    "creeper.guild.join_or_create",
  ];
  for (const eventKey of expected) assert.match(source, new RegExp(`"${eventKey.replaceAll(".", "\\.")}"`));
  assert.equal((source.match(/creeper\.[a-z_.]+"/g) ?? []).length, 9);
  assert.match(source, /source: "creeper_menu\.business_success"/);
  assert.match(source, /try \{[\s\S]*questPlayerService\.recordEvent[\s\S]*\} catch \(error\)/);
});

test("menu-open records only after a form response proves the screen was shown", () => {
  const source = read("scripts/ui/forms/server/index.ts");
  const normal = functionSlice(source, "const data = await form.show(player);", "} catch {");
  assertOrdered(
    normal,
    ["const data = await form.show(player);", 'recordCreeperQuestSuccess(player, "menuOpen")'],
    "menu"
  );
  assertOrdered(
    normal,
    [
      "const forceForm = await useForceOpen(player, form);",
      "if (forceForm)",
      'recordCreeperQuestSuccess(player, "menuOpen")',
    ],
    "forced menu"
  );
});

test("waypoint events occur after persistence or a successful public-point teleport", () => {
  const source = read("scripts/features/waypoint/services/waypoint.ts");
  const create = functionSlice(source, "createPoint(pointOption", "getPoint(pointName");
  assertOrdered(
    create,
    ["const saveError = this.savePoint", 'recordCreeperQuestSuccess(player, "waypointCreate",'],
    "waypoint create"
  );
  assert.match(create, /if \(type === "private"\)/);

  const teleport = functionSlice(source, "teleport(player: Player", "private readonly particleType");
  assertOrdered(
    teleport,
    [
      'chargeTeleportCost(player, "waypointTeleportCost"',
      "player.teleport(targetLocation",
      'if (wayPoint.type === "public")',
      'recordCreeperQuestSuccess(player, "publicWaypointUse",',
    ],
    "public waypoint teleport"
  );
});

test("TPA and random teleport events occur inside their successful teleport branches", () => {
  const tpa = read("scripts/features/player/services/tpa-logic.ts");
  const tpaTry = functionSlice(tpa, "try {", "} catch {");
  assert.ok(tpaTry.includes("requestPlayer.teleport") && tpaTry.includes("targetPlayer.teleport"));
  assert.ok(
    tpaTry.lastIndexOf('recordCreeperQuestSuccess(requestPlayer, "tpaComplete",') > tpaTry.indexOf(".teleport(")
  );

  const random = read("scripts/features/other/services/random-tp.ts");
  const randomSuccess = functionSlice(random, "player.teleport(result.target", "} catch {");
  assertOrdered(
    randomSuccess,
    [
      "player.teleport(result.target",
      "applyRandomTeleportBuffs(player)",
      'recordCreeperQuestSuccess(player, "randomTeleportComplete",',
    ],
    "random teleport"
  );
});

test("land, market and red-packet events are downstream of committed money/data operations", () => {
  const land = read("scripts/features/land/services/land-manager.ts");
  const landCreate = functionSlice(land, "async createLand(landData", "  confirmAndCreateLandAsync(");
  assert.equal((landCreate.match(/recordCreeperQuestSuccess\(player, "landCreate"/g) ?? []).length, 2);
  for (const eventIndex of [...landCreate.matchAll(/recordCreeperQuestSuccess\(player, "landCreate"/g)].map(
    (m) => m.index
  )) {
    assert.ok(landCreate.lastIndexOf("this.saveLand(landData.name", eventIndex) < eventIndex);
  }

  const market = read("scripts/features/economic/services/player-market.ts");
  const purchase = functionSlice(market, "async buyItem(", "/**\n   * 检查条目是否有效");
  assertOrdered(
    purchase,
    ["economic.transfer(", "this.addItemStacksToContainer", 'recordCreeperQuestSuccess(player, "marketTrade",'],
    "market purchase"
  );

  const redPacket = read("scripts/features/economic/services/red-packet.ts");
  const create = functionSlice(redPacket, "createPacket(sender", "private broadcastNewPacket");
  assertOrdered(
    create,
    ["this.savePacket(db, id, packet)", 'recordCreeperQuestSuccess(sender, "redPacket",'],
    "red packet send"
  );
  const claim = functionSlice(redPacket, "claim(player: Player", "processExpiredPackets()");
  assert.equal((claim.match(/recordCreeperQuestSuccess\(player, "redPacket"/g) ?? []).length, 2);
  for (const eventIndex of [...claim.matchAll(/recordCreeperQuestSuccess\(player, "redPacket"/g)].map((m) => m.index)) {
    assert.ok(claim.lastIndexOf("economic.addGold(player.name", eventIndex) < eventIndex);
  }
});

test("guild create, invite acceptance and online application approval emit after membership persistence", () => {
  const source = read("scripts/features/guild/services/guild-service.ts");
  const create = functionSlice(source, "createGuild(player", "/** 删除公会数据");
  assertOrdered(
    create,
    [
      "this.saveGuild(g)",
      "this.setPlayerIndex(player.name, id)",
      'recordCreeperQuestSuccess(player, "guildJoinOrCreate",',
    ],
    "guild create"
  );
  const accept = functionSlice(source, "acceptInvite(player", "private clearAllInvitesForPlayer");
  assertOrdered(
    accept,
    [
      "this.saveGuild(g)",
      "this.setPlayerIndex(player.name, g.id)",
      'recordCreeperQuestSuccess(player, "guildJoinOrCreate",',
    ],
    "guild invite acceptance"
  );
  const approve = functionSlice(source, "approveJoinRequest(actor", "rejectJoinRequest(actor");
  assertOrdered(
    approve,
    [
      "this.saveGuild(g)",
      "this.setPlayerIndex(aname, g.id)",
      "if (ap)",
      'recordCreeperQuestSuccess(ap, "guildJoinOrCreate",',
    ],
    "guild application approval"
  );
});
