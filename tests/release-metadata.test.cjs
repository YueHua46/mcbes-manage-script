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

test("release metadata derives the public Minecraft family and upload-safe names", () => {
  const config = loadReleaseConfig();
  const family = minecraftFamily(config.minecraftVersion);

  assert.equal(releaseTitle(config), `苦力怕菜单 v${config.version}（适配 MCBE ${family}）`);

  assert.equal(
    artifactFilename("standard", config),
    `CreeperMenu-v${config.version}-MCBE-${family}-Standard.mcaddon`
  );

  assert.equal(
    artifactFilename("realms", config),
    `CreeperMenu-v${config.version}-MCBE-${family}-Realms.mcaddon`
  );

  assert.equal(artifactFilename("bds", config), `CreeperMenu-v${config.version}-MCBE-${family}-BDS.mcaddon`);
});

test("release metadata rejects malformed versions and unknown variants", () => {
  assert.throws(() => minecraftFamily("1.26"), /三段数字/);
  assert.throws(() => minecraftFamily("1.26.beta"), /三段数字/);

  assert.throws(
    () =>
      artifactFilename("debug", {
        version: "9.9.9",
        minecraftVersion: "1.99.99",
      }),
    /未知发行变体/
  );
});

test("tag validation requires the canonical release tag", () => {
  const config = loadReleaseConfig();

  assert.doesNotThrow(() => assertTag(`v${config.version}`, config));

  assert.throws(() => assertTag("v0.0.0", config), new RegExp(`必须等于 v${config.version.replace(/\./g, "\\.")}`));

  assert.throws(
    () => assertTag(config.version, config),
    new RegExp(`必须等于 v${config.version.replace(/\./g, "\\.")}`)
  );
});

test("all CreeperMenu package and manifest versions share one release version", () => {
  const config = loadReleaseConfig();

  assert.match(config.version, /^\d+\.\d+\.\d+$/);
  assert.match(config.minecraftVersion, /^\d+\.\d+\.\d+$/);

  assert.doesNotThrow(() => assertVersions(config));
});

test("Minecraft build baseline must match the pinned package dependencies", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

  const config = loadReleaseConfig();

  assert.doesNotThrow(() => assertMinecraftDependencies(packageJson.dependencies, config));

  const [major, minor, patch] = config.minecraftVersion.split(".").map(Number);

  const wrongMinecraftVersion = `${major}.${minor}.${patch + 1}`;

  assert.throws(
    () =>
      assertMinecraftDependencies(
        {
          ...packageJson.dependencies,
          "@minecraft/vanilla-data": wrongMinecraftVersion,
        },
        config
      ),
    /Minecraft 构建基线/
  );

  assert.throws(
    () =>
      assertMinecraftDependencies(
        {
          ...packageJson.dependencies,
          "@minecraft/server": `999.0.0-beta.${wrongMinecraftVersion}-stable`,
        },
        config
      ),
    /Minecraft 构建基线/
  );
});

test("Backrooms remains independently versioned", () => {
  for (const relativePath of ["behavior_packs/Backrooms/manifest.json", "resource_packs/Backrooms/manifest.json"]) {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));

    assert.deepEqual(manifest.header.version, [1, 0, 0]);

    for (const module of manifest.modules) {
      assert.deepEqual(module.version, [1, 0, 0]);
    }
  }
});

test("release notes explain all variants and the exact compatibility baseline", () => {
  const config = loadReleaseConfig();
  const family = minecraftFamily(config.minecraftVersion);

  const notes = releaseNotes(config);

  for (const text of ["普通兼容版", "Realms 兼容版", "BDS 增强版", config.minecraftVersion, family, "备份世界"]) {
    assert.match(notes, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("release file validation requires exactly the three configured attachments", () => {
  const tempDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "release-files-"));

  const config = loadReleaseConfig();

  try {
    for (const variant of ["standard", "realms", "bds"]) {
      fs.writeFileSync(path.join(tempDir, artifactFilename(variant, config)), variant);
    }

    assert.doesNotThrow(() => verifyReleaseFiles(tempDir, config));

    fs.writeFileSync(path.join(tempDir, "Backrooms.mcaddon"), "unexpected");

    assert.throws(() => verifyReleaseFiles(tempDir, config), /必须恰好包含三个/);
  } finally {
    fs.rmSync(tempDir, {
      recursive: true,
      force: true,
    });
  }
});
