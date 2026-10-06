const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const filename = path.join(root, "scripts/features/land/services/land-boundary-render-plan.ts");
const source = fs.readFileSync(filename, "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: filename,
}).outputText;
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = Module._nodeModulePaths(path.dirname(filename));
loaded._compile(output, filename);

const {
  BOUNDARY_RENDER_PROFILES,
  createBoundaryRenderPlan,
  getBoundaryHorizontalLoopPoint,
  getBoundaryVerticalPoint,
  selectNearestBoundaryCandidates,
} = loaded.exports;

const vector = (x, y, z) => ({ x, y, z });
const assertVectorAlmostEqual = (actual, expected) => {
  for (const axis of ["x", "y", "z"]) assert.ok(Math.abs(actual[axis] - expected[axis]) < 1e-9);
};

test("single-block land produces a complete 1x1x1 volume with twelve edges and eight anchors", () => {
  const plan = createBoundaryRenderPlan(vector(4, 8, 12), vector(4, 8, 12), "balanced", "single");
  assert.deepEqual(plan.bounds.min, vector(4, 8, 12));
  assert.deepEqual(plan.bounds.max, vector(5, 9, 13));
  assert.deepEqual(plan.bounds.size, vector(1, 1, 1));
  assert.equal(plan.edges.length, 12);
  assert.equal(plan.corners.length, 8);
  assert.deepEqual(
    plan.edges.reduce((counts, edge) => ({ ...counts, [edge.role]: (counts[edge.role] ?? 0) + 1 }), {}),
    { bottom: 4, top: 4, vertical: 4 }
  );
});

test("reversed endpoints produce the same normalized 3D render plan", () => {
  const forward = createBoundaryRenderPlan(vector(-3, 2, 7), vector(20, 14, 31), "high", "stable");
  const reversed = createBoundaryRenderPlan(vector(20, 14, 31), vector(-3, 2, 7), "high", "stable");
  assert.deepEqual(reversed, forward);
});

test("all twelve edges receive runes and every rune lies on its assigned 3D edge", () => {
  const plan = createBoundaryRenderPlan(vector(0, 3, 0), vector(19, 22, 11), "balanced", "volume");
  const edgeIndices = new Set(plan.runes.map((rune) => rune.edgeIndex));
  assert.deepEqual(
    [...edgeIndices].sort((a, b) => a - b),
    Array.from({ length: 12 }, (_, index) => index)
  );

  for (const rune of plan.runes) {
    const edge = plan.edges[rune.edgeIndex];
    assert.equal(rune.edgeRole, edge.role);
    assert.ok(rune.edgeProgress > 0 && rune.edgeProgress < 1);
    assert.ok(rune.roleProgress > 0 && rune.roleProgress <= 1);
    for (const axis of ["x", "y", "z"]) {
      const low = Math.min(edge.start[axis], edge.end[axis]);
      const high = Math.max(edge.start[axis], edge.end[axis]);
      assert.ok(rune.position[axis] >= low && rune.position[axis] <= high);
      if (edge.start[axis] === edge.end[axis]) assert.equal(rune.position[axis], edge.start[axis]);
    }
  }
});

test("five rune variants are stable, diverse, and never repeat at adjacent positions on an edge", () => {
  const first = createBoundaryRenderPlan(vector(0, 0, 0), vector(40, 20, 40), "high", "arcane-seed");
  const second = createBoundaryRenderPlan(vector(0, 0, 0), vector(40, 20, 40), "high", "arcane-seed");
  assert.deepEqual(second.runes, first.runes);
  assert.deepEqual(new Set(first.runes.map((rune) => rune.runeVariant)), new Set([1, 2, 3, 4, 5]));

  for (let edgeIndex = 0; edgeIndex < 12; edgeIndex++) {
    const variants = first.runes
      .filter((rune) => rune.edgeIndex === edgeIndex)
      .sort((a, b) => a.edgeProgress - b.edgeProgress)
      .map((rune) => rune.runeVariant);
    for (let index = 1; index < variants.length; index++) assert.notEqual(variants[index], variants[index - 1]);
  }
});

test("sparse rune spacing remains consistent on equal-length edges", () => {
  for (const detail of ["low", "balanced", "high"]) {
    const profile = BOUNDARY_RENDER_PROFILES[detail];
    assert.equal(typeof profile.runeSpacing, "number");

    const plan = createBoundaryRenderPlan(vector(0, 0, 0), vector(24, 24, 24), detail, `equal-density-${detail}`);
    const counts = { bottom: 0, vertical: 0, top: 0 };
    for (const rune of plan.runes) counts[rune.edgeRole] += 1;
    assert.equal(counts.bottom, counts.vertical, `${detail} vertical density diverged from the bottom`);
    assert.equal(counts.bottom, counts.top, `${detail} top density diverged from the bottom`);
  }
});

test("rune pulse phase forms a coherent perimeter and height wave instead of random per-symbol flicker", () => {
  const plan = createBoundaryRenderPlan(vector(0, 0, 0), vector(32, 16, 32), "high", "macro-pulse");
  for (const role of ["bottom", "top"]) {
    const ordered = plan.runes.filter((rune) => rune.edgeRole === role).sort((a, b) => a.roleProgress - b.roleProgress);
    for (let index = 1; index < ordered.length; index++) {
      assert.ok(ordered[index].roleProgress >= ordered[index - 1].roleProgress);
    }
    assert.ok(new Set(ordered.map((rune) => rune.pulsePhase)).size > 8);
  }

  const verticals = plan.runes.filter((rune) => rune.edgeRole === "vertical");
  for (const progress of new Set(verticals.map((rune) => rune.edgeProgress))) {
    const phases = new Set(verticals.filter((rune) => rune.edgeProgress === progress).map((rune) => rune.pulsePhase));
    assert.equal(phases.size, 1);
  }
});

test("each detail profile respects its global rune ceiling while retaining all eight anchors", () => {
  for (const detail of ["low", "balanced", "high"]) {
    const profile = BOUNDARY_RENDER_PROFILES[detail];
    const plan = createBoundaryRenderPlan(vector(0, 0, 0), vector(10000, 10000, 10000), detail, "huge");
    assert.equal(plan.runes.length + plan.corners.length, profile.maxRunes);
    assert.equal(plan.corners.length, 8);
    assert.equal(
      plan.runes.every((rune) => Object.values(rune.position).every(Number.isFinite)),
      true
    );
  }
});

test("horizontal scan loops cover bottom and top perimeters", () => {
  const plan = createBoundaryRenderPlan(vector(0, 3, 0), vector(3, 5, 1), "balanced", "loop");
  assertVectorAlmostEqual(getBoundaryHorizontalLoopPoint(plan, "bottom", 0), vector(0, 3, 0));
  assertVectorAlmostEqual(getBoundaryHorizontalLoopPoint(plan, "bottom", 1 / 3), vector(4, 3, 0));
  assertVectorAlmostEqual(getBoundaryHorizontalLoopPoint(plan, "bottom", 0.5), vector(4, 3, 2));
  assertVectorAlmostEqual(getBoundaryHorizontalLoopPoint(plan, "top", 5 / 6), vector(0, 6, 2));
});

test("vertical scan visits all four columns from exact bottom to exact top", () => {
  const plan = createBoundaryRenderPlan(vector(2, 10, 4), vector(5, 14, 8), "high", "columns");
  for (let corner = 0; corner < 4; corner++) {
    assertVectorAlmostEqual(getBoundaryVerticalPoint(plan, corner, 0), plan.corners[corner]);
    assertVectorAlmostEqual(getBoundaryVerticalPoint(plan, corner, 1), plan.corners[corner + 4]);
  }
});

test("nearby selection includes every in-range land, filters dimensions, and prioritizes containing land", () => {
  const candidates = [
    { value: "near-edge", start: vector(10, 0, 0), end: vector(110, 5, 10), dimension: "overworld" },
    { value: "wrong-dimension", start: vector(0, 0, 0), end: vector(1, 1, 1), dimension: "nether" },
    { value: "nearest", start: vector(2, 0, 2), end: vector(3, 1, 3), dimension: "overworld" },
    { value: "priority", start: vector(500, 0, 500), end: vector(510, 5, 510), dimension: "overworld", priority: true },
    { value: "also-visible", start: vector(-20, 0, -20), end: vector(-18, 1, -18), dimension: "overworld" },
  ];
  const selected = selectNearestBoundaryCandidates(candidates, "overworld", vector(0, 0, 0), 32);
  assert.deepEqual(selected, ["priority", "nearest", "near-edge", "also-visible"]);
});
