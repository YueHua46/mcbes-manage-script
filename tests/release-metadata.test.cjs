const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const {
  artifactFilename,
  assertMinecraftDependencies,
  assertTag,
  assertVersions,
  loadReleaseConfig,
  minecraftFamily,
  releaseNotes,
  releaseTitle,
  verifyReleaseFiles,
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
  assert.deepEqual(config, { version: "3.2.14", minecraftVersion: "1.26.30" });
  assert.doesNotThrow(() => assertVersions(config));
});

test("Minecraft build baseline must match the pinned package dependencies", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const config = { version: "3.2.13", minecraftVersion: "1.26.30" };
  assert.doesNotThrow(() => assertMinecraftDependencies(packageJson.dependencies, config));
  assert.throws(
    () =>
      assertMinecraftDependencies(
        { ...packageJson.dependencies, "@minecraft/vanilla-data": "1.26.40" },
        config
      ),
    /Minecraft 构建基线/
  );
  assert.throws(
    () =>
      assertMinecraftDependencies(
        {
          ...packageJson.dependencies,
          "@minecraft/server": "2.9.0-beta.1.26.40-stable",
        },
        config
      ),
    /Minecraft 构建基线/
  );
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

test("release notes explain all variants and the exact compatibility baseline", () => {
  const notes = releaseNotes({
    version: "3.2.13",
    minecraftVersion: "1.26.30",
  });
  for (const text of [
    "普通兼容版",
    "Realms 兼容版",
    "BDS 增强版",
    "1.26.30",
    "1.26.3x",
    "备份世界",
  ]) {
    assert.match(notes, new RegExp(text));
  }
});

test("release file validation requires exactly the three configured attachments", () => {
  const tempDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "release-files-"));
  const config = { version: "3.2.13", minecraftVersion: "1.26.30" };
  try {
    for (const variant of ["standard", "realms", "bds"]) {
      fs.writeFileSync(path.join(tempDir, artifactFilename(variant, config)), variant);
    }
    assert.doesNotThrow(() => verifyReleaseFiles(tempDir, config));
    fs.writeFileSync(path.join(tempDir, "Backrooms.mcaddon"), "unexpected");
    assert.throws(() => verifyReleaseFiles(tempDir, config), /必须恰好包含三个/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
