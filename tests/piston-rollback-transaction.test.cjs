const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const filename = path.join(root, "scripts/features/land/services/piston-rollback-transaction.ts");
const source = fs.readFileSync(filename, "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: filename,
}).outputText;
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = Module._nodeModulePaths(path.dirname(filename));
loaded._compile(output, filename);
const { executePistonRollbackCommit } = loaded.exports;

const at = (x) => ({ x, y: 64, z: 0 });
const keyOf = ({ x, y, z }) => `${x},${y},${z}`;
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

function makeGrid(entries, fail = {}) {
  const grid = new Map(entries.map(([x, block]) => [keyOf(at(x)), clone(block)]));
  let writes = 0;
  const snapshot = (locations) => new Map(locations.map((location) => [keyOf(location), clone(grid.get(keyOf(location)))]));
  const restoreSnapshot = (saved, targetOverride) => {
    for (const [key, value] of saved) grid.set(targetOverride ?? key, clone(value));
  };
  return {
    grid,
    writes: () => writes,
    adapter: {
      captureMoved(move, index) {
        if (fail.captureMoved === index) throw new Error("capture failed");
        return snapshot([move.destination]);
      },
      captureCheckpoint(locations) {
        if (fail.captureCheckpoint) throw new Error("checkpoint failed");
        return snapshot(locations);
      },
      clear(location) {
        writes += 1;
        grid.set(keyOf(location), { typeId: "minecraft:air" });
        if (fail.clearAfter === writes) throw new Error("commit failed");
      },
      restoreMoved(saved, move) {
        writes += 1;
        const value = [...saved.values()][0];
        grid.set(keyOf(move.source), clone(value));
      },
      restoreTerminal(saved) {
        writes += 1;
        restoreSnapshot(saved);
      },
      verifyMoved(saved, move) {
        assert.deepEqual(grid.get(keyOf(move.source)), [...saved.values()][0]);
      },
      verifyTerminal(saved) {
        for (const [key, value] of saved) assert.deepEqual(grid.get(key), value);
      },
      restoreCheckpoint(saved) {
        if (fail.restoreCheckpoint) throw new Error("checkpoint restore failed");
        restoreSnapshot(saved);
      },
    },
  };
}

test("a pulled NBT container is restored once and never copied behind the piston", () => {
  const container = { typeId: "minecraft:shulker_box", nbt: { items: [{ id: "diamond", count: 64 }] } };
  const world = makeGrid([
    [-1, { typeId: "minecraft:bedrock" }],
    [0, { typeId: "minecraft:sticky_piston" }],
    [1, { typeId: "minecraft:air" }],
    [2, container],
    [3, { typeId: "minecraft:air" }],
  ]);
  const move = { source: at(3), destination: at(2) };
  const result = executePistonRollbackCommit(
    {
      moves: [move],
      terminalSnapshots: [],
      clearLocations: [at(0), at(1), at(2), at(3)],
      checkpointLocations: [at(0), at(1), at(2), at(3)],
    },
    world.adapter
  );
  assert.equal(result.status, "completed");
  assert.deepEqual(world.grid.get(keyOf(at(3))), container);
  assert.equal(world.grid.get(keyOf(at(2))).typeId, "minecraft:air");
  assert.equal(world.grid.get(keyOf(at(-1))).typeId, "minecraft:bedrock");
  const nbtContainers = [...world.grid.values()].filter((block) => block.nbt).length;
  assert.equal(nbtContainers, 1);
});

test("a chain of block-entity containers keeps each distinct NBT payload exactly once", () => {
  const chest = { typeId: "minecraft:chest", nbt: { customName: "A", items: ["diamond"] } };
  const hopper = { typeId: "minecraft:hopper", nbt: { customName: "B", items: ["emerald"] } };
  const world = makeGrid([
    [0, { typeId: "minecraft:piston" }],
    [1, { typeId: "minecraft:air" }],
    [2, chest],
    [3, hopper],
    [4, { typeId: "minecraft:air" }],
  ]);
  const moves = [
    { source: at(1), destination: at(2) },
    { source: at(2), destination: at(3) },
  ];
  const result = executePistonRollbackCommit(
    {
      moves,
      terminalSnapshots: [],
      clearLocations: [at(0), at(1), at(2), at(3)],
      checkpointLocations: [at(0), at(1), at(2), at(3)],
    },
    world.adapter
  );
  assert.equal(result.status, "completed");
  assert.deepEqual(world.grid.get(keyOf(at(1))), chest);
  assert.deepEqual(world.grid.get(keyOf(at(2))), hopper);
  assert.equal([...world.grid.values()].filter((block) => block?.nbt?.customName === "A").length, 1);
  assert.equal([...world.grid.values()].filter((block) => block?.nbt?.customName === "B").length, 1);
});

test("validated replaceable terminal state such as water is restored after reversing a push", () => {
  const stone = { typeId: "minecraft:stone" };
  const water = { typeId: "minecraft:water", states: { liquid_depth: 0 } };
  const world = makeGrid([
    [0, { typeId: "minecraft:piston" }],
    [1, { typeId: "minecraft:air" }],
    [2, stone],
  ]);
  const terminalSnapshot = new Map([[keyOf(at(2)), clone(water)]]);
  const move = { source: at(1), destination: at(2) };
  const result = executePistonRollbackCommit(
    {
      moves: [move],
      terminalSnapshots: [terminalSnapshot],
      clearLocations: [at(0), at(1), at(2)],
      checkpointLocations: [at(0), at(1), at(2)],
    },
    world.adapter
  );
  assert.equal(result.status, "completed");
  assert.deepEqual(world.grid.get(keyOf(at(1))), stone);
  assert.deepEqual(world.grid.get(keyOf(at(2))), water);
});

test("unrelated command blocks and indestructible blocks outside the move set remain untouched", () => {
  const world = makeGrid([
    [-1, { typeId: "minecraft:command_block", nbt: { command: "say safe" } }],
    [0, { typeId: "minecraft:sticky_piston" }],
    [1, { typeId: "minecraft:stone" }],
    [2, { typeId: "minecraft:air" }],
    [3, { typeId: "minecraft:barrier" }],
  ]);
  const beforeRear = clone(world.grid.get(keyOf(at(-1))));
  const beforeFront = clone(world.grid.get(keyOf(at(3))));
  const result = executePistonRollbackCommit(
    {
      moves: [{ source: at(2), destination: at(1) }],
      terminalSnapshots: [],
      clearLocations: [at(0), at(1), at(2)],
      checkpointLocations: [at(0), at(1), at(2)],
    },
    world.adapter
  );
  assert.equal(result.status, "completed");
  assert.deepEqual(world.grid.get(keyOf(at(-1))), beforeRear);
  assert.deepEqual(world.grid.get(keyOf(at(3))), beforeFront);
});

test("snapshot failure performs zero world writes and leaves the piston intact", () => {
  const world = makeGrid(
    [
      [0, { typeId: "minecraft:sticky_piston" }],
      [1, { typeId: "minecraft:stone" }],
    ],
    { captureMoved: 0 }
  );
  const before = clone([...world.grid]);
  const result = executePistonRollbackCommit(
    {
      moves: [{ source: at(2), destination: at(1) }],
      terminalSnapshots: [],
      clearLocations: [at(0), at(1), at(2)],
      checkpointLocations: [at(0), at(1), at(2)],
    },
    world.adapter
  );
  assert.equal(result.status, "precommit-failed");
  assert.equal(result.mutated, false);
  assert.equal(world.writes(), 0);
  assert.deepEqual([...world.grid], before);
});

test("mid-commit failure restores the complete settled checkpoint", () => {
  const world = makeGrid(
    [
      [-1, { typeId: "minecraft:barrier" }],
      [0, { typeId: "minecraft:sticky_piston" }],
      [1, { typeId: "minecraft:stone" }],
      [2, { typeId: "minecraft:chest", nbt: { items: ["emerald"] } }],
      [3, { typeId: "minecraft:air" }],
    ],
    { clearAfter: 2 }
  );
  const before = clone([...world.grid]);
  const result = executePistonRollbackCommit(
    {
      moves: [{ source: at(3), destination: at(2) }],
      terminalSnapshots: [],
      clearLocations: [at(0), at(1), at(2), at(3)],
      checkpointLocations: [at(0), at(1), at(2), at(3)],
    },
    world.adapter
  );
  assert.equal(result.status, "commit-reverted");
  assert.deepEqual([...world.grid], before);
  assert.equal(world.grid.get(keyOf(at(-1))).typeId, "minecraft:barrier");
});

test("checkpoint restoration failure is reported without continuing commit writes", () => {
  const world = makeGrid(
    [
      [0, { typeId: "minecraft:sticky_piston" }],
      [1, { typeId: "minecraft:stone" }],
    ],
    { clearAfter: 1, restoreCheckpoint: true }
  );
  const result = executePistonRollbackCommit(
    {
      moves: [{ source: at(2), destination: at(1) }],
      terminalSnapshots: [],
      clearLocations: [at(0), at(1), at(2)],
      checkpointLocations: [at(0), at(1), at(2)],
    },
    world.adapter
  );
  assert.equal(result.status, "checkpoint-restore-failed");
  assert.equal(world.writes(), 1);
});
