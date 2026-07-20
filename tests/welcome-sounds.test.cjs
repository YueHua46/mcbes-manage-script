const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("welcome music uses ten non-positional preloaded music events with matching OGG files", () => {
  const definitions = JSON.parse(
    fs.readFileSync(path.join(root, "resource_packs/CreeperMenu/sounds/sound_definitions.json"), "utf8")
  ).sound_definitions;

  for (let index = 0; index < 10; index += 1) {
    const definition = definitions[`yuehua.welcome_${index}`];
    assert.ok(definition, `missing yuehua.welcome_${index}`);
    assert.equal(definition.category, "music");
    assert.equal(definition.sounds.length, 1);
    assert.equal(definition.sounds[0].is3D, false, "welcome music must not stay at the join position");
    assert.equal(definition.sounds[0].stream, undefined, "short welcome tracks should be preloaded for sync");
    assert.ok(fs.existsSync(path.join(root, "resource_packs/CreeperMenu", `${definition.sounds[0].name}.ogg`)));
  }

  assert.equal(
    Object.keys(definitions).filter((id) => id.startsWith("yuehua.welcome_")).length,
    10,
    "the shared sound catalog may contain non-welcome events, but exactly ten welcome tracks are required"
  );
});

test("player join handler selects a concrete welcome sound id", () => {
  const source = fs.readFileSync(path.join(root, "scripts/events/handlers/player.ts"), "utf8");
  assert.match(source, /const WELCOME_SOUNDS = \[/);
  assert.match(source, /WELCOME_PRESENTATION_DELAY_TICKS = 70/);
  assert.match(source, /waitTicks\(WELCOME_PRESENTATION_DELAY_TICKS\)/);
  assert.match(source, /if \(!event\.initialSpawn\) return/);
  assert.match(source, /WELCOME_SOUNDS\[index\]/);
  assert.match(source, /player\.playMusic\(sound\.id, \{ volume: 0\.4, fade: 0, loop: false \}\)/);
  assert.ok(
    source.indexOf("playRandomWelcomeSound(player);") < source.indexOf('player.onScreenDisplay.setTitle({ text: " " });'),
    "music must be requested before the title becomes visible"
  );
  assert.doesNotMatch(source, /\[欢迎音乐调试\]/);
  assert.doesNotMatch(source, /console\.info\(/);
  assert.doesNotMatch(source, /playSound\("yuehua\.welcome"\)/);
  assert.doesNotMatch(source, /setDynamicProperty\("join"/);
});
