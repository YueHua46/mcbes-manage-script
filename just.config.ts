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
    plugins: [externalRuntimeIdMapPlugin],
  } as BundleTaskParameters & { define?: Record<string, string>; plugins?: esbuild.Plugin[] };
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

/** 使用 esbuild 直接打主包（应用 external runtime-id-map 插件，官方 bundleTask 不传 plugins） */
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

// Build（主包用自定义 esbuild，以便应用 external runtime-id-map 插件）
task("bundle:standard", () => runMainBundle(bundleTaskOptionsStandard));
task("bundle:bds-admin", () => runMainBundle(bundleTaskOptionsBdsAdmin));
task("typescript", tscTask());
task("useManifestStandard", () => {
  useStandardManifest();
});
task("useManifestBds", () => {
  useBdsManifest();
});

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

task("build:standard", series("useManifestStandard", "typescript", "bundle:standard", "bundle:runtime-id-map"));
task("build:bds-admin", series("useManifestBds", "typescript", "bundle:bds-admin", "bundle:runtime-id-map"));
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
