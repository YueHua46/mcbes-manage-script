const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("player trading market replaces the old auction module and player-facing name", () => {
  const economyForm = read("scripts/ui/forms/economic/index.ts");
  const marketForm = read("scripts/ui/forms/economic/player-market-form.ts");
  const marketService = read("scripts/features/economic/services/player-market.ts");
  const economyService = read("scripts/features/economic/services/economic.ts");
  const serviceExports = read("scripts/features/economic/services/index.ts");

  assert.match(economyForm, /form\.button\("玩家交易市场", "textures\/icons\/menu_player_market"\)/);
  assert.match(marketForm, /class PlayerMarketForm/);
  assert.match(marketService, /class PlayerMarket/);
  assert.match(marketService, /economic\.transfer[\s\S]{0,120}PLAYER_MARKET_PURCHASE_REASON/);
  assert.match(economyService, /PLAYER_MARKET_PURCHASE_REASON = "购买玩家交易市场商品"/);
  assert.match(economyService, /reason\.includes\(PLAYER_MARKET_PURCHASE_REASON\)/);
  assert.match(serviceExports, /default as playerMarket.*"\.\/player-market"/);

  assert.doesNotMatch(economyForm + marketForm, /拍卖|竞拍/i);
  assert.equal(fs.existsSync(path.join(root, "scripts/ui/forms/economic/auction-house-form.ts")), false);
  assert.equal(fs.existsSync(path.join(root, "scripts/features/economic/services/auction-house.ts")), false);
  assert.equal(fs.existsSync(path.join(root, "resource_packs/CreeperMenu/textures/icons/menu_auction.png")), false);
  assert.equal(fs.existsSync(path.join(root, "resource_packs/CreeperMenu/textures/icons/menu_player_market.png")), true);
});

test("player trading market keeps the existing listing database during the rename", () => {
  const marketService = read("scripts/features/economic/services/player-market.ts");

  assert.match(marketService, /constructor\(dbName: string = "AuctionHouse2\.0"\)/);
  assert.match(marketService, /保留原数据库标识，确保升级后已有挂单可继续读取/);
});

test("spectator menu access is rejected before showing a server form", () => {
  const serverMenu = read("scripts/ui/forms/server/index.ts");
  const spectatorGuard = serverMenu.indexOf("player.getGameMode() === GameMode.Spectator");
  const firstShow = serverMenu.indexOf("form.show(player)");

  assert.ok(spectatorGuard >= 0, "missing spectator guard");
  assert.ok(firstShow > spectatorGuard, "spectator guard must run before form.show");
  assert.match(serverMenu, /旁观模式下暂时无法打开/);
});

test("busy form retries yield ticks and stop safely", () => {
  const formHook = read("scripts/shared/hooks/use-form.ts");
  const wait = formHook.indexOf("await system.waitTicks(retryIntervalTicks)");
  const show = formHook.indexOf("await form.show(player)");

  assert.match(formHook, /timeout = 200/);
  assert.match(formHook, /retryIntervalTicks = 5/);
  assert.ok(wait >= 0 && show > wait, "retry must yield before showing the form again");
  assert.match(formHook, /if \(!player\.isValid\) return undefined/);
  assert.match(formHook, /catch \{\s*return undefined;\s*\}/);
});
