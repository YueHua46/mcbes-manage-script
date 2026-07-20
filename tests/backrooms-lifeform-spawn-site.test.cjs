const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const previousTsLoader = require.extensions[".ts"];
require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

const selector = require(path.join(root, "scripts/features/backrooms/lifeform/spawn-site-selector.ts"));

test.after(() => {
  if (previousTsLoader) require.extensions[".ts"] = previousTsLoader;
  else delete require.extensions[".ts"];
});

function syntheticRegion({ wall = true, loaded = true, blackout = false } = {}) {
  const size = 64;
  const cells = new Uint8Array(size * size).fill(1);
  if (wall) {
    for (let z = 0; z <= 44; z++) cells[z * size + 30] = 0;
  }
  return {
    region: { rx: 0, rz: 0 },
    size,
    blackout,
    loaded,
    getCell(x, z) {
      if (x < 0 || z < 0 || x >= size || z >= size) return undefined;
      return cells[z * size + x];
    },
  };
}

function context(region = syntheticRegion()) {
  return {
    player: { x: 8.5, y: 100, z: 32.5 },
    forward: { x: 1, z: 0 },
    manifestationSpawn: { x: 2.5, y: 100, z: 2.5 },
    otherPlayers: [],
    regions: [region],
    seed: 12345,
    isLoaded: () => true,
    hasClearance: () => true,
    isVoid: () => false,
  };
}

test("bounded BFS returns a reachable wall-occluded site inside both distance bands", () => {
  const candidates = selector.collectSpawnCandidates(context());
  assert.ok(candidates.length > 0);
  assert.ok(candidates.length <= 48);
  for (const candidate of candidates) {
    assert.ok(candidate.euclideanDistance >= 36 && candidate.euclideanDistance <= 56);
    assert.ok(candidate.pathDistance >= 44 && candidate.pathDistance <= 96);
    assert.equal(candidate.lineOfSight, false);
  }
  const selected = selector.selectLifeformSpawnSite(context());
  assert.ok(selected);
  assert.ok(candidates.some((candidate) => candidate.key === selected.key));
});

test("an open layout is rejected because it has direct logical line of sight", () => {
  const open = syntheticRegion({ wall: false });
  assert.equal(selector.hasLogicalLineOfSight(context(open), { x: 48.5, y: 100, z: 32.5 }), true);
  assert.deepEqual(selector.collectSpawnCandidates(context(open)), []);
});

test("unloaded, obstructed, void, spawn-pad, and nearby-player sites are excluded", () => {
  assert.deepEqual(selector.collectSpawnCandidates(context(syntheticRegion({ loaded: false }))), []);
  assert.deepEqual(selector.collectSpawnCandidates({ ...context(), isLoaded: () => false }), []);
  assert.deepEqual(selector.collectSpawnCandidates({ ...context(), hasClearance: () => false }), []);
  assert.deepEqual(selector.collectSpawnCandidates({ ...context(), isVoid: () => true }), []);
  const spawnFiltered = selector.collectSpawnCandidates({
    ...context(),
    manifestationSpawn: { x: 48.5, y: 100, z: 32.5 },
  });
  assert.ok(spawnFiltered.every((candidate) => Math.hypot(
    candidate.location.x - 48.5,
    candidate.location.z - 32.5,
  ) >= 24));
  const playerFiltered = selector.collectSpawnCandidates({
    ...context(),
    otherPlayers: [{ x: 48.5, y: 100, z: 32.5 }],
  });
  assert.ok(playerFiltered.every((candidate) => Math.hypot(
    candidate.location.x - 48.5,
    candidate.location.z - 32.5,
  ) >= 32));
});

test("selection ranks deterministically and never traverses a region absent from the loaded snapshot", () => {
  const first = selector.selectLifeformSpawnSite(context());
  const second = selector.selectLifeformSpawnSite(context());
  assert.deepEqual(second, first);

  const edgeContext = {
    ...context(),
    player: { x: 60.5, y: 100, z: 32.5 },
    manifestationSpawn: { x: 1.5, y: 100, z: 1.5 },
  };
  assert.ok(selector.collectSpawnCandidates(edgeContext).every((candidate) => (
    candidate.location.x >= 0 && candidate.location.x < 64
      && candidate.location.z >= 0 && candidate.location.z < 64
  )));
});
