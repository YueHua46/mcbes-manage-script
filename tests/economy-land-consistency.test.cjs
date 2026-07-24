const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("economy-disabled player surfaces hide money and optional costs become free", () => {
  const hud = read("scripts/features/system/services/player-hud.ts");
  const teleportCost = read("scripts/features/economic/services/teleport-cost.ts");
  const fakePlayer = read("scripts/features/fake-player/services/fake-player.ts");
  const floatingText = read("scripts/features/floating-text/services/floating-text.ts");
  const stats = read("scripts/ui/forms/stats/index.ts");
  const pvp = read("scripts/ui/forms/pvp/index.ts");
  const quest = read("scripts/features/quest/services/quest-player.ts");

  assert.match(hud, /const economyEnabled = setting\.getState\("economy"\) === true/);
  assert.match(hud, /if \(economyEnabled\)[\s\S]*segments\.unshift/);
  assert.match(teleportCost, /if \(setting\.getState\("economy"\) !== true\) return 0/);
  assert.equal((fakePlayer.match(/if \(setting\.getState\("economy"\) !== true\) return 0/g) ?? []).length, 2);
  assert.match(floatingText, /if \(setting\.getState\("economy"\) !== true\) return 0/);
  assert.match(stats, /经济系统已关闭，财富排行榜暂不显示/);
  assert.match(pvp, /if \(economyEnabled\) form\.button\("夺取金币排行榜"/);
  assert.match(quest, /经济系统已关闭，本次任务金币奖励不发放/);
});

test("land selection always tells players how to cancel", () => {
  const landHandler = read("scripts/events/handlers/land.ts");

  assert.match(landHandler, /取消：潜行手持木棍长按空气/);
  assert.match(landHandler, /取消圈地：潜行并手持木棍长按空气（不要对着方块）/);
});

test("admins can disable land teleport for regular players without deleting teleport points", () => {
  const settings = read("scripts/features/system/services/setting.ts");
  const systemForm = read("scripts/ui/forms/system/index.ts");
  const landManager = read("scripts/features/land/services/land-manager.ts");
  const landForm = read("scripts/ui/forms/land/index.ts");

  assert.match(settings, /landTeleportEnabled: true/);
  assert.doesNotMatch(settings, /landTeleportEffectMode/);
  assert.match(systemForm, /允许普通玩家使用领地传送/);
  assert.match(systemForm, /setting\.setState\("landTeleportEnabled", enabled\)/);
  assert.match(
    landManager,
    /setting\.getState\("landTeleportEnabled"\) !== true && !isAdmin\(player\)/
  );
  assert.match(landForm, /function canUseLandTeleport\(player: Player\)/);
  assert.match(landForm, /landData\.teleportPoint && canAccess && canUseLandTeleport\(player\)/);
  assert.doesNotMatch(systemForm, /完整效果|简洁倒计时|立即传送/);
});
