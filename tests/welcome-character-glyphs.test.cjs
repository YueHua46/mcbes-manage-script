const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("all sixteen fake-player characters map to the first row of glyph_E8", () => {
  const glyphMap = fs.readFileSync(path.join(root, "scripts/assets/glyph-map.ts"), "utf8");
  const joinEvent = fs.readFileSync(path.join(root, "scripts/Events/handlers/player.ts"), "utf8");
  const hudScreen = JSON.parse(
    fs.readFileSync(path.join(root, "resource_packs/CreeperMenu/ui/hud_screen.json"), "utf8")
  );
  const atlas = fs.readFileSync(
    path.join(root, "resource_packs/CreeperMenu/font/glyph_E8.png")
  );

  const mappedGlyphs = [...glyphMap.matchAll(/"\\u(E80[0-9A-F])"/g)].map((match) => match[1]);
  assert.deepEqual(
    mappedGlyphs,
    Array.from({ length: 16 }, (_, index) => `E80${index.toString(16).toUpperCase()}`)
  );
  assert.match(joinEvent, /Math\.random\(\) \* welcomeCharacterGlyphs\.length/);
  assert.match(joinEvent, /titleraw @s subtitle[\s\S]*setTitle\(\{ text: " " \}\)/);
  assert.match(joinEvent, /\$\{welcomeCharacter\}\\\\n\\\\n\\\\n\\\\n\$\{left\}/);
  assert.equal(hudScreen["hud_title_text/subtitle_frame/subtitle"].line_padding, -2);

  assert.equal(atlas.toString("ascii", 1, 4), "PNG");
  assert.equal(atlas.readUInt32BE(16), 960);
  assert.equal(atlas.readUInt32BE(20), 960);
  assert.equal(atlas[25], 6, "glyph atlas must be an RGBA PNG");
});
