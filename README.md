![苦力怕菜单](docs/images/creeper-menu-banner.png)

# 苦力怕菜单

Minecraft 基岩版服务器菜单附加包。它把传送、领地、经济、公会、路点和管理工具集中到一个菜单道具里。本仓库还包含已经独立拆包的 Backrooms Level 0 附加包。

> [!IMPORTANT]
> 本仓库公开源代码，但限制商业用途，属于 **source-available（源码可用）** 项目，而不是 OSI 定义的开源软件。代码许可为 [PolyForm Noncommercial License 1.0.0](LICENSE)，第三方素材适用各自条款。

> [!NOTE]
> 这是非官方 Minecraft 项目，不受 Mojang Studios 或 Microsoft 批准、认可、赞助或关联。

## 功能

- 菜单入口：使用 `yuehua:sm` 道具打开主菜单。
- 玩家功能：TPA、坐标与随机传送、个人/公共路点、在线时长与设置。
- 服务器系统：领地、经济、官方商店、玩家交易市场、红包、公会、PVP、任务和统计。
- 管理工具：玩家与背包管理、行为日志、防刷物品、公告、浮空字和调度面板。
- 自定义维度：苦力怕菜单提供 5 个通用虚空维度。
- 独立 Backrooms：按玩家隔离、按需延伸的 Level 0，以及独立实体、声景和资源包。
- 资源体验：保留项目原有的 DOVA 音乐、欢迎角色、假人皮肤与相关运行时资源。

完整功能和管理员操作说明见 [项目知识库](docs/creeper-menu-knowledge-base.md)。Backrooms 的生成、隔离和声景设计见 [Backrooms 无限生成器设计](docs/backrooms-generator.md)。

## 构建与附加包

| 产物 | 适用环境 | 特点 | 打包命令 |
| --- | --- | --- | --- |
| 苦力怕菜单普通兼容版 | 本地世界、Realms、BDS | 不依赖 BDS 专属模块，覆盖主要菜单功能 | `npm run mcaddon` |
| 苦力怕菜单 BDS 增强版 | 仅 BDS 专用服务器 | 增加进服前黑名单拦截、XUID 解析和服务器网络能力 | `npm run mcaddon:bds` |
| Backrooms Level 0 | 本地世界、Realms、BDS | 独立行为包与资源包，不依赖苦力怕菜单 | `npm run mcaddon:backrooms` |

同时生成全部 `.mcaddon`：`npm run mcaddon:all`。

当前苦力怕菜单行为包版本为 **3.1.13**，资源包版本为 **3.2.13**；Backrooms 行为包和资源包版本均为 **1.0.0**。manifest 最低引擎版本为 **1.26.0**。

## 安装

### 苦力怕菜单

1. 从 Release 下载普通兼容版或 BDS 增强版。
2. 本地世界使用 Minecraft 打开 `.mcaddon` 完成导入；BDS 可解压后部署行为包和资源包。
3. 在世界中同时启用 `苦力怕菜单_BP` 与 `苦力怕菜单_RP`。
4. 首次安装或升级后完整重启世界或服务器，不要只执行 `/reload`。
5. 给管理员添加标签：

```mcfunction
/tag @s add admin
```

6. 获取菜单道具：

```mcfunction
/give @s yuehua:sm
```

手动安装时，将以下目录分别放入目标世界或服务器对应的行为包、资源包目录：

- `behavior_packs/CreeperMenu`
- `resource_packs/CreeperMenu`

BDS 增强版必须通过 `npm run build:bds-admin` 或 `npm run mcaddon:bds` 生成，不要直接把源码目录当作已构建的增强版。

### Backrooms Level 0

Backrooms 已从苦力怕菜单拆分为独立附加包。启用以下两个配套目录并完整重启：

- `behavior_packs/Backrooms`
- `resource_packs/Backrooms`

管理员或命令方块可使用：

```mcfunction
/yuehua:backrooms_tp @p
/yuehua:backrooms_tp @p 0 100 0
/yuehua:backrooms_exit @p
```

省略坐标时，每个玩家会进入相距极远且持久稳定的独立 manifestation；显式坐标会先生成目标区域并收敛到安全落脚点。同时安装苦力怕菜单时，聊天、TPA 与坐标点系统会遵守 Backrooms 发布的维度隔离策略。

## 开发与构建

环境要求：

- Node.js `20.19+`、`22.13+` 或 `24+`
- npm
- Python 3.11+（仅用于素材可复现性测试）

安装与检查：

```bash
npm ci
python3 -m pip install -r requirements-dev.txt
cp .env.example .env
npm run check
```

常用命令：

```bash
npm run lint              # ESLint
npm run typecheck         # TypeScript 类型检查
npm test                  # 发布约束与资源保护测试
npm run build:standard    # 构建菜单普通版和独立 Backrooms
npm run build:bds-admin   # 构建菜单 BDS 版和独立 Backrooms
npm run build:backrooms   # 仅构建 Backrooms 脚本
npm run mcaddon           # 打包菜单普通兼容版
npm run mcaddon:bds       # 打包菜单 BDS 增强版
npm run mcaddon:backrooms # 打包独立 Backrooms
npm run mcaddon:all       # 打包全部产物
```

本地部署需要在 `.env` 中设置 `PROJECT_NAME`；使用 BDS 部署任务时还需设置 `BDS_SERVER_DEPLOY_PATH`。普通构建和代码检查不要求部署路径。

### 更新 Chest UI 原版物品图标映射

官方商店、玩家交易市场等界面使用 `textures/...` 路径显示物品图标。映射文件为 `scripts/features/system/services/vanilla-item-icon-paths.ts`，生成器为 `tools/build-vanilla-icon-map.ts`：

```bash
npm run build:vanilla-icon-map
npm run build:vanilla-icon-map -- 1.26.30
```

生成器会从 Mojang 官方 `bedrock-samples` 获取物品和贴图元数据，诊断报告输出到 `out/vanilla-icon-map/`。

### 品牌图

包图标与本页横幅由 [品牌构建脚本](tools/build-brand-assets.py) 生成。中央始终使用现有菜单道具 `sm.png`，脚本只读取它，不会覆盖或重绘游戏内纹理。背景来自项目内保留的 ImageGen 源图。

## 贡献

欢迎提交问题和非商业用途的改进。提交 PR 前请运行：

```bash
npm run check
npm run build:standard
npm run build:bds-admin
npm run build:backrooms
```

请不要在没有明确授权的情况下替换、删除、重命名 DOVA 音乐、欢迎角色、假人皮肤及其来源文件。经过项目维护者确认的音频编码优化应同步更新对应保护测试。

## 许可与第三方内容

项目原创代码和未单独标注的原创内容使用 [PolyForm Noncommercial License 1.0.0](LICENSE)：允许非商业使用、研究、修改和再分发，但不允许商业用途。

Minecraft 名称与素材、DOVA-SYNDROME 音乐、Pixabay 音效及二次元角色资源不由项目许可证重新授权。来源、署名和适用边界见 [第三方素材与商标声明](THIRD_PARTY_NOTICES.md)。
