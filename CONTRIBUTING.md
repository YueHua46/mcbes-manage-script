# 贡献指南

感谢你愿意参与苦力怕菜单的开发与改进。

## 开始之前

- Bug、兼容性问题和功能建议请优先通过对应的 Issue 模板提交。
- 涉及权限绕过、物品复制、经济刷取、黑名单绕过或数据破坏的问题，请按照 [SECURITY.md](SECURITY.md) 私下报告。
- 大型功能建议建议先创建 Issue，确认方向后再提交 PR。

## 开发环境

- Node.js 18+
- npm
- Minecraft Bedrock 1.26.x 测试环境
- 测试 BDS 增强版时，需要可使用 `@minecraft/server-admin` 与 `@minecraft/server-net` 的 BDS 环境

```bash
npm install
npm run lint
npx tsc --noEmit
npm run build
npm run build:bds-admin
```

## 分支与提交

- 从 `main` 创建独立分支。
- 一个 PR 尽量只解决一个主题。
- 提交信息应简洁说明改动，例如 `fix: 修复领地边界判断`。
- 不要提交无关格式化、构建产物或本地配置文件。

## Pull Request 要求

PR 描述至少说明：

1. 改了什么，以及为什么要改。
2. 影响的模块和运行环境。
3. 普通兼容版与 BDS 增强版分别是否受影响。
4. 使用过的验证命令和实际游戏测试场景。
5. 是否涉及数据结构、动态属性、配置项或升级兼容。
6. 用户可见行为变化时，是否同步更新文档。

## 代码与结构约定

- 新功能优先放入 `scripts/features/<feature-name>/`。
- 跨模块通用能力放入 `scripts/shared/`，避免功能模块互相直接依赖内部实现。
- 平台差异通过现有能力检测与标准版/BDS 入口隔离。
- 配置关闭的模块不应继续执行不必要的高频事件或轮询。
- 避免新增 `any`；公共接口应有明确类型。

## 文档贡献

用户文档位于 `docs/`。文档应优先回答服主实际使用问题，并明确区分本地世界、Realms 与 BDS。