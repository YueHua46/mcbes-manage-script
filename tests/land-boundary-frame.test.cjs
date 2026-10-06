const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const ts = require("typescript");
const base = path.resolve(__dirname, "../scripts/features/land/services");
const cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name);
  const file = path.join(base, name + ".ts");
  const mod = new Module(file, module);
  mod.require = (id) => (id.startsWith("./land-boundary-") ? load(id.slice(2)) : require(id));
  mod._compile(
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    file
  );
  cache.set(name, mod.exports);
  return mod.exports;
}
const { createBoundaryRenderPlan } = load("land-boundary-render-plan");
const { planBoundaryFrame, FRAME_PROFILES, boundaryFlowOffset, reserveBoundaryParticles } = load("land-boundary-frame");
const { planBoundaryCurtain } = load("land-boundary-frame");
const { planBoundaryOutline } = load("land-boundary-frame");
const { planBoundaryMarkers } = load("land-boundary-frame");
const v = (x, y, z) => ({ x, y, z });

test("terrain footprint covers every horizontal edge regardless of claim height and stays bounded on huge claims", () => {
  const { planBoundaryFootprint } = load("land-boundary-frame");
  const plan = createBoundaryRenderPlan(v(0, -60, 0), v(19, -50, 19), "balanced");
  const points = planBoundaryFootprint(plan, v(10, 100, 10), "balanced", 73);
  assert.equal(points.filter((p) => p.corner).length, 4);
  assert.ok(points.length >= 40 && points.length + 8 <= 81);
  for (const axis of ["x", "z"])
    for (const side of [0, 20]) {
      assert.ok(points.filter((p) => !p.corner && p.position[axis] === side).length >= 9);
    }
  const huge = createBoundaryRenderPlan(v(-1000000, -60, 0), v(1000000, -50, 1000000), "balanced");
  const samples = planBoundaryFootprint(huge, v(0, 100, 5), "balanced", 73);
  assert.ok(samples.length > 0 && samples.length <= 73);
  assert.ok(samples.every((p) => Math.hypot(p.position.x, p.position.z - 5) <= 128));
});

test("fixed marker lattice is bounded on huge lands and only visibility changes with the viewer", () => {
  const plan = createBoundaryRenderPlan(v(-1000000, 0, 0), v(1000000, 19, 19), "balanced");
  const key = (p) => [p.x, p.y, p.z].join(":");
  const a = planBoundaryMarkers(plan, v(0, 5, 5), "balanced", 136);
  const b = planBoundaryMarkers(plan, v(3, 5, 5), "balanced", 136);
  assert.ok(a.length > 10 && a.length <= 136 && b.length <= 136);
  const set = new Set(b.map(key));
  assert.ok(a.filter((p) => set.has(key(p))).length >= a.length * 0.85);
  assert.ok(a.every((p) => (p.x - plan.bounds.min.x) % 2 === 0));
});

test("limited particle samples cover all twelve visible edges instead of just nearby edges", () => {
  const plan = createBoundaryRenderPlan(v(0, 0, 0), v(59, 19, 59), "balanced");
  const samples = planBoundaryOutline(plan, v(-2, 5, -2), "balanced", 36);
  assert.equal(samples.length, 36);
  for (const edge of plan.edges) {
    const count = samples.filter(
      (s) =>
        s.axis === edge.axis &&
        ["x", "y", "z"].every((axis) => axis === s.axis || s.position[axis] === edge.start[axis])
    ).length;
    assert.equal(count, 3);
  }
});

test("segmented frame covers all twelve exact block faces without gaps or overshoot", () => {
  const plan = createBoundaryRenderPlan(v(-3, 4, 2), v(18, 15, 20), "balanced");
  const segments = planBoundaryFrame(plan, plan.bounds.center, "balanced");
  for (const edge of plan.edges) {
    const spans = segments
      .filter(
        (s) => s.axis === edge.axis && ["x", "y", "z"].every((a) => a === edge.axis || s.position[a] === edge.start[a])
      )
      .map((s) => [s.position[s.axis] - s.length / 2, s.position[s.axis] + s.length / 2])
      .sort((a, b) => a[0] - b[0]);
    assert.equal(spans[0][0], Math.min(edge.start[edge.axis], edge.end[edge.axis]));
    assert.equal(spans.at(-1)[1], Math.max(edge.start[edge.axis], edge.end[edge.axis]));
    for (let i = 1; i < spans.length; i++) assert.equal(spans[i - 1][1], spans[i][0]);
  }
  assert.ok(segments.every((s) => s.length > 0 && s.length <= 4));
});

test("single block has twelve unit segments, eight corners, and no oversized rune clutter", () => {
  const plan = createBoundaryRenderPlan(v(0, 0, 0), v(0, 0, 0), "high");
  assert.equal(plan.runes.length, 0);
  const segments = planBoundaryFrame(plan, v(0.5, 0.5, 0.5), "high");
  assert.equal(segments.length, 12);
  assert.ok(segments.every((s) => s.length === 1));
});

test("huge lands clip before tessellation and only render actual nearby edges", () => {
  const plan = createBoundaryRenderPlan(v(-1000000, 0, 0), v(1000000, 19, 19), "high");
  for (const detail of ["low", "balanced", "high"]) {
    const segments = planBoundaryFrame(plan, v(0, 1, 1), detail);
    assert.ok(segments.length > 0 && segments.length <= FRAME_PROFILES[detail].maxSegments);
    assert.ok(segments.every((s) => s.axis === "x" && s.distance <= FRAME_PROFILES[detail].distance));
    assert.ok(segments.every((s, i) => i === 0 || s.distance >= segments[i - 1].distance));
    assert.deepEqual(planBoundaryFrame(plan, v(0, 1000, 0), detail), []);
  }
});

test("one shared budget caps multiple lands, preserving complete crossed line pairs", () => {
  const budget = { remaining: 7 };
  for (let land = 0; land < 4; land++) assert.equal(reserveBoundaryParticles(budget, 2), land < 3);
  assert.equal(budget.remaining, 1);
  assert.equal(reserveBoundaryParticles(budget, 1), true);
  assert.equal(reserveBoundaryParticles(budget, 1), false);
});

test("four-block-per-second flow crosses corners and wraps without position jumps", () => {
  const width = 8,
    depth = 4;
  for (const [distance, expected] of [
    [0, [0, 0]],
    [8, [8, 0]],
    [12, [8, 4]],
    [20, [0, 4]],
    [24, [0, 0]],
  ]) {
    assert.deepEqual(boundaryFlowOffset(width, depth, distance), { x: expected[0], z: expected[1] });
  }
  for (let distance = -8; distance < 80; distance += 0.125) {
    const a = boundaryFlowOffset(width, depth, distance),
      b = boundaryFlowOffset(width, depth, distance + 0.125);
    assert.ok(Math.abs(Math.abs(b.x - a.x) + Math.abs(b.z - a.z) - 0.125) < 1e-9);
    assert.ok(a.x >= 0 && a.x <= width && a.z >= 0 && a.z <= depth);
  }
});

test("curtain panels exactly cover four side faces including partial top and end cells", () => {
  const plan = createBoundaryRenderPlan(v(-3, 4, 2), v(15, 13, 18), "balanced");
  const panels = planBoundaryCurtain(plan, plan.bounds.center, "balanced");
  assert.equal(
    panels.reduce((area, p) => area + p.width * p.height, 0),
    2 * (plan.bounds.size.x + plan.bounds.size.z) * plan.bounds.size.y
  );
  assert.ok(panels.some((p) => p.width < 4));
  assert.ok(panels.some((p) => p.height < 4));
  for (const panel of panels) {
    const axis = panel.plane === "xy" ? "x" : "z",
      normal = axis === "x" ? "z" : "x";
    assert.ok([plan.bounds.min[normal], plan.bounds.max[normal]].includes(panel.position[normal]));
    assert.ok(panel.position[axis] - panel.width / 2 >= plan.bounds.min[axis]);
    assert.ok(panel.position[axis] + panel.width / 2 <= plan.bounds.max[axis]);
    assert.ok(panel.position.y - panel.height / 2 >= plan.bounds.min.y);
    assert.ok(panel.position.y + panel.height / 2 <= plan.bounds.max.y);
    assert.ok(Math.abs(panel.v + panel.height / 4 - 1) < 1e-9);
  }
});

test("curtain supports tiny, reversed and huge lands without inventing a surface at viewer height", () => {
  const small = createBoundaryRenderPlan(v(1, 2, 3), v(1, 2, 3), "high");
  const panels = planBoundaryCurtain(small, v(1.5, 2.5, 3.5), "high");
  assert.equal(panels.length, 4);
  assert.ok(panels.every((p) => p.width === 1 && p.height === 1));
  const forward = createBoundaryRenderPlan(v(-5, -20, -5), v(20, 20, 20), "balanced");
  const reverse = createBoundaryRenderPlan(v(20, 20, 20), v(-5, -20, -5), "balanced");
  assert.deepEqual(
    planBoundaryCurtain(forward, v(0, 0, 0), "balanced"),
    planBoundaryCurtain(reverse, v(0, 0, 0), "balanced")
  );
  const huge = createBoundaryRenderPlan(v(-1000000, -1000000, 0), v(1000000, 1000000, 20), "high");
  const near = planBoundaryCurtain(huge, v(0, 0, 1), "high");
  assert.ok(near.length > 0 && near.length <= FRAME_PROFILES.high.maxPanels);
  assert.ok(near.every((p) => p.position.z === 0 || p.position.z === 21));
  assert.deepEqual(planBoundaryCurtain(huge, v(0, 0, 500), "high"), []);
});
