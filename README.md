# 杜绝熊孩服务器插件

Minecraft 基岩版（Bedrock）服务器管理插件，基于 Script API（SAPI）构建。支持 **1.26.x** 引擎（manifest `min_engine_version: [1, 26, 0]`）。

## 构建变体

项目提供两种 `.mcaddon` 产物，按需选用：

| 变体 | 构建命令 | 适用环境 | 额外依赖 |
|------|----------|----------|----------|
| **普通兼容版** | `npm run mcaddon` / `npm run build:standard` | 本地存档、BDS、Realms 领域服 | `@minecraft/server`、`@minecraft/server-ui` |
| **BDS 增强版** | `npm run mcaddon:bds` / `npm run build:bds-admin` | 仅 BDS 专用服务器 | 额外 `@minecraft/server-admin`、`@minecraft/server-net` |

**差异摘要：**

- 普通兼容版：不含 BDS 专属模块，可在 Realms / 本地世界运行；黑名单进服前拦截、XUID 查询、HTTP 出站不可用。
- BDS 增强版：支持黑名单进服前拦截（`asyncPlayerJoin`）、XUID 解析（`server-net` HTTP）、完整黑名单管理 UI。

同时产出两个包：`npm run mcaddon:all`

## 功能矩阵

| 模块 | 说明 | 普通版 | BDS 增强版 |
|------|------|:------:|:----------:|
| 自定义命令 | SAPI `CustomCommandRegistry`，权限与参数校验 | ✓ | ✓ |
| 玩家传送 / TPA | 玩家互传、坐标传送、随机传送 | ✓ | ✓ |
| 领地系统 | 创建/管理/权限/粒子边界/快照分片 | ✓ | ✓ |
| PVP 系统 | 竞技场、统计、效果管理 | ✓ | ✓ |
| 经济系统 | 金币、官方商店、拍卖行、红包、怪物击杀奖励 | ✓ | ✓ |
| 公会系统 | 创建/成员/金库/权限 facade 缓存 | ✓ | ✓ |
| 路点系统 | 个人/公共路点、传送倒计时 | ✓ | ✓ |
| 玩家行为日志 | 聊天/交互/伤害/物品监控、日志检视器 | ✓ | ✓ |
| 防刷物品 | Bundle 守卫、方块白名单、库存访问拦截 | ✓ | ✓ |
| 黑名单 | 名字 / persistentId / xuid 三层匹配 | — | ✓ |
| 进服前拦截 | `asyncPlayerJoin` 拒绝封禁玩家 | — | ✓ |
| 服务器实时面板 | CustomForm + Observable，不支持时降级 ActionForm | ✓ | ✓ |
| 试玩模式 / 在线时长 / 数据统计 | 服主管理面板子模块 | ✓ | ✓ |
| 一键挖矿 / 一键砍树 | 可配置开关 | ✓ | ✓ |
| Chest UI 图标修复 | 启动时自动偏移修复 | ✓ | ✓ |

平台能力检测与 BDS 专属 API 封装见 `scripts/features/platform/sapi-capabilities/`。

## 开发

### 环境要求

- Node.js 18+
- npm

### 常用命令

```bash
npm install              # 安装依赖
npm run lint             # ESLint 检查
npx tsc --noEmit         # TypeScript 类型检查
npm run build            # 构建普通兼容版
npm run build:bds-admin  # 构建 BDS 增强版
npm run mcaddon          # 打包普通兼容版 .mcaddon
npm run mcaddon:bds      # 打包 BDS 增强版 .mcaddon
npm run mcaddon:all      # 同时产出两个 .mcaddon
npm run local-deploy     # 监听变更并部署普通版
npm run local-deploy:bds # 监听变更并部署 BDS 版
```

### 贡献

fork 后修改并提交 PR，请在描述中说明改动内容与测试方式。需具备基础 JavaScript/TypeScript 知识。

### 更新 Chest UI 原版物品贴图映射

商店、拍卖行等界面使用 **`textures/...` 贴图路径**显示物品图标（不再依赖 runtime 数字 id）。

- 映射数据：`scripts/assets/vanilla-item-icon-paths.ts`（自动生成）
- 游戏版本升级后执行：`npm run build:vanilla-icon-map`，再 `npm run build`
- 附加包自定义物品默认尝试 `textures/items/物品名`

## 版权

本插件遵循 MIT 协议，你可以在遵守协议的前提下自由使用本插件的代码。  
本插件的版权归作者所有，作者保留对本插件的所有权和最终解释权。  
请不要将本插件应用于商业用途，否则后果自负。
