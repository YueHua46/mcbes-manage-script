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

// You can use `npm run build:production` to build a "production" build that strips out statements labelled with "dev:".
const isProduction = argv()["production"];

/**
 * 将 runtime-id-map 标为 external，使 main.js 不内联 runtime_map.json，
 * 改为运行时加载同目录下的 assets/runtime-id-map.js，便于用户单独替换该文件更新 addon 物品 ID。
 */
const externalRuntimeIdMapPlugin: esbuild.Plugin = {
  name: "external-runtime-id-map",
  setup(build) {
    build.onResolve({ filter: /[\\/]runtime-id-map(\.(ts|js))?$/ }, () => ({
      path: "./assets/runtime-id-map.js",
      external: true,
    }));
  },
};

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
  plugins: [externalRuntimeIdMapPlugin],
} as BundleTaskParameters & { define?: Record<string, string>; plugins?: esbuild.Plugin[] };

/** BDS 版构建：包含 xuid 解析等 server-net 功能，供 BDS 服主使用 */
const bundleTaskOptionsBds = {
  ...bundleTaskOptions,
  define: { __BDS_BUILD__: "true" },
} as BundleTaskParameters & { define?: Record<string, string> };

/** 使用 esbuild 直接打主包（应用 external runtime-id-map 插件，官方 bundleTask 不传 plugins） */
async function runMainBundle(options: typeof bundleTaskOptions): Promise<void> {
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
    plugins: [externalRuntimeIdMapPlugin],
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

// Build（主包用自定义 esbuild，以便应用 external runtime-id-map 插件）
task("bundle", () => runMainBundle(bundleTaskOptions));
task("bundle:bds", () => runMainBundle(bundleTaskOptionsBds));
task("typescript", tscTask());

/**
 * 从 runtime_map.ts 的编译结果生成 dist/scripts/assets/ 下两个可读、未压缩的 JS：
 * - runtime_map.js：数据文件，用户可直接用最新的 runtime_map.js 替换该文件。
 * - runtime-id-map.js：固定包装，import runtime_map.js 并 export runtimeIdMap，不要改。
 * 数据来源：需先执行 typescript，读取 lib/scripts/assets/runtime_map.js。
 */
task("bundle:runtime-id-map", async () => {
  const libAssets = path.join(__dirname, "lib", "scripts", "assets");
  const libJsPath = path.join(libAssets, "runtime_map.js");
  if (!fs.existsSync(libJsPath)) {
    throw new Error("请先执行 typescript 任务（生成 lib/scripts/assets/runtime_map.js）");
  }
  const mod = require(libJsPath) as { runtimeMap?: Record<string, number>; default?: Record<string, number> };
  const data = (mod.runtimeMap ?? mod.default) as Record<string, number>;

  const outDir = path.resolve(__dirname, "dist", "scripts", "assets");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const dataJson = JSON.stringify(data, null, 2);
  const runtimeMapJs = `/**
 * 物品 typeId → 数字 ID 映射数据（Chest UI 等用）。
 * 用户可直接用最新的 runtime_map.js 替换本文件，保持 export const runtimeMap = { ... }; 格式即可，无需编译环境。
 */
export const runtimeMap = ${dataJson};
`;
  fs.writeFileSync(path.join(outDir, "runtime_map.js"), runtimeMapJs, "utf-8");

  const wrapperJs = `/**
 * 包装 runtime_map.js 为 Map，供主包使用。请勿修改；替换映射时只替换同目录下的 runtime_map.js。
 */
import { runtimeMap } from "./runtime_map.js";
export const runtimeIdMap = new Map(Object.entries(runtimeMap));
`;
  fs.writeFileSync(path.join(outDir, "runtime-id-map.js"), wrapperJs, "utf-8");
});

task("build", series("typescript", "bundle", "bundle:runtime-id-map"));
task("build:bds", series("typescript", "bundle:bds", "bundle:runtime-id-map"));

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
