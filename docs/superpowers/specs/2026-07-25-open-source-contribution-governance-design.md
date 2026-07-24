# 开源贡献治理设计

日期：2026-07-25

## 目标

为“苦力怕菜单”建立一套中英双语、低门槛且可自动执行的贡献流程：

- 让新贡献者快速判断应当提交 Issue、Discussion 还是 Pull Request。
- 让 Bug 报告包含 Minecraft 基岩版版本、部署环境和复现信息。
- 让进入 `main` 的提交历史保持统一的 Conventional Commits 格式。
- 保留维护者对合并和发布节奏的控制，不要求贡献者整理每一个中间 commit。

## 总体方案

采用“适度自动化”治理：

1. 用 `CONTRIBUTING.md` 说明开发环境、贡献步骤、质量检查和标题规范。
2. 用 GitHub Issue Forms 分别收集 Bug 和功能建议。
3. 将安装、配置和使用求助引导到 GitHub Discussions，并关闭空白 Issue。
4. 用 PR 模板要求贡献者说明变更、测试和兼容范围。
5. 用 GitHub Actions 校验 PR 标题，不校验 PR 内每一个 commit。
6. 仓库只使用 Squash merge，并让合并提交默认采用 PR 标题。
7. 增加行为准则与安全报告政策。
8. 在 README 中加入贡献和支持入口，但实施时必须保留当前工作区已有的 README 修改。

暂不加入自动发版、Stale Bot、逐 commit 校验、强制 scope 清单和复杂自动标签。贡献量增长后再评估这些能力。

## 贡献入口

### Bug Issue Form

Bug 表单使用中英双语字段，要求：

- 提交前确认已搜索现有 Issue，并确认问题可在最新版本复现。
- 项目版本或 commit。
- Minecraft 基岩版版本。
- 部署环境：本地世界、Realms、普通 BDS 或 BDS 增强版。
- 使用的构建变体：普通兼容版、Realms 兼容版、BDS 增强版或独立 Backrooms。
- 问题描述、复现步骤、预期结果、实际结果。
- 相关日志、截图或视频。
- 可选的补充信息。

新 Issue 自动添加 `bug` 与 `needs-triage` 标签。实施前应确认标签存在；若标签不存在，则创建标签或从模板中移除自动标签，不能留下失效配置。

### Feature Issue Form

功能建议表单要求：

- 提交前搜索已有 Issue。
- 描述要解决的问题和具体使用场景。
- 描述建议方案、可接受的替代方案和影响范围。
- 选择影响的构建变体或模块。
- 说明是否愿意提交实现 PR。

新 Issue 自动添加 `enhancement` 与 `needs-triage` 标签，并遵循与 Bug 表单相同的标签存在性检查。

### Issue 配置与 Discussions

- 禁止创建空白 Issue。
- 提供“使用问题 / Questions & Support”链接，指向仓库 Discussions。
- 提供“安全漏洞 / Security Vulnerability”链接，指向安全政策或 GitHub 私密漏洞报告入口。
- Discussions 建议启用 `Q&A`、`Ideas` 和 `Show and tell` 分类。
- Issue 只追踪可以执行、复现和关闭的工作。

## Pull Request 流程

PR 模板包含：

- 变更摘要。
- 关联 Issue（推荐使用 `Closes #123`）。
- 变更类型。
- 影响的运行环境与构建变体。
- 已执行的测试及结果。
- 游戏内手动测试说明；若未测试，必须明确写出。
- UI、资源或视觉变更的截图。
- 破坏性变更、数据迁移和兼容性检查。
- 提交者确认未提交密钥、服务器地址、玩家隐私数据或无权再分发的素材。

维护者在合并前确认 CI、PR 标题、授权和测试信息。合并策略为 Squash merge，使一个 PR 在 `main` 中形成一个提交。

## PR 标题规则

格式：

```text
<type>(<optional-scope>): <subject>
```

允许类型：

- `feat`：新增功能。
- `fix`：修复问题。
- `docs`：仅文档变化。
- `refactor`：不改变外部行为的代码重构。
- `test`：新增或修改测试。
- `build`：构建系统或依赖变化。
- `ci`：持续集成变化。
- `chore`：其他维护工作。
- `perf`：性能优化。
- `style`：不影响行为的格式调整。
- `revert`：撤销已有变更。

Scope 可选且不限制固定清单。Subject 可以使用中文或英文，但必须清楚、具体，且标题不能以句号结尾。

示例：

```text
feat(shop): 添加批量购买
fix(land): 修复领地成员权限判断
docs: add Realms installation notes
ci: 校验 Pull Request 标题
```

破坏性变更使用 `!`：

```text
feat(database)!: 调整玩家数据结构
```

校验工作流使用 `amannn/action-semantic-pull-request` 的固定主版本，监听来自 fork 的 PR，并仅授予读取 PR 所需的最小权限。校验应在 PR 创建、重新打开、编辑和更新提交时运行。

## 项目政策文件

### CONTRIBUTING

中英双语贡献指南覆盖：

- Issue、Discussion 和 PR 的用途。
- Fork、建分支、安装依赖和提交 PR 的流程。
- Node.js、Python 和依赖安装要求。
- `npm run check`、各构建变体和必要手动测试。
- PR 标题规则和 Squash merge 行为。
- 资源、音频、图片、第三方代码与许可证要求。
- 不应提交生成目录、本机 `.env`、服务器配置或玩家数据。

### CODE_OF_CONDUCT

采用 Contributor Covenant 2.1，并提供中英双语说明。项目当前没有公开的维护者邮箱，因此行为事件通过 GitHub 对相关 Issue、评论或用户提供的内容举报功能提交；不得要求贡献者在公开 Issue 中披露骚扰或其他敏感细节。

### SECURITY

说明支持的版本范围和私密报告方式。安全漏洞、真实服务器地址、凭据和玩家隐私数据不得通过公开 Issue 报告。仓库启用 GitHub Private Vulnerability Reporting，`SECURITY.md` 直接链接到 `https://github.com/YueHua46/mcbes-manage-script/security/advisories/new`。

## GitHub 仓库设置

文件提交后，维护者需要在 GitHub 设置中完成：

- 启用 Discussions。
- 启用 Private Vulnerability Reporting。
- 仅保留 Squash merging。
- 将 Squash commit 默认标题设为 Pull Request title。
- 为 `main` 配置规则集或分支保护：
  - 必须通过现有 `CI / verify`。
  - 必须通过新的 PR 标题校验。
  - 禁止直接强制推送和删除。
  - 单人维护阶段不强制批准次数，避免维护者无法合并；增加协作者后再启用至少一次批准。
- 确认 Issue Forms 引用的标签存在。

这些设置无法仅靠仓库文件完整表达，实施结果中应提供一份明确的手动设置清单。

## 验证

实施后执行以下检查：

1. 解析所有 YAML 文件，确认语法有效。
2. 运行 `npm run check`，确认现有代码质量门禁未受影响。
3. 检查 Issue Forms 必需字段、链接和标签引用。
4. 用有效与无效标题样例检查 PR 标题正则及 Action 配置。
5. 检查 README、CONTRIBUTING、PR 模板、CODE_OF_CONDUCT 和 SECURITY 之间的链接。
6. 检查 git diff，确认没有覆盖工作区已有的 README 和 Changelog 修改。

## 成功标准

- 新贡献者从 README 可以找到贡献指南、Discussions 和安全报告方式。
- Bug 与功能建议通过结构化表单提交，普通求助不会进入 Issue 列表。
- PR 模板覆盖测试、兼容环境、授权和隐私检查。
- 不合规 PR 标题会产生清晰的 CI 失败信息。
- 合并后的 `main` 历史可以稳定用于人工或未来自动生成 Changelog。
- 现有 CI、构建流程和用户未提交改动保持完好。
