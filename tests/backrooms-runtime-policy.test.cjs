const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const source = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const previousTsLoader = require.extensions[".ts"];
require.extensions[".ts"] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

// manifestation.ts only needs the world's synchronous dynamic-property API. Keeping
// this mock deliberately small makes accidental new SAPI dependencies fail the test.
const worldProperties = new Map();
class MockBlockVolume {
  constructor(from, to) {
    this.from = from;
    this.to = to;
  }
}
class MockListBlockVolume {
  constructor(locations) {
    this.locations = locations;
  }
}
const minecraftServerMock = {
  BlockVolume: MockBlockVolume,
  ListBlockVolume: MockListBlockVolume,
  world: {
    seed: 0,
    getDynamicProperty: (key) => worldProperties.get(key),
    setDynamicProperty: (key, value) => {
      if (value === undefined) worldProperties.delete(key);
      else worldProperties.set(key, value);
    },
  },
};
const previousModuleLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "@minecraft/server") return minecraftServerMock;
  return previousModuleLoad.call(this, request, parent, isMain);
};

const core = require(path.join(root, "scripts/features/backrooms/core/index.ts"));
const { BackroomsLayoutAdapter } = require(path.join(
  root,
  "scripts/features/backrooms/layout-adapter.ts",
));
const manifestation = require(path.join(root, "scripts/features/backrooms/manifestation.ts"));
const constants = require(path.join(root, "scripts/features/backrooms/constants.ts"));
const runtimeContracts = require(path.join(root, "scripts/features/backrooms/runtime/contracts.ts"));
const { BackroomsRegionMarkerStore } = require(path.join(
  root,
  "scripts/features/backrooms/runtime/region-marker.ts",
));
Module._load = previousModuleLoad;

test.after(() => {
  Module._load = previousModuleLoad;
  if (previousTsLoader) require.extensions[".ts"] = previousTsLoader;
  else delete require.extensions[".ts"];
});

function fakePlayer(id) {
  const properties = new Map();
  return {
    id,
    properties,
    getDynamicProperty: (key) => properties.get(key),
    setDynamicProperty: (key, value) => {
      if (value === undefined) properties.delete(key);
      else properties.set(key, value);
    },
  };
}

function assertSourceOrder(text, needles, label) {
  let previous = -1;
  for (const needle of needles) {
    const index = text.indexOf(needle);
    assert.ok(index >= 0, `${label}: missing ${needle}`);
    assert.ok(index > previous, `${label}: ${needle} is out of order`);
    previous = index;
  }
}

test("generation channels are stable, separated, and mandatory gates lead toward origin", () => {
  const worldSeed = "runtime-policy-world";
  const decorSeed = core.deriveSeed32(worldSeed, 1, "decor", -17, 23);
  assert.equal(decorSeed, core.deriveSeed32(worldSeed, 1, "decor", -17, 23));
  assert.notEqual(decorSeed, core.deriveSeed32(worldSeed, 1, "layout", -17, 23));

  const fingerprints = new Set();
  for (let rz = -10; rz <= 10; rz++) {
    for (let rx = -10; rx <= 10; rx++) {
      const region = { rx, rz };
      const plan = core.generateRegionPlan(worldSeed, rx, rz);
      fingerprints.add(plan.fingerprint);
      assert.equal(plan.connectivity.connected, true, `disconnected ${rx},${rz}`);
      if (rx === 0 && rz === 0) continue;
      const parent = core.getRegionParent(worldSeed, region);
      const mandatory = core.getRegionGates(worldSeed, region).filter((gate) => gate.mandatory);
      assert.ok(
        mandatory.some((gate) => core.sameRegion(gate.neighbor, parent)),
        `${rx},${rz} has no physical gate to its parent`,
      );
    }
  }
  assert.ok(fingerprints.size > 430, "sampled regions should not collapse into repeated layouts");
});

test("square spiral is a contiguous collision-free bijection over the tested allocation range", () => {
  const expectedFirstRing = [
    { x: 0, z: 0 },
    { x: 1, z: 0 },
    { x: 1, z: -1 },
    { x: 0, z: -1 },
    { x: -1, z: -1 },
    { x: -1, z: 0 },
    { x: -1, z: 1 },
    { x: 0, z: 1 },
    { x: 1, z: 1 },
  ];
  assert.deepEqual(expectedFirstRing.map((_, slot) => manifestation.squareSpiralCoordinate(slot)), expectedFirstRing);

  const seen = new Set();
  let previous;
  for (let slot = 0; slot <= 40_000; slot++) {
    const coordinate = manifestation.squareSpiralCoordinate(slot);
    const key = `${coordinate.x},${coordinate.z}`;
    assert.equal(seen.has(key), false, `duplicate spiral coordinate at slot ${slot}`);
    seen.add(key);
    if (previous) {
      assert.equal(
        Math.abs(coordinate.x - previous.x) + Math.abs(coordinate.z - previous.z),
        1,
        `spiral discontinuity at slot ${slot}`,
      );
    }
    previous = coordinate;
  }
  assert.throws(() => manifestation.squareSpiralCoordinate(-1), RangeError);
  assert.throws(() => manifestation.squareSpiralCoordinate(1.5), RangeError);
});

test("manifestation slots persist per player and produce widely separated safe spawns", () => {
  worldProperties.clear();
  const alice = fakePlayer("alice");
  const bob = fakePlayer("bob");
  const first = manifestation.getBackroomsManifestation(alice);
  const repeated = manifestation.getBackroomsManifestation(alice);
  const second = manifestation.getBackroomsManifestation(bob);

  assert.deepEqual(repeated, first, "a returning player must retain the same manifestation");
  assert.equal(first.slot, 0);
  assert.equal(second.slot, 1);
  assert.equal(first.spawn.y, constants.BACKROOMS_WALK_Y);
  assert.equal(second.spawn.y, constants.BACKROOMS_WALK_Y);
  assert.equal(
    Math.max(Math.abs(second.regionX - first.regionX), Math.abs(second.regionZ - first.regionZ)),
    constants.BACKROOMS_MANIFESTATION_STRIDE_REGIONS,
  );
  for (const item of [first, second]) {
    const localX = Math.floor(item.spawn.x - item.regionX * constants.BACKROOMS_REGION_SIZE);
    const localZ = Math.floor(item.spawn.z - item.regionZ * constants.BACKROOMS_REGION_SIZE);
    const layout = core.generateRegionPlan(0, item.regionX, item.regionZ);
    for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      assert.equal(layout.grid.get(localX + dx, localZ + dz), core.BackroomsCell.Walkable);
    }
  }

  worldProperties.set("yuehua:backroomsNextManifestationSlot", 40_001);
  assert.throws(
    () => manifestation.getBackroomsManifestation(fakePlayer("overflow")),
    /安全坐标上限/,
  );
});

test("marker schema v3 rejects v2 sentinels and commits the replacement material", () => {
  assert.equal(
    runtimeContracts.DEFAULT_BACKROOMS_RUNTIME_CONFIG.palette.readySentinelMarker,
    "minecraft:lapis_block",
    "schema v3 needs a material distinct from the v2 diamond sentinels",
  );
  const config = {
    ...runtimeContracts.DEFAULT_BACKROOMS_RUNTIME_CONFIG,
    palette: {
      ...runtimeContracts.DEFAULT_BACKROOMS_RUNTIME_CONFIG.palette,
      readyMarker: "minecraft:emerald_block",
      readySentinelMarker: "minecraft:lapis_block",
    },
  };
  const blocks = new Map();
  const key = ({ x, y, z }) => `${x},${y},${z}`;
  const dimension = {
    getBlock: (location) => ({ typeId: blocks.get(key(location)) ?? "minecraft:air" }),
    fillBlocks: (volume, blockId) => {
      const locations = volume.locations ?? [volume.from];
      for (const location of locations) blocks.set(key(location), blockId);
    },
  };
  const marker = new BackroomsRegionMarkerStore(config);
  const region = { rx: -2, rz: 3 };
  const origin = runtimeContracts.regionOrigin(region, config.regionSize);

  // Reproduce schema v2: emerald global marker plus diamond per-chunk sentinels.
  blocks.set(key(marker.getLocation(region)), config.palette.readyMarker);
  for (let z = 8; z < config.regionSize; z += 16) {
    for (let x = 8; x < config.regionSize; x += 16) {
      blocks.set(key({ x: origin.x + x, y: config.markerY, z: origin.z + z }), "minecraft:diamond_block");
    }
  }
  assert.equal(
    marker.read(dimension, region),
    "building",
    "v2 must enter the interrupted-build path so two-block arches are rebuilt with three-block clearance",
  );

  marker.write(dimension, region, "ready");
  assert.equal(marker.read(dimension, region), "ready");
  for (let z = 8; z < config.regionSize; z += 16) {
    for (let x = 8; x < config.regionSize; x += 16) {
      assert.equal(
        blocks.get(key({ x: origin.x + x, y: config.markerY, z: origin.z + z })),
        config.palette.readySentinelMarker,
      );
    }
  }
});

test("decorative arches preserve three air blocks for the Lifeform collision box", () => {
  const adapter = new BackroomsLayoutAdapter("lifeform-arch-clearance");
  let archCount = 0;
  for (let rz = -5; rz <= 5; rz++) {
    for (let rx = -5; rx <= 5; rx++) {
      const layout = adapter.getLayout({ rx, rz });
      const plan = adapter.createPlan({ rx, rz });
      for (const wall of plan.walls) {
        const isArch = layout.partitions.some((partition) => partition.openings.some((opening) => (
          partition.orientation === "vertical"
            ? wall.from.x === partition.position
              && wall.to.x === partition.position
              && wall.from.z === opening.offset
              && wall.to.z === opening.offset + opening.width - 1
            : wall.from.z === partition.position
              && wall.to.z === partition.position
              && wall.from.x === opening.offset
              && wall.to.x === opening.offset + opening.width - 1
        )));
        if (!isArch || wall.from.y <= 1) continue;
        archCount++;
        assert.equal(wall.from.y, 4);
        assert.equal(wall.to.y, 4);
      }
    }
  }
  assert.ok(archCount > 0, "sample must contain decorative arches");
});

test("layout adapter never manifests lamps inside walls or walls across logical gates", () => {
  const adapter = new BackroomsLayoutAdapter("adapter-policy-world");
  let lampCount = 0;
  let wallVolumeCount = 0;

  for (let rz = -5; rz <= 5; rz++) {
    for (let rx = -5; rx <= 5; rx++) {
      const region = { rx, rz };
      const layout = adapter.getLayout(region);
      const plan = adapter.createPlan(region);
      assert.deepEqual(plan.region, region);
      assert.ok(plan.walls.length >= layout.wallRuns.length);
      assert.ok(plan.safeSpawn);
      for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        assert.equal(
          layout.grid.get(plan.safeSpawn.x + dx, plan.safeSpawn.z + dz),
          core.BackroomsCell.Walkable,
        );
      }

      for (let index = 0; index < plan.walls.length; index++) {
        const wall = plan.walls[index];
        wallVolumeCount++;
        assert.ok(wall.from.x >= 0 && wall.to.x < layout.size);
        assert.ok(wall.from.z >= 0 && wall.to.z < layout.size);
        const matchesOpening = layout.partitions.some((partition) => partition.openings.some((opening) =>
          partition.orientation === "vertical"
            ? wall.from.x === partition.position && wall.from.z === opening.offset
            : wall.from.z === partition.position && wall.from.x === opening.offset
        ));
        if (matchesOpening && wall.from.y > 1) {
          assert.equal(wall.from.y, 4);
          assert.equal(wall.to.y, 4);
          continue;
        }

        if (wall.from.y === 4 && wall.to.y === 4) {
          assert.equal(wall.blockId, "yuehua:backrooms_ceiling_tile");
          assert.equal(wall.from.y, 4);
          assert.equal(wall.to.y, 4);
          assert.ok(
            layout.rooms.some((room) =>
              wall.from.x === room.rect.x &&
              wall.from.z === room.rect.z &&
              wall.to.x === room.rect.x + room.rect.width - 1 &&
              wall.to.z === room.rect.z + room.rect.depth - 1
            ),
            `low ceiling does not match a room ${rx},${rz}`,
          );
          continue;
        }

        assert.equal(wall.from.y, 1);
        assert.equal(wall.to.y, 4);
        for (let z = wall.from.z; z <= wall.to.z; z++) {
          for (let x = wall.from.x; x <= wall.to.x; x++) {
            const cell = layout.grid.get(x, z);
            assert.ok(
              cell === core.BackroomsCell.Wall || cell === core.BackroomsCell.Protected,
              `wall volume covers traversable cell ${rx},${rz}:${x},${z}`,
            );
          }
        }
      }

      for (const lamp of plan.lamps ?? []) {
        lampCount++;
        const { x, y, z } = lamp.location;
        assert.ok(Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z));
        assert.ok(y === 4 || y === constants.BACKROOMS_CEILING_Y - constants.BACKROOMS_FLOOR_Y);
        assert.ok(x > 0 && x < layout.size - 1 && z > 0 && z < layout.size - 1);
        const cell = layout.grid.get(x, z);
        assert.ok(
          cell === core.BackroomsCell.Walkable || cell === core.BackroomsCell.Gate,
          `lamp overlaps wall ${rx},${rz}:${x},${z}`,
        );
      }

      for (const stain of plan.decorations ?? []) {
        assert.equal(stain.location.y, 0);
        assert.equal(layout.grid.get(stain.location.x, stain.location.z), core.BackroomsCell.Walkable);
      }
    }
  }
  assert.ok(lampCount > 1_000, "sample should exercise a substantial lamp population");
  assert.ok(wallVolumeCount > 1_000, "sample should exercise a substantial wall population");
});

test("blackout and pit-cluster variants preserve their physical policies", () => {
  const seed = "variant-policy-world";
  const adapter = new BackroomsLayoutAdapter(seed);
  let blackoutPlan;
  let pitPlan;
  let pitLayout;
  for (let rx = -4000; rx <= 4000 && (!blackoutPlan || !pitPlan); rx++) {
    const region = { rx, rz: 37 };
    const variant = require(path.join(root, "scripts/features/backrooms/layout-adapter.ts"))
      .getBackroomsRegionVariant(seed, region);
    if (variant.blackout && !blackoutPlan) blackoutPlan = adapter.createPlan(region);
    if (variant.holeCluster && !pitPlan) {
      const candidate = adapter.createPlan(region);
      if (candidate.voids.length) {
        pitPlan = candidate;
        pitLayout = adapter.getLayout(region);
      }
    }
  }
  assert.ok(blackoutPlan, "sample should contain a deterministic blackout region");
  assert.ok(blackoutPlan.lamps.length > 0);
  assert.ok(blackoutPlan.lamps.every((lamp) => lamp.blockId === "yuehua:backrooms_fluorescent_dead"));
  assert.ok(pitPlan && pitLayout, "sample should contain a viable pit-cluster region");
  for (const pit of pitPlan.voids) {
    assert.equal(pit.from.y, -1);
    assert.equal(pit.to.y, 0);
    assert.equal(pitLayout.grid.get(pit.from.x, pit.from.z), core.BackroomsCell.Walkable);
    assert.ok(Math.abs(pit.from.x - pitPlan.safeSpawn.x) > 2 || Math.abs(pit.from.z - pitPlan.safeSpawn.z) > 2);
  }
});

test("source wiring preserves registration, safe teleport, and transaction boundaries", () => {
  const feature = source("scripts", "features", "backrooms", "index.ts");
  const pool = source("scripts", "features", "dimension", "services", "custom-dimension-pool.ts");
  const standardMain = source("scripts", "main.standard.ts");
  const bdsMain = source("scripts", "main.bds.ts");
  const builder = source("scripts", "features", "backrooms", "runtime", "region-builder.ts");
  const queue = source("scripts", "features", "backrooms", "runtime", "generation-queue.ts");
  const marker = source("scripts", "features", "backrooms", "runtime", "region-marker.ts");
  const protection = source("scripts", "features", "backrooms", "protection.ts");
  const anomalies = source("scripts", "features", "backrooms", "anomalies.ts");
  const manageForm = source("scripts", "ui", "forms", "system", "custom-dimensions.ts");

  assert.match(pool, /alias:\s*["']backrooms["'][\s\S]*dimensionId:\s*["']yuehua:backrooms["']/);
  assert.match(feature, /registerCustomDimension\(BACKROOMS_DIMENSION_ID\)/);
  assert.match(feature, /world\.afterEvents\.worldLoad\.subscribe/);
  assertSourceOrder(
    feature,
    [
      "layouts = new BackroomsLayoutAdapter(world.seed)",
      "const lifeformDirector = registerBackroomsLifeformDirector",
      "registerBackroomsVoices({",
      "const markers = new BackroomsRegionMarkerStore",
    ],
    "Lifeform and source-less voices register after the deterministic layout is available",
  );
  assert.match(standardMain, /import\s+["']\.\/features\/backrooms["']/);
  assert.match(bdsMain, /import\s+["']\.\/features\/backrooms["']/);
  assert.match(manageForm, /record\.dimensionId\s*===\s*BACKROOMS_DIMENSION_ID/);
  assert.match(manageForm, /await\s+teleportPlayerToBackrooms\(player\)/);
  assertSourceOrder(
    feature,
    [
      "await ensureBackroomsRegionReady({ rx: manifestation.regionX, rz: manifestation.regionZ })",
      "player.teleport(manifestation.spawn",
    ],
    "teleport waits for region commit",
  );

  assertSourceOrder(
    builder,
    [
      'this.markers.write(dimension, region, "building")',
      "await this.clearGenerationVolume",
      "await this.buildShell",
      "await this.placeVolumes",
      "await this.placeBlocks",
      'this.markers.write(dimension, region, "ready")',
    ],
    "region transaction",
  );
  assertSourceOrder(
    builder,
    [
      'if (initialState === "ready") return "already-ready"',
      'this.markers.write(dimension, region, "building")',
      'if (initialState === "building") await this.clearGenerationVolume(dimension, region)',
      "await this.buildShell",
    ],
    "v1 sentinel migration clears the complete old shell and fixture field before v2 rebuild",
  );
  assertSourceOrder(
    queue,
    ["await this.builder.build", "this.markReady(key)", "this.resolveWaiters(key)", "await this.builder.connectReadyNeighbors"],
    "queue commit publication",
  );
  assertSourceOrder(
    builder,
    ['this.markers.read(dimension, neighbor) !== "ready"', "await this.carveSharedGate"],
    "shared gate readiness",
  );
  assert.match(marker, /if\s*\(!block\)\s*return\s+["']unknown["']/);
  assert.match(marker, /getSentinelLocations\(region\)/);
  assert.match(marker, /return\s+["']ready["']/);
  assert.match(builder, /new\s+ListBlockVolume/);
  assert.match(builder, /fillBlocksPerTick/);
  assert.match(queue, /maxQueuedRegions/);
  assert.match(queue, /requestTtlTicks/);
  assert.match(queue, /BackroomsTickingAreaCapacityError/);
  assert.match(feature, /ensureBackroomsLocationReady/);
  assert.match(feature, /BACKROOMS_RECOVERY_Y/);
  assert.match(anomalies, /forcedReentryUntil/);
  assert.match(anomalies, /VISITED_FILTER_PROPERTY/);

  for (const eventName of [
    "playerBreakBlock",
    "playerPlaceBlock",
    "playerInteractWithBlock",
    "explosion",
    "entitySpawn",
  ]) {
    assert.match(protection, new RegExp(`${eventName}\\.subscribe`), `missing protection for ${eventName}`);
  }
  assertSourceOrder(
    protection,
    [
      "const entity = event.entity",
      "try {",
      "if (!entity.isValid)",
      "entity.dimension.id",
      "entity.typeId",
    ],
    "spawn cleanup validates transient entities before reading their properties",
  );
  assert.match(protection, /entity\.typeId\s*===\s*LIFEFORM_TYPE_ID/);
});

test("custom Level 0 soundscape declares valid original wave assets", () => {
  const definitions = JSON.parse(source(
    "resource_packs", "CreeperMenu", "sounds", "sound_definitions.json",
  )).sound_definitions;
  const expected = [
    "hum", "ballast_surge", "tube_flicker", "wall_scratch", "indistinct_breath", "music_lock",
    "footstep_dry_walk", "footstep_dry_run", "footstep_damp_walk", "footstep_damp_run",
  ];
  for (const suffix of expected) {
    assert.ok(definitions[`yuehua.backrooms.${suffix}`], `missing sound event ${suffix}`);
  }
  for (const suffix of expected) {
    for (const sound of definitions[`yuehua.backrooms.${suffix}`].sounds) {
      const bytes = fs.readFileSync(path.join(root, "resource_packs", "CreeperMenu", `${sound.name}.wav`));
      assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF");
      assert.equal(bytes.subarray(8, 12).toString("ascii"), "WAVE");
      assert.ok(bytes.length > 1_000);
    }
  }
  const ambience = source("scripts", "features", "backrooms", "ambience.ts");
  assert.match(ambience, /getBackroomsRegionVariant/);
  assert.match(ambience, /player\.stopSound\(SOUNDS\.hum\)/);
  assert.match(ambience, /playSpatialAnomaly/);
});

test("custom Level 0 block palette has complete 64px resource definitions", () => {
  const ids = [
    "wallpaper", "wallpaper_stained", "carpet", "carpet_damp",
    "ceiling_tile", "fluorescent_on", "fluorescent_dead",
  ];
  const terrain = JSON.parse(source(
    "resource_packs", "CreeperMenu", "textures", "terrain_texture.json",
  )).texture_data;
  for (const suffix of ids) {
    const definition = JSON.parse(source(
      "behavior_packs", "CreeperMenu", "blocks", `backrooms_${suffix}.json`,
    ))["minecraft:block"];
    assert.equal(definition.description.identifier, `yuehua:backrooms_${suffix}`);
    assert.equal(definition.components["minecraft:destructible_by_mining"], false);
    assert.ok(definition.components["minecraft:geometry"]);
    assert.ok(definition.components["minecraft:material_instances"]);
    assert.ok(terrain[`backrooms_${suffix}`]);
    const png = fs.readFileSync(path.join(
      root, "resource_packs", "CreeperMenu", "textures", "blocks", "backrooms", `${suffix}.png`,
    ));
    assert.equal(png.readUInt32BE(16), 64);
    assert.equal(png.readUInt32BE(20), 64);
  }
  const lamp = JSON.parse(source(
    "behavior_packs", "CreeperMenu", "blocks", "backrooms_fluorescent_on.json",
  ))["minecraft:block"];
  assert.ok(lamp.components["minecraft:light_emission"] > 0);
  assert.ok(lamp.components["minecraft:light_emission"] <= 8);
});

test("Backrooms fog preserves local lamp contrast instead of globally filling darkness", () => {
  const fog = JSON.parse(source(
    "resource_packs", "CreeperMenu", "fogs", "backrooms.json",
  ))["minecraft:fog_settings"].distance;
  const rgb = (color) => [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));

  for (const medium of ["air", "weather"]) {
    assert.ok(fog[medium].fog_start >= 16, `${medium} fog must not flatten nearby local lighting`);
    assert.ok(fog[medium].fog_end > fog[medium].fog_start, `${medium} fog distance must remain ordered`);
    assert.ok(
      rgb(fog[medium].fog_color).every((channel) => channel < 0x70),
      `${medium} fog must be a dark olive-brown, got ${fog[medium].fog_color}`,
    );
  }
});

test("renderer contract avoids unscoped global lighting and registers only the warm static lamp", () => {
  const globalPath = path.join(root, "resource_packs", "CreeperMenu", "lighting", "global.json");
  const localPath = path.join(
    root, "resource_packs", "CreeperMenu", "local_lighting", "local_lighting.json",
  );
  assert.equal(
    fs.existsSync(globalPath),
    false,
    "lighting/global.json is pack-wide and must not be used as an unreliable dimension override",
  );
  assert.ok(fs.existsSync(localPath), "missing Vibrant Visuals local_lighting/local_lighting.json");

  const local = JSON.parse(fs.readFileSync(localPath, "utf8"))["minecraft:local_light_settings"];
  assert.deepEqual(Object.keys(local), ["yuehua:backrooms_fluorescent_on"]);
  assert.equal(local["yuehua:backrooms_fluorescent_on"].light_type, "static_light");
  const color = local["yuehua:backrooms_fluorescent_on"].light_color;
  const rgb = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
  assert.ok(rgb[0] > rgb[1] && rgb[1] > rgb[2], `lamp must be warm ivory, got ${color}`);
});
