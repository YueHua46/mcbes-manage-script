const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const ts = require("typescript");
const filename = path.resolve(__dirname, "../scripts/features/land/services/land-boundary-colors.ts");
const mod = new Module(filename, module);
mod._compile(
  ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  filename
);
const { BoundaryColorResolver, BOUNDARY_COLOR_PALETTE } = mod.exports;
const land = (name, x = 0, z = 0, dimension = "overworld") => ({
  name,
  owner: "owner",
  dimension,
  vectors: { start: { x, y: -60, z }, end: { x: x + 9, y: 100, z: z + 9 } },
});
const key = (value) => `${value.name}:${value.owner}`;
const colorKey = (value) => [value.red, value.green, value.blue].join(":");
const distance = (a, b) => Math.hypot(a.red - b.red, a.green - b.green, a.blue - b.blue);

test("eight close lands have different whole-boundary colors even with similar names", () => {
  const lands = Array.from({ length: 8 }, (_, i) => land(`领地${i}`, (i % 4) * 2, Math.floor(i / 4) * 2));
  const resolver = new BoundaryColorResolver();
  resolver.setSource(() => Object.fromEntries(lands.map((value) => [value.name, value])));
  const colors = lands.map((value) => resolver.get(key(value)));
  assert.equal(new Set(colors.map(colorKey)).size, 8);
  assert.ok(distance(colors[0], colors[1]) > 0.7, "immediate neighbors need visible hue separation, not blue variants");
  assert.ok(colors.every((color) => BOUNDARY_COLOR_PALETTE.some((entry) => colorKey(entry) === colorKey(color))));
});

test("world assignment ignores database order, lookup order, viewers and distant or other-dimension lands", () => {
  const a = land("a"),
    b = land("b", 10),
    far = land("zzz", 10000),
    other = land("other", 0, 0, "nether");
  let list = { a, b };
  const resolver = new BoundaryColorResolver();
  resolver.setSource(() => list);
  const colors = [resolver.get(key(a)), resolver.get(key(b))];
  list = { b, far, a, other };
  assert.deepEqual(resolver.get(key(b)), colors[1]);
  assert.deepEqual(resolver.get(key(a)), colors[0]);
  const copy = resolver.get(key(a));
  copy.red = -1;
  assert.deepEqual(resolver.get(key(a)), colors[0], "callers cannot mutate cached palettes");
});

test("moving a land close invalidates cached colors and avoids a preexisting same-color neighbor", () => {
  const a = land("base");
  const resolver = new BoundaryColorResolver();
  let list = { a };
  resolver.setSource(() => list);
  const first = resolver.get(key(a));
  let b;
  for (let i = 0; i < 100; i++) {
    b = land(`neighbor${i}`, 10000);
    list = { a, b };
    if (colorKey(resolver.get(key(b))) === colorKey(first)) break;
  }
  assert.equal(colorKey(resolver.get(key(b))), colorKey(first));
  b.vectors.start.x = 10;
  b.vectors.end.x = 19;
  assert.notEqual(colorKey(resolver.get(key(a))), colorKey(resolver.get(key(b))));
  delete list.b;
  assert.equal(resolver.get(key(b)), undefined);
});
