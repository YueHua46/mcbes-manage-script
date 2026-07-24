# 贡献指南 / Contributing Guide

感谢你愿意改进苦力怕菜单。为了让问题更容易复现、让 Pull Request 更容易审查，请先阅读下面的流程。

Thank you for improving Creeper Menu. Please follow this workflow so reports are reproducible and pull requests are easy to review.

## 选择正确的入口 / Choose the right channel

- 可复现的错误请提交 [Bug Issue](https://github.com/YueHua46/mcbes-manage-script/issues/new/choose)。
- 已经比较明确、可以实施的功能建议请提交 Feature Issue。
- 安装、配置、使用求助和早期想法请前往 [GitHub Discussions](https://github.com/YueHua46/mcbes-manage-script/discussions)。
- 安全漏洞必须按照 [安全政策](SECURITY.md) 私密报告，不要创建公开 Issue。

- Use a [Bug Issue](https://github.com/YueHua46/mcbes-manage-script/issues/new/choose) for reproducible defects.
- Use a Feature Issue for a reasonably scoped, actionable proposal.
- Use [GitHub Discussions](https://github.com/YueHua46/mcbes-manage-script/discussions) for setup, configuration, support, and early ideas.
- Report vulnerabilities privately according to the [Security Policy](SECURITY.md), never in a public issue.

提交前请先搜索现有 Issue 和 Discussion。较大的功能最好先讨论并得到维护者认可，再开始实现。

Search existing Issues and Discussions first. For a substantial feature, discuss the design with maintainers before investing in an implementation.

## 贡献流程 / Contribution workflow

1. Fork 本仓库，从最新的 `main` 创建一个短生命周期分支。
2. 一个分支只处理一个清晰的问题，避免夹带无关重构。
3. 添加或更新测试，并完成下方的质量检查。
4. 提交 Pull Request，填写模板并关联 Issue，例如 `Closes #123`。
5. 根据审查意见更新同一个分支；不要求整理每一个开发中的 commit。
6. 维护者使用 Squash merge，因此进入 `main` 的一个 PR 对应一个提交。

1. Fork the repository and create a short-lived branch from the latest `main`.
2. Keep one focused change per branch and avoid unrelated refactors.
3. Add or update tests and run the checks below.
4. Open a pull request, complete the template, and link the issue, for example `Closes #123`.
5. Push review updates to the same branch. Work-in-progress commits do not need to follow the final format.
6. Maintainers use squash merge, so one PR becomes one commit on `main`.

## 开发环境 / Development setup

需要 Node.js `20.19+`、`22.13+` 或 `24+`、npm，以及用于素材测试的 Python 3.11+。

Node.js `20.19+`, `22.13+`, or `24+`, npm, and Python 3.11+ for asset tests are required.

```bash
npm ci
python3 -m pip install -r requirements-dev.txt
cp .env.example .env
```

不要提交 `.env`。普通代码检查与构建不需要填写本地部署路径。

Do not commit `.env`. Local deployment paths are not required for normal checks and builds.

## 检查与测试 / Checks and tests

所有代码变更至少运行：

Run at least the following for every code change:

```bash
npm run check
```

根据影响范围运行对应构建；跨平台或公共代码变化应运行全部命令：

Run the affected builds. Changes to shared or cross-platform code should run all commands:

```bash
npm run build:standard
npm run build:realms
npm run verify:realms-build
npm run build:bds-admin
npm run build:backrooms
```

如果无法进行游戏内手动测试，请在 PR 中明确说明未测试的环境，不要猜测结果。

If in-game testing is unavailable, explicitly list the untested environments in the PR instead of guessing the result.

## PR 标题 / Pull request titles

PR 标题使用 Conventional Commits 风格：

Pull request titles follow Conventional Commits:

```text
<type>(<optional-scope>): <subject>
```

允许的类型 / Allowed types:

- `feat`：功能 / feature
- `fix`：修复 / bug fix
- `docs`：文档 / documentation
- `refactor`：重构 / refactoring
- `test`：测试 / tests
- `build`：构建或依赖 / build or dependencies
- `ci`：持续集成 / continuous integration
- `chore`：维护 / maintenance
- `perf`：性能 / performance
- `style`：不影响行为的格式调整 / formatting without behavior changes
- `revert`：撤销 / revert

Scope 可选且没有强制清单。Subject 可以使用中文或英文，应当具体，并且不要以句号结尾。破坏性变更在类型或 scope 后加 `!`。

Scope is optional and unrestricted. The subject may be Chinese or English, must be specific, and must not end with a period. Add `!` after the type or scope for a breaking change.

```text
feat(shop): 添加批量购买
fix(land): 修复领地成员权限判断
docs: add Realms installation notes
feat(database)!: 调整玩家数据结构
```

只校验 PR 标题，不校验贡献者的每一个中间 commit。

Only the PR title is validated; individual work-in-progress commits are not.

## 资源、隐私与许可 / Assets, privacy, and licensing

本仓库使用 [PolyForm Noncommercial License 1.0.0](LICENSE)，属于 source-available（源码可用）项目，而不是 OSI 定义的开源软件。提交贡献即表示你有权按照该许可证提供原创部分；第三方内容仍适用各自条款。

This repository uses the [PolyForm Noncommercial License 1.0.0](LICENSE). It is source-available rather than OSI-approved open source. By contributing, you confirm that you may provide your original work under that license; third-party material keeps its own terms.

请勿提交：

Do not commit:

- 无权再分发的代码、模型、图片、音频、字体或其他素材；
- 密钥、令牌、真实服务器地址、服务器配置或玩家隐私数据；
- `.env`、`node_modules/`、`dist/`、`out/` 或打包产物；
- 未在 [第三方声明](THIRD_PARTY_NOTICES.md) 中正确记录来源与许可的素材。

- code, models, images, audio, fonts, or other assets you cannot redistribute;
- secrets, tokens, real server addresses, server configuration, or player data;
- `.env`, `node_modules/`, `dist/`, `out/`, or packaged artifacts;
- third-party assets without correct source and license details in [Third-Party Notices](THIRD_PARTY_NOTICES.md).
