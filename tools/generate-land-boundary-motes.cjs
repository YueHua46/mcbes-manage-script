// Filled sprites for the particle-only boundary. No line, ring or grid masks.
const fs = require("node:fs");
const path = require("node:path");
const { texture, particle, root } = require("./generate-land-boundary-frame.cjs");

texture("rbb_land_mote_glow", 64, 64, (x, y) => {
  const r = Math.hypot(x - 0.5, y - 0.5);
  return Math.min(1, Math.exp((-r * r) / 0.003) * 0.95 + Math.exp((-r * r) / 0.032) * 0.26);
});
texture("rbb_land_mote_crystal", 32, 32, (x, y) => {
  const shape = Math.abs(x - 0.5) / 0.22 + Math.abs(y - 0.5) / 0.32;
  const alpha = Math.min(1, Math.max(0, (1 - shape) * 12));
  return [x + y < 1 ? 255 : 175, 235, 255, alpha * 0.8];
});
texture("rbb_land_mote_dust", 32, 32, (x, y) => {
  const r = Math.hypot(x - 0.5, y - 0.5);
  return Math.max(0, 1 - r / 0.25) ** 0.6;
});
// Soft light core: no solid polka dots or dark outline. Companions reuse the original motes.
texture("rbb_land_mote_marker", 32, 32, (x, y) => {
  const r = Math.hypot(x - 0.5, y - 0.5);
  return Math.min(1, Math.exp((-r * r) / 0.009) * 0.85 + Math.exp((-r * r) / 0.04) * 0.25);
});
const markerSize =
  "0.42 * variable.size_scale * (0.99 + math.sin((variable.particle_age + variable.clock) * 40 + variable.phase) * 0.01)";
particle(
  "land_mote_marker",
  "rbb_land_mote_marker",
  [markerSize, markerSize],
  { facing_camera_mode: "rotate_xyz" },
  [32, 32],
  {
    "minecraft:emitter_rate_instant": { num_particles: "variable.count" },
    "minecraft:particle_motion_parametric": { relative_position: [0, 0, 0] },
    "minecraft:particle_initial_spin": { rotation: 0, rotation_rate: 0 },
    // Additive light needs complementary fades, rather than two fully bright overlapping cores.
    "minecraft:particle_appearance_tinting": {
      color: [
        "variable.color.r",
        "variable.color.g",
        "variable.color.b",
        "variable.color.a * math.clamp(variable.particle_age / variable.fade, 0, 1) * math.clamp((variable.duration - variable.particle_age) / variable.fade, 0, 1)",
      ],
    },
  },
  "particles_add"
);
texture("rbb_land_mote_corner", 32, 32, (x, y) => {
  const shape = Math.abs(x - 0.5) / 0.34 + Math.abs(y - 0.5) / 0.45;
  const alpha = Math.min(1, Math.max(0, (1 - shape) * 24));
  const halo = Math.exp(-(Math.hypot(x - 0.5, y - 0.5) ** 2) / 0.025) * 0.22;
  return x < 0.5 ? [255, 255, 255, Math.max(alpha * 0.8, halo)] : [200, 230, 255, Math.max(alpha * 0.65, halo)];
});
// The same stationary, opaque handover as the perimeter cores, with a faceted silhouette.
const cornerDocument = JSON.parse(fs.readFileSync(path.join(root, "particles", "land_mote_marker.json")));
cornerDocument.particle_effect.description.identifier = "rbb:land_mote_corner";
cornerDocument.particle_effect.description.basic_render_parameters.texture = "textures/particle/rbb_land_mote_corner";
fs.writeFileSync(path.join(root, "particles", "land_mote_corner.json"), JSON.stringify(cornerDocument, null, 2) + "\n");
for (const [kind, size, material] of [
  ["glow", 0.17, "particles_add"],
  ["crystal", 0.075, "particles_add"],
  ["dust", 0.045, "particles_add"],
  ["wake", 0.2, "particles_add"],
]) {
  const name = "land_mote_" + kind;
  const age = "math.max(0, variable.particle_age - variable.delay)";
  const motionTime = kind === "wake" ? age : "(variable.particle_age + variable.clock)";
  const unfold =
    kind === "wake"
      ? `(0.18 + math.clamp((${age} - 0.12) / 0.45, 0, 1) * 0.82)`
      : `(0.82 + math.sin(${motionTime} * 40 + variable.phase) * 0.08)`;
  const relative_position = ["x", "y", "z"].map((axis, index) => {
    const random = `variable.particle_random_${index + 1}`;
    const drift =
      axis === "y"
        ? kind === "wake"
          ? `${age} * 0.12 + math.sin(${age} * 65 + variable.phase) * 0.08`
          : `math.sin(${motionTime} * 45 + variable.phase) * 0.1`
        : `math.sin(${motionTime} * 65 + variable.phase + ${index * 90}) * 0.12`;
    // Cohesive cell motion plus individual drift, expanding gently before the final dissolve.
    return `math.clamp(((${random} - 0.5) * ${unfold} + math.sin(variable.phase + ${index * 120}) * 0.18) * variable.span_${axis} + ${drift} + math.sin(${motionTime} * 60 + variable.particle_random_4 * 360) * 0.05, variable.min_${axis}, variable.max_${axis})`;
  });
  const scale = `${size} * variable.size_scale * (0.75 + variable.particle_random_4 * variable.particle_random_4 * 0.45) * (0.95 + math.sin(${motionTime} * 65 + variable.phase) * 0.05)`;
  particle(
    name,
    kind === "wake" ? "rbb_land_mote_glow" : "rbb_" + name,
    [scale, scale],
    { facing_camera_mode: "rotate_xyz" },
    kind === "glow" || kind === "wake" ? [64, 64] : [32, 32],
    {
      "minecraft:emitter_rate_instant": { num_particles: "variable.count" },
      "minecraft:particle_motion_parametric": { relative_position },
      "minecraft:particle_initial_spin": {
        rotation: "variable.particle_random_4 * 360",
        rotation_rate: kind === "crystal" ? 18 : 0,
      },
    },
    material
  );
  const filename = path.join(root, "particles", name + ".json");
  const document = JSON.parse(fs.readFileSync(filename));
  // Delayed wake pulses travel across separate clusters; no connected graphic is drawn.
  document.particle_effect.components["minecraft:particle_appearance_tinting"].color[3] =
    `variable.color.a * math.clamp((variable.particle_age - variable.delay) / ${kind === "wake" ? "(0.16 - variable.focus * 0.08)" : "variable.fade"}, 0, 1) * math.clamp((variable.duration - variable.particle_age) / ${kind === "wake" ? "0.45" : "variable.fade"}, 0, 1)` +
    (kind === "wake"
      ? ` * (1 - math.clamp((${age} - (0.28 - variable.focus * 0.14)) / 0.55, 0, 1))`
      : ` * (0.96 + math.sin(${motionTime} * 65 + variable.phase) * 0.04)`);
  fs.writeFileSync(filename, JSON.stringify(document, null, 2) + "\n");
}
console.log("Generated a stable contrast core, three cluster effects and a travelling wake effect.");
