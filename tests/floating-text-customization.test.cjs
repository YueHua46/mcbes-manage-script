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

test("ordinary create and edit forms use player-friendly named choices", () => {
  const createForm = form.slice(
    form.indexOf("function openFloatingTextCreateForm"),
    form.indexOf("function openFloatingTextDetailForm")
  );
  const editForm = form.slice(
    form.indexOf("function openFloatingTextEditForm"),
    form.indexOf("function openFloatingTextAdvancedColorForm")
  );

  assert.match(createForm, /form\.dropdown\([\s\S]*?"文字大小"/);
  assert.match(createForm, /form\.dropdown\([\s\S]*?"多远还能看见"/);
  assert.match(createForm, /form\.dropdown\([\s\S]*?"背景显示效果"/);
  assert.match(createForm, /"始终面向每位玩家（推荐）", "固定为我现在面对的方向"/);
  assert.doesNotMatch(createForm, /十六进制|不透明度|Pitch|Yaw|Roll/);
  assert.doesNotMatch(editForm, /十六进制|Pitch|Yaw|Roll/);
});

test("technical color controls are isolated behind a clearly labeled advanced form", () => {
  assert.match(form, /form\.button\("高级颜色设置"/);
  assert.match(form, /form\.title\("高级颜色设置"\)/);
  assert.match(form, /"完全清晰（推荐）"/);
  assert.match(form, /"无背景（完全透明）"/);
  assert.match(form, /普通玩家建议返回并使用颜色名称/);
  assert.match(form, /固定朝向时，背面也显示文字/);
  assert.match(form, /固定朝向时，背面也显示背景/);
});

test("legacy background alpha remains readable and is migrated on update", () => {
  assert.match(service, /alpha: clampNumber\(item\.backgroundAlpha, DEFAULT_BACKGROUND_COLOR\.alpha, 0, 1\)/);
  assert.match(service, /delete item\.backgroundAlpha/);
});
