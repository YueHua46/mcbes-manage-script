<h1 align="center">
  苦力怕菜单 - Addon
</h1>

<p align="center">
  <img src="docs/assets/creeper-menu-banner.png" alt="苦力怕菜单" />
</p>

Minecraft 基岩版综合生存服管理 Addon，面向服主提供可视化菜单与一体化服务器功能。

当前版本：**v3.0.1**  
支持引擎：**Minecraft Bedrock 1.26.x**（`min_engine_version: [1, 26, 0]`）

> 项目目前处于公开测试准备阶段。正式部署前，请先备份世界与动态属性数据。

## 主要功能

- 自定义命令、玩家传送、TPA、随机传送
- 自定义维度登记、默认点与跨维度传送
- 领地、PVP 竞技场、路点、公会与金库
- 金币、官方商店、拍卖行、红包与怪物击杀奖励
- 玩家行为日志、试玩模式、在线时长与数据统计
- 假人、悬浮文字、玩家 HUD 与服务器实时面板
- 一键挖矿、一键砍树、连锁收割与连锁播种
- 防刷物品、库存访问防护与黑名单管理

## 下载哪个版本

项目提供两种 `.mcaddon` 构建产物：

| 版本 | 适用环境 | 能力 |
|---|---|---|
| **普通兼容版** | 本地世界、Realms、BDS | 包含绝大多数功能，不依赖 BDS 专属模块 |
| **BDS 增强版** | 仅 BDS 专用服务器 | 额外支持进服前黑名单拦截、XUID 解析和 HTTP 出站能力 |

普通兼容版不包含 `@minecraft/server-admin` 和 `@minecraft/server-net`。BDS 增强版额外启用这些模块，因此不能用于 Realms 或普通本地世界。

## 安装

### 普通兼容版

1. 从 GitHub Releases 下载名称中带有 `standard` 的 `.mcaddon`。
2. 导入 Minecraft，或将行为包与资源包上传到服务器。
3. 在世界设置中启用对应行为包与资源包。
4. 首次安装或升级后完整重启世界或服务器，不要只执行 `/reload`。

### BDS 增强版

1. 从 GitHub Releases 下载名称中带有 `bds` 的 `.mcaddon`。
2. 将行为包和资源包部署到 BDS 世界。
3. 确认服务器环境允许使用 `@minecraft/server-admin` 与 `@minecraft/server-net`。
4. 完整重启 BDS。

> Release 安装包尚未发布时，可按照下方“开发与构建”章节自行构建。

## 功能矩阵

| 模块 | 普通版 | BDS 增强版 |
|---|:---:|:---:|
| 自定义命令 | ✓ | ✓ |
| 玩家传送 / TPA / 随机传送 | ✓ | ✓ |
| 自定义维度传送 | ✓ | ✓ |
| 领地系统 | ✓ | ✓ |
| PVP 系统 | ✓ | ✓ |
| 经济、商店、拍卖行、红包 | ✓ | ✓ |
| 公会系统 | ✓ | ✓ |
| 路点系统 | ✓ | ✓ |
| 玩家行为日志 | ✓ | ✓ |
| 防刷物品 | ✓ | ✓ |
| 假人、悬浮文字、HUD | ✓ | ✓ |
| 服务器实时面板 | ✓ | ✓ |
| 名字 / persistentId / XUID 黑名单 | — | ✓ |
| 进服前拦截 `asyncPlayerJoin` | — | ✓ |
| HTTP 出站与 XUID 解析 | — | ✓ |

平台能力检测与 BDS 专属 API 封装位于：

```text
scripts/features/platform/sapi-capabilities/
```

## 自定义维度传送

插件启动时会注册 5 个虚空生成器维度，并登记为 `custom1` 至 `custom5`。管理员可以修改显示名称、设置默认传送点，也可以登记其他行为包提供的维度。

```text
/yuehua:dimension add <别名> <维度ID> [显示名称]
/yuehua:dimension add_here <别名> [显示名称]
/yuehua:dimension list
/yuehua:dimension info <别名>
/yuehua:dimension current
/yuehua:dimension remove <别名>
/yuehua:dimension rename <别名> <新显示名称>
/yuehua:dimension reset <custom1至custom5>
/yuehua:dimension_setspawn <别名> <x> <y> <z>
/yuehua:dimension_setspawn_here <别名>
/yuehua:dimension test <别名>
/yuehua:dimension_tp <玩家选择器> <别名> [x y z]
```

预置维度真实 ID 为 `yuehua:custom_1` 至 `yuehua:custom_5`。它们不能真正删除；`reset` 会恢复默认名称并清除默认传送点。

示例：

```mcfunction
/yuehua:dimension_tp @a[tag=enter_mine] mine
/yuehua:dimension_tp @p[r=3] dungeon 0 80 0
```

## 升级与数据安全

- 升级前备份整个世界。
- 不要在未备份的生产服务器上直接测试预览版。
- 安装或升级行为包、资源包后完整重启服务器。
- 遇到资源包仍显示旧内容时，先确认服务器实际部署目录、包 UUID 与版本号是否已更新。
- 提交 Bug 时请说明 Minecraft 版本、运行环境、使用的构建变体和复现步骤。

## 开发与构建

### 环境要求

- Node.js 18+
- npm

### 常用命令

```bash
npm install
npm run lint
npx tsc --noEmit
npm run build
npm run build:bds-admin
npm run mcaddon
npm run mcaddon:bds
npm run mcaddon:all
npm run local-deploy
npm run local-deploy:bds
```

构建产物说明：

- `npm run mcaddon`：普通兼容版
- `npm run mcaddon:bds`：BDS 增强版
- `npm run mcaddon:all`：同时生成两个版本

### 更新 Chest UI 原版物品贴图映射

商店和拍卖行等界面使用 `textures/...` 贴图路径显示物品图标。

```bash
npm run build:vanilla-icon-map
npm run build
```

映射文件：

```text
scripts/assets/vanilla-item-icon-paths.ts
```

## 贡献

欢迎提交 Issue 和 Pull Request。请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，并在 PR 中说明改动内容、测试环境与验证方式。

## 许可证

本项目使用 [MIT License](LICENSE)。

MIT License 允许使用、复制、修改、分发和商业使用代码，但必须保留版权声明与许可证文本。“苦力怕菜单”名称、Logo 和官方发布身份不因代码许可证而自动授权。
