const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const filename = path.join(root, "scripts/features/land/services/piston-boundary-policy.ts");
const source = fs.readFileSync(filename, "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: filename,
}).outputText;
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = Module._nodeModulePaths(path.dirname(filename));
loaded._compile(output, filename);
const { findDeniedPistonMove } = loaded.exports;

const landA = { id: "a" };
const landB = { id: "b" };
const keyOf = (land) => land.id;
const at = (x) => ({ x, y: 64, z: 0 });
const move = (from, to) => ({ source: at(from), destination: at(to) });
const resolveAdjacentLands = (location) => {
  if (location.x >= 0 && location.x <= 9) return landA;
  if (location.x >= 10 && location.x <= 19) return landB;
  return null;
};

test("allows wilderness pistons that only move wilderness blocks", () => {
  assert.equal(findDeniedPistonMove(at(-3), [move(-2, -1)], resolveAdjacentLands, keyOf), null);
});

test("allows a piston and its moved blocks entirely inside one land", () => {
  assert.equal(findDeniedPistonMove(at(1), [move(2, 3), move(3, 4)], resolveAdjacentLands, keyOf), null);
});

test("does not block land A redstone merely because land B is adjacent", () => {
  assert.equal(findDeniedPistonMove(at(7), [move(8, 9)], resolveAdjacentLands, keyOf), null);
});

test("denies a wilderness piston even when both block positions are inside a land", () => {
  const denied = findDeniedPistonMove(at(-1), [move(0, 1)], resolveAdjacentLands, keyOf);
  assert.equal(denied?.protectedLand, landA);
});

test("denies moving a block across the wilderness-land boundary", () => {
  assert.equal(findDeniedPistonMove(at(-2), [move(-1, 0)], resolveAdjacentLands, keyOf)?.protectedLand, landA);
  assert.equal(findDeniedPistonMove(at(1), [move(0, -1)], resolveAdjacentLands, keyOf)?.protectedLand, landA);
});

test("denies movement between two adjacent lands", () => {
  const denied = findDeniedPistonMove(at(8), [move(9, 10)], resolveAdjacentLands, keyOf);
  assert.equal(denied?.protectedLand, landA);
});

test("an unprotected public-break land behaves like wilderness", () => {
  const publicBreakResolver = () => null;
  assert.equal(findDeniedPistonMove(at(0), [move(1, 2)], publicBreakResolver, keyOf), null);
});
