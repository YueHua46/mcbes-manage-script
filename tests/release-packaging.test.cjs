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
  validateVariantScript,
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
  assert.match(justConfig, /process\.once\("exit"/);
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
        header: {
          name: "苦力怕菜单_BP",
          uuid: "c32e1f60-0ee0-4413-a760-d261d91e5fc6",
          version,
        },
        modules: [
          {
            type: "data",
            uuid: "0c4dc15d-f113-4d6f-bb41-6a0b44d785e0",
            version,
          },
          {
            type: "script",
            uuid: "c022f157-4583-4c5e-ad08-a5828f8d0783",
            entry: "scripts/main.js",
            version,
          },
        ],
        dependencies: expectedModules("standard").map((module_name) => ({
          module_name,
          version: "beta",
        })),
      }),
    },
    {
      name: "scripts/main.js",
      content: 'import("@minecraft/server-gametest"); export {};',
    },
  ]);
  await createZip(rpPath, [
    {
      name: "manifest.json",
      content: JSON.stringify({
        header: {
          name: "苦力怕菜单_RP",
          uuid: "1150bfb5-215b-45a1-bea0-6e9aaafcb344",
          version,
        },
        modules: [
          {
            type: "resources",
            uuid: "b95615c0-01b0-4928-8a36-25a4dd434e32",
            version,
          },
        ],
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

test("variant script validation requires the runtime imports each build promises", () => {
  assert.doesNotThrow(() =>
    validateVariantScript(
      "realms",
      'if (false) import("@minecraft/server-net"); const hint = "@minecraft/server-admin";'
    )
  );
  assert.throws(
    () => validateVariantScript("realms", 'import("@minecraft/server-gametest")'),
    /GameTest/
  );
  assert.throws(() => validateVariantScript("standard", "export {};"), /GameTest/);
  assert.throws(
    () => validateVariantScript("bds", 'import("@minecraft/server-gametest")'),
    /BDS 运行时/
  );
  assert.doesNotThrow(() =>
    validateVariantScript(
      "bds",
      [
        'import("@minecraft/server-gametest")',
        'import("@minecraft/server-admin")',
        'import("@minecraft/server-net")',
      ].join(";")
    )
  );
});

test("package manifest validation enforces version and variant dependencies", () => {
  const config = { version: "3.2.13", minecraftVersion: "1.26.30" };
  const makeBehavior = (modules) => ({
    header: {
      name: "苦力怕菜单_BP",
      uuid: "c32e1f60-0ee0-4413-a760-d261d91e5fc6",
      version: [3, 2, 13],
    },
    modules: [
      {
        type: "data",
        uuid: "0c4dc15d-f113-4d6f-bb41-6a0b44d785e0",
        version: [3, 2, 13],
      },
      {
        type: "script",
        uuid: "c022f157-4583-4c5e-ad08-a5828f8d0783",
        entry: "scripts/main.js",
        version: [3, 2, 13],
      },
    ],
    dependencies: modules.map((module_name) => ({ module_name, version: "beta" })),
  });
  const resource = {
    header: {
      name: "苦力怕菜单_RP",
      uuid: "1150bfb5-215b-45a1-bea0-6e9aaafcb344",
      version: [3, 2, 13],
    },
    modules: [
      {
        type: "resources",
        uuid: "b95615c0-01b0-4928-8a36-25a4dd434e32",
        version: [3, 2, 13],
      },
    ],
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
  assert.throws(
    () =>
      validatePackageManifests(
        "standard",
        {
          ...makeBehavior(expectedModules("standard")),
          header: {
            ...makeBehavior(expectedModules("standard")).header,
            uuid: "00000000-0000-0000-0000-000000000000",
          },
        },
        resource,
        config
      ),
    /身份不匹配/
  );
});
