const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("repository check uses a stable LF policy", () => {
  const attributes = read(".gitattributes");
  const prettier = JSON.parse(read(".prettierrc.json"));

  assert.match(attributes, /\*\.ts text eol=lf/);
  assert.match(attributes, /\*\.yml text eol=lf/);
  assert.match(attributes, /\*\.cjs text eol=lf/);
  assert.equal(prettier.endOfLine, "lf");
});

test("lint passes a directory instead of a shell-dependent recursive glob", () => {
  assert.match(read("just.config.ts"), /coreLint\(\["scripts"\]/);
});

test("workflow tests normalize line endings before matching", () => {
  assert.match(read("tests/release-workflow.test.cjs"), /replace\(\/\\r\\n\?\/g, "\\n"\)/);
});
