const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const filename = path.join(root, "scripts/features/land/services/piston-movement-plan.ts");
const source = fs.readFileSync(filename, "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: filename,
}).outputText;
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = Module._nodeModulePaths(path.dirname(filename));
loaded._compile(output, filename);
const { PISTON_FACING_DIRECTIONS, planPistonMovement } = loaded.exports;

const at = (x, y = 64, z = 0) => ({ x, y, z });
const key = ({ x, y, z }) => `${x},${y},${z}`;
const base = {
  pistonLocation: at(0),
  facingDirection: at(1, 0, 0),
  pistonTypeId: "minecraft:sticky_piston",
  minY: -64,
  maxY: 319,
};

function plan(overrides) {
  const result = planPistonMovement({ ...base, ...overrides });
  assert.equal(result.ok, true, result.reason);
  return result.plan;
}

test("expansion filters the piston head and treats attached locations as destinations", () => {
  assert.deepEqual(plan({ phase: "expanding", attachedLocations: [at(1), at(2), at(3)] }).moves, [
    { source: at(1), destination: at(2) },
    { source: at(2), destination: at(3) },
  ]);
});

test("retraction treats attached locations as sources", () => {
  const result = plan({ phase: "retracting", attachedLocations: [at(2)] });
  assert.deepEqual(result.moves, [{ source: at(2), destination: at(1) }]);
  assert.deepEqual(result.terminalLocations, []);
});

test("Bedrock facing_direction values match observed piston arm coordinates", () => {
  assert.deepEqual(PISTON_FACING_DIRECTIONS, {
    0: at(0, -1),
    1: at(0, 1),
    2: at(0, 0, 1),
    3: at(0, 0, -1),
    4: at(1, 0, 0),
    5: at(-1, 0, 0),
  });
});

test("the post-reload BDS expansion observation reconstructs the pushed chain", () => {
  const result = planPistonMovement({
    ...base,
    pistonLocation: { x: -889, y: 69, z: -126 },
    facingDirection: PISTON_FACING_DIRECTIONS[2],
    phase: "expanding",
    attachedLocations: [
      { x: -889, y: 69, z: -123 },
      { x: -889, y: 69, z: -124 },
      { x: -889, y: 69, z: -125 },
    ],
  });
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(
    new Set(result.plan.moves.map((move) => `${key(move.source)}>${key(move.destination)}`)),
    new Set(["-889,69,-124>-889,69,-123", "-889,69,-125>-889,69,-124"])
  );
});

test("the post-reload BDS retraction observation reconstructs the sticky pull", () => {
  const result = planPistonMovement({
    ...base,
    pistonLocation: { x: -889, y: 69, z: -126 },
    facingDirection: PISTON_FACING_DIRECTIONS[2],
    phase: "retracting",
    attachedLocations: [{ x: -889, y: 69, z: -124 }],
  });
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(result.plan.moves, [
    {
      source: { x: -889, y: 69, z: -124 },
      destination: { x: -889, y: 69, z: -125 },
    },
  ]);
});

test("all six cardinal directions preserve one-block movement", () => {
  const directions = [at(1, 0, 0), at(-1, 0, 0), at(0, 1, 0), at(0, -1, 0), at(0, 0, 1), at(0, 0, -1)];
  for (const facingDirection of directions) {
    const pistonHead = {
      x: facingDirection.x,
      y: 64 + facingDirection.y,
      z: facingDirection.z,
    };
    const destination = {
      x: pistonHead.x + facingDirection.x,
      y: pistonHead.y + facingDirection.y,
      z: pistonHead.z + facingDirection.z,
    };
    const result = plan({ phase: "expanding", facingDirection, attachedLocations: [pistonHead, destination] });
    assert.deepEqual(result.moves[0], { source: pistonHead, destination });
  }
});

test("slime and honey side attachments remain valid when they stay in front of the piston", () => {
  const result = plan({ phase: "retracting", attachedLocations: [at(2), at(2, 65), at(2, 64, 1)] });
  assert.equal(result.moves.length, 3);
  assert.deepEqual(
    result.moves.map((move) => move.destination),
    [at(1), at(1, 64, 1), at(1, 65)]
  );
});

test("normal piston retraction cannot claim pulled blocks", () => {
  const result = planPistonMovement({
    ...base,
    phase: "retracting",
    pistonTypeId: "minecraft:piston",
    attachedLocations: [at(2)],
  });
  assert.deepEqual(result, {
    ok: false,
    reason: "normal-piston-retraction-has-attached-blocks",
    diagnostic: {},
  });
});

test("invalid observations cannot reach the piston base, rear, height limits, or exceed twelve blocks", () => {
  const cases = [
    { phase: "expanding", attachedLocations: [at(0)], reason: "movement-touches-piston-base" },
    { phase: "expanding", attachedLocations: [at(-1)], reason: "movement-behind-piston" },
    { phase: "expanding", attachedLocations: [at(2, 320)], reason: "coordinate-out-of-height-range" },
    {
      phase: "expanding",
      attachedLocations: Array.from({ length: 14 }, (_, index) => at(index + 1)),
      reason: "too-many-attached-blocks",
    },
  ];
  for (const { reason, ...observation } of cases) {
    const result = planPistonMovement({ ...base, ...observation });
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
  }
});

test("invalid movement diagnostics identify the raw coordinate and inferred move", () => {
  const result = planPistonMovement({
    ...base,
    phase: "retracting",
    attachedLocations: [at(0)],
  });
  assert.deepEqual(result, {
    ok: false,
    reason: "movement-touches-piston-base",
    diagnostic: {
      attachedIndex: 0,
      attachedLocation: at(0),
      inferredSource: at(0),
      inferredDestination: at(-1),
      sourceProjection: 0,
      destinationProjection: -1,
    },
  });
});

test("issue 28 retraction does not include the protected adjacent container or rear block", () => {
  const result = plan({ phase: "retracting", attachedLocations: [at(2)] });
  const touched = new Set(result.moves.flatMap((move) => [move.source.x, move.destination.x]));
  assert.deepEqual(
    [...touched].sort((a, b) => a - b),
    [1, 2]
  );
  assert.equal(touched.has(3), false, "the protected adjacent container must not be treated as a moved block");
  assert.equal(touched.has(-1), false, "the block behind the piston must never be touched");
});
