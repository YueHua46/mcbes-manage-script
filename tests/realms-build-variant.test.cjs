const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function moduleNames(manifest) {
  return (manifest.dependencies ?? []).map((dependency) => dependency.module_name).filter(Boolean);
}

function loadPureTypeScriptModule(relativePath) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function (module, exports) { ${output} })(module, module.exports);`, {
    module,
  });
  return module.exports;
}

test("Realms manifest excludes unsupported modules while standard and BDS keep GameTest", () => {
  const realms = moduleNames(readJson("behavior_packs/CreeperMenu/manifest.realms.json"));
  assert.equal(realms.includes("@minecraft/server-gametest"), false);
  assert.equal(realms.includes("@minecraft/server-admin"), false);
  assert.equal(realms.includes("@minecraft/server-net"), false);
  assert.equal(realms.includes("@minecraft/debug-utilities"), false);

  for (const file of ["manifest.standard.json", "manifest.bds.json"]) {
    assert.equal(
      moduleNames(readJson(`behavior_packs/CreeperMenu/${file}`)).includes("@minecraft/server-gametest"),
      true,
      file
    );
  }
});

test("package and just config expose a dedicated Realms build", () => {
  const pkg = readJson("package.json");
  assert.equal(pkg.scripts["build:realms"], "just-scripts build:realms");
  assert.equal(pkg.scripts["mcaddon:realms"], "just-scripts mcaddon:realms");

  const config = read("just.config.ts");
  assert.match(config, /task\("build:realms"/);
  assert.match(config, /task\("mcaddon:realms"/);
  assert.match(config, /manifest\.realms\.json/);
  assert.match(config, /__REALMS_BUILD__:\s*"true"/);
});

test("Realms capability and GameTest adapter stay centralized", () => {
  const flags = read("scripts/features/platform/sapi-capabilities/build-flags.ts");
  const service = read("scripts/features/fake-player/services/fake-player.ts");
  const realmsRuntime = read("scripts/features/fake-player/services/simulated-player-runtime.realms.ts");

  assert.match(flags, /export type BuildVariant = "standard" \| "debug" \| "bds-admin" \| "realms"/);
  assert.match(flags, /export function isRealmsBuild/);
  assert.match(flags, /export function isSimulatedPlayerAvailable/);
  assert.doesNotMatch(service, /from\s+["']@minecraft\/server-gametest["']/);
  assert.doesNotMatch(realmsRuntime, /@minecraft\/server-gametest/);
});

test("Realms migration converts simulated records and removes unsupported state", () => {
  const { migrateFakePlayerRecordForRealms } = loadPureTypeScriptModule(
    "scripts/features/fake-player/services/realms-fake-player-migration.ts"
  );
  const original = {
    id: "fake-1",
    name: "加载点",
    ownerName: "Steve",
    location: { x: 1, y: 64, z: 2 },
    dimension: "minecraft:overworld",
    created: "2026-07-25 12:00:00",
    type: "simulated",
    rotationX: 5,
    rotationY: 90,
    inventoryViewers: ["Alex"],
    skinId: 999,
    isDead: true,
    diedAt: "2026-07-25 12:30:00",
    deathReason: "测试",
    deathSourceLocalizationKey: "entity.zombie.name",
    deathSourceName: "僵尸",
    deathCause: "近战攻击",
    gameMode: "Survival",
    inventory: { slots: [] },
    behavior: { movement: "idle" },
    program: { enabled: true, loop: true, steps: [] },
  };

  const result = migrateFakePlayerRecordForRealms(original);
  assert.equal(result.changed, true);
  assert.equal(result.record.type, "entity");
  assert.equal(result.record.skinId, 0);
  assert.equal(result.record.name, original.name);
  assert.equal(JSON.stringify(result.record.location), JSON.stringify(original.location));
  assert.equal(JSON.stringify(result.record.inventoryViewers), JSON.stringify(["Alex"]));
  for (const key of [
    "isDead",
    "diedAt",
    "deathReason",
    "deathSourceLocalizationKey",
    "deathSourceName",
    "deathCause",
    "gameMode",
    "inventory",
    "behavior",
    "program",
  ]) {
    assert.equal(Object.hasOwn(result.record, key), false, key);
  }
  assert.notEqual(result.record, original);
  assert.equal(original.type, "simulated");
});

test("Realms migration is idempotent for legacy entity records", () => {
  const { migrateFakePlayerRecordForRealms } = loadPureTypeScriptModule(
    "scripts/features/fake-player/services/realms-fake-player-migration.ts"
  );
  const legacy = {
    id: "fake-2",
    name: "旧版加载点",
    type: "entity",
    skinId: 12,
    customFutureField: "keep",
  };

  const result = migrateFakePlayerRecordForRealms(legacy);
  assert.equal(result.changed, false);
  assert.equal(result.record, legacy);
  assert.equal(result.record.customFutureField, "keep");
});

test("fake-player service applies Realms migration before spawning and rejects simulated creation", () => {
  const service = read("scripts/features/fake-player/services/fake-player.ts");
  const databaseInitialization = service.indexOf('new Database<IFakePlayer>("fake_players")');
  const migrationCall = service.indexOf("this.migrateRecordsForRealms()");
  const spawnCall = service.indexOf("this.ensureAllSpawned()");

  assert.ok(databaseInitialization >= 0);
  assert.ok(migrationCall > databaseInitialization);
  assert.ok(spawnCall > migrationCall);
  assert.match(service, /if \(!isSimulatedPlayerAvailable\(\) && input\.type === "simulated"\)/);
});

test("Realms entry and fake-player UI expose legacy-only behavior", () => {
  const entry = read("scripts/main.realms.ts");
  const variants = read("scripts/startup-variants.ts");
  const ui = read("scripts/ui/forms/player/fake-player.ts");

  assert.match(entry, /startupVariants\.realms/);
  assert.match(variants, /Realms 兼容版/);
  assert.match(variants, /仅旧版实体假人/);
  assert.match(ui, /isSimulatedPlayerAvailable/);
  assert.match(ui, /Realms 版仅支持旧版实体假人/);
  assert.match(
    ui,
    /isSimulatedPlayerAvailable\(\)\s*\?\s*openCreateFakePlayerForm\(player, back\)\s*:\s*openCreateFakePlayerDetailsForm\(player, "entity", back\)/
  );
});

test("CI builds and verifies the Realms artifact", () => {
  const pkg = readJson("package.json");
  const workflow = read(".github/workflows/ci.yml");
  const verifier = read("tools/verify-realms-build.cjs");

  assert.equal(pkg.scripts["verify:realms-build"], "node tools/verify-realms-build.cjs");
  assert.match(workflow, /npm run build:realms/);
  assert.match(workflow, /npm run verify:realms-build/);
  assert.match(verifier, /@minecraft\/server-gametest/);
  assert.match(verifier, /dist\/scripts\/main\.js/);
});

test("README and knowledge base document Realms limitations and automatic downgrade", () => {
  const readme = read("README.md");
  const knowledgeBase = read("docs/creeper-menu-knowledge-base.md");

  for (const document of [readme, knowledgeBase]) {
    assert.match(document, /Realms 兼容版/);
    assert.match(document, /仅支持旧版实体假人/);
    assert.match(document, /自动降级/);
    assert.match(document, /@minecraft\/server-gametest/);
  }
});

test("standard build no longer advertises Realms compatibility", () => {
  const variants = read("scripts/startup-variants.ts");
  const config = read("just.config.ts");

  assert.doesNotMatch(variants, /标准兼容版（本地 \/ BDS \/ Realms）/);
  assert.doesNotMatch(config, /普通兼容版（适用本地、BDS、Realms领域服）/);
  assert.match(config, /普通兼容版（适用本地、BDS）/);
});
