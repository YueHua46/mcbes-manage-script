const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const callbacks = {};

const event = () => ({ subscribe(callback) { return callback; } });
const serverMock = {
  system: { run(callback) { callback(); } },
  world: {
    getAllPlayers: () => [],
    beforeEvents: {
      playerBreakBlock: event(),
      playerPlaceBlock: event(),
      playerInteractWithBlock: event(),
      explosion: event(),
    },
    afterEvents: {
      entitySpawn: {
        subscribe(callback) {
          callbacks.entitySpawn = callback;
        },
      },
    },
  },
};

const previousTsLoader = require.extensions[".ts"];
const previousModuleLoad = Module._load;
require.extensions[".ts"] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};
Module._load = function (request, parent, isMain) {
  if (request === "@minecraft/server") return serverMock;
  if (request === "../../shared/utils/common") return { isAdmin: () => false };
  return previousModuleLoad.call(this, request, parent, isMain);
};

const { registerBackroomsProtection } = require(path.join(
  root,
  "scripts/features/backrooms/protection.ts",
));
registerBackroomsProtection();
Module._load = previousModuleLoad;

test.after(() => {
  Module._load = previousModuleLoad;
  if (previousTsLoader) require.extensions[".ts"] = previousTsLoader;
  else delete require.extensions[".ts"];
});

test("spawn cleanup never reads properties from an already invalid entity", () => {
  let dimensionReads = 0;
  const invalidEntity = {
    isValid: false,
    get dimension() {
      dimensionReads += 1;
      throw new Error("InvalidEntityError");
    },
  };
  assert.doesNotThrow(() => callbacks.entitySpawn({ entity: invalidEntity }));
  assert.equal(dimensionReads, 0);
});

test("spawn cleanup keeps the scripted Lifeform but removes ordinary mobs", () => {
  let lifeformRemovals = 0;
  callbacks.entitySpawn({
    entity: {
      isValid: true,
      dimension: { id: "yuehua:backrooms" },
      typeId: "yuehua:backrooms_lifeform",
      remove: () => { lifeformRemovals += 1; },
    },
  });
  assert.equal(lifeformRemovals, 0);

  let mobRemovals = 0;
  callbacks.entitySpawn({
    entity: {
      isValid: true,
      dimension: { id: "yuehua:backrooms" },
      typeId: "minecraft:zombie",
      remove: () => { mobRemovals += 1; },
    },
  });
  assert.equal(mobRemovals, 1);
});

test("spawn cleanup keeps experience orbs dropped by the Bacteria", () => {
  let removals = 0;
  callbacks.entitySpawn({
    entity: {
      isValid: true,
      dimension: { id: "yuehua:backrooms" },
      typeId: "minecraft:xp_orb",
      remove: () => { removals += 1; },
    },
  });
  assert.equal(removals, 0);
});
