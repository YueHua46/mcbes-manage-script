const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("vanilla icon generator is self-contained in this repository", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const command = packageJson.scripts["build:vanilla-icon-map"];
  const source = fs.readFileSync(path.join(root, "tools/build-vanilla-icon-map.ts"), "utf8");

  assert.match(command, /tools\/build-vanilla-icon-map\.ts/);
  assert.doesNotMatch(command, /bedrock-texture-extractor|\.\.\//);
  assert.match(source, /const OUTPUT_RELATIVE = "\.\.\/scripts\/assets\/vanilla-item-icon-paths\.ts"/);
  assert.match(source, /Mojang[\s\S]*bedrock-samples/);
  assert.doesNotMatch(source, /bedrock-texture-extractor|import\.meta\.dir/);
});

test("generated map resolves current special item textures without convention fallbacks", () => {
  const generated = fs.readFileSync(
    path.join(root, "scripts/assets/vanilla-item-icon-paths.ts"),
    "utf8"
  );

  assert.match(generated, /"minecraft:enchanted_golden_apple": "textures\/items\/apple_golden"/);
  assert.match(generated, /"minecraft:sulfur_cube_bucket": "textures\/items\/bucket_sulfur_cube"/);
});
