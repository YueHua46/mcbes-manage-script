const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "scripts/features/economic/services/economic.ts"), "utf8");

test("money scoreboard bridge exposes the documented vanilla objective", () => {
  assert.match(source, /MONEY_SCOREBOARD_OBJECTIVE = "yuehua_money"/);
  assert.match(source, /MONEY_SCOREBOARD_MAX = 2_147_483_647/);
  assert.match(source, /addObjective\(MONEY_SCOREBOARD_OBJECTIVE, "金币"\)/);
  assert.match(source, /id: "economy\.moneyScoreboardBridge"[\s\S]*intervalTicks: 1/);
});

test("wallet writes immediately update the online player's score", () => {
  assert.match(
    source,
    /private saveWallet[\s\S]*this\.db\.save\(\);\s*this\.syncWalletToOnlinePlayer\(wallet\.name, wallet\.gold\)/
  );
  assert.match(source, /this\.syncWalletToOnlinePlayer\(fromPlayer, fromWallet\.gold\)/);
  assert.match(source, /this\.syncWalletToOnlinePlayer\(toPlayer, toWallet\.gold\)/);
});

test("external scoreboard changes are imported and audited", () => {
  assert.match(source, /if \(observedScore !== lastSyncedScore\) \{\s*this\.importScoreboardGold/);
  assert.match(source, /wallet\.gold = nextGold;[\s\S]*this\.db\.save\(\)/);
  assert.match(source, /MONEY_SCOREBOARD_ADJUST_REASON = "原版计分板调整"/);
  assert.match(source, /Math\.max\(this\.getMinimumGold\(\), Math\.min\(MONEY_SCOREBOARD_MAX/);
  assert.match(source, /deathGoldPenaltyAllowNegativeBalance/);
});

test("wallet values are kept within the vanilla scoreboard integer range", () => {
  assert.match(source, /if \(wallet\.gold > MONEY_SCOREBOARD_MAX\) \{/);
  assert.match(source, /wallet\.gold = MONEY_SCOREBOARD_MAX/);
  assert.match(source, /if \(toWallet\.gold > MONEY_SCOREBOARD_MAX - amount\) return "收款方余额将超过金币上限"/);
  assert.match(source, /if \(amount > MONEY_SCOREBOARD_MAX\)[\s\S]*金币数量超过计分板整数上限/);
});

test("missing scores recover from the wallet instead of erasing it", () => {
  assert.match(
    source,
    /if \(lastSyncedScore === undefined \|\| observedScore === undefined\) \{\s*objective\.setScore\(player, walletScore\)/
  );
  assert.doesNotMatch(source, /observedScore === undefined[\s\S]{0,120}wallet\.gold\s*=\s*0/);
});
