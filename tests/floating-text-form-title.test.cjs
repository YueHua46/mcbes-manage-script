const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "scripts", "ui", "forms", "floating-text", "index.ts"), "utf8");

test("floating-text detail titles never use player-controlled text for resource-pack routing", () => {
  assert.match(source, /form\.title\("悬浮文字详情"\)/);
  assert.doesNotMatch(source, /form\.title\(`\$\{latest\.name\}`\)/);
  assert.doesNotMatch(source, /form\.title\(formatFloatingTextDetailTitle\(latest\.name\)\)/);
});

test("closing the creation result does not automatically open another form", () => {
  assert.doesNotMatch(source, /\(\) => openFloatingTextDetailForm\(player, result/);
});
