// Deterministic, code-native masks and particle definitions. Run from any directory.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const root = path.resolve(__dirname, "../resource_packs/CreeperMenu");
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const size = Buffer.alloc(4),
    checksum = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, body, checksum]);
}
function texture(name, width, height, alpha, outputPath = path.join(root, "textures/particle", name + ".png")) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = y * (width * 4 + 1) + 1 + x * 4;
      const sample = alpha((x + 0.5) / width, (y + 0.5) / height);
      const rgba = Array.isArray(sample) ? sample : [255, 255, 255, sample];
      pixels[offset] = rgba[0];
      pixels[offset + 1] = rgba[1];
      pixels[offset + 2] = rgba[2];
      pixels[offset + 3] = Math.round(Math.min(1, Math.max(0, rgba[3])) * 255);
    }
  fs.writeFileSync(
    outputPath,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", zlib.deflateSync(pixels)),
      chunk("IEND", Buffer.alloc(0)),
    ])
  );
}
const fade =
  "variable.color.a * math.min(variable.particle_age / 0.15, 1) * math.min((variable.duration - variable.particle_age) / 0.15, 1)";
const planes = {
  xy: { facing_camera_mode: "direction_z", direction: { mode: "custom_direction", custom_direction: [0, 0, 1] } },
  // Normal along X, vertical billboard axis along world Y; horizontal axis is world Z.
  yz: { facing_camera_mode: "direction_z", direction: { mode: "custom_direction", custom_direction: [1, 0, 0] } },
  xz: { facing_camera_mode: "emitter_transform_xz" },
};
function particle(
  name,
  tex,
  size,
  facing,
  dimensions,
  additions = {},
  material = "particles_blend",
  billboardExtra = {}
) {
  const document = {
    format_version: "1.10.0",
    particle_effect: {
      description: {
        identifier: "rbb:" + name,
        basic_render_parameters: { material, texture: "textures/particle/" + tex },
      },
      components: {
        "minecraft:emitter_rate_instant": { num_particles: 1 },
        "minecraft:emitter_lifetime_once": { active_time: 0.01 },
        "minecraft:emitter_shape_point": {},
        "minecraft:particle_initial_speed": 0,
        "minecraft:particle_lifetime_expression": { max_lifetime: "variable.duration" },
        "minecraft:particle_appearance_billboard": {
          size,
          ...facing,
          uv: { texture_width: dimensions[0], texture_height: dimensions[1], uv: [0, 0], uv_size: dimensions },
          ...billboardExtra,
        },
        "minecraft:particle_appearance_tinting": {
          color: ["variable.color.r", "variable.color.g", "variable.color.b", fade],
        },
        ...additions,
      },
    },
  };
  fs.writeFileSync(path.join(root, "particles", name + ".json"), JSON.stringify(document, null, 2) + "\n");
}
function main() {
  const crossSection = (v) => {
    const d = Math.abs(v - 0.5);
    return Math.max(0, 1 - d / 0.12) * 0.8 + Math.max(0, 1 - d / 0.48) ** 2 * 0.2;
  };
  // Constant along the long axis: adjacent segments join without dotted endpoints.
  texture("rbb_ward_line_h", 8, 32, (_x, y) => crossSection(y));
  texture("rbb_ward_line_v", 32, 8, (x) => crossSection(x));
  texture("rbb_ward_node", 64, 64, (x, y) => {
    const diamond = Math.abs(x - 0.5) + Math.abs(y - 0.5);
    return Math.max(0, 1 - Math.abs(diamond - 0.3) / 0.045) * 0.9 + Math.max(0, 1 - diamond / 0.07);
  });
  texture("rbb_ward_rune", 64, 64, (x, y) => {
    const a = Math.abs(x - 0.5),
      b = Math.abs(y - 0.5);
    const diamond = Math.max(0, 1 - Math.abs(a + b - 0.32) / 0.026);
    const inner = Math.max(0, 1 - Math.abs(a + b - 0.14) / 0.023);
    const cross = Math.max(0, 1 - a / 0.02) * (b < 0.44 ? 0.7 : 0);
    return Math.max(diamond, inner, cross);
  });
  texture("rbb_ward_flow", 32, 32, (x, y) => Math.max(0, 1 - Math.hypot(x - 0.5, y - 0.5) * 2) ** 3);
  // Sixteen seamless frames: flowing filaments, a geometric lattice and rising luminous ripples.
  // One-pixel gutters repeat the tile edges to protect atlas frames from texture filtering.
  const curtainMask = (x, atlasY) => {
    const frame = Math.min(15, Math.floor(atlasY * 16));
    const px = Math.min(126, Math.max(0, x * 128 - 1)) / 126;
    const py = 1 - Math.min(126, Math.max(0, atlasY * 2048 - frame * 128 - 1)) / 126;
    const phase = frame / 16;
    const periodicDistance = (t) => Math.abs(t - Math.round(t));
    const diagonal = Math.min(periodicDistance((px + py) * 2), periodicDistance((px - py) * 2));
    const mesh = Math.max(0, 1 - diagonal / 0.05);
    const crest = Math.exp(-((periodicDistance(py - phase) / 0.075) ** 2));
    const filaments = Math.max(0, Math.cos(px * Math.PI * 8 + Math.sin((py - phase) * Math.PI * 2) * 0.6)) ** 18;
    const sigil = Math.max(0, 1 - Math.abs(Math.abs(px - 0.5) + Math.abs(py - 0.5) - 0.21) / 0.018);
    return 0.1 + mesh * (0.3 + crest * 0.4) + filaments * 0.2 + sigil * (0.18 + crest * 0.24);
  };
  texture("rbb_ward_curtain", 128, 2048, curtainMask);
  const previewPath = path.resolve(root, "../../design/land-boundary-concepts/curtain-alpha-preview.png");
  fs.mkdirSync(path.dirname(previewPath), { recursive: true });
  // Diagnostic composite of the actual mask over light/dark flat backgrounds, not an in-game mockup.
  texture(
    "preview",
    512,
    256,
    (x, y) => {
      const frame = Math.floor(x * 4) * 4;
      const alpha = curtainMask((x * 4) % 1, (frame + ((y * 2) % 1)) / 16) * 0.7;
      const background = y < 0.5 ? [120, 146, 82] : [25, 48, 39];
      const tint = [77, 209, 255];
      return [...background.map((c, i) => c * (1 - alpha) + tint[i] * alpha), 1];
    },
    previewPath
  );
  texture("rbb_ward_band", 16, 128, (_x, y) => {
    const core = Math.exp(-(((y - 0.88) / 0.045) ** 2));
    return core * 0.85 + y ** 3 * 0.3;
  });
  for (const plane of ["xy", "yz"]) {
    const frame = "math.mod(math.floor(variable.animation_phase + variable.particle_age * 8), 16)";
    particle(
      `ward_curtain_${plane}`,
      "rbb_ward_curtain",
      ["variable.panel_width / 2", "variable.panel_height / 2"],
      planes[plane],
      [128, 2048],
      {},
      "particles_blend",
      {
        uv: {
          texture_width: 128,
          texture_height: 2048,
          uv: ["1 + variable.uv_u * 126", `${frame} * 128 + 1 + variable.uv_v * 126`],
          uv_size: ["variable.panel_width / 4 * 126", "variable.panel_height / 4 * 126"],
        },
      }
    );
    particle(
      `ward_band_${plane}`,
      "rbb_ward_band",
      ["variable.segment_length / 2", "variable.band_height / 2"],
      planes[plane],
      [16, 128],
      {},
      "particles_add"
    );
    particle(
      `ward_spine_${plane}`,
      "rbb_ward_line_v",
      [0.18, "variable.segment_length / 2"],
      planes[plane],
      [32, 8],
      {},
      "particles_add"
    );
  }
  for (const [axis, plane, vertical] of [
    ["x", "xy", false],
    ["x", "xz", false],
    ["y", "xy", true],
    ["y", "yz", true],
    ["z", "yz", false],
    ["z", "xz", true],
  ]) {
    const length = "variable.segment_length / 2";
    particle(
      `ward_line_${axis}_${plane}`,
      `rbb_ward_line_${vertical ? "v" : "h"}`,
      vertical ? [0.055, length] : [length, 0.055],
      planes[plane],
      vertical ? [32, 8] : [8, 32]
    );
  }
  particle("ward_node", "rbb_ward_node", [0.22, 0.22], { facing_camera_mode: "rotate_xyz" }, [64, 64]);
  for (const plane of ["xy", "yz"]) {
    particle(`ward_rune_${plane}`, "rbb_ward_rune", [0.34, 0.34], planes[plane], [64, 64]);
  }
  const distance =
    "math.mod(variable.phase + variable.particle_age * variable.speed, 2 * (variable.width + variable.depth))";
  particle(
    "ward_flow",
    "rbb_ward_flow",
    [0.16, 0.16],
    { facing_camera_mode: "rotate_xyz" },
    [32, 32],
    {
      "minecraft:particle_motion_parametric": {
        relative_position: [
          `math.min(${distance}, variable.width) - math.max(0, math.min(${distance} - variable.width - variable.depth, variable.width)) - variable.start_x`,
          0,
          `math.max(0, math.min(${distance} - variable.width, variable.depth)) - math.max(0, math.min(${distance} - 2 * variable.width - variable.depth, variable.depth)) - variable.start_z`,
        ],
      },
    },
    "particles_add"
  );
  console.log("Generated 7 ward textures and 16 particle definitions, including the animated curtain atlas.");
}
if (require.main === module) main();
module.exports = { texture, particle, root };
