## 变更摘要 / Summary

<!-- 说明改了什么以及为什么。Describe what changed and why. -->

## 关联 Issue / Related issue

Closes #

## 变更类型 / Change type

- [ ] 功能 / Feature
- [ ] 修复 / Bug fix
- [ ] 文档 / Documentation
- [ ] 重构 / Refactor
- [ ] 测试、构建或 CI / Test, build, or CI

## 影响范围 / Affected variants

- [ ] 普通兼容版 / Standard
- [ ] Realms 兼容版 / Realms
- [ ] BDS 增强版 / BDS enhanced
- [ ] 独立 Backrooms / Standalone Backrooms
- [ ] 仅文档或工具 / Documentation or tooling only

## 验证 / Validation

请勾选实际执行过的项目，并在下方说明结果。Check only commands you actually ran and describe the result below.

- [ ] `npm run check`
- [ ] `npm run build:standard`
- [ ] `npm run build:realms`
- [ ] `npm run verify:realms-build`
- [ ] `npm run build:bds-admin`
- [ ] `npm run build:backrooms`

测试结果 / Test results:

<!-- 粘贴简短结果，或说明为什么某项不适用。Paste a concise result or explain why a check is not applicable. -->

游戏内测试 / In-game testing:

<!-- 写明版本、环境和结果；未测试请明确写“未测试 / Not tested”。 -->

## 截图 / Screenshots

<!-- UI、材质或其他视觉变化请提供截图。Add screenshots for UI, texture, or other visual changes. -->

## 兼容性与迁移 / Compatibility and migration

- [ ] 没有破坏性变更 / No breaking change
- [ ] 包含破坏性变更，已在下方说明 / Contains a breaking change documented below
- [ ] 不需要数据或配置迁移 / No data or configuration migration
- [ ] 需要迁移，已在下方说明 / Migration is required and documented below

说明 / Notes:

## 提交者确认 / Contributor confirmation

- [ ] PR 标题符合 `<type>(<optional-scope>): <subject>`。
- [ ] 没有提交密钥、令牌、真实服务器地址、私有服务器配置或玩家隐私数据。
- [ ] 没有提交 `.env`、`node_modules/`、`dist/`、`out/` 或打包产物。
- [ ] 我有权按照项目许可提供原创改动，并已记录第三方素材的来源与再分发条款。

- [ ] The PR title follows `<type>(<optional-scope>): <subject>`.
- [ ] No secrets, tokens, real server addresses, private server configuration, or player data are included.
- [ ] No `.env`, `node_modules/`, `dist/`, `out/`, or packaged artifacts are included.
- [ ] I may contribute my original changes under the project license, and third-party sources and redistribution terms are documented.

维护者会使用 Squash merge。PR 标题将成为 `main` 中的最终提交标题，开发过程中的每个 commit 不需要单独符合格式。

Maintainers use squash merge. The PR title becomes the final commit title on `main`; individual work-in-progress commits do not need to follow the format.
