const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

function loadReconcile() {
  const filename = path.join(__dirname, "..", "scripts", "features", "economic", "services", "item-database-reconcile.ts");
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports }, { filename });
  return module.exports;
}

const { decideSlot } = loadReconcile();

const SOURCES = {
  live: { kind: "live" },
  backup: { kind: "backup", seq: 3 },
  rescue: { kind: "rescue" },
  unload: { kind: "unload" },
};

const RECORDS = {
  none: undefined,
  activeOld: { rev: 1, snapshotTypeId: "minecraft:diamond" }, // 备份之前写入
  activeNew: { rev: 5, snapshotTypeId: "minecraft:diamond" }, // 备份之后写入
  quarantined: { quarantined: true },
  staleCopy: { quarantined: true, staleCopy: true },
};

const ENTITY = {
  empty: undefined,
  same: "minecraft:diamond",
  other: "minecraft:stone",
};

// 每一格都显式写出预期结果：[实体为空, 同类物品, 异类物品]
const EXPECTED = {
  none: {
    live: ["noop", "quarantine", "quarantine"],
    backup: ["noop", "discardBackupCopy", "discardBackupCopy"],
    rescue: ["noop", "quarantine", "quarantine"],
    unload: ["noop", "quarantine", "quarantine"],
  },
  activeOld: {
    live: ["rebuild", "activate", "quarantineMismatch"],
    backup: ["rebuild", "activate", "rebuild!"],
    rescue: ["rebuild", "activate", "quarantineMismatch"],
    unload: ["noop", "noop", "noop"],
  },
  activeNew: {
    live: ["rebuild", "activate", "quarantineMismatch"],
    backup: ["rebuild", "rebuild!", "rebuild!"],
    rescue: ["rebuild", "activate", "quarantineMismatch"],
    unload: ["noop", "noop", "noop"],
  },
  quarantined: {
    live: ["dropRecord", "keepQuarantine", "keepQuarantine"],
    backup: ["dropRecord", "keepQuarantine", "keepQuarantine"],
    rescue: ["dropRecord", "keepQuarantine", "keepQuarantine"],
    unload: ["noop", "keepQuarantine", "keepQuarantine"],
  },
  staleCopy: {
    live: ["clearStaleCopy", "clearStaleCopy", "clearStaleCopy"],
    backup: ["clearStaleCopy", "clearStaleCopy", "clearStaleCopy"],
    rescue: ["clearStaleCopy", "clearStaleCopy", "clearStaleCopy"],
    unload: ["noop", "noop", "noop"],
  },
};

test("decideSlot covers every entity × record × source combination as specified", () => {
  let checked = 0;
  for (const [recordName, record] of Object.entries(RECORDS)) {
    for (const [sourceName, source] of Object.entries(SOURCES)) {
      Object.values(ENTITY).forEach((entityTypeId, column) => {
        const expected = EXPECTED[recordName][sourceName][column];
        const decision = decideSlot(entityTypeId, record, source);
        const label = `${recordName} / ${sourceName} / ${entityTypeId ?? "empty"}`;
        if (expected.endsWith("!")) {
          assert.equal(decision.kind, "rebuild", label);
          assert.equal(decision.discardEntityItem, true, `${label} must discard the stale entity copy`);
        } else {
          assert.equal(decision.kind, expected, label);
          if (decision.kind === "rebuild") assert.equal(decision.discardEntityItem, false, label);
        }
        checked++;
      });
    }
  }
  assert.equal(checked, 60);
});

test("no combination ever turns an unindexed or stale item into a visible item", () => {
  for (const source of Object.values(SOURCES)) {
    for (const entityTypeId of Object.values(ENTITY)) {
      for (const record of [RECORDS.none, RECORDS.quarantined, RECORDS.staleCopy]) {
        assert.notEqual(decideSlot(entityTypeId, record, source).kind, "activate");
      }
    }
  }
});

test("the unload path never asks for physical changes", () => {
  const physical = new Set(["clearStaleCopy", "discardBackupCopy", "rebuild"]);
  for (const record of Object.values(RECORDS)) {
    for (const entityTypeId of Object.values(ENTITY)) {
      assert.ok(!physical.has(decideSlot(entityTypeId, record, SOURCES.unload).kind));
    }
  }
});
