const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { build, buildSync } = require("esbuild");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creeper-redemption-code-"));
const domainBundle = path.join(tempRoot, "redemption-domain.cjs");
const runtimeEntry = path.join(tempRoot, "runtime-entry.ts");
const runtimeBundle = path.join(tempRoot, "redemption-runtime.cjs");

buildSync({
  entryPoints: [path.join(root, "scripts", "features", "economic", "services", "redemption-code-domain.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  outfile: domainBundle,
  logLevel: "silent",
});

const serviceFile = path.join(root, "scripts", "features", "economic", "services", "redemption-code.ts");
fs.writeFileSync(
  runtimeEntry,
  [
    `export { default as service } from ${JSON.stringify(serviceFile)};`,
    `export { resetDatabase, seedRecord, getRawRecord, failNextSave, getSaveCount } from "redemption-db-test";`,
    `export { setEconomyEnabled } from "redemption-setting-test";`,
    `export { resetEconomic, setWallet, getWalletGold, getCreditCallCount, setNextCreditResult, setCreditHook, seedReceipt } from "redemption-economic-test";`,
  ].join("\n")
);

const runtimeDoubles = {
  name: "redemption-code-runtime-doubles",
  setup(build) {
    build.onResolve({ filter: /^@minecraft\/server$/ }, () => ({
      path: "minecraft",
      namespace: "redemption-test",
    }));
    build.onResolve({ filter: /(?:shared\/database\/database|redemption-db-test)$/ }, () => ({
      path: "database",
      namespace: "redemption-test",
    }));
    build.onResolve({ filter: /(?:shared\/utils\/common|redemption-common-test)$/ }, () => ({
      path: "common",
      namespace: "redemption-test",
    }));
    build.onResolve({ filter: /identity-service(?:-test)?$/ }, () => ({
      path: "identity",
      namespace: "redemption-test",
    }));
    build.onResolve({ filter: /(?:system\/services\/setting|redemption-setting-test)$/ }, () => ({
      path: "setting",
      namespace: "redemption-test",
    }));
    build.onResolve({ filter: /(?:^redemption-economic-test$|(?:^|\/)economic$)/ }, () => ({
      path: "economic",
      namespace: "redemption-test",
    }));

    build.onLoad({ filter: /.*/, namespace: "redemption-test" }, (args) => {
      if (args.path === "minecraft") {
        return {
          loader: "ts",
          contents: `
            export class Player {}
            export const system = {
              currentTick: 73,
              run(callback: () => void) { callback(); },
              runInterval() { return 1; },
              clearRun() {},
            };
          `,
        };
      }
      if (args.path === "database") {
        return {
          loader: "ts",
          contents: `
            const stores: Record<string, Record<string, any>> = {};
            let saves = 0;
            let pendingFailures = 0;
            function store(name: string): Record<string, any> {
              return (stores[name] ??= {});
            }
            export class Database<V = any> {
              constructor(readonly name: string) { store(name); }
              set(key: string, value: V): void { store(this.name)[key] = value; }
              get(key: string): V | undefined { return store(this.name)[key]; }
              has(key: string): boolean { return Object.prototype.hasOwnProperty.call(store(this.name), key); }
              delete(key: string): boolean { return delete store(this.name)[key]; }
              keys(): string[] { return Object.keys(store(this.name)); }
              values(): V[] { return Object.values(store(this.name)); }
              getAll(): Record<string, V> { return store(this.name); }
              save(): void {
                saves += 1;
                if (pendingFailures > 0) {
                  pendingFailures -= 1;
                  throw new Error("injected save failure");
                }
              }
            }
            export function resetDatabase(): void {
              for (const value of Object.values(stores)) {
                for (const key of Object.keys(value)) delete value[key];
              }
              saves = 0;
              pendingFailures = 0;
            }
            export function seedRecord(record: any): void {
              store("eco_redemption_codes")[record.id] = JSON.parse(JSON.stringify(record));
            }
            export function getRawRecord(id: string): any {
              return store("eco_redemption_codes")[id];
            }
            export function failNextSave(count = 1): void { pendingFailures += count; }
            export function getSaveCount(): number { return saves; }
          `,
        };
      }
      if (args.path === "common") {
        return {
          loader: "ts",
          contents: `
            export const isAdmin = (player: any) => player?.admin === true;
            export class SystemLog {
              static info() {}
              static warn() {}
              static error() {}
              static debug() {}
            }
          `,
        };
      }
      if (args.path === "identity") {
        return {
          loader: "ts",
          contents: `
            const names = new Map<string, string>();
            const identity = {
              resolvePlayerKeyForPlayer(player: any): string {
                if (!player?.cmid) throw new Error("missing cmid");
                names.set(player.cmid, player.name);
                return player.cmid;
              },
              getProfileById(cmid: string) {
                const currentName = names.get(cmid);
                return currentName ? { id: cmid, currentName } : undefined;
              },
              getDisplayName(cmid: string): string { return names.get(cmid) ?? cmid; },
            };
            export default identity;
          `,
        };
      }
      if (args.path === "setting") {
        return {
          loader: "ts",
          contents: `
            let enabled = true;
            export function setEconomyEnabled(value: boolean): void { enabled = value; }
            export default { getState(key: string) { return key === "economy" ? enabled : undefined; } };
          `,
        };
      }
      if (args.path === "economic") {
        return {
          loader: "ts",
          contents: `
            import setting from "redemption-setting-test";
            export const MONEY_SCOREBOARD_MAX = 2147483647;
            const wallets = new Map<string, { name: string; gold: number }>();
            const receipts = new Map<string, { amount: number }>();
            let calls = 0;
            let nextResult: any;
            let creditHook: undefined | (() => void);
            function wallet(name: string) {
              let found = wallets.get(name);
              if (!found) {
                found = { name, gold: 0 };
                wallets.set(name, found);
              }
              return found;
            }
            export function resetEconomic(): void {
              wallets.clear();
              receipts.clear();
              calls = 0;
              nextResult = undefined;
              creditHook = undefined;
            }
            export function setWallet(name: string, gold: number): void { wallets.set(name, { name, gold }); }
            export function getWalletGold(name: string): number { return wallet(name).gold; }
            export function getCreditCallCount(): number { return calls; }
            export function setNextCreditResult(value: any): void { nextResult = value; }
            export function setCreditHook(value: () => void): void { creditHook = value; }
            export function seedReceipt(key: string, amount: number): void { receipts.set(key, { amount }); }
            const economic = {
              getWallet(name: string) { return wallet(name); },
              creditGoldOnce(input: any): any {
                calls += 1;
                const hook = creditHook;
                creditHook = undefined;
                if (hook) hook();
                if (nextResult !== undefined) {
                  const result = nextResult;
                  nextResult = undefined;
                  return result;
                }
                const target = wallet(input.playerName);
                const receipt = receipts.get(input.idempotencyKey);
                if (receipt) {
                  return receipt.amount === input.amount
                    ? { status: "already_credited", amount: receipt.amount, balance: target.gold }
                    : { status: "conflict", requestedAmount: input.amount, appliedAmount: receipt.amount, balance: target.gold };
                }
                if (setting.getState("economy") !== true) {
                  return { status: "rejected", reason: "economy_disabled" };
                }
                if (target.gold > MONEY_SCOREBOARD_MAX - input.amount) {
                  return { status: "rejected", reason: "balance_limit_exceeded" };
                }
                target.gold += input.amount;
                receipts.set(input.idempotencyKey, { amount: input.amount });
                return { status: "credited", amount: input.amount, balance: target.gold };
              },
            };
            export default economic;
          `,
        };
      }
      throw new Error(`unknown redemption test double: ${args.path}`);
    });
  },
};

const domain = require(domainBundle);
let runtime;

before(async () => {
  await build({
    entryPoints: [runtimeEntry],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    outfile: runtimeBundle,
    plugins: [runtimeDoubles],
    logLevel: "silent",
  });
  runtime = require(runtimeBundle);
});

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function resetRuntime() {
  runtime.resetDatabase();
  runtime.resetEconomic();
  runtime.setEconomyEnabled(true);
}

function player(name, cmid, admin = false) {
  return { name, cmid, admin };
}

function persistedRecord(overrides = {}) {
  return {
    id: "rc_test",
    code: "EXACT",
    gold: 50,
    maxUses: null,
    expiresAt: null,
    status: "active",
    createdAt: 100,
    createdById: "cmid_admin",
    createdByName: "Admin",
    claims: {},
    ...overrides,
  };
}

test("custom code validation preserves exact visible Unicode while rejecting unsafe text", () => {
  assert.deepEqual(domain.validateRedemptionCode(" Ab中🙂 "), { ok: true, code: " Ab中🙂 " });
  for (const invalid of ["", "   ", "a\nb", "a\0b", "a§b", "a\u2028b", "x".repeat(65)]) {
    assert.equal(domain.validateRedemptionCode(invalid).ok, false, JSON.stringify(invalid));
  }
  assert.equal(domain.validateRedemptionCode("Code").code, "Code");
  assert.equal(domain.validateRedemptionCode("code").code, "code");
});

test("creation validation supports unlimited and permanent codes and uses an exact expiry boundary", () => {
  const now = 1_000_000;
  const permanent = domain.validateCreateRedemptionInput(
    { code: "", gold: 1, maxUses: null, expiresInHours: null },
    now
  );
  assert.equal(permanent.ok, true);
  assert.equal(permanent.generated, true);
  assert.equal(permanent.expiresAt, null);

  const limited = domain.validateCreateRedemptionInput(
    { code: "中文 码", gold: 99, maxUses: 3, expiresInHours: 2 },
    now
  );
  assert.equal(limited.ok, true);
  assert.equal(limited.customCode, "中文 码");
  assert.equal(limited.expiresAt, now + 2 * 60 * 60 * 1000);

  for (const input of [
    { code: "X", gold: 0, maxUses: null, expiresInHours: null },
    { code: "X", gold: 1.5, maxUses: null, expiresInHours: null },
    { code: "X", gold: 1, maxUses: 0, expiresInHours: null },
    { code: "X", gold: 1, maxUses: null, expiresInHours: 0 },
  ]) {
    assert.equal(domain.validateCreateRedemptionInput(input, now).ok, false);
  }

  const record = persistedRecord({ expiresAt: now });
  assert.equal(domain.isRedemptionCodeExpired(record, now - 1), false);
  assert.equal(domain.isRedemptionCodeExpired(record, now), true);
});

test("generated codes use the unambiguous format and mix tick and collision salt", () => {
  const values = new Set();
  for (let salt = 0; salt < 64; salt++) {
    const code = domain.generateRedemptionCode({ now: 123456, tick: 77, salt, random: () => 0.25 });
    assert.match(code, domain.REDEMPTION_CODE_GENERATED_PATTERN);
    assert.doesNotMatch(code, /[01ILO]/);
    values.add(code);
  }
  assert.ok(values.size > 60);
  assert.match(
    domain.generateRedemptionCodeId({ now: 123456, tick: 77, salt: 0, random: () => 0.5 }),
    /^rc_[a-z0-9]+_[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{20}$/
  );
});

test("prepared, granted, and recovery claims all reserve limited capacity", () => {
  const record = persistedRecord({
    maxUses: 3,
    claims: {
      a: { playerIdentityId: "a", playerName: "A", status: "prepared", preparedAt: 1, updatedAt: 1 },
      b: { playerIdentityId: "b", playerName: "B", status: "granted", preparedAt: 1, updatedAt: 1 },
      c: {
        playerIdentityId: "c",
        playerName: "C",
        status: "recovery_required",
        preparedAt: 1,
        updatedAt: 1,
      },
    },
  });
  const view = domain.toRedemptionCodeView(record, 2);
  assert.deepEqual(view.counts, { prepared: 1, granted: 1, recoveryRequired: 1, reserved: 3 });
  assert.equal(view.remainingUses, 0);
  assert.equal(view.exhausted, true);
  assert.deepEqual(domain.assessRedemptionAvailability(record, "new", 2), { ok: false, reason: "exhausted" });
});

test("a prepared reservation survives later expiry, disable, and archive", () => {
  const claim = {
    playerIdentityId: "cmid_a",
    playerName: "Alice",
    status: "prepared",
    preparedAt: 1,
    updatedAt: 1,
  };
  const record = persistedRecord({ status: "archived", expiresAt: 1, maxUses: 1, claims: { cmid_a: claim } });
  assert.deepEqual(domain.assessRedemptionAvailability(record, "cmid_a", 999), {
    ok: true,
    resumePrepared: true,
  });
  assert.deepEqual(domain.assessRedemptionAvailability(record, "cmid_b", 999), {
    ok: false,
    reason: "archived",
  });
});

test("service creates exact codes, retries generated collisions, and never reuses archived text", () => {
  resetRuntime();
  const admin = player("Admin", "cmid_admin", true);
  const first = runtime.service.create(admin, {
    code: " Ab中 ",
    gold: 20,
    maxUses: 2,
    expiresInHours: null,
  });
  assert.equal(first.ok, true);
  assert.equal(first.code.code, " Ab中 ");

  const caseVariant = runtime.service.create(admin, {
    code: " ab中 ",
    gold: 20,
    maxUses: null,
    expiresInHours: null,
  });
  assert.equal(caseVariant.ok, true);
  assert.equal(
    runtime.service.create(admin, {
      code: " Ab中 ",
      gold: 20,
      maxUses: null,
      expiresInHours: null,
    }).reason,
    "duplicate_code"
  );

  assert.equal(runtime.service.archive(admin, first.code.id).ok, true);
  assert.equal(
    runtime.service.create(admin, {
      code: " Ab中 ",
      gold: 20,
      maxUses: null,
      expiresInHours: null,
    }).reason,
    "duplicate_code"
  );

  const fixedNow = 1_234_567_890;
  const collidingCode = domain.generateRedemptionCode({
    now: fixedNow,
    tick: 73,
    salt: 0,
    random: () => 0.25,
  });
  runtime.seedRecord(persistedRecord({ id: "rc_generated_collision", code: collidingCode, status: "archived" }));

  const originalNow = Date.now;
  const originalRandom = Math.random;
  let generatedOne;
  try {
    Date.now = () => fixedNow;
    Math.random = () => 0.25;
    generatedOne = runtime.service.create(admin, {
      code: "",
      gold: 1,
      maxUses: null,
      expiresInHours: null,
    });
  } finally {
    Date.now = originalNow;
    Math.random = originalRandom;
  }
  const generatedTwo = runtime.service.create(admin, {
    gold: 1,
    maxUses: null,
    expiresInHours: null,
  });
  assert.equal(generatedOne.ok, true);
  assert.equal(generatedTwo.ok, true);
  assert.match(generatedOne.code.code, domain.REDEMPTION_CODE_GENERATED_PATTERN);
  assert.notEqual(generatedOne.code.code, collidingCode);
  assert.notEqual(generatedOne.code.code, generatedTwo.code.code);
});

test("stable cmid prevents a renamed player from redeeming again and limited capacity is global", () => {
  resetRuntime();
  const admin = player("Admin", "cmid_admin", true);
  const created = runtime.service.create(admin, {
    code: "ONE",
    gold: 25,
    maxUses: 1,
    expiresInHours: null,
  });
  runtime.setWallet("Alice", 10);
  const first = runtime.service.redeem(player("Alice", "cmid_same"), "ONE");
  assert.equal(first.ok, true);
  assert.equal(first.balance, 35);

  assert.equal(runtime.service.redeem(player("AliceRenamed", "cmid_same"), "ONE").reason, "already_claimed");
  assert.equal(runtime.service.redeem(player("Bob", "cmid_b"), "ONE").reason, "exhausted");
  assert.equal(runtime.service.getById(created.code.id).counts.reserved, 1);
});

test("unlimited codes still allow each stable cmid only once", () => {
  resetRuntime();
  const admin = player("Admin", "cmid_admin", true);
  const created = runtime.service.create(admin, {
    code: "UNLIMITED",
    gold: 5,
    maxUses: null,
    expiresInHours: null,
  });
  assert.equal(created.ok, true);
  assert.equal(runtime.service.redeem(player("Alice", "cmid_a"), "UNLIMITED").ok, true);
  assert.equal(runtime.service.redeem(player("AliceNew", "cmid_a"), "UNLIMITED").reason, "already_claimed");
  assert.equal(runtime.service.redeem(player("Bob", "cmid_b"), "UNLIMITED").ok, true);
  const view = runtime.service.getById(created.code.id);
  assert.equal(view.counts.granted, 2);
  assert.equal(view.remainingUses, null);
});

test("economy shutdown rejects new claims without consuming eligibility", () => {
  resetRuntime();
  const admin = player("Admin", "cmid_admin", true);
  const created = runtime.service.create(admin, {
    code: "ECONOMY-OFF",
    gold: 5,
    maxUses: 1,
    expiresInHours: null,
  });
  runtime.setEconomyEnabled(false);
  assert.equal(runtime.service.redeem(player("Alice", "cmid_a"), "ECONOMY-OFF").reason, "economy_disabled");
  assert.equal(runtime.getCreditCallCount(), 0);
  assert.equal(runtime.service.getById(created.code.id).counts.reserved, 0);
});

test("per-code lock prevents the last limited slot from being prepared reentrantly", () => {
  resetRuntime();
  const admin = player("Admin", "cmid_admin", true);
  runtime.service.create(admin, { code: "LOCK", gold: 10, maxUses: 1, expiresInHours: null });
  let nested;
  runtime.setCreditHook(() => {
    nested = runtime.service.redeem(player("Bob", "cmid_b"), "LOCK");
  });
  const first = runtime.service.redeem(player("Alice", "cmid_a"), "LOCK");
  assert.equal(first.ok, true);
  assert.equal(nested.ok, false);
  assert.equal(nested.reason, "busy");
  assert.equal(runtime.service.getById(first.codeId).counts.reserved, 1);
});

test("capacity rejection and preparation save failure never partially credit or consume a slot", () => {
  resetRuntime();
  const admin = player("Admin", "cmid_admin", true);
  const created = runtime.service.create(admin, {
    code: "CAP",
    gold: 10,
    maxUses: 1,
    expiresInHours: null,
  });
  runtime.setWallet("Alice", 2147483642);
  assert.equal(runtime.service.redeem(player("Alice", "cmid_a"), "CAP").reason, "balance_limit_exceeded");
  assert.equal(runtime.getCreditCallCount(), 0);
  assert.equal(runtime.service.getById(created.code.id).counts.reserved, 0);

  runtime.setWallet("Alice", 0);
  runtime.failNextSave();
  assert.equal(runtime.service.redeem(player("Alice", "cmid_a"), "CAP").reason, "persistence_error");
  assert.equal(runtime.getCreditCallCount(), 0);
  assert.equal(runtime.service.getById(created.code.id).counts.reserved, 0);
});

test("explicit wallet rejection releases a reservation while uncertain results require admin recovery", () => {
  resetRuntime();
  const admin = player("Admin", "cmid_admin", true);
  const rejectedCode = runtime.service.create(admin, {
    code: "REJECT",
    gold: 10,
    maxUses: 1,
    expiresInHours: null,
  });
  runtime.setNextCreditResult({ status: "rejected", reason: "balance_limit_exceeded" });
  assert.equal(runtime.service.redeem(player("Alice", "cmid_a"), "REJECT").reason, "balance_limit_exceeded");
  assert.equal(runtime.service.getById(rejectedCode.code.id).counts.reserved, 0);

  const uncertainCode = runtime.service.create(admin, {
    code: "UNCERTAIN",
    gold: 10,
    maxUses: 1,
    expiresInHours: null,
  });
  runtime.setNextCreditResult({ status: "retryable_error", reason: "wallet_save_failed" });
  assert.equal(runtime.service.redeem(player("Alice", "cmid_a"), "UNCERTAIN").reason, "retryable_error");
  const abnormal = runtime.service.getById(uncertainCode.code.id);
  assert.equal(abnormal.claims.cmid_a.status, "recovery_required");
  assert.equal(abnormal.counts.reserved, 1);

  assert.equal(
    runtime.service.resolveRecovery(player("Member", "cmid_member"), abnormal.id, "cmid_a", "release").reason,
    "forbidden"
  );
  const beforeGold = runtime.getWalletGold("Alice");
  const resolved = runtime.service.resolveRecovery(admin, abnormal.id, "cmid_a", "release");
  assert.equal(resolved.ok, true);
  assert.equal(resolved.code.counts.reserved, 0);
  assert.equal(runtime.getWalletGold("Alice"), beforeGold);
});

test("idempotency conflicts stay reserved until an audited admin resolution", () => {
  resetRuntime();
  const admin = player("Admin", "cmid_admin", true);
  const created = runtime.service.create(admin, {
    code: "CONFLICT",
    gold: 10,
    maxUses: 1,
    expiresInHours: null,
  });
  runtime.setWallet("Alice", 70);
  runtime.setNextCreditResult({
    status: "conflict",
    requestedAmount: 10,
    appliedAmount: 20,
    balance: 70,
  });
  assert.equal(runtime.service.redeem(player("Alice", "cmid_a"), "CONFLICT").reason, "conflict");
  const abnormal = runtime.service.getById(created.code.id);
  assert.equal(abnormal.claims.cmid_a.status, "recovery_required");
  assert.equal(abnormal.counts.reserved, 1);

  const beforeGold = runtime.getWalletGold("Alice");
  const resolved = runtime.service.resolveRecovery(admin, created.code.id, "cmid_a", "mark_granted");
  assert.equal(resolved.ok, true);
  assert.equal(resolved.code.claims.cmid_a.status, "granted");
  assert.equal(resolved.code.recoveryResolutions.at(-1).action, "mark_granted");
  assert.equal(runtime.getWalletGold("Alice"), beforeGold);
});

test("prepared claims wait while economy is off and complete after it is enabled", () => {
  resetRuntime();
  runtime.seedRecord(
    persistedRecord({
      id: "rc_wait_for_economy",
      code: "WAIT",
      claims: {
        cmid_a: {
          playerIdentityId: "cmid_a",
          playerName: "Alice",
          status: "prepared",
          preparedAt: 1,
          updatedAt: 1,
        },
      },
    })
  );
  runtime.setWallet("Alice", 10);
  runtime.setEconomyEnabled(false);
  const skipped = runtime.service.recoverPreparedClaims();
  assert.equal(skipped.skipped, 1);
  assert.equal(runtime.getRawRecord("rc_wait_for_economy").claims.cmid_a.status, "prepared");
  assert.equal(runtime.getWalletGold("Alice"), 10);

  runtime.setEconomyEnabled(true);
  const completed = runtime.service.recoverPreparedClaims();
  assert.equal(completed.granted, 1);
  assert.equal(runtime.getRawRecord("rc_wait_for_economy").claims.cmid_a.status, "granted");
  assert.equal(runtime.getWalletGold("Alice"), 60);
});

test("startup recovery uses the fixed receipt key and completes archived prepared claims once", () => {
  resetRuntime();
  const record = persistedRecord({
    id: "rc_recovery",
    code: "OLD",
    status: "archived",
    expiresAt: 10,
    gold: 50,
    claims: {
      cmid_a: {
        playerIdentityId: "cmid_a",
        playerName: "Alice",
        status: "prepared",
        preparedAt: 1,
        updatedAt: 1,
      },
    },
  });
  runtime.seedRecord(record);
  runtime.setWallet("cmid_a", 80);
  runtime.seedReceipt("redeem:v1:rc_recovery:cmid_a", 50);
  runtime.setEconomyEnabled(false);

  const summary = runtime.service.recoverPreparedClaims();
  assert.equal(summary.alreadyCredited, 1);
  assert.equal(runtime.getRawRecord("rc_recovery").claims.cmid_a.status, "granted");
  assert.equal(runtime.getCreditCallCount(), 1);

  const repeated = runtime.service.recoverPreparedClaims();
  assert.equal(repeated.inspected, 0);
  assert.equal(runtime.getCreditCallCount(), 1);
});

test("admin state changes enforce expiry, exhaustion, permissions, and do not alter wallets", () => {
  resetRuntime();
  const admin = player("Admin", "cmid_admin", true);
  const member = player("Member", "cmid_member");
  const created = runtime.service.create(admin, {
    code: "STATE",
    gold: 10,
    maxUses: 1,
    expiresInHours: null,
  });
  assert.equal(runtime.service.setEnabled(member, created.code.id, false).reason, "forbidden");
  assert.equal(runtime.service.setEnabled(admin, created.code.id, false).ok, true);
  assert.equal(runtime.service.redeem(player("Alice", "cmid_a"), "STATE").reason, "disabled");
  assert.equal(runtime.service.setEnabled(admin, created.code.id, true).ok, true);
  assert.equal(runtime.service.redeem(player("Alice", "cmid_a"), "STATE").ok, true);
  assert.equal(runtime.service.setEnabled(admin, created.code.id, true).reason, "exhausted");
  assert.equal(runtime.service.archive(admin, created.code.id).ok, true);
  assert.equal(runtime.service.setEnabled(admin, created.code.id, true).reason, "invalid_state");
});

test("source contract keeps claims and wallet calls on immediate persistence boundaries", () => {
  const source = fs.readFileSync(serviceFile, "utf8");
  assert.match(source, /new Database<IRedemptionCode>\(REDEMPTION_CODE_DATABASE\)/);
  assert.match(source, /private saveRecord[\s\S]*this\.db\.set\(record\.id, record\);\s*this\.db\.save\(\);/);
  assert.match(source, /this\.saveRecord\(prepared\);[\s\S]*this\.completePreparedClaim/);
  assert.match(source, /idempotencyKey: `redeem:v1:\$\{record\.id\}:\$\{playerIdentityId\}`/);
  assert.match(source, /ignoreDailyLimit: true/);
  assert.match(source, /id: "economy\.redemptionCodeRecovery"[\s\S]*RECOVERY_INTERVAL_TICKS/);
  assert.doesNotMatch(source, /\.trim\(\)|toLowerCase\(\)|toUpperCase\(\)/);
});
