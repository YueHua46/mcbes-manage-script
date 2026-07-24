# 苦力怕菜单公开发布整备 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前仓库整理为可公开发布、禁止商业使用、可复现构建且具有统一苦力怕品牌形象的源码公开项目。

**Architecture:** 保持现有行为包、资源包与业务模块边界不变，仅在发布元数据、构建入口、质量门禁、仓库卫生和对外品牌层进行定向修复。运行时 `sm.png` 作为不可变品牌源，包图标与 README 横幅由确定性合成脚本生成。

**Tech Stack:** TypeScript、Node.js 18+、Minecraft Bedrock Script API、Node test runner、ESLint、Pillow、GitHub Actions。

## Global Constraints

- 许可证固定为 PolyForm Noncommercial License 1.0.0。
- 不修改 `resource_packs/CreeperMenu/textures/items/sm.png`。
- 所有 DOVA 音乐及其备份、署名记录必须保留，不删除、不替换、不改名、不重新压缩。
- 所有二次元角色资源必须保留，包括欢迎字形、设计源图、最终图、假人皮肤、实体映射和说明文档；不删除、不替换、不改名、不重新压缩。
- 不修改现有菜单功能图标与 Backrooms 运行时资源。
- 不执行大规模业务架构拆分。
- 所有删除目标必须先通过引用搜索与产物检查。

---

### Task 1: 发布契约与仓库卫生

**Files:**
- Create: `LICENSE`
- Create: `THIRD_PARTY_NOTICES.md`
- Create: `.env.example`
- Modify: `.gitignore`
- Test: `tests/public-release-readiness.test.cjs`

**Interfaces:**
- Produces: 可机器检查的许可证、第三方声明、环境模板和忽略规则。

- [ ] 编写失败测试，验证许可证名称、README 非商业定位、非官方声明、环境模板和禁止跟踪目录。
- [ ] 运行 `node --test tests/public-release-readiness.test.cjs`，确认因文件缺失或旧文案失败。
- [ ] 添加发布契约文件并保守移除 `.vs/`、`error.log`、`docs.txt`；保留全部 DOVA 音乐、音乐备份和二次元角色资源。
- [ ] 重新运行发布整备测试并确认通过。

### Task 2: 构建与跨平台修复

**Files:**
- Modify: `just.config.ts`
- Modify: `package.json`
- Rename: `scripts/Events/` to `scripts/events/`
- Remove: 未被入口或测试引用的旧事件转发文件
- Modify: `tsconfig.json`
- Test: `tests/build-tooling-readiness.test.cjs`

**Interfaces:**
- Produces: `npm test`、`npm run typecheck`、`npm run check`；lint/build 不要求本机部署路径。

- [ ] 编写失败测试，验证脚本集合、目录大小写和构建配置不在模块加载阶段强制读取部署路径。
- [ ] 运行测试确认失败。
- [ ] 两阶段 `git mv` 规范化事件目录，更新引用并删除确认无引用的旧入口。
- [ ] 将部署目录读取延迟到部署任务执行期，补齐 npm 质量脚本。
- [ ] 修复依赖类型/本地声明与 TypeScript 配置，使类型检查通过。
- [ ] 运行新测试、lint、typecheck 和现有测试。

### Task 3: 品牌资源

**Files:**
- Create: `tools/build-brand-assets.py`
- Create: `docs/images/creeper-menu-banner.png`
- Replace: `resource_packs/CreeperMenu/pack_icon.png`
- Create: `behavior_packs/CreeperMenu/pack_icon.png`
- Test: `tests/brand-assets.test.cjs`

**Interfaces:**
- Consumes: 原始 `sm.png`。
- Produces: 两个 256×256 包图标和一个 README 横幅；构建脚本不得写回 `sm.png`。

- [ ] 编写失败测试，验证尺寸、PNG 格式、两个包图标一致、横幅存在以及 `sm.png` 哈希不变。
- [ ] 运行测试确认失败。
- [ ] 使用现有菜单道具作为中心像素图，生成单层绿色主框、深绿背景和角落装饰。
- [ ] 生成无二次元内容的 README 横幅，使用确定性字体排版。
- [ ] 运行品牌测试并视觉检查 256×256 图标与横幅。

### Task 4: README 与 CI

**Files:**
- Rewrite: `README.md`
- Create: `.github/workflows/ci.yml`
- Modify: `package-lock.json`
- Test: `tests/public-release-readiness.test.cjs`

**Interfaces:**
- Consumes: Task 1 的许可证与 Task 3 的横幅。
- Produces: 面向使用者和贡献者的项目首页及自动质量门禁。

- [ ] 扩展失败测试，验证横幅、安装、兼容性、构建变体、测试命令、许可证、第三方素材与非官方声明。
- [ ] 重写 README，将 Backrooms 细节压缩为专题文档链接。
- [ ] 添加 Node.js 18/20 CI，执行安装、发布守护测试、现有测试、lint、typecheck 和两种构建。
- [ ] 更新 lockfile 元数据并运行 README/CI 守护测试。

### Task 5: 全量验证

**Files:**
- Review all changed files

**Interfaces:**
- Produces: 可公开发布的验证证据。

- [ ] 运行 `npm ci`。
- [ ] 运行 `npm test`。
- [ ] 运行 `npm run lint`。
- [ ] 运行 `npm run typecheck`。
- [ ] 运行 `npm run build:standard` 和 `npm run build:bds-admin`。
- [ ] 重新运行品牌生成脚本并验证工作树没有非预期差异。
- [ ] 检查 `git status`、`git diff --check`、删除文件引用和最终 README 链接。
