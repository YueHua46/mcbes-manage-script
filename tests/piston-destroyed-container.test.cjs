const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const filename = path.join(root, "scripts/features/land/services/piston-destroyed-container.ts");
const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: filename,
}).outputText;
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = Module._nodeModulePaths(path.dirname(filename));
loaded._compile(output, filename);
const { isPistonDestroyedContainerType } = loaded.exports;

test("all shulker box variants use the piston-destroyed container path", () => {
  for (const typeId of [
    "minecraft:shulker_box",
    "minecraft:undyed_shulker_box",
    "minecraft:purple_shulker_box",
    "minecraft:white_shulker_box",
    "minecraft:black_shulker_box",
  ]) {
    assert.equal(isPistonDestroyedContainerType(typeId), true, typeId);
  }
});

test("ordinary containers and solid blocks remain on the normal transaction path", () => {
  for (const typeId of ["minecraft:chest", "minecraft:barrel", "minecraft:hopper", "minecraft:stone"]) {
    assert.equal(isPistonDestroyedContainerType(typeId), false, typeId);
  }
});
