# Backrooms 细菌实体属性与奖励设计

## 目标

将 Kane Pixels 风格的 `yuehua:backrooms_lifeform` 定位为稀有小 Boss，并采用玩家社区广泛使用的 Bacteria 名称。

## 最终规则

- 中文显示名：`细菌（Bacteria）`。
- 英文显示名：`Bacteria`。
- 最大与初始生命值：`240`，为原有 `48` 的五倍。
- 追踪距离：`96` 格；手动召唤、潜行跟踪与追逐阶段统一使用该距离。
- 搜索游走半径：`16` 格；失去视线后扩大邻近区域搜索。
- 击杀经验：固定 `35` XP，通过 `minecraft:experience_reward` 由实体死亡时生成原版经验球。
- 击杀金币：固定 `100` 金币，只奖励 `damageSource.damagingEntity` 为真实玩家的最后一击者。
- 金币奖励复用现有怪物击杀奖励服务，遵守经济系统开关、怪物击杀奖励开关与每日金币上限。
- 非玩家伤害、环境死亡、假玩家和脚本清理实体均不发放金币。

## 实现边界

实体属性继续由 `behavior_packs/CreeperMenu/entities/backrooms_lifeform.json` 管理；金币配置继续由通用怪物奖励表管理，不在 Lifeform 导演中重复订阅死亡事件。自定义实体翻译键从完整 `yuehua:` type ID 解析，避免被误当作 `minecraft:` 实体。

## 验证

测试必须覆盖准确名称、240 生命、96 格目标范围、16 格搜索范围、35 XP 原版掉落、固定 100 金币范围及自定义实体本地化键。完成后运行全部 Backrooms 测试、经济奖励测试、TypeScript、ESLint、JSON 校验并重新生成标准兼容版 `.mcaddon`。

