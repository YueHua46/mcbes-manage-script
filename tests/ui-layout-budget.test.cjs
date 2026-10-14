const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function listTs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listTs(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

// Every ActionForm instantiates all enabled chest layouts (hidden) inside the vanilla form factory,
// so a layout that no script uses only costs client memory and frame time.
const SIZE_TO_LAYOUT = {
  small: "27",
  single: "27",
  large: "54",
  double: "54",
  shop: "54",
  1: "1",
  5: "5",
  9: "9",
  18: "18",
  27: "27",
  "27_inv": "27_inv",
  36: "36",
  "36_inv": "36_inv",
  45: "45",
  "45_inv": "45_inv",
  54: "54",
};

test("only chest layouts used by scripts are instantiated", () => {
  const globals = JSON.parse(
    fs.readFileSync(path.join(root, "resource_packs", "CreeperMenu", "ui", "_global_variables.json"), "utf8")
  );
  const sources = listTs(path.join(root, "scripts"))
    .filter((file) => !file.endsWith(path.join("chest-ui", "chest-forms.ts")) && !file.endsWith("typing.d.ts"))
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");

  assert.doesNotMatch(sources, /new ChestFormData\(\s*\)/, "use an explicit chest size");
  const used = new Set();
  for (const match of sources.matchAll(/new ChestFormData\(\s*"([^"]+)"\s*\)/g)) {
    const layout = SIZE_TO_LAYOUT[match[1]];
    assert.ok(layout, `unknown chest size ${match[1]}`);
    used.add(layout);
  }

  for (const layout of new Set(Object.values(SIZE_TO_LAYOUT))) {
    const key = `$disable_${layout}_slots_layout`;
    assert.equal(globals[key], !used.has(layout), `${key} should be ${!used.has(layout)}`);
  }

  const furnaceUsed = /new FurnaceFormData\(/.test(sources);
  assert.equal(globals.$disable_furnace_ui, !furnaceUsed, "$disable_furnace_ui must follow FurnaceFormData usage");
});
