const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("guild land officers manage routine settings while owner keeps destructive actions", () => {
  const guildService = read("scripts/features/guild/services/guild-service.ts");
  const landForm = read("scripts/ui/forms/land/index.ts");

  assert.match(guildService, /canOfficerManageGuildLand[\s\S]*role === "owner" \|\| role === "officer"/);
  assert.match(guildService, /canOwnerManageGuildLand[\s\S]*getMemberRole\(player\) === "owner"/);
  assert.match(landForm, /if \(canManageGuildLand\)[\s\S]*text: "领地公开权限"/);
  assert.match(landForm, /if \(canManageGuildLandDangerously\)[\s\S]*text: "解除公会归属"[\s\S]*text: "删除领地"/);
  assert.match(landForm, /只有本公会会长可以删除公会领地/);
});

test("guild land unbinding is owner-only and cannot overflow personal land quota", () => {
  const guildService = read("scripts/features/guild/services/guild-service.ts");

  assert.match(guildService, /unbindGuildLandByOwner/);
  assert.match(guildService, /if \(role !== "owner"\) return "只有会长可解除公会领地归属"/);
  assert.match(guildService, /getPlayerLandCount\(landRaw\.owner\) >= maxLandPerPlayer/);
});

test("land snapshots are restricted to server administrators", () => {
  const snapshotForm = read("scripts/ui/forms/land/snapshot.ts");
  const snapshotService = read("scripts/features/land/services/land-snapshot.ts");
  const landForm = read("scripts/ui/forms/land/index.ts");

  assert.match(snapshotForm, /function canManageLandSnapshots[\s\S]*if \(!isAdmin\(player\)\) return undefined/);
  assert.doesNotMatch(snapshotForm, /canOfficerManageGuildLand/);
  assert.match(snapshotForm, /if \(isAdmin\(player\)\) \{\s*form\.button\("切块上限设置"/);
  assert.match(snapshotForm, /if \(isAdmin\(player\) && selection === limitButtonIndex\)/);
  assert.match(landForm, /if \(playerIsAdmin\(player\)\) \{\s*buttons\.push\(\{\s*text: "领地快照"/);
  assert.match(snapshotService, /createSnapshot\(player:[\s\S]*if \(!isAdmin\(player\)\) return "只有管理员可以使用领地快照功能"/);
  assert.match(snapshotService, /restoreSnapshot\(player:[\s\S]*if \(!isAdmin\(player\)\) return "只有管理员可以使用领地快照功能"/);
  assert.match(snapshotService, /deleteSnapshot\(player:[\s\S]*if \(!isAdmin\(player\)\) return "只有管理员可以使用领地快照功能"/);
});
