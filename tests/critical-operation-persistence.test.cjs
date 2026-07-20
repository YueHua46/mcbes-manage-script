const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("land create update and delete operations flush immediately", () => {
  const source = read("scripts/features/land/services/land-manager.ts");

  assert.match(source, /private saveLand\(name: string, land: ILand\): void \{\s*this\.db\.set\(name, land\);\s*this\.db\.save\(\);\s*\}/);
  assert.match(source, /private deleteLand\(name: string\): boolean \{\s*const deleted = this\.db\.delete\(name\);\s*if \(deleted\) this\.db\.save\(\);\s*return deleted;\s*\}/);
  assert.equal((source.match(/this\.saveLand\(landData\.name, landData\)/g) ?? []).length, 2);
  assert.match(source, /removeLand\([\s\S]*return this\.deleteLand\(name\)/);
  assert.match(source, /setLand\([\s\S]*return this\.saveLand\(name, land\)/);
});

test("waypoint create update and delete operations flush immediately", () => {
  const source = read("scripts/features/waypoint/services/waypoint.ts");

  assert.match(source, /private savePoint\(key: string, point: IWayPoint\): void \{\s*this\.db\.set\(key, point\);\s*this\.db\.save\(\);\s*\}/);
  assert.match(source, /private deletePointRecord\(key: string\): boolean \{\s*const deleted = this\.db\.delete\(key\);\s*if \(deleted\) this\.db\.save\(\);\s*return deleted;\s*\}/);
  assert.match(source, /createPoint\([\s\S]*return this\.savePoint\(key, wayPoint\)/);
  assert.match(source, /createGuildPointAtLocation\([\s\S]*return this\.savePoint\(key, wp\)/);
  assert.match(source, /deletePoint\([\s\S]*return this\.deletePointRecord\(key\)/);
});

test("guild records and membership indexes flush at transaction boundaries", () => {
  const source = read("scripts/features/guild/services/guild-service.ts");

  assert.match(source, /private saveGuild\(g: IGuild\): void \{[\s\S]*this\.guildsDb\.set\(g\.id, g\);\s*this\.guildsDb\.save\(\);\s*\}/);
  assert.match(source, /private setPlayerIndex\([\s\S]*this\.indexDb\.save\(\);\s*\}/);
  assert.match(source, /private deletePlayerIndex\([\s\S]*this\.indexDb\.save\(\);\s*\}/);
  assert.match(source, /this\.guildsDb\.delete\(g\.id\);\s*this\.guildsDb\.save\(\);/);
  assert.match(source, /this\.saveGuild\(g\);\s*this\.setPlayerIndex\(player\.name, id\);/);
  assert.match(source, /private rollbackGuildCreation\(guildId: string, playerName: string\): void \{[\s\S]*this\.guildsDb\.delete\(guildId\);[\s\S]*this\.guildsDb\.save\(\);[\s\S]*this\.deletePlayerIndex\(playerName\);[\s\S]*\}/);
  assert.match(source, /catch \(e\) \{\s*this\.rollbackGuildCreation\(id, player\.name\);/);
});

test("wallet balances and transaction records flush immediately", () => {
  const source = read("scripts/features/economic/services/economic.ts");

  assert.match(source, /private saveWallet\(key: string, wallet: IUserWallet\): void \{\s*this\.db\.set\(key, wallet\);\s*this\.db\.save\(\);\s*\}/);
  assert.match(source, /addGold\([\s\S]*this\.saveWallet\(this\.resolveWalletKey\(playerName\), wallet\);/);
  assert.match(source, /removeGold\([\s\S]*this\.saveWallet\(this\.resolveWalletKey\(playerName\), wallet\);/);
  assert.match(source, /this\.db\.set\(toKey, toWallet\);\s*this\.db\.save\(\);/);
  assert.match(source, /const fromGoldBefore = fromWallet\.gold;\s*const toGoldBefore = toWallet\.gold;/);
  assert.match(source, /fromWallet\.gold = fromGoldBefore;\s*toWallet\.gold = toGoldBefore;\s*try \{\s*this\.db\.set\(fromKey, fromWallet\);\s*this\.db\.set\(toKey, toWallet\);/);
  assert.match(source, /this\.logDb\.set\("transactions", logs\);\s*this\.logDb\.save\(\);/);
  assert.match(source, /setPlayerGold\([\s\S]*this\.saveWallet\(this\.resolveWalletKey\(playerName\), wallet\);/);
});

test("security configuration shop and identity changes flush immediately", () => {
  const blacklist = read("scripts/features/blacklist/services/blacklist.ts");
  const settings = read("scripts/features/system/services/setting.ts");
  const identity = read("scripts/features/player/services/identity-service.ts");
  const shop = read("scripts/features/economic/services/office-shop.ts");
  const prices = read("scripts/features/economic/services/item-price-database.ts");

  assert.match(blacklist, /private saveEntry\([\s\S]*this\.db\.set\(key, entry\);\s*this\.db\.save\(\);/);
  assert.match(blacklist, /this\.db\.delete\(xuid\);\s*this\.db\.save\(\);/);
  assert.match(settings, /this\.db\.set\(module, state\);\s*this\.db\.save\(\);/);
  assert.match(identity, /this\.profilesDb\.save\(\);\s*this\.nameIndexDb\.save\(\);/);
  assert.match(shop, /private saveCategory\([\s\S]*this\.db\.save\(\);/);
  assert.match(prices, /setPrice\([\s\S]*this\.db\.save\(\);/);
  assert.match(prices, /removePrice\([\s\S]*this\.db\.save\(\);/);
});

test("red packets and guild invitations flush immediately", () => {
  const packets = read("scripts/features/economic/services/red-packet.ts");
  const guild = read("scripts/features/guild/services/guild-service.ts");

  assert.match(packets, /private savePacket\(db: Database<IRedPacket>, id: string, packet: IRedPacket\): void \{\s*db\.set\(id, packet\);\s*db\.save\(\);\s*\}/);
  assert.equal((packets.match(/this\.savePacket\(db, packetId, packet\)/g) ?? []).length, 4);
  assert.match(packets, /this\.savePacket\(db, id, packet\)/);
  assert.match(guild, /private saveInvite\([\s\S]*this\.invitesDb\.save\(\);/);
  assert.match(guild, /private deleteInvite\([\s\S]*if \(deleted\) this\.invitesDb\.save\(\);/);
});

test("messages notifications and membership changes flush immediately", () => {
  const messages = read("scripts/features/other/services/leave-message.ts");
  const notify = read("scripts/features/notify/services/notify.ts");
  const trial = read("scripts/features/system/services/trial-mode.ts");

  assert.match(messages, /private saveMessage\([\s\S]*this\.db\.save\(\);/);
  assert.match(messages, /private deleteMessage\([\s\S]*if \(deleted\) this\.db\.save\(\);/);
  assert.match(notify, /private saveNotify\([\s\S]*this\.db\.save\(\);/);
  assert.match(notify, /this\.db\.delete\(id\);\s*this\.db\.save\(\);/);
  assert.match(trial, /this\.db\.set\(playerName, true\);\s*this\.db\.save\(\);/);
  assert.match(trial, /this\.db\.delete\(playerName\);\s*this\.db\.save\(\);/);
});
