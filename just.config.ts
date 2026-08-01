import { argv, parallel, series, task, tscTask } from "just-scripts";
import {
  BundleTaskParameters,
  CopyTaskParameters,
  bundleTask,
  cleanTask,
  cleanCollateralTask,
  coreLint,
  getGameDeploymentRootPaths,
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

const {
  artifactFilename,
  loadReleaseConfig,
  minecraftFamily,
}: {
  artifactFilename: (
    variant: "standard" | "realms" | "bds",
    config: { version: string; minecraftVersion: string }
  ) => string;
  loadReleaseConfig: () => { version: string; minecraftVersion: string };
  minecraftFamily: (version: string) => string;
} = require("./tools/release-metadata.cjs");
const releaseConfig = loadReleaseConfig();

// Setup env variables
setupEnvironment(path.resolve(__dirname, ".env"));
const projectName = process.env.PROJECT_NAME?.trim() || "CreeperMenu";

// You can use `npm run build:production` to build a "production" build that strips out statements labelled with "dev:".
const isProduction = argv()["production"];

type MainBundleOptions = BundleTaskParameters & {
  define?: Record<string, string>;
  realmsRuntime?: boolean;
  bdsRuntime?: boolean;
};

function createBundleTaskOptions(
  entryPoint: string,
  outfile: string,
  define: Record<string, string>,
  realmsRuntime: boolean = false,
  bdsRuntime: boolean = false
): MainBundleOptions {
  const absoluteOutfile = path.resolve(__dirname, outfile);
  return {
    entryPoint: path.join(__dirname, entryPoint),
    external: [
      "@minecraft/server",
      "@minecraft/server-ui",
      "@minecraft/server-net",
      "@minecraft/server-admin",
      "@minecraft/debug-utilities",
      "@minecraft/server-gametest",
    ],
    outfile: absoluteOutfile,
    minifyWhitespace: false,
    sourcemap: true,
    outputSourcemapPath: path.resolve(path.dirname(absoluteOutfile), "../debug"),
    dropLabels: isProduction ? ["dev"] : undefined,
    define: {
      __APP_VERSION__: JSON.stringify(releaseConfig.version),
      __MINECRAFT_VERSION_FAMILY__: JSON.stringify(minecraftFamily(releaseConfig.minecraftVersion)),
      ...define,
    },
    realmsRuntime,
    bdsRuntime,
  } as MainBundleOptions;
}

/** 普通兼容版构建：不包含 server-net / server-admin 运行时能力，供本地和 BDS 使用 */
const bundleTaskOptionsStandard = createBundleTaskOptions("./scripts/main.standard.ts", "./dist/scripts/main.js", {
  __BDS_BUILD__: "false",
  __SERVER_ADMIN_BUILD__: "false",
  __DEBUG_UTILITIES_BUILD__: "false",
  __REALMS_BUILD__: "false",
});

/** 本地/BDS 调试版构建：包含 @minecraft/debug-utilities，不适用于 Realms */
const bundleTaskOptionsDebug = createBundleTaskOptions("./scripts/main.debug.ts", "./dist/scripts/main.js", {
  __BDS_BUILD__: "false",
  __SERVER_ADMIN_BUILD__: "false",
  __DEBUG_UTILITIES_BUILD__: "true",
  __REALMS_BUILD__: "false",
});

/** BDS 增强版构建：包含 server-net / server-admin 相关能力，仅供 BDS 服务器使用 */
const bundleTaskOptionsBdsAdmin = createBundleTaskOptions(
  "./scripts/main.bds.ts",
  "./dist/scripts/main.js",
  {
    __BDS_BUILD__: "true",
    __SERVER_ADMIN_BUILD__: "true",
    __DEBUG_UTILITIES_BUILD__: "false",
    __REALMS_BUILD__: "false",
  },
  false,
  true
);

/** Realms 兼容版构建：不包含 GameTest，仅支持旧版实体假人 */
const bundleTaskOptionsRealms = createBundleTaskOptions(
  "./scripts/main.realms.ts",
  "./dist/scripts/main.js",
  {
    __BDS_BUILD__: "false",
    __SERVER_ADMIN_BUILD__: "false",
    __DEBUG_UTILITIES_BUILD__: "false",
    __REALMS_BUILD__: "true",
  },
  true
);

const bundleTaskOptionsBackrooms = createBundleTaskOptions(
  "./scripts/backrooms.main.ts",
  "./dist/backrooms/scripts/main.js",
  {
    __BDS_BUILD__: "false",
    __SERVER_ADMIN_BUILD__: "false",
    __DEBUG_UTILITIES_BUILD__: "false",
    __REALMS_BUILD__: "false",
  },
);

const realmsRuntimePlugin: esbuild.Plugin = {
  name: "realms-simulated-player-runtime",
  setup(build) {
    build.onResolve({ filter: /simulated-player-runtime$/ }, () => ({
      path: path.resolve(
        __dirname,
        "scripts/features/fake-player/services/simulated-player-runtime.realms.ts"
      ),
    }));
  },
};

const withoutBdsRuntimePlugin: esbuild.Plugin = {
  name: "without-bds-runtime",
  setup(build) {
    const capabilityDirectory = path.resolve(
      __dirname,
      "scripts/features/platform/sapi-capabilities"
    );
    build.onResolve({ filter: /^\.\/server-(admin|net)$/ }, (args) => {
      if (path.dirname(args.importer) !== capabilityDirectory) return undefined;
      const disabledModule =
        args.path === "./server-admin"
          ? "server-admin.disabled.ts"
          : "server-net.disabled.ts";
      return { path: path.join(capabilityDirectory, disabledModule) };
    });
  },
};

/** 使用 esbuild 直接打主包 */
async function runMainBundle(options: MainBundleOptions): Promise<void> {
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
    plugins: [
      ...(options.realmsRuntime ? [realmsRuntimePlugin] : []),
      ...(!options.bdsRuntime ? [withoutBdsRuntimePlugin] : []),
    ],
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

const backroomsCopyTaskOptions: CopyTaskParameters = {
  copyToBehaviorPacks: ["./behavior_packs/Backrooms"],
  copyToScripts: ["./dist/backrooms/scripts"],
  copyToResourcePacks: ["./resource_packs/Backrooms"],
};

const RETRYABLE_COPY_ERRORS = new Set(["EBUSY", "EPERM", "EACCES"]);

async function copyFileWithRetry(source: string, destination: string): Promise<void> {
  const maxAttempts = 8;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fs.promises.copyFile(source, destination);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!code || !RETRYABLE_COPY_ERRORS.has(code) || attempt === maxAttempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 100));
    }
  }
}

async function copyDirectoryContents(source: string, destination: string): Promise<void> {
  await fs.promises.mkdir(destination, { recursive: true });
  const entries = await fs.promises.readdir(source, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const sourcePath = path.join(source, entry.name);
      const destinationPath = path.join(destination, entry.name);
      if (entry.isDirectory()) {
        await copyDirectoryContents(sourcePath, destinationPath);
      } else if (entry.isFile()) {
        await copyFileWithRetry(sourcePath, destinationPath);
      }
    })
  );
}

async function copyArtifacts(): Promise<void> {
  const product = getOrThrowFromProcess("MINECRAFT_PRODUCT");
  const deploymentPath = getGameDeploymentRootPaths()[product as keyof ReturnType<typeof getGameDeploymentRootPaths>];
  if (!deploymentPath) {
    throw new Error(`无法确定 ${product} 的部署路径，请检查 .env 配置。`);
  }

  const packs = [
    { name: projectName, options: copyTaskOptions },
    { name: "Backrooms", options: backroomsCopyTaskOptions },
  ];
  for (const pack of packs) {
    const behaviorPackTarget = path.join(deploymentPath, "development_behavior_packs", pack.name);
    const resourcePackTarget = path.join(deploymentPath, "development_resource_packs", pack.name);
    await copyDirectoryContents(path.resolve(__dirname, pack.options.copyToBehaviorPacks[0]), behaviorPackTarget);
    await copyDirectoryContents(
      path.resolve(__dirname, pack.options.copyToScripts[0]),
      path.join(behaviorPackTarget, "scripts"),
    );
    if (pack.options.copyToResourcePacks?.[0]) {
      await copyDirectoryContents(path.resolve(__dirname, pack.options.copyToResourcePacks[0]), resourcePackTarget);
    }
  }
}

// 普通兼容版（适用本地、BDS）
const mcaddonTaskOptionsStandard: ZipTaskParameters = {
  ...copyTaskOptions,
  outputFile: `./dist/packages/${artifactFilename("standard", releaseConfig)}`,
};

const mcaddonTaskOptionsDebug: ZipTaskParameters = {
  ...copyTaskOptions,
  outputFile: `./dist/packages/${projectName}_本地BDS调试版（不适用Realms领域服，含DebugUtilities）.mcaddon`,
};

const mcaddonTaskOptionsBdsAdmin: ZipTaskParameters = {
  ...copyTaskOptions,
  outputFile: `./dist/packages/${artifactFilename("bds", releaseConfig)}`,
};

const mcaddonTaskOptionsRealms: ZipTaskParameters = {
  ...copyTaskOptions,
  outputFile: `./dist/packages/${artifactFilename("realms", releaseConfig)}`,
};

const mcaddonTaskOptionsBackrooms: ZipTaskParameters = {
  ...backroomsCopyTaskOptions,
  outputFile: "./dist/packages/Backrooms_Level_0_独立附加包.mcaddon",
};

const behaviorPackDir = path.join(__dirname, "behavior_packs", projectName);
const manifestPath = path.join(behaviorPackDir, "manifest.json");
const manifestStandardPath = path.join(behaviorPackDir, "manifest.standard.json");
const manifestDebugPath = path.join(behaviorPackDir, "manifest.debug.json");
const manifestBdsPath = path.join(behaviorPackDir, "manifest.bds.json");
const manifestRealmsPath = path.join(behaviorPackDir, "manifest.realms.json");

function useManifestVariant(sourcePath: string, label: string) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`${label} 不存在: ${sourcePath}`);
  }
  fs.copyFileSync(sourcePath, manifestPath);
}

function useStandardManifest() {
  useManifestVariant(manifestStandardPath, "manifest.standard.json");
}

function useDebugManifest() {
  useManifestVariant(manifestDebugPath, "manifest.debug.json");
}

function useBdsManifest() {
  useManifestVariant(manifestBdsPath, "manifest.bds.json");
}

function useRealmsManifest() {
  useManifestVariant(manifestRealmsPath, "manifest.realms.json");
}

// just-scripts 在串行任务失败时不会继续执行收尾步骤，因此发布构建退出时再同步恢复一次。
if (process.argv.includes("mcaddon:release")) {
  process.once("exit", () => {
    try {
      useStandardManifest();
    } catch (error) {
      console.error("发布构建结束后恢复 manifest.standard.json 失败", error);
      process.exitCode = 1;
    }
  });
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
  const bdsServerDeployPath = getOrThrowFromProcess("BDS_SERVER_DEPLOY_PATH");
  process.env.MINECRAFT_PRODUCT = "Custom";
  process.env.CUSTOM_DEPLOYMENT_PATH = bdsServerDeployPath;
}

// Lint
task("lint", coreLint(["scripts"], argv().fix));

// Build
task("bundle:standard", () => runMainBundle(bundleTaskOptionsStandard));
task("bundle:debug", () => runMainBundle(bundleTaskOptionsDebug));
task("bundle:bds-admin", () => runMainBundle(bundleTaskOptionsBdsAdmin));
task("bundle:realms", () => runMainBundle(bundleTaskOptionsRealms));
task("bundle:backrooms", () => runMainBundle(bundleTaskOptionsBackrooms));
task("typescript", tscTask());
task("useManifestStandard", () => {
  useStandardManifest();
});
task("useManifestDebug", () => {
  useDebugManifest();
});
task("useManifestBds", () => {
  useBdsManifest();
});
task("useManifestRealms", () => {
  useRealmsManifest();
});

task("bundle:standard-all", parallel("bundle:standard", "bundle:backrooms"));
task("bundle:debug-all", parallel("bundle:debug", "bundle:backrooms"));
task("bundle:bds-admin-all", parallel("bundle:bds-admin", "bundle:backrooms"));
task("bundle:realms-all", parallel("bundle:realms", "bundle:backrooms"));
task("build:standard", series("useManifestStandard", "typescript", "bundle:standard-all"));
task("build:debug", series("useManifestDebug", "typescript", "bundle:debug-all"));
task("build:bds-admin", series("useManifestBds", "typescript", "bundle:bds-admin-all"));
task("build:realms", series("useManifestRealms", "typescript", "bundle:realms-all"));
task("build:backrooms", series("typescript", "bundle:backrooms"));
task("build", series("build:standard"));

// Clean
task("clean-local", cleanTask(DEFAULT_CLEAN_DIRECTORIES));
task("clean-collateral", cleanCollateralTask(STANDARD_CLEAN_PATHS));
task("clean", parallel("clean-local", "clean-collateral"));

// Package
task("copyArtifacts", copyArtifacts);
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
    ["scripts/**/*.ts", "behavior_packs/**/*.{json,lang,png,ogg,wav}", "resource_packs/**/*.{json,lang,png,ogg,wav}"],
    series("setDefaultDeployEnv", "clean-local", "build:standard", "package")
  )
);
task(
  "local-deploy:debug",
  watchTask(
    ["scripts/**/*.ts", "behavior_packs/**/*.{json,lang,png,ogg,wav}", "resource_packs/**/*.{json,lang,png,ogg,wav}"],
    series("setDefaultDeployEnv", "clean-local", "build:debug", "package")
  )
);
task(
  "local-deploy:bds-admin",
  watchTask(
    ["scripts/**/*.ts", "behavior_packs/**/*.{json,lang,png,ogg,wav}", "resource_packs/**/*.{json,lang,png,ogg,wav}"],
    series("setBdsServerDeployEnv", "clean-local", "build:bds-admin", "package")
  )
);
task("local-deploy:bds", series("local-deploy:bds-admin"));

// Mcaddon
task("createMcaddonFile:standard", mcaddonTask(mcaddonTaskOptionsStandard));
task("createMcaddonFile:debug", mcaddonTask(mcaddonTaskOptionsDebug));
task("createMcaddonFile:bds-admin", mcaddonTask(mcaddonTaskOptionsBdsAdmin));
task("createMcaddonFile:realms", mcaddonTask(mcaddonTaskOptionsRealms));
task("createMcaddonFile:backrooms", mcaddonTask(mcaddonTaskOptionsBackrooms));
task("package:standard", series("build:standard", "createMcaddonFile:standard"));
task("package:debug", series("build:debug", "createMcaddonFile:debug"));
task("package:bds-admin", series("build:bds-admin", "createMcaddonFile:bds-admin"));
task("package:realms", series("build:realms", "createMcaddonFile:realms"));
task("package:backrooms", series("build:backrooms", "createMcaddonFile:backrooms"));
task("mcaddon:standard", series("clean-local", "package:standard"));
task("mcaddon:debug", series("clean-local", "package:debug"));
task("mcaddon:bds-admin", series("clean-local", "package:bds-admin"));
task("mcaddon:realms", series("clean-local", "package:realms"));
task("mcaddon:backrooms", series("clean-local", "package:backrooms"));
task("mcaddon", series("mcaddon:standard"));
task("mcaddon:bds", series("mcaddon:bds-admin"));

// 仅生成进入 CreeperMenu Release 的三个菜单变体，不包含独立 Backrooms 包。
task(
  "mcaddon:release",
  series(
    "clean-local",
    "package:standard",
    "package:realms",
    "package:bds-admin",
    "useManifestStandard"
  )
);

// 同时产出菜单普通版、Realms 版、BDS 增强版和独立 Backrooms 包。
task(
  "mcaddon:all",
  series(
    "clean-local",
    "package:standard",
    "package:realms",
    "package:backrooms",
    "package:bds-admin",
    "useManifestStandard"
  )
);
