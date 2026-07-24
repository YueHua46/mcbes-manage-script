# Realms 独立构建设计

## 背景与目标

苦力怕菜单当前提供普通兼容版和 BDS 增强版，但两个版本都在行为包
`manifest` 中声明 `@minecraft/server-gametest`，假人服务也会静态导入该模块。
Realms 不支持该模块，因此“普通兼容版适用于 Realms”的现状并不成立。

本次新增第三个菜单发行版本：

| 版本 | 目标环境 | 假人能力 |
| --- | --- | --- |
| 普通兼容版 | 本地世界、普通基岩版环境、BDS | 旧版实体假人 + 新版模拟玩家 |
| BDS 增强版 | BDS 专用服务器 | 旧版实体假人 + 新版模拟玩家，并保留 BDS 专属能力 |
| Realms 版 | Minecraft Realms | 仅旧版实体假人，完全不依赖 `@minecraft/server-gametest` |

独立 Backrooms 附加包仍保持现状，不与三个菜单版本耦合。

## 方案比较与选择

### A. 构建期能力隔离（采用）

把 GameTest 的导入收口到单独的平台适配模块。普通版和 BDS 版使用真实
GameTest 适配器；Realms 构建通过 esbuild alias 使用无 GameTest 导入的
Realms 适配器。业务服务继续通过统一接口工作，并通过集中式构建能力标识
决定是否允许新版模拟玩家。

优点是共享绝大多数假人逻辑、避免三个版本漂移，同时能从 Realms 的静态
依赖图中真正排除 GameTest。代价是构建配置需要明确维护 alias 和产物检查。

### B. 复制一套 Realms 假人服务（不采用）

Realms 使用完全独立的旧版假人服务。隔离直观，但创建、删除、传送、权限、
数据库等共享行为会产生重复代码，后续修复容易遗漏某个版本。

### C. 仅在运行时隐藏新版假人（不采用）

只改 UI 和条件判断，不处理静态 import。改动最小，但 Realms 仍会加载或
声明不支持的模块，无法满足兼容目标。

## 构建与清单

新增 `realms` 构建变体和 `__REALMS_BUILD__` 编译期标识，并纳入现有
`sapi-capabilities` 能力边界：

- 普通版：`__REALMS_BUILD__ = false`
- 调试版：`__REALMS_BUILD__ = false`
- BDS 增强版：`__REALMS_BUILD__ = false`
- Realms 版：`__REALMS_BUILD__ = true`

新增 `manifest.realms.json`。它与普通版共享稳定的服务器和 UI 依赖，但
删除 `@minecraft/server-gametest`，也不得引入 `@minecraft/server-admin`、
`@minecraft/server-net` 或 `@minecraft/debug-utilities`。

新增以下命令：

- `npm run build:realms`
- `npm run mcaddon:realms`

`npm run mcaddon:all` 应同时生成普通版、Realms 版、BDS 增强版和独立
Backrooms 包，并在结束时恢复源码目录的普通版 `manifest.json`。

Realms 菜单包使用清晰的中文文件名，与普通版和 BDS 版并列，不能覆盖其他
产物。

## 假人能力边界

新增 GameTest 适配层，假人服务不再直接从
`@minecraft/server-gametest` 导入：

- 完整适配器负责导出 `spawnSimulatedPlayer` 和 `SimulatedPlayer` 类型，
  仅普通版、调试版和 BDS 版进入最终依赖图。
- Realms 适配器不导入 GameTest；若内部缺陷导致调用新版生成入口，应返回
  明确失败结果或抛出带有 Realms 限制说明的错误，不能静默创建错误实体。
- `isSimulatedPlayerAvailable()` 由集中式构建能力模块提供，UI 和业务服务
  不直接读取全局构建常量。

普通版和 BDS 版的现有新版假人、背包、行为编排、死亡与复活逻辑保持不变。
Realms 版继续支持旧版实体假人的创建、换肤、传送、删除、区块加载及权限
管理。

## Realms 数据迁移

Realms 初始化假人数据库时，对所有 `type !== "entity"` 的记录执行幂等
降级：

- 将 `type` 设置为 `"entity"`。
- 保留 `id`、名称、创建者、位置、维度、创建时间、旋转、皮肤及通用权限
  字段。
- 没有合法 `skinId` 时使用现有默认旧版皮肤。
- 清除仅适用于新版模拟玩家的运行状态和持久化字段，包括死亡状态、死亡
  原因、游戏模式、背包快照、自动行为和行为脚本。
- 写回数据库，后续再次加载不重复迁移。
- 记录迁移数量；单条异常不能阻止其他记录或菜单初始化。

迁移只在 Realms 构建执行。普通版和 BDS 版不得修改已有的新版假人记录。

## 用户界面

Realms 版假人菜单应直接进入旧版实体假人的创建表单，不再展示“选择假人
类型”页面，也不显示新版复活费用、模拟玩家能力、背包或行为编排入口。

菜单说明要明确显示“Realms 版仅支持旧版实体假人”。现有记录完成迁移后，
列表和详情页统一按旧版实体假人展示，避免出现不可操作的新版按钮。

普通版和 BDS 版 UI 保持当前双类型体验。

## 关联模块与文档

同步更新以下内容：

- `README.md` 的版本矩阵、适用环境、构建命令、产物说明和验证命令。
- 项目知识库中与版本选择、GameTest 和假人能力有关的说明。
- GitHub Actions：增加 Realms 构建，并验证 Realms 产物不引用 GameTest。
- `package.json`：增加 Realms 构建与打包脚本。源码开发依赖仍保留
  `@minecraft/server-gametest`，因为普通版/BDS 仍需编译新版假人；“删除
  依赖”指 Realms 的 manifest 与最终运行时产物不包含该模块。
- 启动日志：普通版不再声称适用于 Realms；Realms 入口明确报告旧版假人
  限制。

受保护的 DOVA 音乐、二次元角色资源、假人皮肤与现有品牌素材不得删除或
改写。

## 测试与验收

先写会失败的测试，再实现功能。至少覆盖：

1. Realms manifest 存在且不含 `@minecraft/server-gametest`、BDS 专属或
   DebugUtilities 模块。
2. 普通版和 BDS manifest 继续包含 `@minecraft/server-gametest`。
3. 构建能力正确识别 `realms`，并报告新版模拟玩家不可用。
4. Realms 数据迁移会把模拟玩家记录转换为实体记录，保留通用字段、清除
   新版专属字段，且重复执行结果不变。
5. Realms UI 不提供新版假人入口。
6. `npm run build:realms` 成功，生成的 `dist/scripts/main.js` 不包含
   `@minecraft/server-gametest` 或 `spawnSimulatedPlayer` 的外部导入。
7. `npm run build:standard` 与 `npm run build:bds-admin` 继续成功，并保留
   GameTest 能力。
8. `npm run check` 和独立 Backrooms 构建继续通过。

完成全部验证后，统一使用中文 commit 信息提交，并 push 到当前远程分支。
