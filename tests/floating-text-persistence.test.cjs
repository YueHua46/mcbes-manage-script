const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
  path.join(root, "scripts", "features", "floating-text", "services", "floating-text.ts"),
  "utf8"
);

test("floating-text mutations are persisted immediately", () => {
  assert.match(source, /this\.db\.set\(id, item\);\s*this\.db\.save\(\);\s*this\.render\(item\);/);
  assert.match(source, /this\.db\.set\(item\.id, item\);\s*this\.db\.save\(\);\s*this\.render\(item\);/);
  assert.match(source, /const deleted = this\.db\.delete\(id\);\s*if \(deleted\) this\.db\.save\(\);\s*return deleted;/);
});

test("startup reloads all persisted records and administrators list the entire database", () => {
  assert.match(source, /this\.db = new Database<IFloatingText>\("floating_text"\);\s*this\.renderAll\(\);/);
  assert.match(source, /listAllForAdmin\(\): IFloatingText\[\] \{\s*return this\.db\.values\(\)/);
});

