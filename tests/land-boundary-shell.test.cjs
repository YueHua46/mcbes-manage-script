const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const filename = path.join(root, "scripts/features/land/services/land-boundary-shell.ts");
const source = fs.readFileSync(filename, "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: filename,
}).outputText;
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = Module._nodeModulePaths(path.dirname(filename));
loaded._compile(output, filename);
const { iterateBoundaryShell } = loaded.exports;

const cube = (max) => ({ minX: 0, maxX: max, minY: 0, maxY: max, minZ: 0, maxZ: max });
const keyOf = ({ x, y, z }) => `${x},${y},${z}`;

test("depth zero yields each surface block exactly once", () => {
  const locations = [...iterateBoundaryShell(cube(2), 0)];
  assert.equal(locations.length, 26);
  assert.equal(new Set(locations.map(keyOf)).size, 26);
  assert.equal(locations.some(({ x, y, z }) => x === 1 && y === 1 && z === 1), false);
});

test("overlapping shell slabs cover a small land without duplicates", () => {
  const locations = [...iterateBoundaryShell(cube(2), 12)];
  assert.equal(locations.length, 27);
  assert.equal(new Set(locations.map(keyOf)).size, 27);
});

test("thirteen-layer piston shell skips the large protected interior", () => {
  const bounds = cube(39);
  const locations = [...iterateBoundaryShell(bounds, 12)];
  const fullVolume = 40 ** 3;
  const interiorVolume = 14 ** 3;
  assert.equal(locations.length, fullVolume - interiorVolume);
  assert.equal(new Set(locations.map(keyOf)).size, locations.length);
  assert.equal(locations.some(({ x, y, z }) => x === 20 && y === 20 && z === 20), false);
});
