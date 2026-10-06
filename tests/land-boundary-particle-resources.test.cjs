const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const test = require("node:test");
const root = path.resolve(__dirname, "..");
const pack = path.join(root, "resource_packs/CreeperMenu");
const names = [
  "ward_line_x_xy",
  "ward_line_x_xz",
  "ward_line_y_xy",
  "ward_line_y_yz",
  "ward_line_z_yz",
  "ward_line_z_xz",
  "ward_node",
  "ward_rune_xy",
  "ward_rune_yz",
  "ward_flow",
  "ward_curtain_xy",
  "ward_curtain_yz",
  "ward_band_xy",
  "ward_band_yz",
  "ward_spine_xy",
  "ward_spine_yz",
];
const read = (name) => JSON.parse(fs.readFileSync(path.join(pack, "particles", name + ".json"))).particle_effect;

test("curtain atlas animates client UVs while cropped panels stay inside their frame", () => {
  for (const plane of ["xy", "yz"]) {
    const billboard = read("ward_curtain_" + plane).components["minecraft:particle_appearance_billboard"];
    assert.equal(billboard.facing_camera_mode, "direction_z");
    assert.deepEqual(billboard.size, ["variable.panel_width / 2", "variable.panel_height / 2"]);
    const evaluate = (expression, vars) =>
      Function("variable", "math", "return " + expression)(vars, { floor: Math.floor, mod: (a, b) => a % b });
    for (const height of [1, 2, 4])
      for (const age of [0, 0.125, 1, 2.14]) {
        const vars = {
          animation_phase: 15,
          particle_age: age,
          panel_width: 3,
          panel_height: height,
          uv_u: 0,
          uv_v: 1 - height / 4,
        };
        const v = evaluate(billboard.uv.uv[1], vars),
          span = evaluate(billboard.uv.uv_size[1], vars);
        const frame = Math.floor(v / 128);
        assert.ok(frame >= 0 && frame < 16);
        assert.ok(v >= frame * 128 + 1 && v + span <= frame * 128 + 127);
      }
    const initial = { animation_phase: 0, particle_age: 0, uv_v: 0 };
    assert.notEqual(
      evaluate(billboard.uv.uv[1], initial),
      evaluate(billboard.uv.uv[1], { ...initial, particle_age: 0.125 })
    );
  }
  const png = fs.readFileSync(path.join(pack, "textures/particle/rbb_ward_curtain.png")),
    chunks = [];
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset);
    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT")
      chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const pixels = zlib.inflateSync(Buffer.concat(chunks)),
    stride = 128 * 4 + 1;
  assert.notDeepEqual(pixels.subarray(0, stride * 128), pixels.subarray(stride * 128 * 8, stride * 128 * 9));
});

test("ward resources resolve with correct texture dimensions, single particles and finite lifetimes", () => {
  for (const name of names) {
    const effect = read(name),
      c = effect.components;
    assert.equal(effect.description.identifier, "rbb:" + name);
    assert.equal(c["minecraft:emitter_rate_instant"].num_particles, 1);
    assert.equal(c["minecraft:particle_lifetime_expression"].max_lifetime, "variable.duration");
    const texture = fs.readFileSync(path.join(pack, effect.description.basic_render_parameters.texture + ".png"));
    const uv = c["minecraft:particle_appearance_billboard"].uv;
    assert.equal(texture.readUInt32BE(16), uv.texture_width);
    assert.equal(texture.readUInt32BE(20), uv.texture_height);
    assert.equal(
      effect.description.basic_render_parameters.material,
      /ward_(flow|band|spine)/.test(name) ? "particles_add" : "particles_blend"
    );
    assert.match(c["minecraft:particle_appearance_tinting"].color[3], /variable.duration - variable.particle_age/);
  }
});

test("crossed line pairs use perpendicular world planes and exact half-length sizing", () => {
  for (const name of names.filter((n) => n.startsWith("ward_line"))) {
    const billboard = read(name).components["minecraft:particle_appearance_billboard"];
    assert.ok(billboard.size.includes("variable.segment_length / 2"));
    assert.ok(billboard.size.includes(0.055));
    if (name.endsWith("xz")) assert.equal(billboard.facing_camera_mode, "emitter_transform_xz");
    else {
      assert.equal(billboard.facing_camera_mode, "direction_z");
      assert.deepEqual(billboard.direction.custom_direction, name.endsWith("xy") ? [0, 0, 1] : [1, 0, 0]);
    }
    assert.equal(billboard.size[0] === 0.055, name.includes("line_y_") || name === "ward_line_z_xz");
  }
  for (const plane of ["xy", "yz"])
    assert.equal(
      read("ward_rune_" + plane).components["minecraft:particle_appearance_billboard"].facing_camera_mode,
      "direction_z"
    );
});

test("actual client flow equations cross corners and refresh without jumping", () => {
  const position = read("ward_flow").components["minecraft:particle_motion_parametric"].relative_position;
  const evaluate = (expression, variables) =>
    typeof expression === "number"
      ? expression
      : Function(
          "variable",
          "math",
          "return " + expression
        )(variables, { min: Math.min, max: Math.max, mod: (a, b) => a % b });
  for (const phase of [0, 7.9, 11.9, 19.9, 23.9]) {
    const vars = { phase, width: 8, depth: 4, speed: 4, particle_age: 0, start_x: 0, start_z: 0 };
    vars.start_x = evaluate(position[0], vars);
    vars.start_z = evaluate(position[2], vars);
    assert.equal(evaluate(position[0], vars), 0);
    assert.equal(evaluate(position[2], vars), 0);
    for (let age = 0; age <= 2.15; age += 0.025) {
      vars.particle_age = age;
      const t = (phase + age * 4) % 24;
      const expected = t <= 8 ? [t, 0] : t <= 12 ? [8, t - 8] : t <= 20 ? [20 - t, 4] : [0, 24 - t];
      assert.ok(Math.abs(evaluate(position[0], vars) + vars.start_x - expected[0]) < 1e-9);
      assert.ok(Math.abs(evaluate(position[2], vars) + vars.start_z - expected[1]) < 1e-9);
    }
  }
});

test("neutral line masks join continuously and have no baked-in coloured background", () => {
  for (const name of ["rbb_ward_line_h", "rbb_ward_line_v"]) {
    const png = fs.readFileSync(path.join(pack, "textures/particle", name + ".png"));
    const width = png.readUInt32BE(16),
      height = png.readUInt32BE(20),
      chunks = [];
    for (let offset = 8; offset < png.length; ) {
      const length = png.readUInt32BE(offset);
      if (png.toString("ascii", offset + 4, offset + 8) === "IDAT")
        chunks.push(png.subarray(offset + 8, offset + 8 + length));
      offset += 12 + length;
    }
    const raw = zlib.inflateSync(Buffer.concat(chunks));
    const alpha = (x, y) => raw[y * (width * 4 + 1) + 1 + x * 4 + 3];
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const offset = y * (width * 4 + 1) + 1 + x * 4;
        assert.deepEqual([...raw.subarray(offset, offset + 3)], [255, 255, 255]);
        if (name.endsWith("_h")) assert.equal(alpha(x, y), alpha(0, y));
        else assert.equal(alpha(x, y), alpha(x, 0));
      }
    assert.ok(alpha(Math.floor(width / 2), Math.floor(height / 2)) > 180);
    assert.ok(alpha(0, 0) < 10);
  }
});
