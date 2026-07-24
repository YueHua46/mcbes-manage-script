# 三版本附加包自动发布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用一个统一版本源构建普通兼容版、Realms 兼容版和 BDS 增强版，并在合法 `v*` tag 上自动创建带三个中文附件的 GitHub Release。

**Architecture:** `release.config.json` 是 CreeperMenu 发行版本和 Minecraft 精确构建基线的唯一来源，`tools/release-metadata.cjs` 负责版本同步、衍生名称、tag 校验和包内容校验。现有 just-scripts 继续完成单变体打包，GitHub Actions 用三项矩阵隔离构建，并仅在合法 tag 或指向合法 tag 的手动重跑中授予最终 job 发布权限。

**Tech Stack:** Node.js 22、CommonJS、Node test runner、TypeScript/just-scripts、GitHub Actions、GitHub CLI。

## Global Constraints

- CreeperMenu 当前统一发行版本采用 `3.2.13`，所有 BP/RP header 和 module version、根 `package.json` 必须一致。
- Minecraft 精确构建基线保持 `1.26.30`，面向用户的兼容族必须由工具推导为 `1.26.3x`。
- 最终附件名称必须分别包含“普通兼容版”“Realms兼容版”“BDS增强版”。
- Backrooms 继续使用独立版本，不能被版本同步命令修改，也不能进入 CreeperMenu Release。
- 普通 push/PR 构建三个短期 artifact；只有匹配统一版本的 `v*` tag 才能创建 Release。
- CI 发布前必须通过现有质量检查、三变体构建、Realms 无 GameTest 检查和包内容检查。

---

### Task 1: 发行元数据与统一版本

**Files:**
- Create: `release.config.json`
- Create: `tools/release-metadata.cjs`
- Create: `tests/release-metadata.test.cjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `behavior_packs/CreeperMenu/manifest.json`
- Modify: `behavior_packs/CreeperMenu/manifest.standard.json`
- Modify: `behavior_packs/CreeperMenu/manifest.debug.json`
- Modify: `behavior_packs/CreeperMenu/manifest.realms.json`
- Modify: `behavior_packs/CreeperMenu/manifest.bds.json`
- Modify: `resource_packs/CreeperMenu/manifest.json`

**Interfaces:**
- Consumes: JSON manifests and `{ "version": string, "minecraftVersion": string }`.
- Produces: `loadReleaseConfig()`, `minecraftFamily(version)`, `artifactFilename(variant, config)`, `releaseTitle(config)`, `assertVersions(config)`, `syncVersion(version)`, and CLI commands `check`, `sync`, `print`.

- [ ] **Step 1: Write failing metadata tests**

Test exact derivation, invalid versions, all three Chinese names, version consistency, and the fact that Backrooms remains `1.0.0`. Use:

```js
const {
  loadReleaseConfig,
  minecraftFamily,
  artifactFilename,
  releaseTitle,
  assertVersions,
} = require("../tools/release-metadata.cjs");

assert.equal(minecraftFamily("1.26.30"), "1.26.3x");
assert.equal(
  artifactFilename("standard", { version: "3.2.13", minecraftVersion: "1.26.30" }),
  "CreeperMenu-v3.2.13-MCBE-1.26.3x-普通兼容版.mcaddon",
);
assert.throws(() => minecraftFamily("1.26"), /三段数字/);
assert.doesNotThrow(() => assertVersions(loadReleaseConfig()));
```

- [ ] **Step 2: Run RED**

Run: `node --test tests/release-metadata.test.cjs`

Expected: FAIL because `release.config.json` and `tools/release-metadata.cjs` do not exist.

- [ ] **Step 3: Add the canonical config and metadata functions**

Create:

```json
{
  "version": "3.2.13",
  "minecraftVersion": "1.26.30"
}
```

Implement strict `/^\d+\.\d+\.\d+$/` validation. Derive the family by replacing the final decimal digit of the patch component with `x`. Map only:

```js
const VARIANTS = {
  standard: "普通兼容版",
  realms: "Realms兼容版",
  bds: "BDS增强版",
};
```

`print` supports `version`, `tag`, `minecraft-family`, `release-title`, and
`filename <variant>`. `check --tag v3.2.13` additionally requires exact tag
equality. `sync 3.2.14` updates the canonical config, root package files and
every CreeperMenu manifest version, but never reads or writes Backrooms
manifests.

- [ ] **Step 4: Synchronize current project metadata**

Set root package version and every CreeperMenu header/module version to
`3.2.13`, update `package-lock.json` root metadata, then run:

Run: `node tools/release-metadata.cjs check`

Expected: `发行元数据检查通过：v3.2.13 / MCBE 1.26.3x`.

- [ ] **Step 5: Run GREEN and complete checks**

Run: `node --test tests/release-metadata.test.cjs && npm run typecheck`

Expected: all metadata tests pass and TypeScript reports no errors.

- [ ] **Step 6: Commit**

```bash
git add release.config.json tools/release-metadata.cjs tests/release-metadata.test.cjs package.json package-lock.json behavior_packs/CreeperMenu resource_packs/CreeperMenu/manifest.json
git commit -m "feat: 统一苦力怕菜单发行版本"
```

### Task 2: 三变体中文产物与包内容验证

**Files:**
- Modify: `just.config.ts`
- Modify: `package.json`
- Modify: `tools/release-metadata.cjs`
- Create: `tests/release-packaging.test.cjs`

**Interfaces:**
- Consumes: `artifactFilename(variant, config)` and the three existing single-variant build pipelines.
- Produces: `npm run mcaddon:release`, CLI command `verify-package <variant> <path>`, and exactly three named CreeperMenu packages.

- [ ] **Step 1: Write failing packaging contract tests**

Assert `just.config.ts` reads `release.config.json`, all three output paths use
the metadata filenames, `mcaddon:release` exists and excludes
`package:backrooms`. Add unit tests for variant dependency rules:

```js
assert.deepEqual(expectedModules("standard"), [
  "@minecraft/server",
  "@minecraft/server-ui",
  "@minecraft/server-gametest",
]);
assert.deepEqual(expectedModules("realms"), [
  "@minecraft/server",
  "@minecraft/server-ui",
]);
assert.ok(expectedModules("bds").includes("@minecraft/server-admin"));
```

- [ ] **Step 2: Run RED**

Run: `node --test tests/release-packaging.test.cjs`

Expected: FAIL because the release task and package verifier are absent.

- [ ] **Step 3: Make just-scripts consume canonical names**

Load and validate `release.config.json` at configuration time. Replace the
three public package output names with `artifactFilename`-equivalent names,
while leaving debug and Backrooms names unchanged. Add:

```ts
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
```

Add package script:

```json
"release:check": "node tools/release-metadata.cjs check",
"release:sync": "node tools/release-metadata.cjs sync",
"mcaddon:release": "just-scripts mcaddon:release"
```

- [ ] **Step 4: Implement archive verification**

Run `npm install --save-dev yauzl@3.4.0` so the ZIP reader is an explicit,
locked development dependency rather than an undeclared transitive import.
`verify-package` must open the `.mcaddon`, locate one CreeperMenu BP manifest
and one RP manifest, require both versions to equal the canonical version,
then validate the BP dependency set for `standard`, `realms`, or `bds`.
Reject a missing/duplicate manifest and any Backrooms manifest.

- [ ] **Step 5: Run GREEN and build real packages**

Run:

```bash
node --test tests/release-packaging.test.cjs
npm run mcaddon:release
node tools/release-metadata.cjs verify-package standard "dist/packages/CreeperMenu-v3.2.13-MCBE-1.26.3x-普通兼容版.mcaddon"
node tools/release-metadata.cjs verify-package realms "dist/packages/CreeperMenu-v3.2.13-MCBE-1.26.3x-Realms兼容版.mcaddon"
node tools/release-metadata.cjs verify-package bds "dist/packages/CreeperMenu-v3.2.13-MCBE-1.26.3x-BDS增强版.mcaddon"
```

Expected: tests pass, exactly three release packages are generated, and each
verifier prints its matching variant.

- [ ] **Step 6: Commit**

```bash
git add just.config.ts package.json package-lock.json tools/release-metadata.cjs tests/release-packaging.test.cjs
git commit -m "feat: 生成三版本中文发行产物"
```

### Task 3: GitHub Actions 构建与 Release

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `tests/release-workflow.test.cjs`
- Modify: `tools/release-metadata.cjs`

**Interfaces:**
- Consumes: `release:check`, the three single-variant packaging commands,
  `verify-package`, and metadata `print` commands.
- Produces: PR/push workflow artifacts and a tag-gated GitHub Release with
  three Chinese `.mcaddon` attachments.

- [ ] **Step 1: Write failing workflow tests**

Read `.github/workflows/ci.yml` as text and assert:

```js
assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /release_tag:/);
assert.match(workflow, /matrix:/);
assert.match(workflow, /variant:\s*\\[standard, realms, bds\\]/);
assert.match(workflow, /actions\\/upload-artifact@v4/);
assert.match(workflow, /retention-days:\s*14/);
assert.match(workflow, /permissions:\s*\\n\\s*contents:\s*write/);
assert.match(workflow, /gh release upload/);
assert.match(workflow, /--clobber/);
```

Also require that the release job depends on both verify and package and has
a tag/manual condition; reject any workflow-level `contents: write`.

- [ ] **Step 2: Run RED**

Run: `node --test tests/release-workflow.test.cjs`

Expected: FAIL because the existing workflow has only one verify job.

- [ ] **Step 3: Add checkout-ref and release-note metadata**

Extend the CLI with `notes`, which prints Markdown containing the three
Chinese environment explanations, exact baseline `1.26.30`, compatible
family `1.26.3x`, and an installation warning. Keep generated GitHub notes
enabled when creating the Release; pass the generated project guidance through
`--notes` so GitHub prepends it to the automatically generated commit history.

- [ ] **Step 4: Replace CI with gated matrix workflow**

Configure `push`, `pull_request`, and a required `workflow_dispatch.release_tag`.
For manual runs, checkout the input tag; otherwise checkout `github.ref`.
The verify job runs `npm ci`, Python setup, `npm run release:check` with the
tag when publishing, `npm run check`, and the standalone Backrooms build.

The package matrix uses three include rows mapping variants to
`mcaddon:standard`, `mcaddon:realms`, and `mcaddon:bds`; it verifies the exact
metadata filename and uploads `creeper-menu-<variant>` for 14 days.

The final release job:

```yaml
permissions:
  contents: write
steps:
  - uses: actions/download-artifact@v4
    with:
      pattern: creeper-menu-*
      path: release-files
      merge-multiple: true
  - run: |
      if gh release view "$RELEASE_TAG" >/dev/null 2>&1; then
        gh release upload "$RELEASE_TAG" release-files/*.mcaddon --clobber
      else
        RELEASE_NOTES="$(node tools/release-metadata.cjs notes)"
        gh release create "$RELEASE_TAG" release-files/*.mcaddon \
          --verify-tag --title "$RELEASE_TITLE" --notes "$RELEASE_NOTES" \
          --generate-notes
      fi
```

Before this step, check that the three exact configured files and no fourth
`.mcaddon` exist.

- [ ] **Step 5: Run GREEN**

Run: `node --test tests/release-workflow.test.cjs tests/release-metadata.test.cjs tests/release-packaging.test.cjs`

Expected: all workflow and release contract tests pass.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml tools/release-metadata.cjs tests/release-workflow.test.cjs
git commit -m "ci: 自动构建并发布三版本附加包"
```

### Task 4: 用户文档与完整回归

**Files:**
- Modify: `README.md`
- Modify: `tests/public-release-readiness.test.cjs`

**Interfaces:**
- Consumes: all release commands and names from Tasks 1–3.
- Produces: maintainers' version/tag release procedure and users' Chinese
  three-variant download guidance.

- [ ] **Step 1: Write failing documentation assertions**

Require README to contain:

```js
for (const text of [
  "CreeperMenu-v3.2.13-MCBE-1.26.3x-普通兼容版.mcaddon",
  "CreeperMenu-v3.2.13-MCBE-1.26.3x-Realms兼容版.mcaddon",
  "CreeperMenu-v3.2.13-MCBE-1.26.3x-BDS增强版.mcaddon",
  "npm run release:sync -- 3.2.14",
  "git tag v3.2.14",
  "1.26.30",
  "1.26.3x",
]) assert.match(readme, new RegExp(escapeRegExp(text)));
```

- [ ] **Step 2: Run RED**

Run: `node --test tests/public-release-readiness.test.cjs`

Expected: FAIL on missing automatic release guidance and filenames.

- [ ] **Step 3: Update README**

Replace the statement that CI does not publish Releases. Document the three
Chinese filenames and choices, explain exact baseline versus compatible
family, and provide the five release steps from the design. Explicitly state
that Backrooms remains independently versioned and is absent from this
Release.

- [ ] **Step 4: Run focused and complete verification**

Run:

```bash
npm run check
npm run release:check
npm run mcaddon:release
npm run verify:realms-build
npm run build:backrooms
git diff --check
git status --short
```

Expected: all checks/builds pass; `dist/packages` contains the three exact
CreeperMenu filenames; source `manifest.json` equals
`manifest.standard.json`; Git status contains only intended source, workflow,
test and documentation changes and no generated packages.

- [ ] **Step 5: Commit**

```bash
git add README.md tests/public-release-readiness.test.cjs
git commit -m "docs: 补充三版本自动发布说明"
```

- [ ] **Step 6: Final branch review**

Run:

```bash
git log --oneline main..HEAD
git diff --stat main...HEAD
git status --short
```

Expected: design, plan, metadata, packaging, CI and documentation commits are
present; the worktree is clean.
