const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("death debt has an independent switch that defaults to disabled", () => {
  const settings = read("scripts/features/system/services/setting.ts");
  const command = read("scripts/features/command/services/command.ts");
  const systemForm = read("scripts/ui/forms/system/index.ts");

  assert.match(settings, /\| "deathGoldPenaltyAllowNegativeBalance"/);
  assert.match(settings, /deathGoldPenaltyAllowNegativeBalance: false/);
  assert.match(command, /deathGoldPenaltyAllowNegativeBalance:\s*"死亡扣金币允许负余额开关/);
  assert.match(systemForm, /死亡后允许金币扣成负数/);
});

test("only death penalties opt into negative wallet balances", () => {
  const economy = read("scripts/features/economic/services/economic.ts");
  const playerHandler = read("scripts/events/handlers/player.ts");

  assert.match(economy, /removeGold\([\s\S]*allowNegativeBalance: boolean = false/);
  assert.match(economy, /const minimumGold = canUseNegativeBalance \? MONEY_SCOREBOARD_MIN : 0/);
  assert.match(economy, /const deductedAmount = Math\.min\(amount, wallet\.gold - minimumGold\)/);
  assert.match(
    playerHandler,
    /const allowNegativeBalance =\s*setting\.getState\("deathGoldPenaltyAllowNegativeBalance"\) === true/
  );
  assert.match(
    playerHandler,
    /economic\.removeGold\(player\.name, configuredAmount, "死亡金币惩罚", allowNegativeBalance\)/
  );
  assert.doesNotMatch(playerHandler, /Math\.min\(configuredAmount, wallet\.gold\)/);
});

test("negative death balances survive validation and scoreboard synchronization only while enabled", () => {
  const economy = read("scripts/features/economic/services/economic.ts");

  assert.match(economy, /MONEY_SCOREBOARD_MIN = -2_147_483_648/);
  assert.match(economy, /private getMinimumGold\(\): number/);
  assert.match(economy, /deathGoldPenaltyAllowNegativeBalance/);
  assert.match(economy, /Math\.max\(this\.getMinimumGold\(\), Math\.min\(MONEY_SCOREBOARD_MAX/);
  assert.match(economy, /if \(wallet\.gold < this\.getMinimumGold\(\)\)/);
});
