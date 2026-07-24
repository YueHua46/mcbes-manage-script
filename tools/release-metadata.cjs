#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const yauzl = require("yauzl");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "release.config.json");
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const VARIANT_LABELS = Object.freeze({
  standard: "普通兼容版",
  realms: "Realms兼容版",
  bds: "BDS增强版",
});
const VARIANT_MODULES = Object.freeze({
  standard: Object.freeze([
    "@minecraft/server",
    "@minecraft/server-ui",
    "@minecraft/server-gametest",
  ]),
  realms: Object.freeze(["@minecraft/server", "@minecraft/server-ui"]),
  bds: Object.freeze([
    "@minecraft/server",
    "@minecraft/server-ui",
    "@minecraft/server-admin",
    "@minecraft/server-net",
    "@minecraft/server-gametest",
  ]),
});
const MINECRAFT_BUILD_DEPENDENCIES = Object.freeze([
  "@minecraft/debug-utilities",
  "@minecraft/server",
  "@minecraft/server-admin",
  "@minecraft/server-gametest",
  "@minecraft/server-net",
  "@minecraft/server-ui",
]);
const CREEPER_MENU_IDENTITY = Object.freeze({
  behavior: Object.freeze({
    name: "苦力怕菜单_BP",
    uuid: "c32e1f60-0ee0-4413-a760-d261d91e5fc6",
    modules: Object.freeze({
      data: Object.freeze({
        uuid: "0c4dc15d-f113-4d6f-bb41-6a0b44d785e0",
      }),
      script: Object.freeze({
        uuid: "c022f157-4583-4c5e-ad08-a5828f8d0783",
        entry: "scripts/main.js",
      }),
    }),
  }),
  resource: Object.freeze({
    name: "苦力怕菜单_RP",
    uuid: "1150bfb5-215b-45a1-bea0-6e9aaafcb344",
    modules: Object.freeze({
      resources: Object.freeze({
        uuid: "b95615c0-01b0-4928-8a36-25a4dd434e32",
      }),
    }),
  }),
});
const CREEPER_MENU_MANIFESTS = Object.freeze([
  "behavior_packs/CreeperMenu/manifest.json",
  "behavior_packs/CreeperMenu/manifest.standard.json",
  "behavior_packs/CreeperMenu/manifest.debug.json",
  "behavior_packs/CreeperMenu/manifest.realms.json",
  "behavior_packs/CreeperMenu/manifest.bds.json",
  "resource_packs/CreeperMenu/manifest.json",
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeManifestJson(filePath, value) {
  const formatted = JSON.stringify(value, null, 2)
    .replace(/\[\n\s+(\d+),\n\s+(\d+),\n\s+(\d+)\n\s+\]/g, "[$1, $2, $3]")
    .replace(/\[\n\s+("[^"\n]+")\n\s+\]/g, "[$1]");
  fs.writeFileSync(filePath, `${formatted}\n`);
}

function assertThreePartVersion(version, label) {
  if (typeof version !== "string" || !VERSION_PATTERN.test(version)) {
    throw new Error(`${label}必须是 x.y.z 三段数字版本`);
  }
}

function loadReleaseConfig() {
  const config = readJson(CONFIG_PATH);
  assertThreePartVersion(config.version, "发行版本");
  assertThreePartVersion(config.minecraftVersion, "Minecraft 构建基线");
  return {
    version: config.version,
    minecraftVersion: config.minecraftVersion,
  };
}

function minecraftFamily(version) {
  assertThreePartVersion(version, "Minecraft 构建基线");
  const [major, minor, patch] = version.split(".");
  return `${major}.${minor}.${patch.slice(0, -1)}x`;
}

function artifactFilename(variant, config = loadReleaseConfig()) {
  const label = VARIANT_LABELS[variant];
  if (!label) {
    throw new Error(`未知发行变体：${variant}`);
  }
  assertThreePartVersion(config.version, "发行版本");
  return `CreeperMenu-v${config.version}-MCBE-${minecraftFamily(config.minecraftVersion)}-${label}.mcaddon`;
}

function releaseTitle(config = loadReleaseConfig()) {
  assertThreePartVersion(config.version, "发行版本");
  return `苦力怕菜单 v${config.version}（适配 MCBE ${minecraftFamily(config.minecraftVersion)}）`;
}

function releaseNotes(config = loadReleaseConfig()) {
  const family = minecraftFamily(config.minecraftVersion);
  return [
    `本版本使用 Minecraft Bedrock ${config.minecraftVersion} API 构建，适配 ${family} 版本族。`,
    "",
    "### 下载选择",
    "",
    "- **普通兼容版**：适用于本地世界、普通基岩版环境及不使用专属能力的 BDS。",
    "- **Realms 兼容版**：适用于 Minecraft Realms，仅支持旧版实体假人。",
    "- **BDS 增强版**：仅适用于 BDS 专用服务器，包含服务器网络与管理能力。",
    "",
    "> 更新附加包或切换构建版本前，请先完整备份世界。",
  ].join("\n");
}

function verifyReleaseFiles(directory, config = loadReleaseConfig()) {
  if (!directory || !fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error(`Release 产物目录不存在：${directory || "空路径"}`);
  }
  const actual = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".mcaddon"))
    .sort();
  const expected = ["standard", "realms", "bds"]
    .map((variant) => artifactFilename(variant, config))
    .sort();
  if (actual.length !== 3) {
    throw new Error(`Release 目录必须恰好包含三个 .mcaddon，实际=${actual.length}`);
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Release 文件名不匹配：\n实际=${actual.join("\n")}\n预期=${expected.join("\n")}`
    );
  }
}

function expectedModules(variant) {
  const modules = VARIANT_MODULES[variant];
  if (!modules) {
    throw new Error(`未知发行变体：${variant}`);
  }
  return [...modules];
}

function assertTag(tag, config = loadReleaseConfig()) {
  const expected = `v${config.version}`;
  if (tag !== expected) {
    throw new Error(`发行 tag 必须等于 ${expected}，实际为 ${tag || "空值"}`);
  }
}

function assertMinecraftDependencies(dependencies, config = loadReleaseConfig()) {
  const problems = [];
  if (dependencies?.["@minecraft/vanilla-data"] !== config.minecraftVersion) {
    problems.push(
      `@minecraft/vanilla-data=${dependencies?.["@minecraft/vanilla-data"] || "缺失"}`
    );
  }
  const expectedSuffix = `.${config.minecraftVersion}-stable`;
  for (const dependency of MINECRAFT_BUILD_DEPENDENCIES) {
    const actual = dependencies?.[dependency];
    if (typeof actual !== "string" || !actual.endsWith(expectedSuffix)) {
      problems.push(`${dependency}=${actual || "缺失"}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `Minecraft 构建基线 ${config.minecraftVersion} 与依赖不一致：\n- ${problems.join("\n- ")}`
    );
  }
}

function validateManifestVersion(manifest, expected, label) {
  for (const [location, actual] of manifestVersionStrings(manifest)) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        `${label} 版本不一致：${location}=${JSON.stringify(actual)}，预期=${JSON.stringify(expected)}`
      );
    }
  }
}

function assertManifestIdentity(manifest, expected, label) {
  if (
    manifest.header?.name !== expected.name ||
    manifest.header?.uuid !== expected.uuid
  ) {
    throw new Error(
      `${label}身份不匹配：name=${manifest.header?.name || "缺失"}, uuid=${
        manifest.header?.uuid || "缺失"
      }`
    );
  }

  const actualModules = manifest.modules || [];
  const expectedTypes = Object.keys(expected.modules).sort();
  const actualTypes = actualModules.map((module) => module.type).sort();
  if (JSON.stringify(actualTypes) !== JSON.stringify(expectedTypes)) {
    throw new Error(
      `${label}身份不匹配：模块类型=${actualTypes.join(",")}，预期=${expectedTypes.join(",")}`
    );
  }
  for (const [type, expectedModule] of Object.entries(expected.modules)) {
    const matches = actualModules.filter((module) => module.type === type);
    if (
      matches.length !== 1 ||
      matches[0].uuid !== expectedModule.uuid ||
      ("entry" in expectedModule && matches[0].entry !== expectedModule.entry)
    ) {
      throw new Error(`${label}身份不匹配：${type} 模块 UUID 或入口错误`);
    }
  }
}

function validatePackageManifests(
  variant,
  behaviorManifest,
  resourceManifest,
  config = loadReleaseConfig()
) {
  const expectedVersion = config.version.split(".").map(Number);
  validateManifestVersion(behaviorManifest, expectedVersion, "行为包");
  validateManifestVersion(resourceManifest, expectedVersion, "资源包");
  assertManifestIdentity(
    behaviorManifest,
    CREEPER_MENU_IDENTITY.behavior,
    "CreeperMenu 行为包"
  );
  assertManifestIdentity(
    resourceManifest,
    CREEPER_MENU_IDENTITY.resource,
    "CreeperMenu 资源包"
  );

  const actualModules = (behaviorManifest.dependencies || [])
    .map((dependency) => dependency.module_name)
    .filter(Boolean)
    .sort();
  const requiredModules = expectedModules(variant).sort();
  if (JSON.stringify(actualModules) !== JSON.stringify(requiredModules)) {
    throw new Error(
      `${variant} 依赖不匹配：实际=${actualModules.join(",")}，预期=${requiredModules.join(",")}`
    );
  }
}

function hasRuntimeImport(script, moduleName) {
  const escaped = moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:\\bfrom\\s*|\\bimport\\s*\\(\\s*|\\brequire\\s*\\(\\s*)["']${escaped}["']`
  ).test(script);
}

function validateVariantScript(variant, script) {
  expectedModules(variant);
  const hasGameTest = hasRuntimeImport(script, "@minecraft/server-gametest");
  const bdsOnlyImports = ["@minecraft/server-admin", "@minecraft/server-net"].filter(
    (moduleName) => hasRuntimeImport(script, moduleName)
  );
  if (variant === "realms" && hasGameTest) {
    throw new Error("Realms JavaScript 仍引用 GameTest 模块");
  }
  if (variant !== "bds" && bdsOnlyImports.length > 0) {
    throw new Error(
      `${variant} JavaScript 仍引用 BDS 专属模块：${bdsOnlyImports.join(",")}`
    );
  }
  if (variant === "standard" && !hasGameTest) {
    throw new Error("普通兼容版 JavaScript 缺少 GameTest 运行时引用");
  }
  if (
    variant === "bds" &&
    (!hasGameTest ||
      !hasRuntimeImport(script, "@minecraft/server-admin") ||
      !hasRuntimeImport(script, "@minecraft/server-net"))
  ) {
    throw new Error("BDS 运行时必须包含 GameTest、server-admin 和 server-net");
  }
}

function readArchiveEntries(archiveSource) {
  return new Promise((resolve, reject) => {
    const handleOpen = (openError, zipFile) => {
      if (openError) {
        reject(openError);
        return;
      }
      const entries = [];
      zipFile.on("error", reject);
      zipFile.on("end", () => resolve(entries));
      zipFile.on("entry", (entry) => {
        if (/\/$/.test(entry.fileName)) {
          zipFile.readEntry();
          return;
        }
        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError) {
            reject(streamError);
            return;
          }
          const chunks = [];
          stream.on("data", (chunk) => chunks.push(chunk));
          stream.on("error", reject);
          stream.on("end", () => {
            entries.push({
              name: entry.fileName,
              content: Buffer.concat(chunks),
            });
            zipFile.readEntry();
          });
        });
      });
      zipFile.readEntry();
    };
    if (Buffer.isBuffer(archiveSource)) {
      yauzl.fromBuffer(archiveSource, { lazyEntries: true }, handleOpen);
    } else {
      yauzl.open(archiveSource, { lazyEntries: true }, handleOpen);
    }
  });
}

async function readPackageEntries(archivePath) {
  const outerEntries = await readArchiveEntries(archivePath);
  const packageEntries = [];
  for (const entry of outerEntries) {
    if (/\.mcpack$/i.test(entry.name)) {
      const nestedEntries = await readArchiveEntries(entry.content);
      for (const nestedEntry of nestedEntries) {
        packageEntries.push({
          name: `${entry.name}!/${nestedEntry.name}`,
          content: nestedEntry.content,
        });
      }
    } else {
      packageEntries.push(entry);
    }
  }
  return packageEntries;
}

async function verifyPackage(variant, archivePath, config = loadReleaseConfig()) {
  expectedModules(variant);
  if (!archivePath || !fs.existsSync(archivePath)) {
    throw new Error(`发行产物不存在：${archivePath || "空路径"}`);
  }
  const expectedName = artifactFilename(variant, config);
  if (path.basename(archivePath) !== expectedName) {
    throw new Error(
      `${variant} 产物文件名不匹配：${path.basename(archivePath)}，预期=${expectedName}`
    );
  }

  const entries = await readPackageEntries(archivePath);
  const manifestEntries = entries.filter((entry) => /(^|\/)manifest\.json$/.test(entry.name));
  if (manifestEntries.length !== 2) {
    throw new Error(`发行产物必须恰好包含两个 manifest，实际=${manifestEntries.length}`);
  }

  const manifests = manifestEntries.map((entry) => {
    let manifest;
    try {
      manifest = JSON.parse(entry.content.toString("utf8"));
    } catch (error) {
      throw new Error(`${entry.name} 不是有效 JSON：${error.message}`);
    }
    if (/Backrooms/i.test(manifest.header?.name || "")) {
      throw new Error("CreeperMenu 发行产物不能包含 Backrooms manifest");
    }
    return { name: entry.name, manifest };
  });
  const behavior = manifests.filter((entry) =>
    entry.manifest.modules?.some((module) => module.type === "script")
  );
  const resource = manifests.filter((entry) =>
    entry.manifest.modules?.some((module) => module.type === "resources")
  );
  if (behavior.length !== 1 || resource.length !== 1) {
    throw new Error(
      `无法唯一识别行为包和资源包 manifest：behavior=${behavior.length}, resource=${resource.length}`
    );
  }
  validatePackageManifests(variant, behavior[0].manifest, resource[0].manifest, config);

  const scriptModule = behavior[0].manifest.modules.find(
    (module) => module.type === "script"
  );
  const scriptEntry = scriptModule.entry;
  const scripts = entries.filter(
    (entry) =>
      entry.name === scriptEntry ||
      entry.name.endsWith(`/${scriptEntry}`) ||
      entry.name.endsWith(`!/${scriptEntry}`)
  );
  if (scripts.length !== 1) {
    throw new Error(
      `${variant} 产物必须恰好包含一个 ${scriptEntry}，实际=${scripts.length}`
    );
  }
  validateVariantScript(variant, scripts[0].content.toString("utf8"));
}

function manifestVersionStrings(manifest) {
  return [
    ["header", manifest.header?.version],
    ...(manifest.modules || []).map((module, index) => [`modules[${index}]`, module.version]),
  ];
}

function assertVersions(config = loadReleaseConfig()) {
  const expectedArray = config.version.split(".").map(Number);
  const problems = [];
  const packageJson = readJson(path.join(ROOT, "package.json"));
  const packageLock = readJson(path.join(ROOT, "package-lock.json"));
  assertMinecraftDependencies(packageJson.dependencies, config);
  assertMinecraftDependencies(packageLock.packages?.[""]?.dependencies, config);

  if (packageJson.version !== config.version) {
    problems.push(`package.json=${packageJson.version}`);
  }
  if (packageLock.version !== config.version || packageLock.packages?.[""]?.version !== config.version) {
    problems.push(
      `package-lock.json=${packageLock.version}/${packageLock.packages?.[""]?.version}`
    );
  }

  for (const relativePath of CREEPER_MENU_MANIFESTS) {
    const manifest = readJson(path.join(ROOT, relativePath));
    for (const [location, actual] of manifestVersionStrings(manifest)) {
      if (JSON.stringify(actual) !== JSON.stringify(expectedArray)) {
        problems.push(`${relativePath}:${location}=${JSON.stringify(actual)}`);
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(`CreeperMenu 发行版本不一致：\n- ${problems.join("\n- ")}`);
  }
}

function syncVersion(version) {
  assertThreePartVersion(version, "发行版本");
  const versionArray = version.split(".").map(Number);
  const config = loadReleaseConfig();
  config.version = version;
  writeJson(CONFIG_PATH, config);

  const packagePath = path.join(ROOT, "package.json");
  const packageJson = readJson(packagePath);
  packageJson.version = version;
  writeJson(packagePath, packageJson);

  const lockPath = path.join(ROOT, "package-lock.json");
  const packageLock = readJson(lockPath);
  packageLock.version = version;
  packageLock.packages[""].version = version;
  writeJson(lockPath, packageLock);

  for (const relativePath of CREEPER_MENU_MANIFESTS) {
    const manifestPath = path.join(ROOT, relativePath);
    const manifest = readJson(manifestPath);
    manifest.header.version = versionArray;
    for (const module of manifest.modules) {
      module.version = versionArray;
    }
    writeManifestJson(manifestPath, manifest);
  }

  assertVersions({ ...config, version });
}

function printValue(field, variant) {
  const config = loadReleaseConfig();
  switch (field) {
    case "version":
      return config.version;
    case "tag":
      return `v${config.version}`;
    case "minecraft-family":
      return minecraftFamily(config.minecraftVersion);
    case "release-title":
      return releaseTitle(config);
    case "filename":
      return artifactFilename(variant, config);
    default:
      throw new Error(`未知输出字段：${field}`);
  }
}

async function runCli(args = process.argv.slice(2)) {
  const [command = "check", ...rest] = args;
  if (command === "check") {
    const config = loadReleaseConfig();
    const tagIndex = rest.indexOf("--tag");
    if (tagIndex >= 0) {
      assertTag(rest[tagIndex + 1], config);
    }
    assertVersions(config);
    console.log(
      `发行元数据检查通过：v${config.version} / MCBE ${minecraftFamily(config.minecraftVersion)}`
    );
    return;
  }
  if (command === "sync") {
    syncVersion(rest[0]);
    console.log(`发行版本已同步为 v${rest[0]}`);
    return;
  }
  if (command === "print") {
    console.log(printValue(rest[0], rest[1]));
    return;
  }
  if (command === "notes") {
    console.log(releaseNotes());
    return;
  }
  if (command === "verify-release-files") {
    verifyReleaseFiles(rest[0]);
    console.log("Release 文件集合验证通过：三个 CreeperMenu 变体齐全");
    return;
  }
  if (command === "verify-package") {
    await verifyPackage(rest[0], rest[1]);
    console.log(`${rest[0]} 发行产物验证通过：${path.basename(rest[1])}`);
    return;
  }
  throw new Error(`未知命令：${command}`);
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

module.exports = {
  CREEPER_MENU_MANIFESTS,
  VARIANT_LABELS,
  artifactFilename,
  assertMinecraftDependencies,
  assertTag,
  assertVersions,
  expectedModules,
  loadReleaseConfig,
  minecraftFamily,
  releaseNotes,
  releaseTitle,
  runCli,
  syncVersion,
  validatePackageManifests,
  validateVariantScript,
  verifyPackage,
  verifyReleaseFiles,
};
