# 项目架构

苦力怕菜单是面向 Minecraft 基岩版服主的一体化服务器管理 Addon，而不是供第三方引用的 SDK。

## 主要目录

```text
behavior_packs/   行为包 manifest 与数据资源
resource_packs/   资源包、UI 与贴图
scripts/          TypeScript 源码
  features/       按业务能力组织的功能模块
  shared/         数据库、通用工具与跨模块基础能力
  events/         事件注册与环境差异入口
  ui/             表单和 Chest UI 组件
docs/             用户与开发文档
.github/          协作模板与自动化流程
```

## 构建变体

- `main.standard.ts`：本地世界、Realms 与 BDS 通用入口。
- `main.bds.ts`：额外加载 BDS 专属能力。
- 平台能力检测集中在 `scripts/features/platform/sapi-capabilities/`。

## 模块设计原则

- 功能模块应在 `scripts/features/<name>/` 内保持相对独立。
- 跨模块能力通过明确的 service、facade 或 shared 接口协作。
- BDS 专属 API 不应泄漏到普通兼容版入口。
- 模块关闭后应停止不必要的事件监听、轮询和高频计算。
- 动态属性、配置和数据结构变更必须考虑旧世界升级。

## 启动过程

入口加载数据库与系统服务，再加载功能模块，最后统一初始化事件注册器与缓存预热。新增模块时，应明确其初始化时机、失败影响和是否支持按配置关闭。