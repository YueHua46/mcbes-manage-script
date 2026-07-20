const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
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

const core = require(path.join(root, "scripts/features/backrooms/core/index.ts"));
const {
  BackroomsLayoutAdapter,
  getBackroomsRegionVariant,
  isValidLampRowPlan,
  planLampRowSlots,
} = require(path.join(root, "scripts/features/backrooms/layout-adapter.ts"));

test.after(() => {
  if (previousTsLoader) require.extensions[".ts"] = previousTsLoader;
  else delete require.extensions[".ts"];
});

const seed = "lighting-policy-world";
const DEAD_LAMP = "yuehua:backrooms_fluorescent_dead";

test("row-slot planner declares exact 2-4 fixture groups and rejects ambiguous spacing mutations", () => {
  assert.equal(typeof planLampRowSlots, "function", "missing pure lamp row-slot planner");
  assert.equal(typeof isValidLampRowPlan, "function", "missing lamp row-plan validator");
  const scripted = [8, 3, 2, 1];
  const random = {
    integer(min, max) {
      const value = scripted.shift();
      assert.ok(value >= min && value <= max, `${value} outside ${min}..${max}`);
      return value;
    },
  };
  const plan = planLampRowSlots(random, 12);
  assert.deepEqual(plan, {
    baseStep: 8,
    groupLength: 3,
    gapLength: 2,
    offset: 1,
    slots: [true, true, false, false, true, true, true, false, false, true, true, true],
  });
  assert.equal(isValidLampRowPlan(plan), true);

  // The former delta-divisibility test accepted uniform 12-block spacing as
  // multiples of a 6-block base even though it did not encode 2-4-on/1-2-off groups.
  const uniformTwelve = {
    baseStep: 6,
    groupLength: 2,
    gapLength: 1,
    offset: 0,
    slots: [true, false, true, false, true, false],
  };
  assert.equal(isValidLampRowPlan(uniformTwelve), false);

  const independentlyOmitted = {
    ...plan,
    slots: plan.slots.map((active, index) => index === 5 ? !active : active),
  };
  assert.equal(isValidLampRowPlan(independentlyOmitted), false);
});

function contains(rect, location) {
  return location.x >= rect.x && location.x < rect.x + rect.width
    && location.z >= rect.z && location.z < rect.z + rect.depth;
}

function chooseFixtureAxis(room, placements) {
  if (room.rect.width > room.rect.depth) return "x";
  if (room.rect.depth > room.rect.width) return "z";

  // A square room has no unique long axis. Accept whichever axis actually forms
  // complete two-block commercial fixtures, while still rejecting random scatter.
  for (const axis of ["x", "z"]) {
    try {
      groupFixtureRows(room, placements, axis);
      return axis;
    } catch {
      // Try the other legal axis.
    }
  }
  return "x";
}

function groupFixtureRows(room, placements, axis) {
  const along = axis;
  const across = axis === "x" ? "z" : "x";
  const rows = new Map();

  for (const placement of placements) {
    const key = `${placement.location[across]},${placement.location.y}`;
    const row = rows.get(key) ?? [];
    row.push(placement);
    rows.set(key, row);
  }

  const fixtures = [];
  for (const [key, row] of rows) {
    row.sort((a, b) => a.location[along] - b.location[along]);
    const runs = [];
    let current = [];
    for (const placement of row) {
      if (
        current.length === 0
        || placement.location[along] === current[current.length - 1].location[along] + 1
      ) {
        current.push(placement);
      } else {
        runs.push(current);
        current = [placement];
      }
    }
    if (current.length) runs.push(current);

    for (const run of runs) {
      assert.equal(
        run.length,
        2,
        `room ${JSON.stringify(room.rect)} row ${key} must contain only two-block fixtures`,
      );
      assert.equal(
        run[0].blockId,
        run[1].blockId,
        `both blocks of fixture ${key}:${run[0].location[along]} must share state`,
      );
      fixtures.push({
        row: key,
        start: run[0].location[along],
        placements: run,
      });
    }
  }

  const byRow = new Map();
  for (const fixture of fixtures) {
    const row = byRow.get(fixture.row) ?? [];
    row.push(fixture);
    byRow.set(fixture.row, row);
  }
  for (const [key, row] of byRow) {
    row.sort((a, b) => a.start - b.start);
    if (row.length < 2) continue;
    const deltas = row.slice(1).map((fixture, index) => fixture.start - row[index].start);
    assert.ok(
      [6, 7, 8, 9].some((step) => deltas.every((delta) => delta >= step && delta % step === 0)),
      `room ${JSON.stringify(room.rect)} row ${key} must use one seeded 6-9 block step: ${deltas}`,
    );
  }

  const rowCoordinates = [...byRow.keys()]
    .map((key) => Number(key.split(",")[0]))
    .sort((a, b) => a - b);
  if (rowCoordinates.length >= 2) {
    const deltas = rowCoordinates.slice(1).map((coordinate, index) => coordinate - rowCoordinates[index]);
    assert.ok(
      [10, 11, 12].some((step) => deltas.every((delta) => delta >= step && delta % step === 0)),
      `room ${JSON.stringify(room.rect)} must use one seeded 10-12 block cross-row step: ${deltas}`,
    );
  }

  return { fixtures, byRow };
}

function roomCoverage(layout, room, placements) {
  const active = placements.filter((placement) => placement.blockId !== DEAD_LAMP);
  let walkable = 0;
  let covered = 0;
  for (let z = room.rect.z; z < room.rect.z + room.rect.depth; z++) {
    for (let x = room.rect.x; x < room.rect.x + room.rect.width; x++) {
      const cell = layout.grid.get(x, z);
      if (cell !== core.BackroomsCell.Walkable && cell !== core.BackroomsCell.Gate) continue;
      walkable++;
      if (active.some((lamp) => Math.abs(lamp.location.x - x) + Math.abs(lamp.location.z - z) <= 8)) {
        covered++;
      }
    }
  }
  return walkable === 0 ? 1 : covered / walkable;
}

test("normal Level 0 rooms use deterministic long-axis fluorescent rows", () => {
  const first = new BackroomsLayoutAdapter(seed);
  const second = new BackroomsLayoutAdapter(seed);
  let checkedRegions = 0;
  let checkedRooms = 0;
  let checkedFixtures = 0;

  for (let rz = -5; rz <= 5; rz++) {
    for (let rx = -5; rx <= 5; rx++) {
      const region = { rx, rz };
      if (getBackroomsRegionVariant(seed, region).blackout) continue;
      const layout = first.getLayout(region);
      const plan = first.createPlan(region);
      assert.deepEqual(plan.lamps, second.createPlan(region).lamps, `non-deterministic lamps at ${rx},${rz}`);
      checkedRegions++;

      for (const room of layout.rooms) {
        const placements = plan.lamps.filter((lamp) => contains(room.rect, lamp.location));
        const axis = chooseFixtureAxis(room, placements);
        const grouped = groupFixtureRows(room, placements, axis);
        checkedRooms++;
        checkedFixtures += grouped.fixtures.length;

        for (const lamp of placements) {
          const cell = layout.grid.get(lamp.location.x, lamp.location.z);
          assert.ok(
            cell === core.BackroomsCell.Walkable || cell === core.BackroomsCell.Gate,
            `lamp intersects wall at ${rx},${rz}:${lamp.location.x},${lamp.location.z}`,
          );
        }
      }
    }
  }

  assert.equal(checkedRegions, 121, "the deterministic topology sample must cover 121 normal regions");
  assert.ok(checkedRooms > 1_000, "sample must exercise a broad room population");
  assert.ok(checkedFixtures > 1_500, "local rows should provide a substantial fixture population");
});

test("normal rows provide broad coverage with bounded seeded dark and failed fixtures", () => {
  const adapter = new BackroomsLayoutAdapter(seed);
  let rooms = 0;
  let commonCoveredRooms = 0;
  let darkRooms = 0;
  let fixtures = 0;
  let deadFixtures = 0;
  let rowsWithOmittedSlots = 0;
  let multiFixtureRows = 0;

  for (let rz = -5; rz <= 5; rz++) {
    for (let rx = -5; rx <= 5; rx++) {
      const region = { rx, rz };
      if (getBackroomsRegionVariant(seed, region).blackout) continue;
      const layout = adapter.getLayout(region);
      const plan = adapter.createPlan(region);
      for (const room of layout.rooms) {
        const placements = plan.lamps.filter((lamp) => contains(room.rect, lamp.location));
        const axis = chooseFixtureAxis(room, placements);
        const grouped = groupFixtureRows(room, placements, axis);
        const active = placements.filter((lamp) => lamp.blockId !== DEAD_LAMP);
        const coverage = roomCoverage(layout, room, placements);
        rooms++;
        fixtures += grouped.fixtures.length;
        deadFixtures += grouped.fixtures.filter((fixture) => fixture.placements[0].blockId === DEAD_LAMP).length;
        if (active.length === 0) darkRooms++;
        if (coverage >= 0.72) commonCoveredRooms++;

        for (const row of grouped.byRow.values()) {
          if (row.length < 2) continue;
          multiFixtureRows++;
          const starts = row.map((fixture) => fixture.start).sort((a, b) => a - b);
          const deltas = starts.slice(1).map((start, index) => start - starts[index]);
          const step = [6, 7, 8, 9].find((candidate) => (
            deltas.every((delta) => delta >= candidate && delta % candidate === 0)
          ));
          assert.ok(step, `row must retain a deterministic base step: ${deltas}`);
          if (deltas.some((delta) => delta > step)) rowsWithOmittedSlots++;
        }
      }
    }
  }

  const darkRate = darkRooms / rooms;
  const deadRate = deadFixtures / fixtures;
  assert.ok(commonCoveredRooms / rooms >= 0.60, "most normal rooms should have broad active-light coverage");
  assert.ok(darkRate >= 0.015 && darkRate <= 0.10, `normal dark-room rate out of bounds: ${darkRate}`);
  assert.ok(deadRate >= 0.015 && deadRate <= 0.10, `failed-fixture rate out of bounds: ${deadRate}`);
  assert.ok(
    rowsWithOmittedSlots / multiFixtureRows >= 0.25,
    "at least a quarter of multi-fixture rows need grouped dark gaps",
  );
});

test("blackout regions retain sparse dead fixtures but remain primarily dark", () => {
  const adapter = new BackroomsLayoutAdapter(seed);
  const normalDensities = [];
  for (let rx = -5; rx <= 5; rx++) {
    const region = { rx, rz: 0 };
    if (getBackroomsRegionVariant(seed, region).blackout) continue;
    const layout = adapter.getLayout(region);
    normalDensities.push(adapter.createPlan(region).lamps.length / layout.statistics.walkableCells);
  }
  const normalDensity = normalDensities.reduce((sum, value) => sum + value, 0) / normalDensities.length;

  const blackoutDensities = [];
  for (let rx = -5000; rx <= 5000 && blackoutDensities.length < 8; rx++) {
    const region = { rx, rz: 37 };
    if (!getBackroomsRegionVariant(seed, region).blackout) continue;
    const layout = adapter.getLayout(region);
    const lamps = adapter.createPlan(region).lamps;
    assert.ok(lamps.length > 0, `blackout ${rx},37 should retain recognizable dead fixtures`);
    assert.ok(lamps.every((lamp) => lamp.blockId === DEAD_LAMP), `blackout ${rx},37 contains a live fixture`);
    blackoutDensities.push(lamps.length / layout.statistics.walkableCells);
  }

  assert.ok(blackoutDensities.length >= 5, "sample should locate multiple deterministic blackout regions");
  assert.ok(
    blackoutDensities.every((density) => density <= normalDensity * 0.4),
    `blackout fixture density should stay below 40% of normal (${normalDensity})`,
  );
});
