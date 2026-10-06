const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const ts = require("typescript");

function harness() {
  const callbacks = [],
    jobs = [],
    emitted = [];
  const timers = [];
  const system = {
    currentTick: 0,
    run: (fn) => callbacks.push(fn),
    runJob: (job) => jobs.push(job),
    runTimeout: (fn, ticks) => timers.push({ fn, tick: system.currentTick + ticks }),
  };
  class MolangVariableMap {
    values = {};
    setFloat(key, value) {
      this.values[key] = value;
    }
    setColorRGBA(key, value) {
      this.values[key] = value;
    }
  }
  const cache = new Map();
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const filename = path.resolve(__dirname, "../scripts/features/land/services", name + ".ts");
    const mod = new Module(filename, module);
    mod.require = (id) => {
      if (id === "@minecraft/server") return { system, MolangVariableMap };
      if (id.includes("sapi-capabilities")) return { isDebugUtilitiesAvailable: () => false };
      if (id.endsWith("/color")) return { color: { red: (text) => text } };
      if (id.startsWith("./land-boundary-")) return load(id.slice(2));
      throw new Error("Unexpected import " + id);
    };
    mod._compile(
      ts.transpileModule(fs.readFileSync(filename, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText,
      filename
    );
    cache.set(name, mod.exports);
    return mod.exports;
  }
  const service = load("land-particle").default;
  const player = {
    id: "viewer",
    isValid: true,
    dimension: { id: "overworld" },
    location: { x: 1, y: 1, z: 1 },
    spawnParticle: (id, position, molang) => emitted.push({ id, position, values: molang.values }),
  };
  const flushCallbacks = () => {
    while (callbacks.length) callbacks.shift()();
  };
  const drain = () => {
    flushCallbacks();
    for (const job of jobs.splice(0))
      for (const _ of job) {
      }
  };
  const advance = (tick) => {
    system.currentTick = tick;
    for (let i = timers.length - 1; i >= 0; i--) if (timers[i].tick <= tick) timers.splice(i, 1)[0].fn();
    drain();
  };
  return {
    service,
    player,
    system,
    jobs,
    emitted,
    flushCallbacks,
    drain,
    advance,
    choreography: load("land-boundary-choreography"),
    colors: load("land-boundary-colors").landBoundaryColors,
  };
}
const box = [
  { x: 0, y: 0, z: 0 },
  { x: 19, y: 9, z: 19 },
];
const ambient = (h) => h.emitted.filter((p) => p.id !== "rbb:land_mote_wake");

test("ambient cores, companions and crossing wake share the world's assigned whole-land color", () => {
  const h = harness();
  const a = { name: "a", owner: "owner", dimension: "overworld", vectors: { start: box[0], end: box[1] } };
  const b = { ...a, name: "b", vectors: { start: { x: 20, y: 0, z: 0 }, end: { x: 39, y: 9, z: 19 } } };
  h.colors.setSource(() => ({ a, b }));
  h.service.createLandAmbientBoundaryBurst(h.player, box, { seed: "a:owner", variant: "owner" });
  h.drain();
  const expected = h.colors.get("a:owner");
  for (const particle of h.emitted.filter((p) => p.values["variable.outline"] || p.id === "rbb:land_mote_wake")) {
    const tint = particle.values["variable.color"];
    assert.deepEqual([tint.red, tint.green, tint.blue], [expected.red, expected.green, expected.blue]);
  }
  assert.notDeepEqual(h.colors.get("a:owner"), h.colors.get("b:owner"));
  h.emitted.length = 0;
  h.advance(60);
  h.service.createLandAmbientBoundary(h.player, box, { seed: "a:owner", variant: "foreign" });
  h.drain();
  const marker = h.emitted.find((p) => p.id === "rbb:land_mote_marker");
  assert.deepEqual(marker.values["variable.color"], { ...expected, alpha: 1 });
});

test("all twelve real edges share spacing, size and original mote companions on a deep claim", () => {
  const h = harness();
  h.player.location = { x: 15, y: 10, z: 15 };
  h.player.dimension.getTopmostBlock = () => {
    throw new Error("must not depend on terrain");
  };
  const bounds = [
    { x: 0, y: -60, z: 0 },
    { x: 29, y: 41, z: 29 },
  ];
  const budget = { remaining: 540 };
  h.service.createLandAmbientBoundary(h.player, bounds, { seed: "deep", budget });
  h.drain();
  const markers = h.emitted.filter((p) => p.id === "rbb:land_mote_marker");
  const gaps = new Set();
  let groups = 0;
  for (const axis of ["x", "y", "z"]) {
    const other = ["x", "y", "z"].filter((a) => a !== axis);
    for (const sideA of [bounds[0][other[0]], bounds[1][other[0]] + 1])
      for (const sideB of [bounds[0][other[1]], bounds[1][other[1]] + 1]) {
        const points = markers
          .filter((p) => p.position[other[0]] === sideA && p.position[other[1]] === sideB)
          .sort((a, b) => a.position[axis] - b.position[axis]);
        assert.ok(points.length >= 4, "every edge, including buried bottom and tall verticals, needs samples");
        groups++;
        for (let i = 1; i < points.length; i++) gaps.add(points[i].position[axis] - points[i - 1].position[axis]);
        for (const p of points) {
          assert.equal(p.values["variable.size_scale"], 1.35);
          const companions = h.emitted.filter(
            (q) => q.values["variable.outline"] === 1 && JSON.stringify(q.position) === JSON.stringify(p.position)
          );
          assert.deepEqual(
            companions.map((q) => q.id).sort(),
            ["rbb:land_mote_marker", "rbb:land_mote_glow", "rbb:land_mote_crystal"].sort()
          );
          assert.ok(companions.every((q) => q.values["variable.count"] === 1));
        }
      }
  }
  assert.equal(groups, 12);
  assert.equal(gaps.size, 1, "top, bottom and vertical edges must have exactly the same spacing");
  assert.equal(h.emitted.reduce((sum, p) => sum + p.values["variable.count"], 0) + budget.remaining, 540);
  assert.ok(h.emitted.every((p) => !p.values["variable.projected"]));
});

test("wake origins project onto inclusive box faces for side, vertical and teleport crossings", () => {
  const { boundaryWakeOrigin, boundaryCluster } = harness().choreography;
  const bounds = { min: { x: 0, y: 0, z: 0 }, max: { x: 20, y: 10, z: 20 } };
  for (const [viewer, expected] of [
    [
      { x: 0.2, y: 4, z: 10 },
      { x: 0, y: 4, z: 10 },
    ],
    [
      { x: 10, y: 9.9, z: 10 },
      { x: 10, y: 10, z: 10 },
    ],
    [
      { x: -5, y: 15, z: 22 },
      { x: 0, y: 10, z: 20 },
    ],
  ])
    assert.deepEqual(boundaryWakeOrigin(bounds, viewer), expected);
  assert.equal(boundaryCluster("a", bounds.min), boundaryCluster("a", bounds.min));
  assert.notEqual(boundaryCluster("a", bounds.min), boundaryCluster("a", bounds.max));
});

test("local wake cells cover top crossings and stay bounded on enormous claims", () => {
  const { boundaryWakePatches } = harness().choreography;
  const bounds = { min: { x: 0, y: 0, z: 0 }, max: { x: 1000000, y: 256, z: 1000000 } };
  const origin = { x: 500000, y: 256, z: 500000 };
  const patches = boundaryWakePatches(bounds, origin);
  assert.ok(patches.length > 10 && patches.length <= 72);
  assert.ok(patches.every((p) => p.position.y === 256 && p.span.y === 0.6));
  for (const p of patches) assert.ok(Math.hypot(p.position.x - origin.x, p.position.z - origin.z) <= 24);
});

test("runtime uses only separate custom motes, with bounded randomized patches and no line or wall graphics", () => {
  const h = harness();
  h.service.createLandAmbientBoundary(h.player, box, { seed: "test", variant: "owner" });
  h.drain();
  assert.ok(h.emitted.length > 0);
  const names = new Set(h.emitted.map((p) => p.id));
  assert.ok(names.has("rbb:land_mote_glow") && names.has("rbb:land_mote_dust"));
  assert.ok(
    [...names].every((id) =>
      [
        "rbb:land_mote_marker",
        "rbb:land_mote_corner",
        "rbb:land_mote_glow",
        "rbb:land_mote_crystal",
        "rbb:land_mote_dust",
      ].includes(id)
    )
  );
  assert.ok(h.emitted.every((p) => p.values["variable.duration"] === 2.6));
  const total = h.emitted.reduce((sum, p) => sum + p.values["variable.count"], 0);
  const crystals = h.emitted
    .filter((p) => p.id === "rbb:land_mote_crystal")
    .reduce((sum, p) => sum + p.values["variable.count"], 0);
  assert.ok(crystals / total <= 1 / 3, "each outline cluster has one colored crystal, not a cloud of white confetti");
  assert.ok(new Set(h.emitted.map((p) => p.values["variable.phase"])).size > 10);
  for (const particle of h.emitted) {
    const faces = ["x", "y", "z"].filter(
      (axis) => particle.position[axis] === box[0][axis] || particle.position[axis] === box[1][axis] + 1
    );
    assert.ok(faces.length >= 1, "particles stay on true faces, edges and corners");
    assert.ok(particle.values["variable.count"] > 0);
    for (const axis of ["x", "y", "z"]) {
      const min = particle.position[axis] + particle.values[`variable.min_${axis}`];
      const max = particle.position[axis] + particle.values[`variable.max_${axis}`];
      assert.ok(min >= box[0][axis]);
      assert.ok(max <= box[1][axis] + 1);
      assert.ok(min <= max);
    }
  }
});

test("entry lasts three seconds plus fade without changing normal refresh lifetime", () => {
  const h = harness();
  h.service.createLandAmbientBoundaryBurst(h.player, box);
  h.drain();
  assert.ok(h.emitted.length > 0);
  assert.ok(ambient(h).every((p) => p.values["variable.duration"] === 3.6));
  assert.ok(
    h.emitted.filter((p) => p.id === "rbb:land_mote_wake").every((p) => p.values["variable.duration"] === 3.15)
  );
  const count = ambient(h).length;
  h.advance(40);
  h.service.createLandAmbientBoundary(h.player, box);
  h.drain();
  assert.equal(ambient(h).length, count);
  h.advance(60);
  h.service.createLandAmbientBoundary(h.player, box);
  h.drain();
  assert.ok(
    ambient(h)
      .slice(count)
      .every((p) => p.values["variable.duration"] === 2.6)
  );
  assert.equal(ambient(h).length, count * 2);
});

test("entry extends an existing frame to three seconds without double-painting", () => {
  const h = harness();
  h.service.createLandAmbientBoundary(h.player, box);
  h.service.createLandAmbientBoundaryBurst(h.player, box);
  h.drain();
  const count = ambient(h).length;
  h.advance(40);
  assert.equal(ambient(h).length, count * 2);
  assert.ok(
    ambient(h)
      .slice(count)
      .every((p) => p.values["variable.duration"] === 1.6)
  );
  h.service.createLandAmbientBoundary(h.player, box);
  h.drain();
  assert.equal(ambient(h).length, count * 2);
});

test("repeated transitions extend from the latest crossing and dimension changes cancel continuation", () => {
  const h = harness();
  h.service.createLandAmbientBoundaryBurst(h.player, box);
  h.drain();
  const count = ambient(h).length;
  h.advance(20);
  h.service.createLandAmbientBoundaryBurst(h.player, box);
  h.advance(60);
  assert.equal(ambient(h).length, count * 2);
  assert.ok(
    ambient(h)
      .slice(count)
      .every((p) => p.values["variable.duration"] === 1.6)
  );

  const cancelled = harness();
  cancelled.service.createLandAmbientBoundary(cancelled.player, box);
  cancelled.service.createLandAmbientBoundaryBurst(cancelled.player, box);
  cancelled.drain();
  const original = cancelled.emitted.length;
  cancelled.player.dimension.id = "nether";
  cancelled.advance(40);
  assert.equal(cancelled.emitted.length, original);
});

test("crossings immediately wake local clusters in distance order while ambient is leased", () => {
  const h = harness();
  h.player.location = { x: 0.2, y: 4, z: 10 };
  h.service.createLandAmbientBoundary(h.player, box);
  h.drain();
  const count = ambient(h).length;
  h.service.createLandAmbientBoundaryBurst(h.player, box);
  h.drain();
  assert.equal(ambient(h).length, count);
  const wake = h.emitted.filter((p) => p.id === "rbb:land_mote_wake");
  assert.ok(wake.length > 3);
  assert.deepEqual(wake[0].position, { x: 0, y: 4, z: 10 });
  assert.equal(wake[0].values["variable.delay"], 0);
  assert.ok(wake.some((p) => p.values["variable.delay"] > 0.15));
  assert.equal(wake[0].values["variable.focus"], 1);
  assert.ok(wake.slice(1).every((p) => p.values["variable.delay"] >= 0.22 && p.values["variable.delay"] <= 1.25));
  assert.ok(wake.slice(1).every((p) => p.values["variable.color"].alpha < wake[0].values["variable.color"].alpha));
  for (let i = 0; i < 15; i++) h.service.createLandAmbientBoundaryBurst(h.player, box);
  h.drain();
  assert.ok(
    h.emitted.filter((p) => p.id === "rbb:land_mote_wake").reduce((sum, p) => sum + p.values["variable.count"], 0) <=
      144
  );
});

test("wake responds at crossing height on a tall claim, and deferred wakes cancel across dimensions", () => {
  const h = harness();
  h.player.location = { x: 0.1, y: 120, z: 10 };
  h.service.createLandAmbientBoundaryBurst(h.player, [box[0], { x: 19, y: 255, z: 19 }]);
  h.drain();
  const wake = h.emitted.filter((p) => p.id === "rbb:land_mote_wake");
  assert.ok(wake.length > 0);
  assert.deepEqual(wake[0].position, { x: 0, y: 120, z: 10 });
  assert.ok(wake.every((p) => Math.abs(p.position.y - 120) <= 24));
  const cancelled = harness();
  cancelled.service.createLandAmbientBoundaryBurst(cancelled.player, box);
  cancelled.player.dimension.id = "nether";
  cancelled.drain();
  assert.equal(cancelled.emitted.length, 0);
});

test("a quick return crossing retains an immediate focus pulse within the shared wake budget", () => {
  const h = harness();
  h.service.createLandAmbientBoundaryBurst(h.player, box);
  h.drain();
  const wakeCount = h.emitted
    .filter((p) => p.id === "rbb:land_mote_wake")
    .reduce((sum, p) => sum + p.values["variable.count"], 0);
  assert.ok(wakeCount <= 51);
  const first = h.emitted.length;
  h.advance(10);
  h.service.createLandAmbientBoundaryBurst(h.player, box);
  h.drain();
  assert.ok(h.emitted.slice(first).some((p) => p.id === "rbb:land_mote_wake" && p.values["variable.focus"] === 1));
});

test("far corners stay equally bright and every neighboring land receives a readable outline", () => {
  const h = harness();
  for (let i = 0; i < 4; i++)
    h.service.createLandAmbientBoundary(
      h.player,
      [
        { x: i * 30, y: 0, z: 0 },
        { x: i * 30 + 19, y: 9, z: 19 },
      ],
      { budget: { remaining: 180 } }
    );
  h.drain();
  for (let i = 0; i < 4; i++)
    for (const x of [i * 30, i * 30 + 20])
      for (const y of [0, 10])
        for (const z of [0, 20]) {
          const corner = h.emitted.find((p) => p.position.x === x && p.position.y === y && p.position.z === z);
          assert.ok(corner, "all visible corners of all four lands must be represented");
          assert.equal(corner.values["variable.color"].alpha, 1);
        }
  assert.ok(h.emitted.reduce((sum, p) => sum + p.values["variable.count"], 0) <= 720);
});

test("continuous display bridges a long entry lease and respects disabling before renewal", () => {
  for (const enabled of [true, false]) {
    const h = harness();
    h.service.createLandAmbientBoundaryBurst(h.player, box);
    h.drain();
    const count = ambient(h).length;
    h.advance(40);
    let active = true;
    h.service.createLandAmbientBoundary(h.player, box, { active: () => active });
    h.drain();
    assert.equal(ambient(h).length, count);
    active = enabled;
    h.advance(60);
    assert.equal(ambient(h).length, enabled ? count * 2 : count);
  }
});

test("multiple concurrent land jobs respect one player budget", () => {
  const h = harness(),
    budget = { remaining: 101 };
  for (let x = 0; x < 4; x++)
    h.service.createLandAmbientBoundary(
      h.player,
      [
        { x, y: 0, z: 0 },
        { x: x + 19, y: 19, z: 19 },
      ],
      { budget }
    );
  h.drain();
  const particleCount = h.emitted.reduce((sum, p) => sum + p.values["variable.count"], 0);
  assert.ok(particleCount <= 101);
  assert.equal(particleCount + budget.remaining, 101);
});

test("refreshing after movement and neighbor budget changes preserves marker positions and sizes", () => {
  const h = harness();
  const markers = () =>
    h.emitted
      .filter((p) => p.id === "rbb:land_mote_marker")
      .map((p) => ({
        position: p.position,
        scale: p.values["variable.size_scale"],
        phase: p.values["variable.phase"],
      }));
  h.service.createLandAmbientBoundary(h.player, box, { seed: "fixed", budget: { remaining: 540 } });
  h.drain();
  const first = markers();
  assert.ok(first.length > 50);
  h.emitted.length = 0;
  h.advance(40);
  h.player.location = { x: 4, y: 5, z: 3 };
  h.service.createLandAmbientBoundary(h.player, box, { seed: "fixed", budget: { remaining: 2160 } });
  h.drain();
  assert.deepEqual(markers(), first);
});

test("dimension changes cancel both deferred calls and partially generated frames", () => {
  const h = harness();
  h.service.createLandAmbientBoundary(h.player, box);
  h.player.dimension.id = "nether";
  h.drain();
  assert.equal(h.emitted.length, 0);
  h.service.createLandAmbientBoundary(h.player, box);
  h.flushCallbacks();
  assert.equal(h.jobs[0].next().done, false);
  const count = h.emitted.length;
  h.player.dimension.id = "overworld";
  h.drain();
  assert.equal(h.emitted.length, count);
});

test("stale jobs expire and failed chunk emissions do not abort other segments", () => {
  const h = harness();
  h.service.createLandAmbientBoundary(h.player, box);
  h.flushCallbacks();
  h.system.currentTick = 21;
  h.drain();
  assert.equal(h.emitted.length, 0);
  h.system.currentTick = 40;
  const spawn = h.player.spawnParticle;
  h.player.spawnParticle = (id, ...args) => {
    if (id === "rbb:land_mote_dust") throw new Error("unloaded");
    spawn(id, ...args);
  };
  h.service.createLandAmbientBoundary(h.player, box);
  h.drain();
  assert.ok(h.emitted.some((p) => p.id === "rbb:land_mote_glow"));
});
