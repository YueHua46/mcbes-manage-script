#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "release.config.json");
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const VARIANT_LABELS = Object.freeze({
  standard: "普通兼容版",
  realms: "Realms兼容版",
  bds: "BDS增强版",
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

function assertTag(tag, config = loadReleaseConfig()) {
  const expected = `v${config.version}`;
  if (tag !== expected) {
    throw new Error(`发行 tag 必须等于 ${expected}，实际为 ${tag || "空值"}`);
  }
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
    writeJson(manifestPath, manifest);
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

function runCli(args = process.argv.slice(2)) {
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
  throw new Error(`未知命令：${command}`);
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

module.exports = {
  CREEPER_MENU_MANIFESTS,
  VARIANT_LABELS,
  artifactFilename,
  assertTag,
  assertVersions,
  loadReleaseConfig,
  minecraftFamily,
  releaseTitle,
  runCli,
  syncVersion,
};
