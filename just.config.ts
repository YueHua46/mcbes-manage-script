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

// Setup env variables
setupEnvironment(path.resolve(__dirname, ".env"));
const projectName = getOrThrowFromProcess("PROJECT_NAME");

// You can use `npm run build:production` to build a "production" build that strips out statements labelled with "dev:".
const isProduction = argv()["production"];

/** 标准版构建：不包含 @minecraft/server-net 相关代码，供单人/Realms/本地部署使用 */
const bundleTaskOptions = {
  entryPoint: path.join(__dirname, "./scripts/main.ts"),
  external: ["@minecraft/server", "@minecraft/server-ui", "@minecraft/server-admin", "@minecraft/server-net"],
  outfile: path.resolve(__dirname, "./dist/scripts/main.js"),
  minifyWhitespace: false,
  sourcemap: true,
  outputSourcemapPath: path.resolve(__dirname, "./dist/debug"),
  dropLabels: isProduction ? ["dev"] : undefined,
  define: { __BDS_BUILD__: "false" },
} as BundleTaskParameters & { define?: Record<string, string> };

/** BDS 版构建：包含 xuid 解析等 server-net 功能，供 BDS 服主使用 */
const bundleTaskOptionsBds = {
  ...bundleTaskOptions,
  define: { __BDS_BUILD__: "true" },
} as BundleTaskParameters & { define?: Record<string, string> };

const copyTaskOptions: CopyTaskParameters = {
  copyToBehaviorPacks: [`./behavior_packs/${projectName}`],
  copyToScripts: ["./dist/scripts"],
  copyToResourcePacks: [`./resource_packs/${projectName}`],
};

const mcaddonTaskOptions: ZipTaskParameters = {
  ...copyTaskOptions,
  outputFile: `./dist/packages/${projectName}.mcaddon`,
};

const behaviorPackDir = path.join(__dirname, "behavior_packs", projectName);
const manifestPath = path.join(behaviorPackDir, "manifest.json");
const manifestBdsPath = path.join(behaviorPackDir, "manifest.bds.json");
const manifestBackupPath = path.join(behaviorPackDir, "manifest.json.bak");

/** 打包 BDS 版前：用 manifest.bds.json 覆盖 manifest.json */
function swapManifestToBds() {
  if (!fs.existsSync(manifestBdsPath)) {
    throw new Error(`manifest.bds.json 不存在: ${manifestBdsPath}`);
  }
  fs.copyFileSync(manifestPath, manifestBackupPath);
  fs.copyFileSync(manifestBdsPath, manifestPath);
}

/** 打包 BDS 版后：恢复原 manifest.json */
function restoreManifest() {
  if (fs.existsSync(manifestBackupPath)) {
    fs.copyFileSync(manifestBackupPath, manifestPath);
    fs.unlinkSync(manifestBackupPath);
  }
}

// Lint
task("lint", coreLint(["scripts/**/*.ts"], argv().fix));

// Build
task("typescript", tscTask());
task("bundle", bundleTask(bundleTaskOptions));
task("bundle:bds", bundleTask(bundleTaskOptionsBds));
task("build", series("typescript", "bundle"));
task("build:bds", series("typescript", "bundle:bds"));

// Clean
task("clean-local", cleanTask(DEFAULT_CLEAN_DIRECTORIES));
task("clean-collateral", cleanCollateralTask(STANDARD_CLEAN_PATHS));
task("clean", parallel("clean-local", "clean-collateral"));

// Package
task("copyArtifacts", copyTask(copyTaskOptions));
task("package", series("clean-collateral", "copyArtifacts"));

// Local Deploy used for deploying local changes directly to output via the bundler. It does a full build and package first just in case.
task(
  "local-deploy",
  watchTask(
    ["scripts/**/*.ts", "behavior_packs/**/*.{json,lang,png}", "resource_packs/**/*.{json,lang,png}"],
    series("clean-local", "build", "package")
  )
);

// Mcaddon
task("createMcaddonFile", mcaddonTask(mcaddonTaskOptions));
task("mcaddon", series("clean-local", "build", "createMcaddonFile"));

// BDS 版 mcaddon（manifest 含 server-net，供需要黑名单等功能的 BDS 用户使用）
task("swapManifestBds", () => {
  swapManifestToBds();
});
task("restoreManifest", () => {
  restoreManifest();
});
task(
  "createMcaddonFileBds",
  mcaddonTask({
    ...copyTaskOptions,
    outputFile: `./dist/packages/${projectName}_BDS.mcaddon`,
  })
);
task(
  "mcaddon:bds",
  series("clean-local", "build:bds", "swapManifestBds", "createMcaddonFileBds", "restoreManifest")
);

// 同时产出标准版 + BDS 版两个 mcaddon（发布时运行一次即可）
task("mcaddon:all", series("mcaddon", "swapManifestBds", "createMcaddonFileBds", "restoreManifest"));
