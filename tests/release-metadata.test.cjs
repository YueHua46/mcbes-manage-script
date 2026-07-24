const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const {
  artifactFilename,
  assertTag,
  assertVersions,
  loadReleaseConfig,
  minecraftFamily,
  releaseTitle,
} = require("../tools/release-metadata.cjs");

test("release metadata derives the public Minecraft family and Chinese names", () => {
  const config = { version: "3.2.13", minecraftVersion: "1.26.30" };

  assert.equal(minecraftFamily(config.minecraftVersion), "1.26.3x");
  assert.equal(releaseTitle(config), "苦力怕菜单 v3.2.13（适配 MCBE 1.26.3x）");
  assert.equal(
    artifactFilename("standard", config),
    "CreeperMenu-v3.2.13-MCBE-1.26.3x-普通兼容版.mcaddon"
  );
  assert.equal(
    artifactFilename("realms", config),
    "CreeperMenu-v3.2.13-MCBE-1.26.3x-Realms兼容版.mcaddon"
  );
  assert.equal(
    artifactFilename("bds", config),
    "CreeperMenu-v3.2.13-MCBE-1.26.3x-BDS增强版.mcaddon"
  );
});

test("release metadata rejects malformed versions and unknown variants", () => {
  assert.throws(() => minecraftFamily("1.26"), /三段数字/);
  assert.throws(() => minecraftFamily("1.26.beta"), /三段数字/);
  assert.throws(
    () => artifactFilename("debug", { version: "3.2.13", minecraftVersion: "1.26.30" }),
    /未知发行变体/
  );
});

test("tag validation requires the canonical release tag", () => {
  const config = { version: "3.2.13", minecraftVersion: "1.26.30" };

  assert.doesNotThrow(() => assertTag("v3.2.13", config));
  assert.throws(() => assertTag("v3.2.12", config), /必须等于 v3\.2\.13/);
  assert.throws(() => assertTag("3.2.13", config), /必须等于 v3\.2\.13/);
});

test("all CreeperMenu package and manifest versions share one release version", () => {
  const config = loadReleaseConfig();
  assert.deepEqual(config, { version: "3.2.13", minecraftVersion: "1.26.30" });
  assert.doesNotThrow(() => assertVersions(config));
});

test("Backrooms remains independently versioned", () => {
  for (const relativePath of [
    "behavior_packs/Backrooms/manifest.json",
    "resource_packs/Backrooms/manifest.json",
  ]) {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
    assert.deepEqual(manifest.header.version, [1, 0, 0]);
    for (const module of manifest.modules) {
      assert.deepEqual(module.version, [1, 0, 0]);
    }
  }
});
