# Realms 独立构建 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变普通版和 BDS 新版假人能力的前提下，新增完全不依赖 `@minecraft/server-gametest`、只支持旧版实体假人的 Realms 发行版本。

**Architecture:** 将 GameTest 静态导入收口到模拟玩家运行时适配层，Realms 构建通过 esbuild 插件替换为无 GameTest 的拒绝适配器。`sapi-capabilities` 提供统一构建能力，假人数据库在 Realms 初始化时使用纯函数完成幂等降级，UI 根据能力直接进入旧版创建流程。

**Tech Stack:** TypeScript 5.5、esbuild、just-scripts、Minecraft Bedrock Script API、Node.js `node:test`。

## Global Constraints

- 普通兼容版和 BDS 增强版继续支持旧版实体假人及新版模拟玩家。
- Realms 版行为包 manifest 和最终 JavaScript 均不得引用 `@minecraft/server-gametest`。
- Realms 版只支持旧版实体假人；已有模拟玩家记录自动、幂等地降级。
- DOVA 音乐、二次元角色资源、假人皮肤、菜单道具和品牌素材不得删除或改写。
- Backrooms 独立包行为保持不变。
- 遵照用户要求，不做中间提交；全部实现和验证完成后统一使用中文 commit 信息提交并 push。

---

### Task 1: 用失败测试锁定三版本构建契约

**Files:**
- Create: `tests/realms-build-variant.test.cjs`
- Test: `tests/realms-build-variant.test.cjs`

**Interfaces:**
- Consumes: `package.json`、`just.config.ts`、四份 CreeperMenu manifest 和构建入口。
- Produces: Realms 构建、清单、能力标识及打包命令的静态回归契约。

- [ ] **Step 1: 写 manifest 与 npm 命令失败测试**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const readJson = (relativePath) => JSON.parse(read(relativePath));
const moduleNames = (manifest) =>
  (manifest.dependencies ?? []).map((dependency) => dependency.module_name).filter(Boolean);

test("Realms manifest excludes unsupported modules while standard and BDS keep GameTest", () => {
  const realms = moduleNames(readJson("behavior_packs/CreeperMenu/manifest.realms.json"));
  assert.equal(realms.includes("@minecraft/server-gametest"), false);
  assert.equal(realms.includes("@minecraft/server-admin"), false);
  assert.equal(realms.includes("@minecraft/server-net"), false);
  assert.equal(realms.includes("@minecraft/debug-utilities"), false);

  for (const file of ["manifest.standard.json", "manifest.bds.json"]) {
    assert.equal(
      moduleNames(readJson(`behavior_packs/CreeperMenu/${file}`)).includes("@minecraft/server-gametest"),
      true,
      file
    );
  }
});

test("package and just config expose a dedicated Realms build", () => {
  const pkg = readJson("package.json");
  assert.equal(pkg.scripts["build:realms"], "just-scripts build:realms");
  assert.equal(pkg.scripts["mcaddon:realms"], "just-scripts mcaddon:realms");

  const config = read("just.config.ts");
  assert.match(config, /task\("build:realms"/);
  assert.match(config, /task\("mcaddon:realms"/);
  assert.match(config, /manifest\.realms\.json/);
  assert.match(config, /__REALMS_BUILD__:\s*"true"/);
});
```

- [ ] **Step 2: 运行测试并确认因 Realms 文件与命令不存在而失败**

Run: `node --test tests/realms-build-variant.test.cjs`

Expected: FAIL，错误明确指向 `manifest.realms.json` 不存在或 `build:realms` 缺失。

- [ ] **Step 3: 增加能力与隔离边界的静态失败测试**

```js
test("Realms capability and GameTest adapter stay centralized", () => {
  const flags = read("scripts/features/platform/sapi-capabilities/build-flags.ts");
  const service = read("scripts/features/fake-player/services/fake-player.ts");
  const realmsRuntime = read("scripts/features/fake-player/services/simulated-player-runtime.realms.ts");

  assert.match(flags, /export type BuildVariant = "standard" \| "debug" \| "bds-admin" \| "realms"/);
  assert.match(flags, /export function isRealmsBuild/);
  assert.match(flags, /export function isSimulatedPlayerAvailable/);
  assert.doesNotMatch(service, /from\s+["']@minecraft\/server-gametest["']/);
  assert.doesNotMatch(realmsRuntime, /@minecraft\/server-gametest/);
});
```

- [ ] **Step 4: 再次运行并确认因能力和适配层未实现而失败**

Run: `node --test tests/realms-build-variant.test.cjs`

Expected: FAIL，错误指向 Realms runtime 文件不存在或构建能力未导出。

---

### Task 2: 实现构建能力、GameTest 适配层和 Realms 清单

**Files:**
- Create: `behavior_packs/CreeperMenu/manifest.realms.json`
- Create: `scripts/features/fake-player/services/simulated-player-runtime.ts`
- Create: `scripts/features/fake-player/services/simulated-player-runtime.realms.ts`
- Modify: `scripts/features/fake-player/services/fake-player.ts`
- Modify: `scripts/features/platform/sapi-capabilities/build-flags.ts`
- Modify: `scripts/features/platform/sapi-capabilities/index.ts`
- Modify: `scripts/global.d.ts`
- Modify: `just.config.ts`
- Modify: `package.json`
- Test: `tests/realms-build-variant.test.cjs`

**Interfaces:**
- Produces: `isRealmsBuild(): boolean`、`isSimulatedPlayerAvailable(): boolean`、
  `spawnSupportedSimulatedPlayer(...)` 和 `BuildVariant` 的 `"realms"` 分支。
- Consumes: esbuild 的 Realms-only `onResolve` alias 和现有 GameTest API。

- [ ] **Step 1: 增加 Realms 构建标识和集中能力**

```ts
export type BuildVariant = "standard" | "debug" | "bds-admin" | "realms";

export function isRealmsBuild(): boolean {
  return typeof __REALMS_BUILD__ !== "undefined" && __REALMS_BUILD__;
}

export function isSimulatedPlayerAvailable(): boolean {
  return !isRealmsBuild();
}

export function getBuildVariant(): BuildVariant {
  if (isRealmsBuild()) return "realms";
  if (isDebugUtilitiesBuild()) return "debug";
  return isServerAdminBuild() ? "bds-admin" : "standard";
}
```

同时在 `scripts/global.d.ts` 声明 `__REALMS_BUILD__`，从
`sapi-capabilities/index.ts` 导出新增能力，并让 `getBuildVariantLabel()`
为 Realms 返回“Realms 兼容版”。

- [ ] **Step 2: 将 GameTest 导入移动到完整适配器**

```ts
import {
  spawnSimulatedPlayer as spawnFromGameTest,
  type SimulatedPlayer,
} from "@minecraft/server-gametest";

export type { SimulatedPlayer };
export const spawnSupportedSimulatedPlayer = spawnFromGameTest;
```

把 `fake-player.ts` 改为从该适配器导入
`spawnSupportedSimulatedPlayer` 和 `type SimulatedPlayer`，业务文件不再直接
导入 GameTest。

- [ ] **Step 3: 新增不含 GameTest 的 Realms 拒绝适配器**

```ts
import type { DimensionLocation, GameMode, Player } from "@minecraft/server";

export type SimulatedPlayer = Player;

export function spawnSupportedSimulatedPlayer(
  _location: DimensionLocation,
  _name: string,
  _gameMode: GameMode
): never {
  throw new Error("Realms 兼容版不支持新版模拟玩家");
}
```

该模块中不得出现 GameTest 包名。其参数签名以实际依赖版本的声明为准，
保持与完整适配器的调用点一致。

- [ ] **Step 4: 新增 Realms manifest**

以 `manifest.standard.json` 为基线复制 header、modules、`@minecraft/server`
和 `@minecraft/server-ui`，完全删除 GameTest 依赖。UUID 与版本沿用同一
菜单产品的现有值，确保三个变体互为替换版本而不是同时安装的重复包。

- [ ] **Step 5: 在构建器中增加 Realms-only alias**

扩展 bundle options：

```ts
type MainBundleOptions = BundleTaskParameters & {
  define?: Record<string, string>;
  realmsRuntime?: boolean;
};
```

在 `runMainBundle()` 中仅当 `realmsRuntime` 为真时注册 esbuild 插件：

```ts
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
```

Realms options 使用 `scripts/main.realms.ts`、设置
`__REALMS_BUILD__: "true"`，其他所有变体和 Backrooms 均显式设置为
`"false"`。

- [ ] **Step 6: 增加 manifest、build 和 package 任务**

在 `just.config.ts` 增加：

```ts
task("bundle:realms", () => runMainBundle(bundleTaskOptionsRealms));
task("useManifestRealms", () => useRealmsManifest());
task("bundle:realms-all", parallel("bundle:realms", "bundle:backrooms"));
task("build:realms", series("useManifestRealms", "typescript", "bundle:realms-all"));
task("createMcaddonFile:realms", mcaddonTask(mcaddonTaskOptionsRealms));
task("package:realms", series("build:realms", "createMcaddonFile:realms"));
task("mcaddon:realms", series("clean-local", "package:realms"));
```

`mcaddonTaskOptionsRealms.outputFile` 使用
`CreeperMenu_Realms兼容版（仅旧版实体假人）.mcaddon`。更新
`mcaddon:all` 依次生成普通版、Realms、Backrooms、BDS，最后恢复普通版
manifest。

- [ ] **Step 7: 暴露 npm 命令并跑静态契约测试**

在 `package.json` 增加：

```json
"build:realms": "just-scripts build:realms",
"mcaddon:realms": "just-scripts mcaddon:realms"
```

Run: `node --test tests/realms-build-variant.test.cjs`

Expected: 当前 Task 的 manifest、命令、能力和适配层测试 PASS。

---

### Task 3: 用 TDD 实现 Realms 假人数据幂等降级

**Files:**
- Create: `scripts/features/fake-player/services/realms-fake-player-migration.ts`
- Modify: `scripts/features/fake-player/services/fake-player.ts`
- Modify: `tests/realms-build-variant.test.cjs`
- Test: `tests/realms-build-variant.test.cjs`

**Interfaces:**
- Produces:
  `migrateFakePlayerRecordForRealms(record): { record; changed }`。
- Consumes: FakePlayer 数据库记录；迁移模块内部使用与现有皮肤范围一致的纯
  归一化函数，避免 Node 测试加载 Minecraft 运行时。

- [ ] **Step 1: 写迁移行为失败测试**

测试通过 TypeScript `transpileModule` 加载纯函数模块。先在测试文件顶部
加入：

```js
const vm = require("node:vm");
const ts = require("typescript");

function loadPureTypeScriptModule(source) {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function (module, exports) { ${output} })(module, module.exports);`, {
    module,
  });
  return module.exports;
}
```

然后断言：

```js
test("Realms migration converts simulated records and removes unsupported state", () => {
  const source = read("scripts/features/fake-player/services/realms-fake-player-migration.ts");
  const { migrateFakePlayerRecordForRealms } = loadPureTypeScriptModule(source);
  const original = {
    id: "fake-1",
    name: "加载点",
    ownerName: "Steve",
    location: { x: 1, y: 64, z: 2 },
    dimension: "minecraft:overworld",
    created: "2026-07-25 12:00:00",
    type: "simulated",
    rotationX: 5,
    rotationY: 90,
    inventoryViewers: ["Alex"],
    isDead: true,
    deathReason: "测试",
    gameMode: "Survival",
    inventory: { slots: [] },
    behavior: { movement: "idle" },
    program: { enabled: true, loop: true, steps: [] },
  };

  const result = migrateFakePlayerRecordForRealms(original);
  assert.equal(result.changed, true);
  assert.equal(result.record.type, "entity");
  assert.equal(result.record.skinId, 0);
  assert.equal(result.record.name, original.name);
  assert.deepEqual(result.record.location, original.location);
  assert.deepEqual(result.record.inventoryViewers, ["Alex"]);
  for (const key of [
    "isDead", "diedAt", "deathReason", "deathSourceLocalizationKey",
    "deathSourceName", "deathCause", "gameMode", "inventory", "behavior", "program"
  ]) {
    assert.equal(Object.hasOwn(result.record, key), false, key);
  }
  assert.notEqual(result.record, original);
  assert.equal(original.type, "simulated");
});
```

再增加实体记录重复迁移测试，断言 `changed === false` 且业务字段不变。

- [ ] **Step 2: 运行测试并确认迁移模块缺失导致失败**

Run: `node --test tests/realms-build-variant.test.cjs`

Expected: FAIL，失败原因是迁移文件或导出函数不存在。

- [ ] **Step 3: 实现纯迁移函数**

```ts
const SIMULATED_ONLY_KEYS = [
  "isDead",
  "diedAt",
  "deathReason",
  "deathSourceLocalizationKey",
  "deathSourceName",
  "deathCause",
  "gameMode",
  "inventory",
  "behavior",
  "program",
] as const;

export function migrateFakePlayerRecordForRealms<T extends Record<string, unknown>>(
  source: T
): { record: T; changed: boolean } {
  if (source.type === "entity") return { record: source, changed: false };
  const record = { ...source, type: "entity", skinId: normalizeSkinId(source.skinId) };
  for (const key of SIMULATED_ONLY_KEYS) delete record[key];
  return { record: record as T, changed: true };
}
```

实现中使用本模块内的纯 `normalizeSkinId()`，合法范围为现有皮肤 `0..15`，
避免测试运行时加载 Minecraft 模块。

- [ ] **Step 4: 将迁移接入数据库初始化**

在 `FakePlayerService` 创建数据库后、注册名称和生成实体前执行：

```ts
private migrateRecordsForRealms(): void {
  if (!isRealmsBuild()) return;
  let migrated = 0;
  for (const item of this.db.values()) {
    try {
      const result = migrateFakePlayerRecordForRealms(item);
      if (!result.changed) continue;
      this.db.set(result.record.id, result.record);
      migrated++;
    } catch (error) {
      SystemLog.warn(`[FakePlayer] Realms 假人降级失败: ${item.id} ${String(error)}`);
    }
  }
  if (migrated > 0) {
    this.db.save();
    SystemLog.info(`[FakePlayer] 已将 ${migrated} 个新版假人降级为旧版实体假人`);
  }
}
```

`create()` 还应在 Realms 拒绝显式 `"simulated"` 请求，并让未指定类型的创建
默认使用 `"entity"`；普通/BDS 的默认值继续是 `"simulated"`。

- [ ] **Step 5: 运行迁移测试**

Run: `node --test tests/realms-build-variant.test.cjs`

Expected: 迁移、幂等性和静态构建契约全部 PASS。

---

### Task 4: 用失败测试锁定并实现 Realms UI 与启动入口

**Files:**
- Create: `scripts/main.realms.ts`
- Modify: `scripts/ui/forms/player/fake-player.ts`
- Modify: `tests/realms-build-variant.test.cjs`
- Test: `tests/realms-build-variant.test.cjs`

**Interfaces:**
- Consumes: `isRealmsBuild()` 与 `isSimulatedPlayerAvailable()`。
- Produces: Realms 专用启动日志、旧版假人直接创建流程和无新版能力说明的菜单。

- [ ] **Step 1: 写 UI 与入口失败测试**

```js
test("Realms entry and fake-player UI expose legacy-only behavior", () => {
  const entry = read("scripts/main.realms.ts");
  const ui = read("scripts/ui/forms/player/fake-player.ts");
  assert.match(entry, /Realms 兼容版/);
  assert.match(entry, /仅旧版实体假人/);
  assert.match(ui, /isSimulatedPlayerAvailable/);
  assert.match(ui, /Realms 版仅支持旧版实体假人/);
});
```

- [ ] **Step 2: 运行测试并确认入口/能力文案缺失导致失败**

Run: `node --test tests/realms-build-variant.test.cjs`

Expected: FAIL，错误指向 `main.realms.ts` 不存在或 UI 未接入能力。

- [ ] **Step 3: 新增 Realms 入口**

以 `main.standard.ts` 的模块加载顺序为基线创建 `main.realms.ts`，仅调整构建
标识日志：

```ts
SystemLog.info("当前构建：Realms 兼容版（仅旧版实体假人）");
```

不得删减与 GameTest 无关的菜单功能。

- [ ] **Step 4: 让创建流程按能力分支**

```ts
const simulatedPlayerAvailable = isSimulatedPlayerAvailable();

// 菜单 body：
simulatedPlayerAvailable
  ? "§7可选择旧版实体假人或新版模拟玩家。"
  : "§7Realms 版仅支持旧版实体假人。"

// 点击创建：
if (simulatedPlayerAvailable) {
  openCreateFakePlayerForm(player, back);
} else {
  openCreateFakePlayerDetailsForm(player, "entity", back);
}
```

仅在能力可用时展示新版复活费用和类型选择页。详情页仍按记录类型决定按钮；
Realms 初始化迁移保证记录均为 entity。

- [ ] **Step 5: 运行 UI 静态测试和类型检查**

Run: `node --test tests/realms-build-variant.test.cjs`

Expected: PASS。

Run: `npm run typecheck`

Expected: PASS，无 TypeScript 错误。

---

### Task 5: 增加真实产物验证并接入 CI

**Files:**
- Create: `tools/verify-realms-build.cjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `tests/realms-build-variant.test.cjs`
- Test: `tests/realms-build-variant.test.cjs`

**Interfaces:**
- Produces: `npm run verify:realms-build`，对当前 Realms build 的 manifest 和
  `dist/scripts/main.js` 做硬性检查。
- Consumes: `npm run build:realms` 的输出。

- [ ] **Step 1: 写验证器接入失败测试**

```js
test("CI builds and verifies the Realms artifact", () => {
  const pkg = readJson("package.json");
  const workflow = read(".github/workflows/ci.yml");
  assert.equal(pkg.scripts["verify:realms-build"], "node tools/verify-realms-build.cjs");
  assert.match(workflow, /npm run build:realms/);
  assert.match(workflow, /npm run verify:realms-build/);
});
```

- [ ] **Step 2: 运行测试并确认脚本/CI 步骤缺失导致失败**

Run: `node --test tests/realms-build-variant.test.cjs`

Expected: FAIL，错误指向 `verify:realms-build` 或 CI 命令缺失。

- [ ] **Step 3: 实现产物验证器**

```js
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "behavior_packs/CreeperMenu/manifest.json"), "utf8")
);
const bundle = fs.readFileSync(path.join(root, "dist/scripts/main.js"), "utf8");
const modules = (manifest.dependencies ?? []).map((item) => item.module_name);

for (const unsupported of [
  "@minecraft/server-gametest",
  "@minecraft/server-admin",
  "@minecraft/server-net",
  "@minecraft/debug-utilities",
]) {
  if (modules.includes(unsupported)) throw new Error(`Realms manifest 包含不支持模块: ${unsupported}`);
}
if (bundle.includes("@minecraft/server-gametest")) {
  throw new Error("Realms JavaScript 仍引用 @minecraft/server-gametest");
}
console.log("Realms 构建验证通过：manifest 与脚本均不含不支持模块。");
```

- [ ] **Step 4: 接入 npm 和 CI**

新增：

```json
"verify:realms-build": "node tools/verify-realms-build.cjs"
```

CI 在普通版和 BDS 构建之外执行：

```yaml
- name: Build Realms variant
  run: npm run build:realms

- name: Verify Realms artifact
  run: npm run verify:realms-build
```

- [ ] **Step 5: 构建并验证真实 Realms 产物**

Run: `npm run build:realms`

Expected: PASS，使用 `manifest.realms.json` 并生成 `dist/scripts/main.js`。

Run: `npm run verify:realms-build`

Expected: 输出“Realms 构建验证通过”，退出码为 0。

---

### Task 6: 更新 README、知识库和版本说明

**Files:**
- Modify: `README.md`
- Modify: `docs/creeper-menu-knowledge-base.md`
- Modify: `tests/public-release-readiness.test.cjs`
- Modify: `tests/realms-build-variant.test.cjs`
- Test: `tests/public-release-readiness.test.cjs`
- Test: `tests/realms-build-variant.test.cjs`

**Interfaces:**
- Produces: 三菜单版本选择指南、Realms 限制/迁移说明、完整构建命令说明。
- Consumes: 已实现的命令和实际能力，不描述不存在的功能。

- [ ] **Step 1: 先扩展 README 失败测试**

在 `tests/public-release-readiness.test.cjs` 的发布要素中增加：

```js
"Realms 兼容版",
"npm run build:realms",
"npm run mcaddon:realms",
"@minecraft/server-gametest",
```

并在 Realms 测试中断言知识库包含“仅旧版实体假人”和“自动降级”。

- [ ] **Step 2: 运行文档测试并确认缺少新说明而失败**

Run:
`node --test tests/public-release-readiness.test.cjs tests/realms-build-variant.test.cjs`

Expected: FAIL，明确指出 README/知识库缺少 Realms 文案。

- [ ] **Step 3: 更新 README**

更新内容必须包括：

- 版本矩阵拆成普通兼容版、Realms 兼容版、BDS 增强版和独立 Backrooms。
- 普通版适用范围移除 Realms。
- Realms 版说明“不声明且不加载 `@minecraft/server-gametest`，仅旧版实体
  假人”。
- 解释从其他版本切到 Realms 时，已有新版假人会自动降级，且新版背包、
  死亡、自动行为和脚本数据无法继承。
- 增加 `build:realms`、`mcaddon:realms`，更新 `mcaddon:all` 产物列表。
- 验证章节增加 Realms 构建与 `verify:realms-build`。

- [ ] **Step 4: 更新知识库**

在版本选择和假人功能章节中记录三个版本的能力边界、迁移行为、回切限制，
并说明源码依赖仍保留 GameTest 是为了编译普通/BDS 版本，不代表 Realms
产物携带该模块。

- [ ] **Step 5: 运行文档与资源保护测试**

Run:
`node --test tests/public-release-readiness.test.cjs tests/realms-build-variant.test.cjs`

Expected: PASS。

Run: `node --test tests/brand-assets.test.cjs tests/welcome-sounds.test.cjs tests/welcome-character-glyphs.test.cjs`

Expected: PASS，受保护资源摘要不变。

---

### Task 7: 完整回归、三版本产物检查和统一发布

**Files:**
- Modify only if verification reveals an in-scope defect.
- Verify all files changed in Tasks 1–6.

**Interfaces:**
- Consumes: 全部实现和文档。
- Produces: 已验证的三菜单版本构建以及一次中文提交和远程 push。

- [ ] **Step 1: 运行完整质量检查**

Run: `npm run check`

Expected: lint、typecheck 和全部 Node 测试 PASS。

- [ ] **Step 2: 依次验证普通版、BDS、Realms 和 Backrooms**

Run: `npm run build:standard`

Expected: PASS；`dist/scripts/main.js` 包含普通版所需 GameTest 外部导入。

Run: `npm run build:bds-admin`

Expected: PASS；BDS manifest 同时包含 server-admin、server-net 和 GameTest。

Run: `npm run build:realms && npm run verify:realms-build`

Expected: PASS；Realms manifest 与 bundle 不包含 GameTest。

Run: `npm run build:backrooms`

Expected: PASS；Backrooms 构建不受影响。

- [ ] **Step 3: 打包全部发行物并检查文件**

Run: `npm run mcaddon:all`

Expected: `dist/packages` 同时出现普通版、Realms 版、BDS 增强版和 Backrooms
四个 `.mcaddon` 文件，任务结束后
`behavior_packs/CreeperMenu/manifest.json` 与 `manifest.standard.json` 一致。

- [ ] **Step 4: 检查 diff、资源摘要和工作区**

Run: `git diff --check`

Expected: 无输出，退出码 0。

Run: `git status --short`

Expected: 仅包含本计划范围内的源码、配置、测试和文档；不包含构建产物或
受保护资源变更。

- [ ] **Step 5: 使用中文提交信息统一提交**

```bash
git add \
  .github/workflows/ci.yml \
  README.md \
  behavior_packs/CreeperMenu/manifest.realms.json \
  docs/creeper-menu-knowledge-base.md \
  docs/superpowers/specs/2026-07-25-realms-build-variant-design.md \
  docs/superpowers/plans/2026-07-25-realms-build-variant.md \
  just.config.ts \
  package.json \
  scripts/global.d.ts \
  scripts/main.realms.ts \
  scripts/features/fake-player/services/fake-player.ts \
  scripts/features/fake-player/services/realms-fake-player-migration.ts \
  scripts/features/fake-player/services/simulated-player-runtime.ts \
  scripts/features/fake-player/services/simulated-player-runtime.realms.ts \
  scripts/features/platform/sapi-capabilities/build-flags.ts \
  scripts/features/platform/sapi-capabilities/index.ts \
  scripts/ui/forms/player/fake-player.ts \
  tests/public-release-readiness.test.cjs \
  tests/realms-build-variant.test.cjs \
  tools/verify-realms-build.cjs
git commit -m "feat: 新增 Realms 兼容版构建"
```

Expected: commit 成功，提交范围只包含本功能。

- [ ] **Step 6: push 当前分支并确认远程同步**

Run: `git push`

Expected: push 成功；`git status --short --branch` 显示当前分支与远程同步且
工作区干净。
