import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

type MinecraftConfig = {
  stableRange: string;
  anchorPackage: string;
  versionedPackages: string[];
  vanillaData: string;
};

type PackageJson = {
  dependencies: Record<string, string>;
  minecraftDependencies: MinecraftConfig;
};

function getNpmVersions(packageName: string): string[] {
  const output = execFileSync("npm", ["view", packageName, "versions", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });

  const parsed = JSON.parse(output);

  return Array.isArray(parsed) ? parsed : [parsed];
}

function parseMinecraftStableVersion(version: string): string | null {
  const match = version.match(/(?:^|\.)((?:\d+\.){2}\d+)-stable$/);

  return match?.[1] ?? null;
}

function parseMinecraftVanillaVersion(version: string): string | null {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    return null;
  }

  return version;
}

function compareMinecraftVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);

  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) {
      return pa[i] - pb[i];
    }
  }

  return 0;
}

function matchesStableRange(version: string, range: string): boolean {
  const rangeMatch = range.match(/^(\d+)\.(\d+)\.(\d)x$/);

  if (!rangeMatch) {
    throw new Error(`Unsupported stableRange: ${range}`);
  }

  const [, major, minor, tens] = rangeMatch;

  const [versionMajor, versionMinor, versionPatch] = version.split(".").map(Number);

  return (
    versionMajor === Number(major) && versionMinor === Number(minor) && Math.floor(versionPatch / 10) === Number(tens)
  );
}

function findTargetMinecraftVersion(packageName: string, range: string): string | null {
  const versions = getNpmVersions(packageName);

  const stableMinecraftVersions = versions
    .map(parseMinecraftStableVersion)
    .filter((version): version is string => {
      return version !== null && matchesStableRange(version, range);
    })
    .sort(compareMinecraftVersions);

  return stableMinecraftVersions.at(-1) ?? null;
}

function findBestVersionedPackage(packageName: string, targetMinecraftVersion: string): string | null {
  const versions = getNpmVersions(packageName);

  const candidates = versions
    .map((npmVersion) => ({
      npmVersion,
      minecraftVersion: parseMinecraftStableVersion(npmVersion),
    }))
    .filter(
      (
        entry
      ): entry is {
        npmVersion: string;
        minecraftVersion: string;
      } => {
        return (
          entry.minecraftVersion !== null &&
          compareMinecraftVersions(entry.minecraftVersion, targetMinecraftVersion) <= 0
        );
      }
    )
    .sort((a, b) => compareMinecraftVersions(a.minecraftVersion, b.minecraftVersion));

  return candidates.at(-1)?.npmVersion ?? null;
}

function findBestVanillaDataVersion(packageName: string, targetMinecraftVersion: string): string | null {
  const versions = getNpmVersions(packageName);

  const candidates = versions
    .map((npmVersion) => ({
      npmVersion,
      minecraftVersion: parseMinecraftVanillaVersion(npmVersion),
    }))
    .filter(
      (
        entry
      ): entry is {
        npmVersion: string;
        minecraftVersion: string;
      } => {
        return (
          entry.minecraftVersion !== null &&
          compareMinecraftVersions(entry.minecraftVersion, targetMinecraftVersion) <= 0
        );
      }
    )
    .sort((a, b) => compareMinecraftVersions(a.minecraftVersion, b.minecraftVersion));

  return candidates.at(-1)?.npmVersion ?? null;
}

const packageJsonPath = "package.json";

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJson;

const config = packageJson.minecraftDependencies;

const targetMinecraftVersion = findTargetMinecraftVersion(config.anchorPackage, config.stableRange);

if (!targetMinecraftVersion) {
  console.log(`No Minecraft stable release found for ${config.stableRange}.`);

  process.exit(0);
}

console.log(`Target Minecraft stable: ${targetMinecraftVersion}`);

let changed = false;

for (const packageName of config.versionedPackages) {
  const currentVersion = packageJson.dependencies[packageName];

  if (!currentVersion) {
    console.warn(`Skipping ${packageName}: not found in dependencies.`);

    continue;
  }

  const targetVersion = findBestVersionedPackage(packageName, targetMinecraftVersion);

  if (!targetVersion) {
    console.warn(`No compatible stable version found for ${packageName}.`);

    continue;
  }

  if (currentVersion === targetVersion) {
    console.log(`${packageName}: ${currentVersion} (up to date)`);

    continue;
  }

  console.log(`${packageName}: ${currentVersion} -> ${targetVersion}`);

  packageJson.dependencies[packageName] = targetVersion;

  changed = true;
}

const vanillaDataCurrent = packageJson.dependencies[config.vanillaData];

if (vanillaDataCurrent) {
  const vanillaDataTarget = findBestVanillaDataVersion(config.vanillaData, targetMinecraftVersion);

  if (vanillaDataTarget && vanillaDataTarget !== vanillaDataCurrent) {
    console.log(`${config.vanillaData}: ${vanillaDataCurrent} -> ${vanillaDataTarget}`);

    packageJson.dependencies[config.vanillaData] = vanillaDataTarget;

    changed = true;
  }
}

if (!changed) {
  console.log("Minecraft dependencies are already up to date.");
  process.exit(0);
}

writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n");

console.log("package.json updated.");
