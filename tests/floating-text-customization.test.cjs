const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const service = fs.readFileSync(
  path.join(root, "scripts", "features", "floating-text", "services", "floating-text.ts"),
  "utf8"
);
const form = fs.readFileSync(path.join(root, "scripts", "ui", "forms", "floating-text", "index.ts"), "utf8");

test("floating text exposes the supported primitive visual properties", () => {
  assert.match(service, /shape\.color = normalizeColor\(item\.textColor, DEFAULT_TEXT_COLOR\)/);
  assert.match(service, /shape\.backgroundColorOverride = getBackgroundColor\(item\)/);
  assert.match(service, /shape\.rotation = normalizeRotation\(item\.rotation\)/);
  assert.match(service, /shape\.useRotation = item\.useRotation \?\? false/);
  assert.match(service, /shape\.backfaceVisible = item\.backfaceVisible \?\? true/);
  assert.match(service, /shape\.textBackfaceVisible = item\.textBackfaceVisible \?\? true/);
});

test("create and edit forms expose colors, opacity, rotation, and back-face controls", () => {
  assert.match(form, /form\.textField\("文字颜色"/);
  assert.match(form, /form\.textField\("背景颜色"/);
  assert.match(form, /form\.toggle\("使用固定朝向/);
  assert.match(form, /form\.textField\("俯仰角 Pitch"/);
  assert.match(form, /form\.textField\("偏航角 Yaw"/);
  assert.match(form, /form\.textField\("翻滚角 Roll"/);
  assert.match(form, /form\.toggle\("固定朝向时显示背景背面"/);
  assert.match(form, /form\.toggle\("固定朝向时显示文字背面"/);
});

test("legacy background alpha remains readable and is migrated on update", () => {
  assert.match(service, /alpha: clampNumber\(item\.backgroundAlpha, DEFAULT_BACKGROUND_COLOR\.alpha, 0, 1\)/);
  assert.match(service, /delete item\.backgroundAlpha/);
});
