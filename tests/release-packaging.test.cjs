const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const archiver = require("archiver");

const ROOT = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const justConfig = fs.readFileSync(path.join(ROOT, "just.config.ts"), "utf8");
const {
  artifactFilename,
  expectedModules,
  validateRealmsScript,
  validatePackageManifests,
  verifyPackage,
} = require("../tools/release-metadata.cjs");

test("release packaging exposes one command for exactly three CreeperMenu variants", () => {
  assert.equal(packageJson.scripts["release:check"], "node tools/release-metadata.cjs check");
  assert.equal(packageJson.scripts["release:sync"], "node tools/release-metadata.cjs sync");
  assert.equal(packageJson.scripts["mcaddon:release"], "just-scripts mcaddon:release");

  assert.match(justConfig, /loadReleaseConfig/);
  for (const variant of ["standard", "realms", "bds"]) {
    assert.match(justConfig, new RegExp(`artifactFilename\\("${variant}"`));
  }
  const releaseTask = justConfig.match(
    /task\(\s*"mcaddon:release",[\s\S]*?\n\);/
  )?.[0];
  assert.ok(releaseTask, "mcaddon:release task must exist");
  for (const taskName of ["package:standard", "package:realms", "package:bds-admin"]) {
    assert.match(releaseTask, new RegExp(`"${taskName}"`));
  }
  assert.doesNotMatch(releaseTask, /backrooms/i);
  assert.match(releaseTask, /"useManifestStandard"/);
});

test("package verifier rejects a missing archive before release", async () => {
  await assert.rejects(
    verifyPackage("standard", path.join(ROOT, "dist/packages/missing.mcaddon")),
    /产物不存在/
  );
});

function createZip(targetPath, entries) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(targetPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);
    for (const entry of entries) {
      archive.append(entry.content, { name: entry.name });
    }
    archive.finalize();
  });
}

test("package verifier reads BP and RP manifests from nested mcpack archives", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "creeper-release-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const config = { version: "3.2.13", minecraftVersion: "1.26.30" };
  const version = [3, 2, 13];
  const bpPath = path.join(tempDir, "fixture_bp.mcpack");
  const rpPath = path.join(tempDir, "fixture_rp.mcpack");
  await createZip(bpPath, [
    {
      name: "manifest.json",
      content: JSON.stringify({
        header: { name: "苦力怕菜单_BP", version },
        modules: [
          { type: "data", version },
          { type: "script", version },
        ],
        dependencies: expectedModules("standard").map((module_name) => ({
          module_name,
          version: "beta",
        })),
      }),
    },
    { name: "scripts/main.js", content: "export {};" },
  ]);
  await createZip(rpPath, [
    {
      name: "manifest.json",
      content: JSON.stringify({
        header: { name: "苦力怕菜单_RP", version },
        modules: [{ type: "resources", version }],
      }),
    },
  ]);

  const addonPath = path.join(tempDir, artifactFilename("standard", config));
  await createZip(addonPath, [
    { name: path.basename(bpPath), content: fs.readFileSync(bpPath) },
    { name: path.basename(rpPath), content: fs.readFileSync(rpPath) },
  ]);

  await assert.doesNotReject(() => verifyPackage("standard", addonPath, config));
});

test("each release variant has an exact supported module contract", () => {
  assert.deepEqual(expectedModules("standard"), [
    "@minecraft/server",
    "@minecraft/server-ui",
    "@minecraft/server-gametest",
  ]);
  assert.deepEqual(expectedModules("realms"), [
    "@minecraft/server",
    "@minecraft/server-ui",
  ]);
  assert.deepEqual(expectedModules("bds"), [
    "@minecraft/server",
    "@minecraft/server-ui",
    "@minecraft/server-admin",
    "@minecraft/server-net",
    "@minecraft/server-gametest",
  ]);
  assert.throws(() => expectedModules("debug"), /未知发行变体/);
});

test("Realms script validation follows the existing GameTest runtime boundary", () => {
  assert.doesNotThrow(() =>
    validateRealmsScript(
      'if (false) import("@minecraft/server-net"); const hint = "@minecraft/server-admin";'
    )
  );
  assert.throws(
    () => validateRealmsScript('import("@minecraft/server-gametest")'),
    /GameTest/
  );
});

test("package manifest validation enforces version and variant dependencies", () => {
  const config = { version: "3.2.13", minecraftVersion: "1.26.30" };
  const makeBehavior = (modules) => ({
    header: { version: [3, 2, 13] },
    modules: [
      { type: "data", version: [3, 2, 13] },
      { type: "script", version: [3, 2, 13] },
    ],
    dependencies: modules.map((module_name) => ({ module_name, version: "beta" })),
  });
  const resource = {
    header: { version: [3, 2, 13] },
    modules: [{ type: "resources", version: [3, 2, 13] }],
  };

  assert.doesNotThrow(() =>
    validatePackageManifests(
      "realms",
      makeBehavior(expectedModules("realms")),
      resource,
      config
    )
  );
  assert.throws(
    () =>
      validatePackageManifests(
        "realms",
        makeBehavior([...expectedModules("realms"), "@minecraft/server-gametest"]),
        resource,
        config
      ),
    /依赖不匹配/
  );
  assert.throws(
    () =>
      validatePackageManifests(
        "bds",
        makeBehavior(expectedModules("bds").filter((name) => name !== "@minecraft/server-admin")),
        resource,
        config
      ),
    /依赖不匹配/
  );
  assert.throws(
    () =>
      validatePackageManifests(
        "standard",
        makeBehavior(expectedModules("standard")),
        { ...resource, header: { version: [3, 2, 12] } },
        config
      ),
    /版本不一致/
  );
});
