const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const zlib = require("node:zlib");

const root = path.resolve(__dirname, "..");
const files = {
  behavior: "behavior_packs/CreeperMenu/entities/backrooms_lifeform.json",
  client: "resource_packs/CreeperMenu/entity/backrooms_lifeform.entity.json",
  geometry: "resource_packs/CreeperMenu/models/entity/backrooms_lifeform.geo.json",
  animations: "resource_packs/CreeperMenu/animations/backrooms_lifeform.animation.json",
  controllers: "resource_packs/CreeperMenu/animation_controllers/backrooms_lifeform.animation_controllers.json",
  render: "resource_packs/CreeperMenu/render_controllers/backrooms_lifeform.render_controllers.json",
  texture: "resource_packs/CreeperMenu/textures/entity/backrooms_lifeform.png",
};

function absolute(relative) {
  return path.join(root, ...relative.split("/"));
}

function json(relative) {
  return JSON.parse(fs.readFileSync(absolute(relative), "utf8"));
}

function lang(relative) {
  const entries = new Map();
  for (const rawLine of fs.readFileSync(absolute(relative), "utf8").split(/\r?\n/u)) {
    const line = rawLine.replace(/^\uFEFF/u, "");
    if (!line || line.startsWith("##")) continue;
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    entries.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return entries;
}

function decodePng(relative) {
  const bytes = fs.readFileSync(absolute(relative));
  assert.equal(bytes.toString("ascii", 1, 4), "PNG", `${relative} must be a PNG`);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  assert.equal(bitDepth, 8);
  assert.ok(colorType === 2 || colorType === 6, "texture must be RGB or RGBA");
  const channels = colorType === 2 ? 3 : 4;
  const chunks = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const pixels = Buffer.alloc(width * height * channels);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    assert.ok(filter >= 0 && filter <= 4, `unsupported PNG filter ${filter}`);
    for (let x = 0; x < stride; x += 1) {
      const encoded = raw[y * (stride + 1) + 1 + x];
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upperLeft = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up
        : filter === 3 ? Math.floor((left + up) / 2) : paeth(left, up, upperLeft);
      pixels[y * stride + x] = (encoded + predictor) & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

test("Lifeform Task 1 declares every required asset", () => {
  for (const relative of Object.values(files)) {
    assert.ok(fs.existsSync(absolute(relative)), `missing ${relative}`);
  }
  for (const relative of [files.behavior, files.client, files.geometry, files.animations, files.controllers, files.render]) {
    assert.doesNotThrow(() => json(relative), `${relative} must parse as JSON`);
  }
});

test("Lifeform has exact UTF-8 Chinese and English entity display names", () => {
  const key = "entity.yuehua:backrooms_lifeform.name";
  assert.equal(lang("resource_packs/CreeperMenu/texts/zh_CN.lang").get(key), "细菌（Bacteria）");
  assert.equal(lang("resource_packs/CreeperMenu/texts/en_US.lang").get(key), "Bacteria");
});

test("behavior entity separates persistent manual summons from transient director encounters", () => {
  const document = json(files.behavior);
  assert.equal(document.format_version, "1.26.0");
  const entity = document["minecraft:entity"];
  assert.equal(entity.description.identifier, "yuehua:backrooms_lifeform");
  assert.equal(entity.description.is_spawnable, false);
  assert.equal(entity.description.is_summonable, true);
  const properties = entity.description.properties;
  assert.deepEqual(properties["yuehua:lifeform_phase"].values, [
    "dormant", "lure", "stalk", "inspect", "roar", "chase", "search", "stagger", "retreat",
  ]);
  assert.equal(properties["yuehua:lifeform_phase"].client_sync, true);
  assert.equal(properties["yuehua:manifestation_slot"].client_sync, false);

  const components = entity.components;
  assert.deepEqual(components["minecraft:health"], { value: 240, max: 240 });
  assert.equal(components["minecraft:attack"].damage, 7);
  assert.equal(components["minecraft:knockback_resistance"].value, 0.68);
  assert.equal(components["minecraft:follow_range"].value, 96);
  assert.deepEqual(components["minecraft:experience_reward"], { on_death: "35" });
  const collision = components["minecraft:collision_box"];
  assert.deepEqual(collision, { width: 0.65, height: 2.8 });
  assert.ok(collision.height <= 2.85, "physics must fit the three-block low-room air column");
  assert.ok(3 - collision.height >= 0.15, "low ceilings need suffocation/navigation safety margin");
  assert.equal(components["minecraft:navigation.walk"].can_jump, false);
  assert.equal(components["minecraft:navigation.walk"].can_open_doors, false);
  assert.ok(!components["minecraft:persistent"]);
  assert.ok(!components["minecraft:tick_world"]);

  const manual = entity.component_groups["yuehua:manual_autonomous"];
  assert.ok(manual, "manual summons need a default autonomous component group");
  assert.ok(manual["minecraft:persistent"], "manual summons must persist across unload/save");
  assert.equal(manual["minecraft:movement"].value, 0.35);
  const manualTarget = manual["minecraft:behavior.nearest_attackable_target"];
  assert.equal(manualTarget.entity_types[0].max_dist, 96);
  assert.deepEqual(manualTarget.entity_types[0].filters, {
    test: "is_family", subject: "other", value: "player",
  });
  assert.doesNotMatch(JSON.stringify(manualTarget), /has_tag/);
  assert.equal(manual["minecraft:behavior.delayed_attack"].speed_multiplier, 1.15);

  const spawnedGroups = entity.events["minecraft:entity_spawned"].add.component_groups;
  assert.ok(spawnedGroups.includes("yuehua:manual_autonomous"));
  const dormant = entity.events["yuehua:phase_dormant"];
  assert.ok(dormant.remove.component_groups.includes("yuehua:manual_autonomous"));
  assert.ok(dormant.add.component_groups.includes("yuehua:director_owned"));
  assert.ok(entity.component_groups["yuehua:director_owned"]["minecraft:transient"]);

  const chase = entity.component_groups["yuehua:phase_chase"];
  assert.equal(chase["minecraft:movement"].value, 0.35);
  const stalk = entity.component_groups["yuehua:phase_stalk"];
  assert.deepEqual(stalk["minecraft:behavior.move_towards_target"], {
    priority: 3,
    speed_multiplier: 0.55,
    within_radius: 8,
  });
  const delayed = chase["minecraft:behavior.delayed_attack"];
  assert.equal(delayed.attack_duration, 1.25);
  assert.equal(delayed.hit_delay_pct, 0.36);
  assert.equal(delayed.track_target, true);
  assert.equal(delayed.speed_multiplier, 1.15);
  assert.ok(delayed.reach_multiplier >= 2.3, "longer arms require matching native attack reach");
  for (const group of [stalk, chase]) {
    const target = group["minecraft:behavior.nearest_attackable_target"];
    assert.equal(target.entity_types[0].max_dist, 96);
    assert.match(JSON.stringify(target.entity_types[0].filters), /has_tag/);
    assert.match(JSON.stringify(target.entity_types[0].filters), /yuehua\.backrooms_lifeform_target/);
    assert.ok(target.scan_interval >= 10);
    assert.equal(target.must_reach, true);
  }
  assert.equal(
    stalk["minecraft:behavior.nearest_attackable_target"].must_see,
    false,
    "a wall-hidden natural encounter must acquire its tagged owner before it can approach",
  );
  assert.equal(chase["minecraft:behavior.nearest_attackable_target"].must_see, true);
  assert.equal(
    entity.component_groups["yuehua:phase_search"]["minecraft:behavior.random_stroll"].xz_dist,
    16,
  );

  const phases = ["dormant", "lure", "stalk", "inspect", "roar", "chase", "search", "stagger", "retreat"];
  for (const phase of phases) {
    assert.ok(entity.component_groups[`yuehua:phase_${phase}`], `missing component group ${phase}`);
    assert.ok(entity.events[`yuehua:phase_${phase}`], `missing event ${phase}`);
  }
  assert.ok(entity.events["yuehua:despawn"]);
  assert.equal(fs.existsSync(absolute("behavior_packs/CreeperMenu/spawn_rules/backrooms_lifeform.json")), false);
});

test("geometry is an original tall filament rig within the performance budget", () => {
  const document = json(files.geometry);
  const geometry = document["minecraft:geometry"][0];
  const description = geometry.description;
  assert.equal(description.identifier, "geometry.yuehua.backrooms_lifeform");
  assert.equal(description.texture_width, 128);
  assert.equal(description.texture_height, 128);
  assert.ok(description.visible_bounds_height >= 4.0 && description.visible_bounds_height <= 4.5);
  const bones = geometry.bones;
  assert.ok(bones.length >= 35 && bones.length <= 42, `expected 35–42 bones, got ${bones.length}`);
  assert.equal(new Set(bones.map((bone) => bone.name)).size, bones.length, "bone names must be unique");
  for (const required of [
    "root", "pelvis", "spine_lower", "spine_upper", "rib_cage", "neck", "head", "jaw_upper", "jaw_lower",
    "upper_arm_l", "forearm_l", "hand_l", "upper_arm_r", "forearm_r", "hand_r",
    "thigh_l", "shin_l", "foot_l", "thigh_r", "shin_r", "foot_r",
    "tendril_back_01a", "tendril_back_02a", "tendril_back_03a", "tendril_head_l", "tendril_head_r",
  ]) {
    assert.ok(bones.some((bone) => bone.name === required), `missing bone ${required}`);
  }
  const cubeCount = bones.reduce((sum, bone) => sum + (bone.cubes?.length ?? 0), 0);
  assert.ok(cubeCount >= 35, `rig needs visible filament detail, got ${cubeCount} cubes`);
  assert.ok(cubeCount <= 90, `cube budget exceeded: ${cubeCount}`);
  const verticalBounds = bones.flatMap((bone) => bone.cubes ?? []).reduce(
    (bounds, cube) => ({
      min: Math.min(bounds.min, cube.origin[1]),
      max: Math.max(bounds.max, cube.origin[1] + cube.size[1]),
    }),
    { min: Infinity, max: -Infinity },
  );
  const stretch = json(files.animations).animations["animation.yuehua.backrooms_lifeform.base_stretch"];
  assert.deepEqual(stretch.bones.root.scale, [1, 1.32, 1]);
  assert.deepEqual(stretch.bones.root.position, [0, 5.28, 0]);
  const transformedBottom = verticalBounds.min * stretch.bones.root.scale[1] + stretch.bones.root.position[1];
  const transformedTop = verticalBounds.max * stretch.bones.root.scale[1] + stretch.bones.root.position[1];
  assert.ok(Math.abs(transformedBottom) <= 0.01, `feet must align to the floor, got ${transformedBottom / 16} blocks`);
  const visualHeightBlocks = (transformedTop - transformedBottom) / 16;
  assert.ok(
    visualHeightBlocks >= 3.6 && visualHeightBlocks <= 3.8,
    `static visual silhouette must be 3.6-3.8 blocks tall, got ${visualHeightBlocks}`,
  );
});

test("texture is an opaque 128px charcoal organic atlas with tonal detail", () => {
  const image = decodePng(files.texture);
  assert.equal(image.width, 128);
  assert.equal(image.height, 128);
  const colors = new Set();
  let minimum = 255;
  let maximum = 0;
  let warmHighlights = 0;
  for (let index = 0; index < image.pixels.length; index += image.channels) {
    const red = image.pixels[index];
    const green = image.pixels[index + 1];
    const blue = image.pixels[index + 2];
    if (image.channels === 4) assert.equal(image.pixels[index + 3], 255, "texture must be fully opaque");
    const luminance = (red + green + blue) / 3;
    minimum = Math.min(minimum, luminance);
    maximum = Math.max(maximum, luminance);
    if (red > green && green > blue && red >= 72) warmHighlights += 1;
    colors.add(`${red},${green},${blue}`);
  }
  assert.ok(colors.size >= 96, `texture is too flat: ${colors.size} colors`);
  assert.ok(minimum <= 24, `texture needs charcoal shadows, min=${minimum}`);
  assert.ok(maximum >= 82 && maximum <= 210, `texture highlight range is invalid: ${maximum}`);
  assert.ok(warmHighlights >= 128, "texture needs restrained wet warm-yellow reflections");
});

test("client entity cross-references geometry, texture, render, controllers, animations and Task 2 sounds", () => {
  const document = json(files.client);
  const description = document["minecraft:client_entity"].description;
  assert.equal(description.identifier, "yuehua:backrooms_lifeform");
  assert.equal(description.geometry.default, "geometry.yuehua.backrooms_lifeform");
  assert.equal(description.textures.default, "textures/entity/backrooms_lifeform");
  assert.deepEqual(description.render_controllers, ["controller.render.yuehua.backrooms_lifeform"]);
  assert.equal(description.animations.stretch, "animation.yuehua.backrooms_lifeform.base_stretch");
  assert.ok(description.scripts.animate.includes("stretch"), "permanent narrow vertical stretch must be animated");
  for (const action of ["idle", "walk", "run", "turn", "inspect", "roar", "attack", "stagger", "death"]) {
    assert.equal(description.animations[action], `animation.yuehua.backrooms_lifeform.${action}`);
  }
  for (const controller of ["locomotion", "phase"]) {
    assert.equal(
      description.animations[controller],
      `controller.animation.yuehua.backrooms_lifeform.${controller}`,
    );
    assert.ok(description.scripts.animate.includes(controller), `${controller} controller is not animated`);
  }
  assert.equal(
    description.animations.turn_controller,
    "controller.animation.yuehua.backrooms_lifeform.turn",
  );
  assert.ok(description.scripts.animate.includes("turn_controller"), "turn controller is not animated");
  for (const sound of ["idle", "step_walk", "step_run", "inspect", "lure", "roar", "attack", "hurt", "death"]) {
    assert.equal(description.sound_effects[sound], `yuehua.backrooms.lifeform.${sound}`);
  }
});

test("all nine animations are authored with their required timing and sound cues", () => {
  const animations = json(files.animations).animations;
  const expected = {
    idle: { length: 4.6, loop: true },
    walk: { length: 0.95, loop: true },
    run: { length: 0.48, loop: true },
    turn: { loop: true },
    inspect: { length: 2.4, loop: false },
    roar: { length: 1.45, loop: false },
    attack: { length: 1.25, loop: false },
    stagger: { length: 0.55, loop: false },
    death: { length: 1.0, loop: false },
  };
  for (const [name, policy] of Object.entries(expected)) {
    const animation = animations[`animation.yuehua.backrooms_lifeform.${name}`];
    assert.ok(animation, `missing ${name} animation`);
    assert.equal(animation.loop, policy.loop, `${name} loop policy mismatch`);
    if (policy.length !== undefined) assert.equal(animation.animation_length, policy.length);
    assert.ok(Object.keys(animation.bones ?? {}).length >= 3, `${name} must animate at least three bones`);
  }
  assert.deepEqual(Object.keys(animations["animation.yuehua.backrooms_lifeform.walk"].sound_effects), ["0.16", "0.65"]);
  assert.deepEqual(Object.keys(animations["animation.yuehua.backrooms_lifeform.run"].sound_effects), ["0.1", "0.34"]);
  const runThighFrames = Object.values(animations["animation.yuehua.backrooms_lifeform.run"].bones.thigh_l.rotation);
  assert.ok(
    Math.max(...runThighFrames.flat().map((value) => Math.abs(value))) >= 56,
    "the taller legs need a visibly lengthened running stride",
  );
  const attackRootPositions = Object.values(animations["animation.yuehua.backrooms_lifeform.attack"].bones.root.position);
  assert.ok(
    Math.max(...attackRootPositions.flat().map((value) => Math.abs(value))) >= 1.9,
    "the attack lunge must visually reach with the longer arms",
  );
  assert.equal(animations["animation.yuehua.backrooms_lifeform.roar"].sound_effects["0.28"].effect, "roar");
  assert.equal(animations["animation.yuehua.backrooms_lifeform.attack"].sound_effects["0.36"].effect, "attack");
  assert.equal(animations["animation.yuehua.backrooms_lifeform.death"].sound_effects["0.2"].effect, "death");
});

test("phase controller encodes action priority and locomotion/turn gating", () => {
  const controllers = json(files.controllers).animation_controllers;
  const phase = controllers["controller.animation.yuehua.backrooms_lifeform.phase"];
  const serialized = JSON.stringify(phase);
  for (const state of ["default", "inspect", "roar", "attack", "stagger", "death"]) {
    assert.ok(phase.states[state], `missing phase controller state ${state}`);
  }
  const transitions = phase.states.default.transitions.map((entry) => Object.keys(entry)[0]);
  assert.deepEqual(transitions.slice(0, 5), ["death", "stagger", "attack", "roar", "inspect"]);
  assert.match(serialized, /query\.property\('yuehua:lifeform_phase'\)/);
  assert.match(serialized, /query\.is_delayed_attacking/);
  assert.match(serialized, /!query\.is_alive/);

  const locomotion = JSON.stringify(controllers["controller.animation.yuehua.backrooms_lifeform.locomotion"]);
  assert.match(locomotion, /query\.ground_speed/);
  assert.match(locomotion, /run/);
  assert.match(locomotion, /walk/);
  assert.match(locomotion, /idle/);
  assert.match(locomotion, /query\.is_delayed_attacking/);
  assert.match(locomotion, /query\.is_alive/);
  assert.match(locomotion, /lifeform_phase/);
  assert.match(locomotion, /disabled/);
  const turn = JSON.stringify(controllers["controller.animation.yuehua.backrooms_lifeform.turn"]);
  assert.match(turn, /turn/);
  assert.match(turn, /query\.is_delayed_attacking/);
  assert.match(turn, /query\.is_alive/);
  assert.match(turn, /lifeform_phase/);
  assert.match(turn, /disabled/);
  const turnAnimation = json(files.animations).animations["animation.yuehua.backrooms_lifeform.turn"];
  assert.match(JSON.stringify(turnAnimation), /query\.yaw_speed/);
});

test("render controller is a single opaque renderer", () => {
  const render = json(files.render).render_controllers["controller.render.yuehua.backrooms_lifeform"];
  assert.equal(render.geometry, "Geometry.default");
  assert.deepEqual(render.textures, ["Texture.default"]);
  assert.deepEqual(render.materials, [{ "*": "Material.default" }]);
});
