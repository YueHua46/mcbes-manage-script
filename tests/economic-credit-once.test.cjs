const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const filename = path.join(root, "scripts", "features", "economic", "services", "economic.ts");
let source = fs.readFileSync(filename, "utf8");

// Load only the service class. Runtime imports are replaced with the small fakes below,
// and the eager singleton is removed so its constructor cannot register world tasks.
source = source.replace(/^import[\s\S]*?;\r?\n/gm, "");
source = source.replace(/\r?\nconst economic = Economic\.getInstance\(\);[\s\S]*$/, "");
const output = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;

const moduleRecord = { exports: {} };
let profileLookup = (name) =>
  name === "Alice" || name === "Alicia"
    ? { id: "cmid_alice", currentName: "Alicia", knownNames: ["Alice", "Alicia"] }
    : undefined;
const context = {
  module: moduleRecord,
  exports: moduleRecord.exports,
  console: { ...console, warn() {} },
  identityService: {
    getProfileByName(name) {
      return profileLookup(name);
    },
  },
};
vm.runInNewContext(`(function (module, exports) { ${output}\n})(module, exports);`, context, { filename });
const { Economic, MONEY_SCOREBOARD_MAX } = moduleRecord.exports;

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function wallet(overrides = {}) {
  return {
    name: "Alice",
    identityId: "cmid_alice",
    gold: 100,
    dailyEarned: 20,
    lastResetDate: "2026-08-30",
    dailyLimitNotifyCount: 0,
    ...overrides,
  };
}

function createHarness(initialWallet, options = {}) {
  const service = Object.create(Economic.prototype);
  let cachedWallet = clone(initialWallet);
  let durableWallet = clone(initialWallet);
  let economyEnabled = options.economyEnabled ?? true;
  let nextSaveFailure = options.nextSaveFailure;
  let getWalletCount = 0;
  const logs = [];
  const db = {
    saveCount: 0,
    setCount: 0,
    set(_key, value) {
      this.setCount += 1;
      cachedWallet = clone(value);
    },
    save() {
      this.saveCount += 1;
      if (nextSaveFailure === "before_commit") {
        nextSaveFailure = undefined;
        throw new Error("simulated save failure before durable commit");
      }
      durableWallet = clone(cachedWallet);
      if (nextSaveFailure === "after_commit") {
        nextSaveFailure = undefined;
        throw new Error("simulated save failure after durable commit");
      }
    },
  };

  service.db = db;
  service.getWallet = () => {
    getWalletCount += 1;
    return cachedWallet;
  };
  service.resolveWalletKey = () => "cmid_alice";
  service.isEconomyEnabled = () => economyEnabled;
  service.syncDailyGoldLimitFromSetting = () => options.dailyLimit ?? 100;
  service.syncWalletToOnlinePlayer = () => {};
  service.logTransaction = (...args) => logs.push(args);

  return {
    service,
    db,
    logs,
    getWallet: () => cachedWallet,
    getDurableWallet: () => durableWallet,
    getWalletCount: () => getWalletCount,
    reload() {
      cachedWallet = clone(durableWallet);
    },
    failNextSaveAt(stage) {
      nextSaveFailure = stage;
    },
    setEconomyEnabled(value) {
      economyEnabled = value;
    },
  };
}

function input(overrides = {}) {
  return {
    playerName: "Alice",
    playerIdentityId: "cmid_alice",
    amount: 25,
    reason: "兑换码奖励",
    idempotencyKey: "redeem:v1:code_1:cmid_alice",
    ignoreDailyLimit: true,
    ...overrides,
  };
}

test("creditGoldOnce persists balance and receipt together, then replays without another log", () => {
  const harness = createHarness(wallet());

  assert.deepEqual(plain(harness.service.creditGoldOnce(input())), {
    status: "credited",
    amount: 25,
    balance: 125,
  });
  assert.equal(harness.db.saveCount, 1);
  assert.equal(harness.getWallet().gold, 125);
  assert.equal(harness.getDurableWallet().gold, 125);
  assert.equal(harness.getWallet().dailyEarned, 20);
  assert.deepEqual(plain(harness.getDurableWallet().appliedCredits["redeem:v1:code_1:cmid_alice"]), {
    amount: 25,
    appliedAt: harness.getDurableWallet().appliedCredits["redeem:v1:code_1:cmid_alice"].appliedAt,
    reason: "兑换码奖励",
  });
  assert.equal(harness.logs.length, 1);

  harness.reload();
  assert.deepEqual(plain(harness.service.creditGoldOnce(input({ reason: "重试不应重复日志" }))), {
    status: "already_credited",
    amount: 25,
    balance: 125,
  });
  assert.equal(harness.db.saveCount, 1);
  assert.equal(harness.logs.length, 1);
});

test("the same idempotency key with another amount conflicts without changing the wallet", () => {
  const harness = createHarness(
    wallet({
      appliedCredits: {
        "redeem:v1:code_1:cmid_alice": { amount: 25, appliedAt: 1, reason: "兑换码奖励" },
      },
    })
  );

  assert.deepEqual(plain(harness.service.creditGoldOnce(input({ amount: 30 }))), {
    status: "conflict",
    requestedAmount: 30,
    appliedAmount: 25,
    balance: 100,
  });
  assert.equal(harness.db.saveCount, 0);
  assert.equal(harness.logs.length, 0);
});

test("daily and scoreboard limits reject the whole credit, while bypass leaves daily earnings unchanged", () => {
  const dailyHarness = createHarness(wallet({ dailyEarned: 90 }), { dailyLimit: 100 });
  assert.deepEqual(plain(dailyHarness.service.creditGoldOnce(input({ amount: 11, ignoreDailyLimit: false }))), {
    status: "rejected",
    reason: "daily_limit_exceeded",
  });
  assert.equal(dailyHarness.getWallet().gold, 100);
  assert.equal(dailyHarness.db.saveCount, 0);

  assert.equal(dailyHarness.service.creditGoldOnce(input({ amount: 11 })).status, "credited");
  assert.equal(dailyHarness.getWallet().gold, 111);
  assert.equal(dailyHarness.getWallet().dailyEarned, 90);

  const capacityHarness = createHarness(wallet({ gold: MONEY_SCOREBOARD_MAX - 5 }));
  assert.deepEqual(plain(capacityHarness.service.creditGoldOnce(input({ amount: 6 }))), {
    status: "rejected",
    reason: "balance_limit_exceeded",
  });
  assert.equal(capacityHarness.getWallet().gold, MONEY_SCOREBOARD_MAX - 5);
  assert.equal(capacityHarness.db.saveCount, 0);
});

test("a save failure before durable commit restores the runtime snapshot and remains safely retryable", () => {
  const harness = createHarness(wallet(), { nextSaveFailure: "before_commit" });

  assert.deepEqual(plain(harness.service.creditGoldOnce(input())), {
    status: "retryable_error",
    reason: "wallet_save_failed",
  });
  assert.equal(harness.getWallet().gold, 100);
  assert.equal(harness.getWallet().appliedCredits, undefined);
  assert.equal(harness.getDurableWallet().gold, 100);
  assert.equal(harness.getDurableWallet().appliedCredits, undefined);
  assert.equal(harness.logs.length, 0);

  harness.reload();
  assert.equal(harness.service.creditGoldOnce(input()).status, "credited");
  assert.equal(harness.getWallet().gold, 125);
  assert.equal(harness.getDurableWallet().gold, 125);
  assert.equal(harness.logs.length, 1);
});

test("an ambiguous save failure never credits twice whether retried in memory or after reload", () => {
  const inMemory = createHarness(wallet(), { nextSaveFailure: "after_commit" });

  assert.deepEqual(plain(inMemory.service.creditGoldOnce(input())), {
    status: "retryable_error",
    reason: "wallet_save_failed",
  });
  assert.equal(inMemory.getWallet().gold, 100);
  assert.equal(inMemory.getDurableWallet().gold, 125);
  assert.equal(inMemory.service.creditGoldOnce(input()).status, "credited");
  assert.equal(inMemory.getWallet().gold, 125);
  assert.equal(inMemory.getDurableWallet().gold, 125);
  assert.equal(inMemory.logs.length, 1);

  const afterReload = createHarness(wallet(), { nextSaveFailure: "after_commit" });
  assert.equal(afterReload.service.creditGoldOnce(input()).status, "retryable_error");
  afterReload.reload();
  assert.equal(afterReload.service.creditGoldOnce(input()).status, "already_credited");
  assert.equal(afterReload.getWallet().gold, 125);
  assert.equal(afterReload.logs.length, 0);
});

test("identity mismatches are rejected before any wallet read or persistence side effect", () => {
  const wrongIdentity = createHarness(wallet());
  assert.deepEqual(plain(wrongIdentity.service.creditGoldOnce(input({ playerIdentityId: "cmid_other" }))), {
    status: "rejected",
    reason: "invalid_identity",
  });
  assert.equal(wrongIdentity.getWalletCount(), 0);
  assert.equal(wrongIdentity.db.setCount, 0);
  assert.equal(wrongIdentity.db.saveCount, 0);

  const unknownName = createHarness(wallet());
  assert.deepEqual(plain(unknownName.service.creditGoldOnce(input({ playerName: "Unknown" }))), {
    status: "rejected",
    reason: "invalid_identity",
  });
  assert.equal(unknownName.getWalletCount(), 0);
  assert.equal(unknownName.db.setCount, 0);
  assert.equal(unknownName.db.saveCount, 0);
});

test("the same stable identity can replay its receipt after a player rename", () => {
  const harness = createHarness(
    wallet({
      name: "Alicia",
      appliedCredits: {
        "redeem:v1:code_1:cmid_alice": { amount: 25, appliedAt: 1, reason: "兑换码奖励" },
      },
    })
  );

  assert.deepEqual(plain(harness.service.creditGoldOnce(input({ playerName: "Alicia" }))), {
    status: "already_credited",
    amount: 25,
    balance: 100,
  });
  assert.equal(harness.db.saveCount, 0);
});

test("malformed receipt data returns a closed retryable result without touching the wallet", () => {
  for (const appliedCredits of [
    null,
    { "redeem:v1:code_1:cmid_alice": null },
    { "redeem:v1:code_1:cmid_alice": { amount: "25", appliedAt: 1, reason: "兑换码奖励" } },
  ]) {
    const harness = createHarness(wallet({ appliedCredits }));
    assert.deepEqual(plain(harness.service.creditGoldOnce(input())), {
      status: "retryable_error",
      reason: "wallet_receipt_invalid",
    });
    assert.equal(harness.getWallet().gold, 100);
    assert.equal(harness.db.setCount, 0);
    assert.equal(harness.db.saveCount, 0);
  }
});

test("an existing receipt is observable after economy shutdown, but a new credit is rejected", () => {
  const harness = createHarness(
    wallet({
      appliedCredits: {
        "redeem:v1:code_1:cmid_alice": { amount: 25, appliedAt: 1, reason: "兑换码奖励" },
      },
    }),
    { economyEnabled: false }
  );

  assert.equal(harness.service.creditGoldOnce(input()).status, "already_credited");
  assert.deepEqual(plain(harness.service.creditGoldOnce(input({ idempotencyKey: "redeem:v1:code_2:cmid_alice" }))), {
    status: "rejected",
    reason: "economy_disabled",
  });
  assert.equal(harness.db.saveCount, 0);
  assert.equal(harness.logs.length, 0);
});
