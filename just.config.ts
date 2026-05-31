import { argv, parallel, series, task, tscTask } from "just-scripts";
import {
  BundleTaskParameters,
  CopyTaskParameters,
  bundleTask,
  cleanTask,
  cleanCollateralTask,
  copyTask,
  coreLint,
  mcaddonTask,
  setupEnvironment,
  ZipTaskParameters,
  STANDARD_CLEAN_PATHS,
  DEFAULT_CLEAN_DIRECTORIES,
  getOrThrowFromProcess,
  watchTask,
} from "@minecraft/core-build-tasks";
import path from "path";
import fs from "fs";
import * as esbuild from "esbuild";

// Setup env variables
setupEnvironment(path.resolve(__dirname, ".env"));
const projectName = getOrThrowFromProcess("PROJECT_NAME");
const bdsServerDeployPath = getOrThrowFromProcess("BDS_SERVER_DEPLOY_PATH");

// You can use `npm run build:production` to build a "production" build that strips out statements labelled with "dev:".
const isProduction = argv()["production"];

function createBundleTaskOptions(entryPoint: string, define: Record<string, string>) {
  return {
    entryPoint: path.join(__dirname, entryPoint),
    external: ["@minecraft/server", "@minecraft/server-ui", "@minecraft/server-net", "@minecraft/server-admin"],
    outfile: path.resolve(__dirname, "./dist/scripts/main.js"),
    minifyWhitespace: false,
    sourcemap: true,
    outputSourcemapPath: path.resolve(__dirname, "./dist/debug"),
    dropLabels: isProduction ? ["dev"] : undefined,
    define,
  } as BundleTaskParameters & { define?: Record<string, string> };
}

/** 普通兼容版构建：不包含 server-net / server-admin 运行时能力，供本地、BDS、Realms 使用 */
const bundleTaskOptionsStandard = createBundleTaskOptions("./scripts/main.standard.ts", {
  __BDS_BUILD__: "false",
  __SERVER_ADMIN_BUILD__: "false",
});

/** BDS 增强版构建：包含 server-net / server-admin 相关能力，仅供 BDS 服务器使用 */
const bundleTaskOptionsBdsAdmin = createBundleTaskOptions("./scripts/main.bds.ts", {
  __BDS_BUILD__: "true",
  __SERVER_ADMIN_BUILD__: "true",
});

/** 使用 esbuild 直接打主包 */
async function runMainBundle(options: typeof bundleTaskOptionsStandard): Promise<void> {
  const outDir = path.dirname(options.outfile);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  await esbuild.build({
    entryPoints: [options.entryPoint],
    bundle: true,
    format: "esm",
    outfile: options.outfile,
    external: options.external,
    define: options.define,
    minifyWhitespace: options.minifyWhitespace ?? false,
    sourcemap: options.sourcemap ?? true,
    logLevel: "info",
  });
  if (options.sourcemap && options.outputSourcemapPath) {
    const mapName = path.basename(options.outfile) + ".map";
    const mapSrc = path.join(outDir, mapName);
    const mapDest = path.join(options.outputSourcemapPath, mapName);
    if (fs.existsSync(mapSrc)) {
      if (!fs.existsSync(options.outputSourcemapPath)) {
        fs.mkdirSync(options.outputSourcemapPath, { recursive: true });
      }
      fs.copyFileSync(mapSrc, mapDest);
    }
  }
}

const copyTaskOptions: CopyTaskParameters = {
  copyToBehaviorPacks: [`./behavior_packs/${projectName}`],
  copyToScripts: ["./dist/scripts"],
  copyToResourcePacks: [`./resource_packs/${projectName}`],
};

const mcaddonTaskOptionsStandard: ZipTaskParameters = {
  ...copyTaskOptions,
  outputFile: `./dist/packages/${projectName}_普通兼容版（适用本地、BDS、Realms领域服）.mcaddon`,
};

const mcaddonTaskOptionsBdsAdmin: ZipTaskParameters = {
  ...copyTaskOptions,
  outputFile: `./dist/packages/${projectName}_BDS增强版（仅适用BDS服务器，含额外黑名单功能等）.mcaddon`,
};

const behaviorPackDir = path.join(__dirname, "behavior_packs", projectName);
const manifestPath = path.join(behaviorPackDir, "manifest.json");
const manifestStandardPath = path.join(behaviorPackDir, "manifest.standard.json");
const manifestBdsPath = path.join(behaviorPackDir, "manifest.bds.json");

function useManifestVariant(sourcePath: string, label: string) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`${label} 不存在: ${sourcePath}`);
  }
  fs.copyFileSync(sourcePath, manifestPath);
}

function useStandardManifest() {
  useManifestVariant(manifestStandardPath, "manifest.standard.json");
}

function useBdsManifest() {
  useManifestVariant(manifestBdsPath, "manifest.bds.json");
}

function setDefaultDeployEnv() {
  if (!process.env.MINECRAFT_PRODUCT) {
    process.env.MINECRAFT_PRODUCT = "BedrockGDK";
  }
  if (process.env.MINECRAFT_PRODUCT !== "Custom") {
    process.env.CUSTOM_DEPLOYMENT_PATH = "";
  }
}

function setBdsServerDeployEnv() {
  process.env.MINECRAFT_PRODUCT = "Custom";
  process.env.CUSTOM_DEPLOYMENT_PATH = bdsServerDeployPath;
}

// Lint
task("lint", coreLint(["scripts/**/*.ts"], argv().fix));

// Build
task("bundle:standard", () => runMainBundle(bundleTaskOptionsStandard));
task("bundle:bds-admin", () => runMainBundle(bundleTaskOptionsBdsAdmin));
task("typescript", tscTask());
task("useManifestStandard", () => {
  useStandardManifest();
});
task("useManifestBds", () => {
  useBdsManifest();
});

task("build:standard", series("useManifestStandard", "typescript", "bundle:standard"));
task("build:bds-admin", series("useManifestBds", "typescript", "bundle:bds-admin"));
task("build", series("build:standard"));

// Clean
task("clean-local", cleanTask(DEFAULT_CLEAN_DIRECTORIES));
task("clean-collateral", cleanCollateralTask(STANDARD_CLEAN_PATHS));
task("clean", parallel("clean-local", "clean-collateral"));

// Package
task("copyArtifacts", copyTask(copyTaskOptions));
task("package", series("clean-collateral", "copyArtifacts"));

// Local Deploy used for deploying local changes directly to output via the bundler. It does a full build and package first just in case.
task("setDefaultDeployEnv", () => {
  setDefaultDeployEnv();
});
task("setBdsServerDeployEnv", () => {
  setBdsServerDeployEnv();
});
task(
  "local-deploy",
  watchTask(
    ["scripts/**/*.ts", "behavior_packs/**/*.{json,lang,png}", "resource_packs/**/*.{json,lang,png}"],
    series("setDefaultDeployEnv", "clean-local", "build:standard", "package")
  )
);
task(
  "local-deploy:bds-admin",
  watchTask(
    ["scripts/**/*.ts", "behavior_packs/**/*.{json,lang,png}", "resource_packs/**/*.{json,lang,png}"],
    series("setBdsServerDeployEnv", "clean-local", "build:bds-admin", "package")
  )
);
task("local-deploy:bds", series("local-deploy:bds-admin"));

// Mcaddon
task("createMcaddonFile:standard", mcaddonTask(mcaddonTaskOptionsStandard));
task("createMcaddonFile:bds-admin", mcaddonTask(mcaddonTaskOptionsBdsAdmin));
task("package:standard", series("build:standard", "createMcaddonFile:standard"));
task("package:bds-admin", series("build:bds-admin", "createMcaddonFile:bds-admin"));
task("mcaddon:standard", series("clean-local", "package:standard"));
task("mcaddon:bds-admin", series("clean-local", "package:bds-admin"));
task("mcaddon", series("mcaddon:standard"));
task("mcaddon:bds", series("mcaddon:bds-admin"));

// 同时产出普通兼容版 + BDS 增强版两个 mcaddon（发布时运行一次即可）
task("mcaddon:all", series("clean-local", "package:standard", "package:bds-admin", "useManifestStandard"));
