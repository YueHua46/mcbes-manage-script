const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const previousTsLoader = require.extensions[".ts"];
require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

const core = require(path.join(root, "scripts/addons/backrooms/core/index.ts"));
const runtimeContracts = require(path.join(root, "scripts/addons/backrooms/runtime/contracts.ts"));

test.after(() => {
  if (previousTsLoader) require.extensions[".ts"] = previousTsLoader;
  else delete require.extensions[".ts"];
});

const seed = "backrooms-test-world";

test("region conversion floors negative coordinates instead of truncating", () => {
  assert.deepEqual(core.worldToRegionCoordinate(-0.1, -64.1, 64), { rx: -1, rz: -2 });
  assert.deepEqual(runtimeContracts.locationToRegion({ x: -0.1, y: 100, z: -64.1 }, 64), { rx: -1, rz: -2 });
});

test("macro parent graph strictly approaches the origin", () => {
  for (let rz = -40; rz <= 40; rz++) {
    for (let rx = -40; rx <= 40; rx++) {
      if (rx === 0 && rz === 0) continue;
      const parent = core.getRegionParent(seed, { rx, rz });
      assert.ok(parent);
      assert.equal(
        Math.abs(parent.rx) + Math.abs(parent.rz),
        Math.abs(rx) + Math.abs(rz) - 1,
        `parent of ${rx},${rz}`,
      );
    }
  }
});

test("shared macro gates are symmetric for every sampled neighbor", () => {
  const opposite = { north: "south", east: "west", south: "north", west: "east" };
  const delta = {
    north: { rx: 0, rz: -1 },
    east: { rx: 1, rz: 0 },
    south: { rx: 0, rz: 1 },
    west: { rx: -1, rz: 0 },
  };
  for (let rz = -12; rz <= 12; rz++) {
    for (let rx = -12; rx <= 12; rx++) {
      for (const direction of Object.keys(delta)) {
        const neighbor = { rx: rx + delta[direction].rx, rz: rz + delta[direction].rz };
        const a = core.getGate(seed, { rx, rz }, direction);
        const b = core.getGate(seed, neighbor, opposite[direction]);
        assert.equal(Boolean(a), Boolean(b), `${rx},${rz} ${direction}`);
        if (a && b) {
          assert.equal(a.offset, b.offset);
          assert.equal(a.width, b.width);
        }
        const allA = core.getEdgeGates(seed, { rx, rz }, direction)
          .map(({ offset, width }) => ({ offset, width }));
        const allB = core.getEdgeGates(seed, neighbor, opposite[direction])
          .map(({ offset, width }) => ({ offset, width }));
        assert.deepEqual(allA, allB, `${rx},${rz} ${direction} secondary seams`);
      }
    }
  }
});

test("generated Level 0 regions are deterministic and fully connected", () => {
  for (let rz = -8; rz <= 8; rz++) {
    for (let rx = -8; rx <= 8; rx++) {
      const first = core.generateRegionPlan(seed, rx, rz);
      const second = core.generateRegionPlan(seed, rx, rz);
      assert.equal(first.fingerprint, second.fingerprint, `${rx},${rz} fingerprint`);
      assert.equal(first.connectivity.connected, true, `${rx},${rz} connectivity`);
      assert.equal(first.size, 64);
      assert.ok(first.statistics.roomCount > 0);
      assert.ok(first.statistics.wallCells > 0);
      for (const wall of first.wallRuns) {
        assert.ok(wall.minX >= 0 && wall.maxX < 64);
        assert.ok(wall.minZ >= 0 && wall.maxZ < 64);
      }

      const covered = new Uint8Array(first.size * first.size);
      for (const wall of first.wallRuns) {
        for (let z = wall.minZ; z <= wall.maxZ; z++) {
          for (let x = wall.minX; x <= wall.maxX; x++) {
            assert.equal(first.grid.get(x, z), core.BackroomsCell.Wall);
            covered[z * first.size + x]++;
          }
        }
      }
      first.grid.forEach((cell, x, z) => {
        if (cell === core.BackroomsCell.Wall) assert.equal(covered[z * first.size + x], 1);
        if (cell === core.BackroomsCell.Protected) assert.equal(covered[z * first.size + x], 0);
      });

      const landing = core.findSafeLandingCell(first);
      for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        assert.equal(first.grid.get(landing.x + dx, landing.z + dz), core.BackroomsCell.Walkable);
      }
    }
  }
});

test("runtime transaction ordering keeps ready marker as the final commit", () => {
  const builder = fs.readFileSync(
    path.join(root, "scripts/addons/backrooms/runtime/region-builder.ts"),
    "utf8",
  );
  const shell = builder.indexOf("await this.buildShell");
  const walls = builder.indexOf("await this.placeVolumes");
  const lights = builder.indexOf("await this.placeBlocks");
  const ready = builder.indexOf('this.markers.write(dimension, region, "ready")');
  assert.ok(shell >= 0 && walls > shell && lights > walls && ready > lights);
});
