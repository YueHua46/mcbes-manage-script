# 苦力怕菜单

Minecraft 基岩版（Bedrock）服务器菜单插件，基于 Script API（SAPI）构建。支持 **1.26.x** 引擎（manifest `min_engine_version: [1, 26, 0]`）。

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
| 自定义维度传送 | 维度登记、默认点、选择器批量跨维度传送 | ✓ | ✓ |
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

## 自定义维度传送

插件启动时会注册 5 个通用虚空维度（`custom1` 至 `custom5`）和一个由脚本按需无限延伸的 `backrooms` 维度。首次安装或升级后须完整重启世界/服务器，不要只使用 `/reload`。管理员可以修改显示名称、设置默认点并交给命令方块传送；插件也保留接入其他行为包维度的能力。

```text
/yuehua:dimension add <别名> <维度ID> [显示名称]
/yuehua:dimension add_here <别名> [显示名称]
/yuehua:dimension list
/yuehua:dimension info <别名>
/yuehua:dimension current
/yuehua:dimension remove <别名>
/yuehua:dimension rename <别名> <新显示名称>
/yuehua:dimension reset <预置维度别名>
/yuehua:dimension_setspawn <别名> <x> <y> <z>
/yuehua:dimension_setspawn_here <别名>
/yuehua:dimension test <别名>
/yuehua:dimension_tp <玩家选择器> <别名> [x y z]
```

通用预置维度的真实 ID 为 `yuehua:custom_1` 至 `yuehua:custom_5`，另有 `yuehua:backrooms`；它们不能真正删除。`reset` 会恢复默认名称并清除默认传送点。`dimension`、`dimension_setspawn` 和 `dimension_setspawn_here` 仅管理员可用；`dimension_tp` 可由管理员或命令方块执行。省略目标坐标时使用已保存的默认点，例如：

`dimension_tp` 的维度参数既可以填写固定别名（如 `custom1`），也可以填写管理员修改后的显示名称（如 `天界`）。相对坐标需要写成 `~ ~ ~`，三个坐标之间必须有空格。

```mcfunction
/yuehua:dimension_tp @a[tag=enter_mine] mine
/yuehua:dimension_tp @p[r=3] dungeon 0 80 0
```

进入 Backrooms Level 0：

```mcfunction
/yuehua:dimension_tp @p backrooms
```

省略坐标时，每个玩家会进入相距极远且持久稳定的独立 manifestation。生成器会在玩家接近边界时提前施工相邻 `64×64` 区域；未完成区域保持为封闭黄墙，不会暴露虚空。行为包 3.1.2 与资源包 3.2.2 加入局部灯光、专属脚步、墙后幻听、原版音乐抑制，以及会在持续探索后出现的细菌（Bacteria）小 Boss。由真实玩家击杀细菌可获得 100 金币并掉落 35 点经验。算法、隔离、声景、实体与运维说明见 [Backrooms 无限生成器设计](docs/backrooms-generator.md)。

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
- 生成器源码已包含在本仓库：`tools/build-vanilla-icon-map.ts`，不依赖其他相邻项目
- 当前版本重新生成：`npm run build:vanilla-icon-map`
- 指定新版本标签：`npm run build:vanilla-icon-map -- 1.26.30`，再执行 `npm run build`
- 生成器会从 Mojang 官方 `bedrock-samples` 下载物品和贴图元数据；诊断报告写入 `out/vanilla-icon-map/`
- 附加包自定义物品默认尝试 `textures/items/物品名`

## 版权

本插件遵循 MIT 协议，你可以在遵守协议的前提下自由使用本插件的代码。  
本插件的版权归作者所有，作者保留对本插件的所有权和最终解释权。  
请不要将本插件应用于商业用途，否则后果自负。
