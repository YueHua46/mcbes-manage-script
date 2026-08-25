const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const manifest = JSON.parse(read("design", "menu-ui", "quest-icon-manifest.json"));

function v14PresetQuestIds() {
  const specification = read("docs", "superpowers", "specs", "2026-08-24-quest-system-and-preset-catalog-v1.4.md");
  const appendix = specification.slice(
    specification.indexOf("# 附录 A：完整预设任务目录"),
    specification.indexOf("# 附录 B：第一阶段发布清单")
  );
  return [...appendix.matchAll(/^\| `(preset\.[^`]+)` \|/gm)].map((match) => match[1]);
}

test("quest icon manifest covers every v1.4 preset quest exactly once", () => {
  const expected = v14PresetQuestIds();
  const actual = manifest.icons.map((icon) => icon.questId);

  assert.equal(expected.length, 158);
  assert.equal(manifest.version, 1);
  assert.equal(manifest.columns, 4);
  assert.equal(manifest.rows, 4);
  assert.deepEqual(actual, expected);
  assert.equal(new Set(actual).size, 158);
});

test("quest icon slugs, markers, and atlas cells are stable and collision-free", () => {
  const slugs = new Set();
  const markers = new Set();
  const atlasCells = new Set();
  const atlases = new Set();

  manifest.icons.forEach((icon, index) => {
    const expectedSlug = icon.questId.replace(/^preset\./, "").replaceAll(".", "_");
    const expectedAtlas = `quest-icons-atlas-${String(Math.floor(index / 16) + 1).padStart(2, "0")}-imagegen.png`;
    assert.equal(icon.slug, expectedSlug, icon.questId);
    assert.match(icon.slug, /^[a-z0-9_]+$/);
    assert.equal(icon.atlas, expectedAtlas, icon.questId);
    assert.equal(icon.cell, index % 16, icon.questId);
    assert.equal(icon.markerIndex, index, icon.questId);
    assert.ok(["all", "largest"].includes(icon.componentPolicy), icon.questId);
    assert.ok(Number.isInteger(icon.opticalYOffset), icon.questId);
    assert.ok(icon.opticalYOffset >= -2 && icon.opticalYOffset <= 2, icon.questId);

    const atlasCell = `${icon.atlas}#${icon.cell}`;
    assert.equal(slugs.has(icon.slug), false, `duplicate slug ${icon.slug}`);
    assert.equal(markers.has(icon.markerIndex), false, `duplicate marker ${icon.markerIndex}`);
    assert.equal(atlasCells.has(atlasCell), false, `duplicate atlas cell ${atlasCell}`);
    slugs.add(icon.slug);
    markers.add(icon.markerIndex);
    atlasCells.add(atlasCell);
    atlases.add(icon.atlas);
  });

  assert.equal(slugs.size, 158);
  assert.equal(markers.size, 158);
  assert.equal(atlasCells.size, 158);
  assert.equal(atlases.size, 10);
  assert.deepEqual(
    [...markers].sort((left, right) => left - right),
    Array.from({ length: 158 }, (_, index) => index)
  );
  for (let atlas = 1; atlas <= 9; atlas += 1) {
    const name = `quest-icons-atlas-${String(atlas).padStart(2, "0")}-imagegen.png`;
    assert.equal(manifest.icons.filter((icon) => icon.atlas === name).length, 16, name);
  }
  assert.equal(manifest.icons.filter((icon) => icon.atlas === "quest-icons-atlas-10-imagegen.png").length, 14);
});

test("quest icon builder enforces safe-cell extraction and transparent 32px output", () => {
  const builder = read("design", "menu-ui", "build.py");

  assert.match(builder, /QUEST_ICON_GRID_COLUMNS = 4/);
  assert.match(builder, /QUEST_ICON_GRID_ROWS = 4/);
  assert.match(builder, /QUEST_ICON_SAFE_INSET_RATIO = 0\.125/);
  assert.match(builder, /QUEST_ICON_CANVAS_SIZE = 32/);
  assert.match(builder, /QUEST_ICON_MAX_ARTWORK_SIZE = 26/);
  assert.match(builder, /QUEST_ICON_TRANSPARENT_EDGE = 2/);
  assert.match(builder, /def load_quest_icon_manifest\(\)/);
  assert.match(builder, /def extract_quest_icon_cell\(/);
  assert.match(builder, /atlas\.width % QUEST_ICON_GRID_COLUMNS/);
  assert.match(builder, /cell = remove_edge_key\(atlas\.crop/);
  assert.match(builder, /safe_inset = max\(1, round\(cell_width \* QUEST_ICON_SAFE_INSET_RATIO\)\)/);
  assert.match(builder, /gutter_alpha\.getbbox\(\) is not None/);
  assert.match(builder, /contains artwork in its safety gutter/);
  assert.match(builder, /assert_transparent_quest_icon_edge\(canvas/);
  assert.match(builder, /does not keep a \{edge\}px transparent safety edge/);
  assert.match(builder, /Do not write partial output/);
  assert.match(builder, /def make_quest_icon_contact_sheet\(/);
  assert.match(builder, /QUEST_ICON_PREVIEW/);
  assert.match(builder, /def connected_component_runs\(/);
  assert.match(builder, /def normalize_generated_quest_atlas\(/);
  assert.match(builder, /quest-icons-atlas-b01-v2\.png/);
  assert.match(builder, /QUEST_ICON_NORMALIZED_ATLAS_SIZE = 1280/);
  assert.match(builder, /QUEST_ICON_NORMALIZED_ARTWORK_SIZE = 224/);
  assert.match(builder, /def generate_quest_icon_typescript\(/);
  assert.match(builder, /def update_quest_icon_hud\(/);
});

test("quest icon extractor accepts centered artwork and rejects source gutter pixels", () => {
  const builderPath = path.join(root, "design", "menu-ui", "build.py");
  const probe = String.raw`
import importlib.util
from PIL import Image, ImageDraw

spec = importlib.util.spec_from_file_location("creeper_menu_builder", r"${builderPath}")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
entry = {
    "questId": "preset.test.icon",
    "slug": "test_icon",
    "atlas": "quest-icons-atlas-01-imagegen.png",
    "cell": 0,
    "markerIndex": 0,
    "componentPolicy": "all",
    "opticalYOffset": 0,
}
atlas = Image.new("RGBA", (400, 400))
ImageDraw.Draw(atlas).rectangle((25, 25, 74, 74), fill=(120, 80, 40, 255))
icon = module.extract_quest_icon_cell(atlas, entry)
assert icon.size == (32, 32)
alpha = icon.getchannel("A")
assert alpha.getbbox() is not None
assert alpha.crop((0, 0, 32, 2)).getbbox() is None
assert alpha.crop((0, 30, 32, 32)).getbbox() is None
assert alpha.crop((0, 0, 2, 32)).getbbox() is None
assert alpha.crop((30, 0, 32, 32)).getbbox() is None

atlas.putpixel((2, 2), (255, 255, 255, 255))
try:
    module.extract_quest_icon_cell(atlas, entry)
except ValueError as error:
    assert "safety gutter" in str(error)
else:
    raise AssertionError("source gutter artwork was not rejected")
`;
  const result = childProcess.spawnSync("python", ["-c", probe], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("quest atlas normalizer keeps complete off-grid components in their nearest expected cell", () => {
  const builderPath = path.join(root, "design", "menu-ui", "build.py");
  const probe = String.raw`
import importlib.util
from PIL import Image, ImageDraw

spec = importlib.util.spec_from_file_location("creeper_menu_builder", r"${builderPath}")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
raw = Image.new("RGBA", (400, 400), (249, 2, 247, 255))
draw = ImageDraw.Draw(raw)
# The subject crosses x=100, the nominal boundary of the first source cell.
draw.rectangle((55, 28, 118, 72), fill=(45, 35, 25, 255))
draw.rectangle((75, 38, 108, 62), fill=(190, 120, 40, 255))
normalized = module.normalize_generated_quest_atlas(raw, {0}, "synthetic.png")
assert normalized.size == (1280, 1280)
alpha = normalized.getchannel("A")
assert alpha.crop((0, 0, 320, 320)).getbbox() is not None
assert alpha.crop((320, 0, 640, 320)).getbbox() is None
entry = {
    "questId": "preset.test.off_grid",
    "slug": "test_off_grid",
    "atlas": "synthetic.png",
    "cell": 0,
    "markerIndex": 0,
    "componentPolicy": "all",
    "opticalYOffset": 0,
}
icon = module.extract_quest_icon_cell(normalized, entry)
assert icon.size == (32, 32)
`;
  const result = childProcess.spawnSync("python", ["-c", probe], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("quest icon build is explicit and missing atlases cannot break the ordinary menu build", () => {
  const builder = read("design", "menu-ui", "build.py");
  const mainBody = builder.slice(builder.indexOf("def main()"), builder.indexOf('if __name__ == "__main__"'));

  assert.doesNotMatch(mainBody, /build_quest_icons/);
  assert.match(builder, /"--quest-icons"/);
  assert.match(builder, /"--normalize-quest-atlases"/);
  assert.match(builder, /elif arguments\.quest_icons:[\s\S]*build_quest_icons\(\)[\s\S]*else:[\s\S]*main\(\)/);
  assert.match(builder, /Quest icon atlas sources are missing/);

  const help = childProcess.spawnSync("python", [path.join(root, "design", "menu-ui", "build.py"), "--help"], {
    encoding: "utf8",
  });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--quest-icons/);
  assert.match(help.stdout, /--normalize-quest-atlases/);
});
