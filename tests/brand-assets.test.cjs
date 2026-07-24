const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function sha256(relativePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(root, relativePath)))
    .digest("hex");
}

function pngSize(relativePath) {
  const data = fs.readFileSync(path.join(root, relativePath));
  assert.equal(data.subarray(1, 4).toString("ascii"), "PNG");
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
  };
}

test("brand assets exist at release dimensions", () => {
  assert.deepEqual(pngSize("resource_packs/CreeperMenu/pack_icon.png"), {
    width: 256,
    height: 256,
  });
  assert.deepEqual(pngSize("behavior_packs/CreeperMenu/pack_icon.png"), {
    width: 256,
    height: 256,
  });
  assert.deepEqual(pngSize("docs/images/creeper-menu-banner.png"), {
    width: 1600,
    height: 640,
  });
});

test("behavior and resource packs use one shared icon", () => {
  assert.equal(
    sha256("behavior_packs/CreeperMenu/pack_icon.png"),
    sha256("resource_packs/CreeperMenu/pack_icon.png")
  );
});

test("brand build preserves the original menu item byte-for-byte", () => {
  assert.equal(
    sha256("resource_packs/CreeperMenu/textures/items/sm.png"),
    "137d79911c5fe12cfa3e55cbd40a135fd54f9f69f184c0103b5d916dbaa609c9"
  );
  assert.equal(fs.existsSync(path.join(root, "tools/build-brand-assets.py")), true);
});
