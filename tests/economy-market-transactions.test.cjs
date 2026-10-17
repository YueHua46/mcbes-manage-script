const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function transpile(relativePath, transform = (s) => s) {
  const filename = path.join(root, relativePath);
  const source = transform(fs.readFileSync(filename, "utf8").replace(/^import[\s\S]*?;\r?\n/gm, ""));
  return {
    filename,
    code: ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText,
  };
}

// ---------------------------------------------------------------------------
// 经济：addGold / removeGold 保存失败时必须恢复缓存
// ---------------------------------------------------------------------------

function loadEconomic() {
  const { filename, code } = transpile("scripts/features/economic/services/economic.ts", (s) =>
    s.replace(/\r?\nconst economic = Economic\.getInstance\(\);[\s\S]*$/, "")
  );
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, console: { ...console, warn() {} } }, { filename });
  return module.exports.Economic;
}

function walletHarness(failSave) {
  const Economic = loadEconomic();
  const service = Object.create(Economic.prototype);
  let cached = { name: "Alice", gold: 100, dailyEarned: 0, lastResetDate: "x", dailyLimitNotifyCount: 0 };
  let durable = structuredClone(cached);
  service.db = {
    set(_key, value) {
      cached = structuredClone(value);
    },
    save() {
      if (failSave()) throw new Error("injected save failure");
      durable = structuredClone(cached);
    },
  };
  service.getWallet = () => cached;
  service.resolveWalletKey = () => "alice";
  service.isEconomyEnabled = () => true;
  service.syncDailyGoldLimitFromSetting = () => 1000;
  service.syncWalletToOnlinePlayer = () => {};
  service.logTransaction = () => {};
  return { service, cached: () => cached, durable: () => durable };
}

test("removeGold restores the cached wallet and reports failure when the save fails", () => {
  const h = walletHarness(() => true);
  assert.equal(h.service.removeGold("Alice", 30, "购买"), false);
  assert.equal(h.cached().gold, 100, "a later autosave must not persist the failed deduction");
  assert.equal(h.durable().gold, 100);
});

test("addGold restores the cached wallet and reports 0 when the save fails", () => {
  const h = walletHarness(() => true);
  assert.equal(h.service.addGold("Alice", 30, "退款", true), 0);
  assert.equal(h.cached().gold, 100);
  assert.equal(h.cached().dailyEarned, 0);
});

test("removeGold and addGold still work normally", () => {
  const h = walletHarness(() => false);
  assert.equal(h.service.removeGold("Alice", 30, "购买"), true);
  assert.equal(h.service.addGold("Alice", 10, "退款", true), 10);
  assert.equal(h.durable().gold, 80);
});

// ---------------------------------------------------------------------------
// 玩家市场：取货必须先放进背包再提交删除，失败时两边都不变
// ---------------------------------------------------------------------------

function stack(typeId, amount = 1) {
  return {
    typeId,
    amount,
    maxAmount: 64,
    clone() {
      return stack(this.typeId, this.amount);
    },
    isStackableWith(other) {
      return other.typeId === this.typeId;
    },
    getLore() {
      return [];
    },
  };
}

function container(size = 4) {
  return {
    size,
    slots: new Array(size).fill(undefined),
    failAdd: false,
    getItem(i) {
      return this.slots[i]?.clone();
    },
    setItem(i, item) {
      this.slots[i] = item ? item.clone() : undefined;
    },
    get emptySlotsCount() {
      return this.slots.filter((s) => !s).length;
    },
    addItem(item) {
      if (this.failAdd) throw new Error("injected add failure");
      const i = this.slots.findIndex((s) => !s);
      if (i < 0) return item;
      this.slots[i] = item.clone();
      return undefined;
    },
  };
}

function loadMarket({ transferResults = [], failDialogTitle, failAdd = false } = {}) {
  const dialogs = [];
  const errors = [];
  const transfers = [];
  const listings = [];
  const { filename, code } = transpile("scripts/features/economic/services/player-market.ts");
  const module = { exports: {} };
  vm.runInNewContext(
    code,
    {
      module,
      exports: module.exports,
      ItemDatabase: class {
        add(item, data) {
          if (failAdd) throw new Error("injected commit failure");
          listings.push({ item, data });
          return "id";
        }
      },
      economic: {
        hasEnoughGold: () => true,
        transfer: (...args) => {
          transfers.push(args);
          return transferResults.length ? transferResults.shift() : true;
        },
      },
      PLAYER_MARKET_PURCHASE_REASON: "购买玩家交易市场商品",
      openDialogForm: (_player, dialog, cb) => {
        dialogs.push(dialog);
        if (failDialogTitle && dialog.title === failDialogTitle) throw new Error("injected dialog failure");
      },
      color: { red: (s) => s },
      colorCodes: {},
      isAdmin: () => true,
      SystemLog: { error: (...a) => errors.push(a.join(" ")) },
      usePlayerByName: () => undefined,
      recordCreeperQuestSuccess: () => {},
    },
    { filename }
  );
  return { market: module.exports.default, dialogs, errors, transfers, listings };
}

function marketEntry({ failRemove = false } = {}) {
  const stored = stack("minecraft:red_shulker_box", 1);
  const calls = [];
  let present = true;
  return {
    calls,
    get present() {
      return present;
    },
    entry: {
      item: stored.clone(),
      data: { name: "box", playerName: "seller", price: 10, amount: 1, createdAt: 1 },
      itemDB: {
        isValid: () => present,
        unStore(keep) {
          calls.push(keep ? "read" : "remove");
          if (!keep) {
            if (failRemove) throw new Error("injected commit failure");
            present = false;
          }
          return stored.clone();
        },
        replaceItem() {
          calls.push("replace");
        },
        editData() {
          calls.push("edit");
        },
      },
    },
  };
}

test("unlisting with a failing delivery leaves both the listing and the inventory unchanged", async () => {
  const { market } = loadMarket();
  const box = marketEntry();
  const inv = container();
  inv.failAdd = true;
  const player = { name: "seller", getComponent: () => ({ container: inv }) };

  const result = await market.unlistItem(player, box.entry);
  assert.match(String(result), /下架失败/);
  assert.equal(box.present, true, "the listing must not be removed before delivery succeeds");
  assert.deepEqual(box.calls, ["read"]);
});

test("a failed removal commit rolls back the delivered items (no duplication)", async () => {
  const { market } = loadMarket();
  const box = marketEntry({ failRemove: true });
  const inv = container();
  const admin = { name: "admin", getComponent: () => ({ container: inv }) };

  const result = await market.adminConfiscateItem(admin, box.entry);
  assert.match(String(result), /没收失败/);
  assert.equal(inv.slots.filter(Boolean).length, 0, "delivered items are taken back");
  assert.equal(box.present, true);
});

test("a failed refund is reported instead of silently swallowed", async () => {
  const { market, dialogs, errors } = loadMarket({ transferResults: [true, "转账失败，请稍后重试"] });
  const box = marketEntry({ failRemove: true });
  const inv = container();
  const buyer = { name: "buyer", getComponent: () => ({ container: inv }) };

  await market.buyItem(buyer, box.entry, 1);
  assert.equal(inv.slots.filter(Boolean).length, 0);
  assert.match(String(dialogs.at(-1).desc), /退款失败/);
  assert.equal(errors.length, 1);
});

test("a successful purchase delivers the item actually stored in the entity", async () => {
  const { market, dialogs } = loadMarket();
  const box = marketEntry();
  const inv = container();
  const buyer = { name: "buyer", getComponent: () => ({ container: inv }) };

  await market.buyItem(buyer, box.entry, 1);
  assert.equal(dialogs.at(-1).title, "购买成功");
  assert.equal(inv.slots[0].typeId, "minecraft:red_shulker_box");
  assert.deepEqual(box.calls, ["read", "remove"]);
});

test("confiscation whose delivery fails keeps the listing (the item is never lost)", async () => {
  const { market } = loadMarket();
  const box = marketEntry();
  const inv = container();
  inv.failAdd = true;
  const admin = { name: "admin", getComponent: () => ({ container: inv }) };

  const result = await market.adminConfiscateItem(admin, box.entry);
  assert.match(String(result), /没收失败/);
  assert.equal(box.present, true, "the listing must not be removed before delivery succeeds");
});

// ---- v4 审查回归用例 ----

function playerWith(slotItem) {
  const inv = container();
  inv.slots[0] = slotItem;
  return { inv, player: { name: "seller", getComponent: () => ({ container: inv }) } };
}

test("listing: if taking the item from the player fails, no listing is committed", async () => {
  const { market, listings } = loadMarket();
  const { inv, player } = playerWith(stack("minecraft:diamond", 5));
  inv.setItem = () => {
    throw new Error("injected inventory failure");
  };
  const result = await market.listItem(player, 0, 10, 5, "diamond");
  assert.match(String(result), /上架失败/);
  assert.equal(listings.length, 0);
});

test("listing: if committing the listing fails, the player's item is put back", async () => {
  const { market, listings } = loadMarket({ failAdd: true });
  const { inv, player } = playerWith(stack("minecraft:diamond", 5));
  const result = await market.listItem(player, 0, 10, 3, "diamond");
  assert.match(String(result), /上架失败/);
  assert.equal(listings.length, 0);
  assert.equal(inv.slots[0].amount, 5);
});

test("listing: a notification failure after the commit keeps the listing and the deduction", async () => {
  const { market, listings } = loadMarket({ failDialogTitle: "上架成功" });
  const { inv, player } = playerWith(stack("minecraft:diamond", 5));
  await market.listItem(player, 0, 10, 3, "diamond").catch(() => {});
  assert.equal(listings.length, 1);
  assert.equal(inv.slots[0].amount, 2);
});

test("buying: a notification failure after the commit does not undo the purchase", async () => {
  const { market, transfers } = loadMarket({ failDialogTitle: "购买成功" });
  const box = marketEntry();
  const inv = container();
  const buyer = { name: "buyer", getComponent: () => ({ container: inv }) };

  await market.buyItem(buyer, box.entry, 1).catch(() => {});
  assert.equal(box.present, false, "the listing was sold");
  assert.equal(inv.slots.filter(Boolean).length, 1, "the buyer keeps the item");
  assert.equal(transfers.length, 1, "no refund for a completed purchase");
});
