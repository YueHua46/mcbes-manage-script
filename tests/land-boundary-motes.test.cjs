const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const root = path.resolve(__dirname, "../resource_packs/CreeperMenu");
const read = (kind) =>
  JSON.parse(fs.readFileSync(path.join(root, "particles/land_mote_" + kind + ".json"))).particle_effect;

test("boundary swarm uses square filled sprites and accounts for every particle per emitter", () => {
  for (const kind of ["marker", "corner", "glow", "crystal", "dust", "wake"]) {
    const effect = read(kind),
      c = effect.components;
    assert.equal(effect.description.identifier, "rbb:land_mote_" + kind);
    assert.equal(c["minecraft:emitter_rate_instant"].num_particles, "variable.count");
    const billboard = c["minecraft:particle_appearance_billboard"];
    assert.equal(billboard.facing_camera_mode, "rotate_xyz");
    assert.equal(billboard.size[0], billboard.size[1]);
    const png = fs.readFileSync(path.join(root, effect.description.basic_render_parameters.texture + ".png"));
    assert.equal(png.readUInt32BE(16), png.readUInt32BE(20));
    assert.equal(c["minecraft:particle_lifetime_expression"].max_lifetime, "variable.duration");
    if (kind !== "marker" && kind !== "corner") assert.match(JSON.stringify(c), /variable.particle_random_4/);
  }
});

test("soft core cannot randomize or drift and keeps additive brightness stable across refresh", () => {
  const effect = read("marker"),
    c = effect.components;
  assert.equal(effect.description.basic_render_parameters.material, "particles_add");
  assert.deepEqual(c["minecraft:particle_motion_parametric"].relative_position, [0, 0, 0]);
  assert.doesNotMatch(JSON.stringify(c), /particle_random/);
  assert.deepEqual(c["minecraft:particle_initial_spin"], { rotation: 0, rotation_rate: 0 });
  const expression = c["minecraft:particle_appearance_tinting"].color[3];
  const math = { clamp: (v, a, b) => Math.min(b, Math.max(a, v)) };
  const alpha = (particle_age) =>
    Function(
      "variable",
      "math",
      "return " + expression
    )({ color: { a: 1 }, fade: 0.6, duration: 2.6, particle_age }, math);
  for (let t = 2; t <= 2.6; t += 0.01) {
    const composite = alpha(t) + alpha(t - 2);
    assert.ok(Math.abs(composite - 1) < 1e-9, "additive light cores must not double brightness or dim at handover");
  }
});

test("corner crystal shares stationary marker handover but has its own faceted texture", () => {
  const marker = read("marker"),
    corner = read("corner");
  assert.deepEqual(corner.components, marker.components);
  assert.equal(corner.description.basic_render_parameters.material, "particles_add");
  assert.notEqual(
    corner.description.basic_render_parameters.texture,
    marker.description.basic_render_parameters.texture
  );
});

test("actual client equations keep drifting motes inside patch and land bounds throughout their life", () => {
  const expression = read("glow").components["minecraft:particle_motion_parametric"].relative_position;
  const math = {
    sin: (v) => Math.sin((v * Math.PI) / 180),
    max: Math.max,
    clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
  };
  for (const span of [1, 4])
    for (const particle_random_1 of [0, 0.2, 0.8, 1])
      for (const age of [0, 0.5, 1.15, 2.15, 3.15]) {
        const variables = {
          span_x: span,
          span_y: span,
          span_z: 0.45,
          min_x: -span / 2,
          max_x: span / 2,
          min_y: 0,
          max_y: span / 2,
          min_z: -0.225,
          max_z: 0,
          particle_random_1,
          particle_random_2: 1 - particle_random_1,
          particle_random_3: 0.7,
          particle_random_4: 0.3,
          particle_age: age,
          delay: 0.4,
          phase: 135,
          clock: 0,
          fade: 0.6,
          size_scale: 1,
        };
        for (let i = 0; i < 3; i++) {
          const axis = ["x", "y", "z"][i];
          const value = Function("variable", "math", "return " + expression[i])(variables, math);
          assert.ok(value >= variables["min_" + axis] && value <= variables["max_" + axis]);
        }
      }
  assert.ok(expression.some((e) => e.includes("particle_age")));
});

test("wake visibility travels with delay and dissolves, with finite sizes and motion", () => {
  const effect = read("wake").components;
  const alpha = effect["minecraft:particle_appearance_tinting"].color[3];
  const math = {
    sin: (v) => Math.sin((v * Math.PI) / 180),
    max: Math.max,
    clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
  };
  const variable = { color: { a: 1 }, duration: 3.15, delay: 0.5, focus: 0, clock: 0, fade: 0.6, size_scale: 1 };
  const evaluate = (age) => Function("variable", "math", "return " + alpha)({ ...variable, particle_age: age }, math);
  assert.equal(evaluate(0.4), 0);
  assert.ok(evaluate(0.75) > 0.8);
  assert.equal(evaluate(2), 0);
  assert.equal(evaluate(3.15), 0);
  for (const kind of ["glow", "crystal", "dust", "wake"])
    for (const delay of [0, 0.9])
      for (const age of [0, 0.2, 1, 2.8, 3.15]) {
        const variables = {
          ...variable,
          delay,
          phase: 240,
          particle_age: age,
          particle_random_1: 0.1,
          particle_random_2: 0.6,
          particle_random_3: 0.8,
          particle_random_4: 0.9,
        };
        const c = read(kind).components;
        const opacity = Function(
          "variable",
          "math",
          "return " + c["minecraft:particle_appearance_tinting"].color[3]
        )(variables, math);
        const size = Function(
          "variable",
          "math",
          "return " + c["minecraft:particle_appearance_billboard"].size[0]
        )(variables, math);
        assert.ok(Number.isFinite(opacity) && opacity >= 0 && opacity <= 1);
        assert.ok(Number.isFinite(size) && size > 0 && size <= 0.24);
      }
});

test("crossing core gathers faster and finishes before the surrounding response", () => {
  const alpha = read("wake").components["minecraft:particle_appearance_tinting"].color[3];
  const math = { max: Math.max, clamp: (v, a, b) => Math.min(b, Math.max(a, v)) };
  const opacity = (focus, delay, particle_age) =>
    Function(
      "variable",
      "math",
      "return " + alpha
    )({ color: { a: 1 }, duration: 3.15, focus, delay, particle_age }, math);
  assert.ok(opacity(1, 0, 0.1) > 0.9);
  assert.equal(opacity(0, 0.4, 0.1), 0);
  assert.equal(opacity(1, 0, 0.75), 0);
  assert.ok(opacity(0, 0.4, 0.75) > 0.8);
});

test("refresh crossfade preserves brightness and global motion throughout the handover", () => {
  const effect = read("glow").components;
  const alpha = effect["minecraft:particle_appearance_tinting"].color[3];
  const motion = effect["minecraft:particle_motion_parametric"].relative_position;
  const math = {
    sin: (v) => Math.sin((v * Math.PI) / 180),
    max: Math.max,
    clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
  };
  const common = {
    color: { a: 1 },
    duration: 2.6,
    delay: 0,
    fade: 0.6,
    phase: 70,
    size_scale: 1,
    span_x: 4,
    span_y: 0.6,
    span_z: 0.6,
    min_x: -2,
    max_x: 2,
    min_y: -0.3,
    max_y: 0.3,
    min_z: -0.3,
    max_z: 0.3,
    particle_random_1: 0.2,
    particle_random_2: 0.4,
    particle_random_3: 0.7,
    particle_random_4: 0.3,
  };
  const evaluate = (expression, variable) => Function("variable", "math", "return " + expression)(variable, math);
  for (let t = 2; t <= 2.6; t += 0.02) {
    const old = { ...common, particle_age: t, clock: 0 };
    const next = { ...common, particle_age: t - 2, clock: 2 };
    const total = evaluate(alpha, old) + evaluate(alpha, next);
    assert.ok(total >= 0.919 && total <= 1.001, "handover must not dim or double brightness");
    for (const expression of motion) assert.ok(Math.abs(evaluate(expression, old) - evaluate(expression, next)) < 1e-9);
  }
});
