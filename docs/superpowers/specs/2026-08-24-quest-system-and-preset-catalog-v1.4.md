# CreeperMenu 任务系统与预设任务库完整技术契约 v1.4（AI 实施版）

> 仓库：YueHua46/mcbes-manage-script
>
> 基线：2026-08-24 main，提交 1a80092
>
> 状态：实施前技术契约
>
> 本文取代：
>
> - CreeperMenu 任务系统架构重构技术契约 v1.3（AI 实施版）
> - CreeperMenu 预设任务库完整设计 v1.0（AI 实施版）
>
> 两份旧文档仅作为历史输入，不再作为独立实施依据。

---

# 0. 文档目的与解释顺序

本文是 CreeperMenu 任务系统底层重构、预设内容、迁移、奖励、HUD 和验收的单一事实来源。

发生冲突时，解释优先级如下：

1. 数据安全、奖励安全和已有玩家进度不丢失；
2. 本文主体中的运行时契约；
3. 附录中的预设任务内容；
4. 显示文案、默认奖励数值和 UI 示例。

附录中的“任务已设计”不等于“运行时已经支持”。任务只有同时满足以下条件才可向玩家发布：

- 定义的 releaseState 为 active；
- 所属任务包已启用；
- 所有 requiredCapabilities 可用；
- 所需 Gameplay Experiment 已被可靠确认；
- 对应 Adapter 已完成自动测试和真实游戏验证。

本文列出约 158 条长期内容，其中 A 级约 100 条、B 级约 50 条、C 级约 8 条。第一轮仍然只发布附录 B 规定的 12 条纵向切片。

---

# 1. 产品目标

不要推倒现有任务系统。

现有系统已经支持：

- 管理员自定义任务；
- 一次性、每日、每周和可重复任务；
- 多目标；
- all / any 完成条件；
- 击杀实体、破坏方块、获得物品和在线时长；
- 物品、金币、经验、消息和命令奖励；
- 自动接受；
- 玩家进度持久化；
- 手动领取奖励。

重构后的系统必须同时承载：

1. 管理员自定义任务；
2. 官方内置预设任务；
3. Minecraft 主线、世界探索和新版本冒险；
4. CreeperMenu 自身功能教学；
5. 隐藏挑战；
6. 章节图、主线百分比和任务历史；
7. Fancy HUD、任务 Toast 和章节 Banner；
8. 玩家改名、任务版本升级和任务包开关后的迁移；
9. 可靠领奖、崩溃恢复和人工补偿；
10. 100 至 200 个任务下的可维护性能。

预设任务的产品定位是：

> Minecraft 冒险履历 + 世界内容发现 + CreeperMenu 新手引导。

玩家正常游玩即可自然推进。系统不得为了凑任务数量而使用错误代理条件。

---

# 2. 当前实现基线与已确认问题

当前核心实现位于：

- scripts/features/quest/services/quest-definition.ts
- scripts/features/quest/services/quest-player.ts
- scripts/events/handlers/quest.ts
- scripts/ui/forms/quest-system/index.ts

已确认问题：

1. 玩家任务数据库仍以小写玩家名为主键；
2. 每次事件遍历全部启用任务和全部 Goal；
3. progress 只能保存 Record<goalId, number>；
4. 每个 questId 只保存一份当前状态，周期历史会被覆盖；
5. repeatable 的 periodKey 固定，无法形成独立领奖实例；
6. item.obtain 只表示物品进入背包的正向增量，不能表示当前拥有；
7. 奖励逐项执行后才写 claimedAt，存在重复发放窗口；
8. 删除或停用任务后，已完成未领奖记录依赖当前定义，可能无法领取；
9. 自定义任务编辑缺少统一定义版本与兼容检查；
10. 常驻 HUD 和多个业务模块直接竞争 ActionBar / Title；
11. 当前 Database 分块覆盖不是服务器崩溃意义上的原子提交；
12. 尚无覆盖任务 Domain、迁移、Reward Ledger 和 HUD Broker 的完整测试。

已有可复用基础：

- Quest、Goal、Reward 已有 ID；
- identity-service.ts 已提供稳定 cmid；
- Economy 已开始使用 cmid 迁移钱包；
- 当前依赖提供 entityDie、playerBreakBlock、playerInventoryItemChange、playerDimensionChange、itemUse、playerInteractWithBlock、playerInteractWithEntity、effectAdd 和 playerPlaceBlock 等事件；
- 项目已有 Standard、Realms、BDS 构建流程。

---

# 3. 不可破坏原则

## 3.1 自定义任务兼容

- 现有管理员自定义任务必须继续工作；
- 旧定义缺少 source 时按 custom 解释；
- 旧 Counter Goal 缺少 semantics 时按 counter 解释；
- 旧数字进度必须可惰性转换为类型化进度；
- Phase 0 不改变现有玩家可见行为；
- 预设任务不得直接写入 quest_definitions；
- 管理员任务列表不得混入全部系统预设；
- 预设深度修改通过“复制为自定义任务”完成。

## 3.2 稳定 ID

正式发布后永久稳定：

- packId；
- chapterId；
- questId；
- goalId；
- rewardId；
- selectorId；
- capabilityId。

官方预设禁止使用 Date.now、Math.random、generateId 或标题派生 ID。

自定义任务可以在创建时生成一次 custom.* ID，但此后改名不得改变 ID。

## 3.3 内容准确性

禁止：

- 用 item.obtain 代表当前拥有；
- 用拥有结构战利品代表进入结构；
- 用拥有烈焰棒代表发现下界堡垒；
- 用背包变化代表穿着完整装备；
- 用聊天文本或数据库轮询猜测 CreeperMenu 操作成功；
- 在没有真实原型时把 B/C 级事件标为可用。

玩家文案必须描述系统实际判定的事实。

## 3.4 实验能力

必须区分：

- CreeperMenu 正常运行必需的 Creator Experiments；
- 单个任务包需要的 Gameplay Experiments。

Beta APIs 已开启不代表所有 Gameplay Experiment 已开启。

若运行时无法可靠读取实验开关，应使用能力探测、目标内容存在性探测、构建信息或管理员显式确认；不得无证据推断。

---

# 4. 目标架构

    Minecraft / CreeperMenu 原始事件
                     │
                     ▼
             Quest Event Adapters
                     │
                     ▼
                QuestEventBus
                     │
              ┌──────┴─────────┐
              ▼                ▼
          EventIndex      Capability Registry
              │
       ┌──────┴──────────────┐
       ▼                     ▼
    Counter /            Snapshot Dirty Queue
    Milestone                 │
       │                      ▼
       │              Snapshot Providers
       └──────────┬───────────┘
                  ▼
           Pure Domain Engine
                  │
          ┌───────┴────────┐
          ▼                ▼
    Rule / Lifecycle   Completion Flow
          │                │
          ▼                ▼
    Quest Repository   Completion Snapshot
    cmid + instances        │
    + facts + ledger        ▼
                       Reward Ledger
                            │
                            ▼
                       Reward Handlers

    Effective Catalog + Player Aggregate
                     │
                     ▼
             Quest Journal Query
                     │
             ┌───────┴────────┐
             ▼                ▼
          Player UI       Notification Service
                              │
                              ▼
                       HudMessageBroker

建议目录：

    scripts/features/quest/
    ├── domain/
    │   ├── quest-types.ts
    │   ├── quest-rules.ts
    │   ├── quest-evaluator.ts
    │   ├── quest-state-machine.ts
    │   ├── quest-period.ts
    │   └── reward-contract.ts
    ├── catalog/
    │   ├── effective-quest-catalog.ts
    │   ├── preset-registry.ts
    │   ├── preset-validator.ts
    │   ├── preset-migrations.ts
    │   ├── preset-overrides.ts
    │   ├── selector-registry.ts
    │   └── capability-registry.ts
    ├── events/
    │   ├── quest-event-bus.ts
    │   ├── event-index.ts
    │   └── adapters/
    ├── snapshots/
    │   ├── snapshot-reconciler.ts
    │   └── providers/
    ├── state/
    │   ├── quest-state-repository.ts
    │   ├── quest-fact-store.ts
    │   ├── legacy-name-migration.ts
    │   └── generation-store.ts
    ├── rewards/
    │   ├── quest-reward-service.ts
    │   ├── reward-ledger.ts
    │   ├── reward-validation.ts
    │   └── handlers/
    ├── notifications/
    │   ├── quest-notification-service.ts
    │   ├── quest-toast-queue.ts
    │   └── quest-notification-settings.ts
    ├── queries/
    │   └── quest-journal-query.ts
    ├── presets/
    │   ├── core/
    │   ├── world/
    │   ├── creeper-menu/
    │   ├── updates/
    │   ├── experiments/
    │   └── hidden/
    └── services/
        └── legacy-facade.ts

---

# 5. 内容模型

## 5.1 Quest Pack

    interface QuestPackDefinition {
      id: string;
      version: number;

      title: string;
      description: string;
      category:
        | "core"
        | "world"
        | "creeper"
        | "update"
        | "experiment"
        | "hidden";

      defaultEnabled: boolean;
      releaseState: "active" | "experimental" | "planned";

      requiredCapabilities: string[];
      requiredGameplayExperiments: string[];

      chapterIds: string[];
    }

## 5.2 Chapter

    interface QuestChapterDefinition {
      id: string;
      packId: string;

      title: string;
      description: string;
      icon?: string;
      order: number;

      unlockRule: QuestRule;
      questIds: string[];

      progressPolicy: {
        includeHidden: boolean;
        includeUnavailable: boolean;
      };
    }

章节是第一等定义，不是只显示用的 category 字符串。

章节图允许并行分支，但必须在目录验证阶段检查：

- 引用存在；
- 不存在循环依赖；
- 一个 Quest 只能属于一个正式 Chapter；
- planned 或 unavailable 任务不得成为 active 主线的唯一必要前置。

## 5.3 Quest Definition

    interface QuestDefinition {
      id: string;
      source: "preset" | "custom";
      definitionVersion: number;

      title: string;
      description: string;

      packId?: string;
      chapterId?: string;
      category: string;
      order?: number;

      rarity: "common" | "rare" | "epic" | "legendary";
      reliability: "A" | "B" | "C";
      releaseState: "active" | "experimental" | "planned";

      scope: "once" | "daily" | "weekly" | "repeatable";
      completeWhen: "all" | "any";
      acceptMode: "manual" | "auto";
      claimMode: "manual" | "auto";

      enabled: boolean;
      hidden: boolean;
      trackWhileHidden: boolean;
      contributesToProgress: boolean;

      unlockRule: QuestRule;
      unlockEventPolicy: "exclude" | "include_once";

      requiredCapabilities: string[];
      requiredGameplayExperiments: string[];

      goals: QuestGoalDefinition[];
      rewards: QuestRewardDefinition[];

      createdAt: number;
      updatedAt: number;
    }

第一阶段所有预设任务 claimMode 使用 manual。Reward Ledger 和恢复流程稳定后才允许 auto。

## 5.4 结构化规则

    type QuestRule =
      | { type: "always" }
      | { type: "all"; rules: QuestRule[] }
      | { type: "any"; rules: QuestRule[] }
      | {
          type: "quest";
          questId: string;
          status: "completed" | "claimed";
        }
      | {
          type: "fact";
          factId: string;
          operator: "eq" | "gte" | "lte";
          value: string | number | boolean;
        }
      | {
          type: "capability";
          capabilityId: string;
        };

前置默认检查 completed，不要求玩家先领奖。

规则必须使用结构化对象，不允许把任意字符串表达式交给 eval 或命令解释器。

---

# 6. Availability、Lifecycle 与 Release State

三者必须分离。

## 6.1 Release State

    active        已实现并允许发布
    experimental  只有能力验证通过和服务器明确开启时发布
    planned       仅内容规划，不进入玩家目录

## 6.2 Availability

    type QuestAvailability =
      | "locked"
      | "available"
      | "suspended"
      | "unavailable";

含义：

- locked：前置未满足；
- available：可正常参与；
- suspended：任务包暂时关闭，进度冻结；
- unavailable：缺少运行环境、能力或实验内容。

## 6.3 Lifecycle

    type QuestLifecycle =
      | "not_started"
      | "accepted"
      | "completed"
      | "claiming"
      | "claimed"
      | "recovery_required";

Availability 是动态计算结果，Lifecycle 是持久状态。

允许：

    availability = suspended
    lifecycle = completed

表示任务包已关闭，但玩家仍保留领奖资格。

## 6.4 任务包关闭

未完成任务：

- 停止 Counter 和 Milestone 累计；
- 保存当前进度；
- 关闭期间事件默认不回填；
- 重新开启后继续；
- Snapshot 重新开启后立即扫描。

已完成未领奖任务：

- 进入历史可领取；
- 不依赖当前 Catalog 是否仍启用；
- 使用完成时冻结的奖励快照。

---

# 7. Goal 契约

## 7.1 Goal 类型

Domain 只实现四类稳定原语：

    type QuestGoalDefinition =
      | CounterGoalDefinition
      | DistinctCounterGoalDefinition
      | SnapshotGoalDefinition
      | MilestoneGoalDefinition;

Challenge 由专用 Adapter 验证成功后，转换为 Milestone 或 Counter 事件。

Composite 不作为单独 Goal 类型；完整铁甲等任务使用多个稳定 Goal 加 completeWhen = all。

Counter Milestone 使用 target = 1 的 Counter 或 Milestone 表达，不增加混合类型。

## 7.2 Counter

适用于：

- 击杀 10 个实体；
- 任务启用后累计获得 20 个物品；
- 交易 10 次；
- 在线 1 小时；
- 飞行 10000 格。

    interface CounterGoalDefinition {
      id: string;
      semantics: "counter";

      eventType: string;
      filters: Record<string, QuestFilter>;

      aggregation: "count" | "sum";
      field?: string;
      target: number;

      backfillPolicy: "none" | "historical";
    }

规则：

    next = min(target, current + positiveDelta)

Counter 默认不回填任务可用前没有记录的事件。

## 7.3 Distinct Counter

适用于记录不同种类：

    interface DistinctCounterGoalDefinition {
      id: string;
      semantics: "distinct_counter";

      eventType: string;
      filters: Record<string, QuestFilter>;
      distinctField: string;
      target: number;

      backfillPolicy: "none" | "historical";
    }

进度保存稳定字符串集合。不得只保存集合大小，否则迁移、去重和诊断无法验证。

## 7.4 Snapshot

适用于：

- 当前拥有；
- 当前穿着；
- 当前状态效果；
- 当前业务状态；
- 附近存在有效激活的目标结构或方块状态。

    interface SnapshotGoalDefinition {
      id: string;
      semantics: "snapshot";

      provider:
        | "inventory"
        | "equipment"
        | "effects"
        | "nearby_world"
        | "creeper_state";

      selectorId: string;
      query?: Record<string, unknown>;
      target: number;

      snapshotMode: "current" | "peak";
    }

current：

    next = currentObservedValue

peak：

    next = max(previousObservedValue, currentObservedValue)

任务完成后，完成状态保持，不因后续 Snapshot 下降而撤销。

“当前拥有”的默认边界：

- 快捷栏；
- 主背包；
- 相关装备槽；
- 定义明确要求时包含副手。

默认不包含：

- 末影箱；
- 普通容器；
- 潜影盒内部物品；
- 玩家附近掉落物。

## 7.5 Milestone

适用于：

- 进入维度；
- 完成 TPA；
- 创建领地；
- 完成一次附魔；
- 专用 Adapter 已确认的复杂行为。

    interface MilestoneGoalDefinition {
      id: string;
      semantics: "milestone";

      eventType: string;
      filters: Record<string, QuestFilter>;

      backfillPolicy: "none" | "current_state" | "historical";
      evidenceProviderId?: string;
    }

Milestone 完成后永久为 true。

historical 只有存在可信证据时允许使用。

## 7.6 类型化 Goal State

    type QuestGoalState =
      | {
          kind: "number";
          value: number;
        }
      | {
          kind: "distinct_set";
          values: string[];
        }
      | {
          kind: "milestone";
          achieved: boolean;
          achievedAt?: number;
          evidenceId?: string;
        }
      | {
          kind: "snapshot";
          observedValue: number;
          reconciledAt: number;
          providerVersion: number;
        };

旧 Record<goalId, number> 惰性迁移为 kind = number。

---

# 8. Selector Registry

预设库大量使用物品和装备集合，必须集中维护：

    interface QuestSelectorRegistry {
      matchItem(selectorId: string, item: ItemSnapshot): boolean;
      matchEquipment(
        selectorId: string,
        equipment: EquipmentSnapshot
      ): boolean;
    }

推荐稳定 ID：

    selector.item.logs
    selector.item.beds
    selector.item.shulker_boxes
    selector.item.pottery_sherds
    selector.item.ominous_bottles
    selector.item.spears
    selector.equipment.full_iron_armor
    selector.equipment.full_copper_armor
    selector.enchantment.swift_sneak

Selector 必须：

- 有独立单元测试；
- 能按 Minecraft 版本更新成员；
- 不把显示名称作为匹配依据；
- 不在每条 Quest 中复制长列表；
- 对带组件条件的物品使用结构化谓词，不执行任意表达式。

---

# 9. Player Fact Store 与历史证据

有些历史属于玩家全局事实，而不是某个当前任务：

- Boss 击杀次数；
- 是否完成过市场交易；
- 当前是否有个人路点；
- 当前是否拥有领地；
- 当前是否加入公会。

    type QuestFactValue =
      | { kind: "counter"; value: number; updatedAt: number }
      | {
          kind: "milestone";
          achievedAt: number;
          evidenceId: string;
        }
      | {
          kind: "snapshot";
          value: string | number | boolean;
          observedAt: number;
        };

Fact Store 只能记录显式注册的事实，不得复制全部 Quest 进度。

推荐事实：

    fact.boss.ender_dragon.kill_count
    fact.boss.wither.kill_count
    fact.creeper.market.trade_count
    fact.creeper.waypoint.exists
    fact.creeper.land.exists
    fact.creeper.guild.joined

Evidence Provider：

    interface QuestEvidenceProvider {
      id: string;
      version: number;

      resolve(
        playerCmid: string,
        query: Record<string, unknown>
      ): QuestEvidence | undefined;
    }

证据必须包含来源和时间。无法证明时返回 undefined，不得猜测。

---

# 10. Quest Instance 与玩家聚合

不能继续每个 questId 只保存一份状态。

    interface QuestInstanceState {
      instanceId: string;
      questId: string;
      definitionVersion: number;

      periodKey: string;
      attempt: number;

      acceptedAt: number;
      lifecycle: QuestLifecycle;
      progress: Record<string, QuestGoalState>;

      completedAt?: number;
      claimedAt?: number;
      completionSnapshot?: QuestCompletionSnapshot;
    }

    interface QuestPlayerAggregate {
      schemaVersion: 2;
      playerCmid: string;
      displayName: string;

      activeByQuestId: Record<string, string>;
      instances: Record<string, QuestInstanceState>;
      facts: Record<string, QuestFactValue>;
      rewardLedger: Record<string, RewardDeliveryState>;

      migration?: QuestMigrationMetadata;
    }

实例 ID 必须确定性生成：

    questId + "@" + periodKey + "#" + attempt

示例：

    preset.core.survival.first_log@once#1
    custom.daily_zombie@2026-08-24#1
    custom.repeatable_hunt@repeatable#17

Reward Ledger 唯一键：

    playerCmid + instanceId + rewardId

禁止继续使用 playerCmid + questId + periodKey + rewardId 作为 repeatable 唯一键。

## 10.1 周期

Period Resolver 必须接受服务器配置：

- timezone；
- daily reset hour；
- weekly start day。

禁止在 Domain 中写死 UTC+8。

必须测试 ISO 周跨年、夏令时配置和周期边界。

旧 once / daily / weekly 状态迁移时保留原 periodKey。

## 10.2 历史

- daily、weekly 和 repeatable 的旧实例不得被新周期覆盖；
- activeByQuestId 只指向当前活跃实例；
- 历史实例可归档，但不得在未完成保留策略前删除；
- completed 未 claimed 的实例永远出现在历史可领取；
- 历史显示使用实例中的完成快照，不依赖当前定义存在。

---

# 11. cmid 迁移

新版主键使用：

    identityService.resolvePlayerKeyForPlayer(player)

惰性迁移流程：

1. 绑定并取得 cmid；
2. 读取 cmid 聚合；
3. 读取 Identity knownNames；
4. 对名字执行与旧数据库一致的小写规范化；
5. 合并所有旧名字状态；
6. 写入同一个新聚合；
7. 强制持久化并校验；
8. 成功后为旧键写 tombstone 或删除；
9. 写 migrationVersion，保证重复执行幂等。

冲突规则：

- Counter 取 max，不相加；
- Distinct Set 取并集；
- Milestone 任一可信记录完成即完成；
- completed 任一可信记录完成即完成；
- claimed 任一可信记录已领取即已领取；
- Reward Ledger 中 granted 优先；
- 无法安全合并时进入 recovery_required 并记录诊断。

奖励安全优先于重复补发。

---

# 12. 持久化提交契约

当前 Database 的同名分块覆盖不满足 Reward Ledger 的崩溃原子性。

Quest Repository 应使用分代提交：

    interface QuestStoreManifest {
      generation: number;
      chunkCount: number;
      checksum: string;
      previousGeneration?: number;
    }

提交顺序：

1. 序列化完整玩家聚合；
2. 写 generation N+1 的独立 chunks；
3. 读取并校验长度和 checksum；
4. 最后切换 manifest；
5. 保留 generation N 作为回退；
6. 延迟清理更旧代。

读取顺序：

1. 读取 manifest；
2. 校验当前代；
3. 当前代损坏时回退 previousGeneration；
4. 记录恢复诊断；
5. 不得静默初始化为空并覆盖有价值状态。

性能上禁止每次普通进度事件都序列化全服所有玩家状态。

推荐按 cmid 哈希分片，或保存独立玩家聚合；Reward Ledger 状态转换和完成状态必须强制提交，普通 Counter 可按短窗口合并写入。

---

# 13. Preset Registry 与 Effective Catalog

运行时 Catalog：

    Preset Registry
    + Custom Quest Database
    + Server Overrides
    + Capability Availability
    + Gameplay Experiment Availability
    = Effective Quest Catalog

API：

    effectiveQuestCatalog.getAll()
    effectiveQuestCatalog.getById()
    effectiveQuestCatalog.getVisibleForPlayer()
    effectiveQuestCatalog.getActiveForEvent()
    effectiveQuestCatalog.getPack()
    effectiveQuestCatalog.getChapter()

Catalog 构建必须检查：

- 所有稳定 ID 唯一；
- Pack、Chapter、Quest 引用完整；
- Rule DAG 无环；
- Goal 和 Reward ID 在 Quest 内唯一；
- Selector 存在；
- Capability 存在或任务为 planned；
- active 主线不依赖 planned/C 级唯一前置；
- preset 与 custom ID 冲突时拒绝冲突项并记录错误，禁止后写覆盖。

## 13.1 Server Overrides

    interface PresetPackServerState {
      packId: string;
      enabled: boolean;
      rewardScale?: number;
      overrideQuestEnabled?: Record<string, boolean>;
      gameplayExperimentConfirmation?: Record<string, boolean>;
      updatedAt: number;
    }

管理员可以：

- 启用或关闭整包；
- 单独禁用任务；
- 设置奖励倍率；
- 查看缺失能力；
- 确认无法自动探测的实验；
- 复制预设为自定义。

管理员不得直接编辑官方预设对象。

## 13.2 奖励倍率

rewardScale 在任务完成时应用并冻结。

必须为各奖励类型定义：

- 取整方式；
- 最小值；
- 最大值；
- 不参与倍率的奖励类型。

任务完成后修改倍率不得影响已完成实例。

---

# 14. Capability Registry

    interface QuestCapability {
      id: string;
      version: number;
      state: "available" | "experimental" | "unavailable";
      source: string;
      verifiedAt?: number;
    }

示例：

    cap.minecraft.entity_kill.v1
    cap.minecraft.inventory_change.v1
    cap.snapshot.inventory.v1
    cap.snapshot.equipment.v1
    cap.player.dimension_enter.v1
    cap.player.biome_enter.v1
    cap.structure.enter.v1
    cap.challenge.mace_hit.v1

规则：

- A 级且能力已注册：允许 active；
- B 级：Adapter 原型和游戏内测试通过后注册；
- C 级：默认 planned；
- 缺失 Capability 时 availability = unavailable；
- unavailable 不计章节进度分母；
- B/C 级不得成为 A 级主线唯一硬前置；
- Capability 失效后保留玩家状态，不删除进度。

Reliability 是内容风险等级，Capability 是运行时事实，两者不得混为一个字段。

---

# 15. QuestEventBus 与 EventIndex

    interface QuestEvent {
      id: string;
      type: string;

      playerCmid: string;
      timestamp: number;

      payload: Record<string, unknown>;

      source: string;
      dedupeKey?: string;
    }

事件来源：

- Minecraft WorldAfterEvents；
- CreeperMenu 成功业务操作；
- Snapshot Reconcile；
- 经过验证的专用 Adapter。

CreeperMenu 内部事件必须在业务真正成功且状态已提交后 emit：

    creeper.menu.open
    creeper.waypoint.create
    creeper.tpa.complete
    creeper.random_tp.complete
    creeper.land.create
    creeper.public_waypoint.use
    creeper.market.trade
    creeper.red_packet
    creeper.guild.join_or_create

不得通过聊天消息、UI 按钮点击或数据库轮询猜测成功。

## 15.1 EventIndex

禁止：

    每个事件
    → 遍历所有 Quest
    → 遍历所有 Goal

索引至少支持：

    eventType
    eventType + 常见 selector

示例：

    entity.kill
    entity.kill:minecraft:zombie
    item.obtain:minecraft:diamond

索引候选还必须经过玩家级过滤：

- Quest Instance 已接受；
- Availability 可跟踪；
- 未 completed；
- hidden 且 trackWhileHidden 为 true 时允许；
- Capability 当前可用。

Catalog 或 Override 更新时重建索引版本。

## 15.2 去重

内部业务事件必须优先使用业务操作 ID 作为 dedupeKey。

EventBus 不得只用 Date.now 或随机值伪造可持久去重键。

对可能重复投递的可靠业务事件，玩家聚合应保留有界去重记录或由业务服务提供幂等操作证据。

---

# 16. 事件处理事务顺序

每个事件按以下顺序执行：

1. 验证事件和玩家身份；
2. 去重；
3. 在事件开始时锁定可参与 Goal 集合；
4. 应用 Counter、Distinct Counter 和 Milestone；
5. 计算 Goal / Quest 完成；
6. 冻结 Completion Snapshot；
7. 重新计算前置和章节解锁；
8. 按 unlockEventPolicy 决定是否向新解锁任务传播当前事件；
9. 对新解锁 Snapshot 标记立即 Reconcile；
10. 持久化玩家聚合；
11. 提交成功后发送通知。

默认 unlockEventPolicy = exclude。

需要把解锁事件计入后续任务时使用 include_once，例如第一颗钻石可计入钻石矿工。

第一次击败末影龙不得同时计入“第二次击败末影龙”，应使用 exclude 或持久 Boss Fact 的明确基线。

同一事件最多向同一 Goal 应用一次。

---

# 17. Snapshot Reconciler

Provider：

- InventorySnapshotProvider；
- EquipmentSnapshotProvider；
- EffectSnapshotProvider；
- NearbyWorldSnapshotProvider；
- CreeperMenuStateSnapshotProvider。

触发：

- 玩家加入；
- 接受任务；
- 解锁任务；
- 任务包重新启用；
- 背包变化；
- 可能影响装备的交互；
- 管理员重算；
- Preset Migration；
- Capability 恢复；
- 低频安全兜底。

背包变化时：

1. 标记玩家 inventory dirty；
2. 在批处理窗口内只构建一次 Inventory Summary；
3. 所有相关 Goal 复用该 Summary；
4. 不为每个 Goal 单独扫描背包。

Equipment 当前没有等价的完整槽位变化事件时，使用相关脏标记、接受/解锁扫描和低频兜底，不做每 tick 全服扫描。

Snapshot Reconcile 不伪造 item.obtain 历史。

---

# 18. 完成快照

任务完成瞬间冻结：

    interface QuestCompletionSnapshot {
      questId: string;
      instanceId: string;
      definitionVersion: number;

      title: string;
      description: string;
      rarity: QuestRarity;

      completedAt: number;
      rewardScale: number;
      rewards: FrozenQuestReward[];
    }

用途：

- 任务定义升级后仍领取原奖励；
- 任务包关闭后仍可领取；
- 自定义任务删除后仍可领取；
- 历史页面不依赖当前定义；
- 管理员奖励倍率变化不追溯。

完成快照必须与 completed 生命周期在同一次聚合提交中保存。

---

# 19. Reward Ledger

    interface RewardDeliveryState {
      rewardId: string;
      instanceId: string;

      state:
        | "pending"
        | "prepared"
        | "granted"
        | "recovery_required";

      idempotencyKey: string;

      preparedAt?: number;
      grantedAt?: number;

      handlerId: string;
      handlerVersion: number;
      error?: string;
    }

唯一键：

    playerCmid + instanceId + rewardId

Handler：

    interface QuestRewardHandler {
      id: string;
      version: number;

      idempotency:
        | "strong"
        | "recoverable"
        | "non_idempotent";

      validate(...): RewardValidationResult;
      grant(...): RewardGrantResult;
      recover?(...): RewardRecoveryResult;
    }

领奖流程：

    validate all frozen rewards
             ↓
    lifecycle = claiming
             ↓
    persist aggregate
             ↓

    each reward:
      prepared → persist
      execute handler
      granted  → persist

             ↓
    all granted
             ↓
    lifecycle = claimed
             ↓
    persist aggregate

崩溃恢复：

- strong：使用同一 idempotencyKey 安全重放；
- recoverable：先查询业务状态；
- non_idempotent：prepared 状态无法判断是否执行时进入 recovery_required；
- 禁止从第一项奖励盲目重放。

建议分类：

- 金币：扩展 Economy creditOnce(idempotencyKey)，目标为 strong；
- 可查询的 CreeperMenu 权益：recoverable；
- 普通物品、经验、任意命令：默认 non_idempotent；
- 单纯完成提示不作为高价值奖励，交给 Notification Service。

经济系统关闭、奖励配置失效或运行能力缺失时，不得静默标记 granted。应保留领奖资格并显示可恢复错误。

自动领奖只有在 Ledger 和恢复流程通过游戏内测试后开放。

---

# 20. Notification 与 HudMessageBroker

通知不能影响任务状态。

Notification Service 在玩家聚合提交成功后接收领域结果：

- Goal progress；
- Quest completed；
- Chapter unlocked；
- Reward claimed；
- Recovery required。

    interface QuestNotificationPolicy {
      progress: "none" | "milestones" | "every_change";
      progressMilestones?: number[];
      throttleTicks?: number;
      completion: "compact" | "fancy" | "banner";
    }

默认：

- Snapshot 扫描不提示；
- Counter 只在关键整数或 25% / 50% / 75% 提示；
- 普通完成使用 Compact Toast；
- 稀有使用 Fancy Toast 和轻音效；
- 史诗使用强化 Toast 和粒子；
- 传奇或章节 Boss 使用中央 Banner；
- 同 tick 多条完成进入 Toast Queue；
- 短时间 4 条以上允许折叠为汇总。

## 20.1 Broker API

    hudBroker.setPersistentStatus(player, status);

    hudBroker.showActionHint(player, message, {
      source: "waypoint",
      priority: 50,
      ttl: 40
    });

    hudBroker.enqueueQuestToast(player, toast);
    hudBroker.showChapterBanner(player, banner);
    hudBroker.clearSource(player, "quest");

Broker 至少管理：

- source；
- channel；
- priority；
- TTL；
- replaceKey；
- queue policy；
- restore policy；
- player disconnect cleanup。

所有业务模块最终不得直接竞争 setActionBar / setTitle。

## 20.2 HUD 原型闸门

普通 Add-On 没有无限 Script → JSON UI 独立数据通道。

Phase 2 必须用占位 UI 证明或否定：

- 常驻金币/TPS/在线人数；
- 普通 ActionBar 提示；
- Quest Toast；
- Chapter Banner；

是否可以稳定共存。

验收：

- 不闪烁；
- 不永久覆盖；
- TTL 后恢复；
- 连续 Toast 正确排队；
- PC 和 Pocket 不明显错位；
- HUD 故障不影响任务完成。

若无法完全同时显示，应通过原型结果修订传输协议，可选择：

- 单一复合 Broker 协议；
- Status 使用 ActionBar、Toast/Banner 使用 Title/Subtitle；
- 高优先级临时覆盖并可靠恢复。

原型未通过前禁止制作大量正式 Fancy HUD 美术。

Fancy HUD 故障时降级为 Title、ActionBar 或 Chat。

---

# 21. Quest Journal Query 与 UI

玩家 UI 不直接拼接 Catalog、State、Availability 和 Ledger。

Query API：

    questJournalQuery.getOverview(playerCmid)
    questJournalQuery.getPack(packId, playerCmid)
    questJournalQuery.getChapter(chapterId, playerCmid)
    questJournalQuery.getQuestDetail(instanceId, playerCmid)
    questJournalQuery.getClaimable(playerCmid)
    questJournalQuery.getHistory(playerCmid)

玩家顶层：

    📖 冒险手册

    主线冒险
    世界冒险
    新版本冒险
    苦力怕菜单
    隐藏挑战
    可领取奖励
    历史记录

普通玩家不得看到：

- event key；
- filter JSON；
- Goal ID；
- Reward ID；
- Adapter；
- Capability；
- Snapshot；
- technical recovery payload。

主线进度：

    completed contributing active quests
    /
    all contributing enabled and available quests

默认排除：

- hidden；
- contributesToProgress = false；
- unavailable；
- planned。

管理员 UI：

    服务器设置
    └─ 任务系统
       ├─ 自定义任务
       ├─ 默认预设任务包
       ├─ 奖励倍率
       ├─ 玩家任务提示
       ├─ HUD / Toast 诊断
       ├─ 实验能力诊断
       └─ 数据维护 / 迁移

第一阶段继续使用现有 CreeperActionFormData / CreeperModalFormData 包装器。

除非另有经过测试的设计，不修改 server_form.json 路由。任何后续菜单 JSON UI 改动必须继续满足 design/menu-ui/JSON_UI_ROUTING.md 和 tests/creeper-menu-json-ui.test.cjs。

---

# 22. 自定义任务编辑契约

Preset 和 Custom 共用：

- Domain；
- Goal 语义；
- EventBus；
- Snapshot Provider；
- Quest Instance；
- Reward Ledger。

但存储和管理分离。

旧自定义任务规范化：

    source = "custom"
    definitionVersion = 1
    rarity = "common"
    reliability = "A"
    releaseState = "active"
    hidden = false
    trackWhileHidden = false
    contributesToProgress = false
    unlockRule = always
    semantics = counter

所有保存的自定义定义也有 definitionVersion。

编辑兼容规则：

- 只改标题/描述：ID 不变；
- 兼容地调整 target：Goal ID 可不变，版本增加；
- 改变 Goal 语义：新 Goal ID 或显式迁移；
- 删除 Goal：保留已有历史实例；
- 修改奖励：只影响未来完成实例；
- 删除任务：从当前 Catalog 移除，历史实例保留；
- 保存前进行 ID 冲突、Selector、Capability 和奖励验证；
- 不允许标题改名重新生成 questId。

第一阶段管理员编辑器只开放可靠的 Counter、Snapshot 和 Milestone 子集。高级 Adapter Goal 只有在 Capability 注册后才可选择。

---

# 23. Preset 版本迁移

    interface PresetMigration {
      packId: string;
      fromVersion: number;
      toVersion: number;

      questIdMap?: Record<string, string>;
      goalIdMap?: Record<string, string>;
      rewardIdMap?: Record<string, string>;

      migrateDefinition(...): QuestDefinition;
      migrateInstance(...): QuestInstanceState;
    }

规则：

1. 只改文案：稳定 ID 不变；
2. 兼容调整 target：Goal ID 不变；
3. Goal 语义变化：显式迁移或新 Quest ID；
4. 删除任务：进入历史，不抹玩家记录；
5. 奖励变化：不修改已冻结 Completion Snapshot；
6. Selector 成员变化：增加 Selector version 并测试 Snapshot 影响；
7. 禁止重新生成整包导致进度归零；
8. Migration 必须幂等并支持 dry run；
9. 迁移前后记录诊断摘要。

---

# 24. 性能契约

禁止：

    每 tick
    × 所有玩家
    × 所有任务
    × 所有 Goals

必须使用：

- EventIndex；
- 玩家活跃实例过滤；
- Snapshot Dirty Flag；
- Provider 级 Summary 复用；
- 低频批量 Reconcile；
- 只为有相关 Goal 的玩家启用移动/距离追踪；
- Catalog 和 Journal Read Model 缓存；
- 普通进度短窗口合并持久化；
- 关键状态强制持久化。

在线时长只唤醒有 online_time Goal 的活跃实例。

Biome、Ride、Glide、距离类 Adapter 在 B 级原型阶段定义采样频率和误差界限，不使用无条件每 tick 全服扫描。

性能测试至少覆盖：

- 200 个定义；
- 20 个在线玩家；
- 每玩家 20 个活跃实例；
- 高频 entity.kill / inventory change；
- 同 tick 多任务完成；
- 大型玩家聚合分块提交。

---

# 25. 测试契约

## 25.1 Domain

必须测试：

- filter；
- counter；
- distinct counter；
- snapshot current / peak；
- milestone；
- all / any；
- Rule DAG；
- prerequisites；
- unlockEventPolicy；
- period；
- repeatable attempt；
- locked / available；
- suspended / unavailable；
- hidden；
- completion absorbing state；
- completion snapshot。

Phase 0 必须额外使用不发布的未来内容测试夹具：

- 完整铁甲 Composite Snapshot；
- 5 种幼年生物 Distinct Counter；
- 石镐 OR 铁锭章节解锁；
- 第一颗钻石传播到钻石矿工；
- 第一次击龙不计入第二次击龙；
- 隐藏任务静默跟踪；
- 缺失 Capability；
- repeatable 第 2 次实例。

## 25.2 Migration

必须测试：

- Quest / Goal / Reward ID；
- Pack v1 → v2；
- 玩家名 → cmid；
- 多个历史名字冲突；
- 数字 Goal State → 类型化状态；
- 删除任务历史；
- daily / weekly 历史保留；
- repeatable 独立实例；
- 迁移重复执行；
- 当前代损坏回退上一代。

## 25.3 Rewards

故障注入：

    Reward A granted
    Reward B execute
    crash before granted persist
    restart

验证：

- strong 使用同 key 恢复；
- recoverable 先查询；
- non_idempotent 不盲目复制；
- ambiguous 进入 recovery_required；
- 已完成实例不依赖当前定义；
- 包关闭仍可领取；
- 奖励倍率已冻结。

## 25.4 Event 与 Snapshot

必须测试：

- EventIndex 只唤醒相关 Goal；
- 同一事件不重复应用；
- dedupeKey；
- Snapshot Dirty 合并；
- 一次 Inventory Summary 服务多个 Goal；
- 任务解锁立即 Snapshot；
- suspended 不累计 Counter；
- 重开包重新 Snapshot。

## 25.5 HUD Broker

模拟：

    persistent status
    + PVP hint
    + Quest Toast
    + Chapter Banner

验证：

- priority；
- TTL；
- replaceKey；
- restore；
- queue；
- collapse burst；
- disconnect cleanup；
- transport failure fallback。

## 25.6 现有项目检查

每个 Phase 至少运行：

    npm run lint
    npm run typecheck
    npm test

涉及菜单 JSON UI：

    node --test tests/creeper-menu-json-ui.test.cjs

提交前构建：

    npm run build:standard
    npm run build:realms
    npm run build:bds
    npm run verify:realms-build

---

# 26. 游戏内验证矩阵

至少：

    PC
    Pocket

    Standard
    Realms
    BDS

验证：

- Counter；
- Snapshot；
- Milestone；
- 完整铁甲；
- 完成与领奖；
- 重启；
- 退出重进；
- 改名；
- 任务包关闭和重开；
- 连续 Toast；
- 常驻 HUD；
- ActionBar；
- Title；
- HUD 降级；
- Reward recovery；
- 管理员重算。

B/C Adapter 在加入 active Catalog 前必须单独记录真实游戏验证结果。

---

# 27. 开发阶段

禁止跳阶段。

## Phase 0：Domain 解耦

只做：

- 纯 Quest Domain；
- Clock、周期与规则注入；
- 类型化 Goal State；
- 未来内容测试夹具；
- 旧服务 Facade；
- 保持玩家可见行为不变。

纯 Domain 不 import @minecraft/server，可直接在 Node 测试。

## Phase 1：Catalog、状态与领奖

实现：

- Pack / Chapter / Preset Registry；
- Rule DAG；
- Selector Registry；
- Effective Catalog；
- Quest Instance；
- cmid Repository；
- 分代提交；
- Legacy Migration；
- Player Fact Store；
- Completion Snapshot；
- Reward Ledger；
- Custom Definition Normalizer。

不制作正式 Fancy HUD。

## Phase 2：事件、Snapshot 与 HUD 原型

实现：

- QuestEventBus；
- EventIndex；
- A 级 Adapter；
- Inventory / Equipment Snapshot；
- Snapshot Dirty Queue；
- Capability Registry；
- HudMessageBroker；
- 占位 Toast；
- transport prototype。

必须进 Minecraft 验证 HUD 共存与恢复。

## Phase 3：12 条纵向切片

只发布附录 B 的 12 条任务。

完整跑通：

    解锁
    → 接受
    → Counter
    → Snapshot
    → Equipment
    → 保存
    → 完成
    → Toast
    → 手动领奖
    → 重启
    → cmid
    → 关包
    → 重开
    → 历史

## Phase 4：正式 Fancy HUD

仅在 Phase 2 原型通过后实现：

- 正式 Quest Toast；
- Toast 动画；
- 音效；
- 粒子；
- Chapter Banner；
- Toast Queue；
- 玩家通知设置。

## Phase 5：扩展 A 级任务

顺序：

1. 剩余 Inventory Snapshot；
2. Equipment / Enchantment Snapshot；
3. Entity Kill；
4. Dimension；
5. CreeperMenu 内部业务成功事件。

## Phase 6：B 级 Adapter

按能力族逐项实现：

- Effect / Interact；
- Ride / Glide；
- Biome；
- Trade / Breed / Tame；
- Vault / Raid / Enchant；
- Nearby World State。

每类独立原型、测试和发布。

## Phase 7：C 级内容

最后考虑：

- Structure；
- 特殊战斗；
- 复杂新版本交互。

没有可靠判定时继续保持 planned，不使用错误代理条件。

---

# 28. 第一批 12 条实现要求

第一批必须使用稳定定义：

1. 第一捆木头；
2. 动手制作；
3. 石器时代；
4. 温暖的炉火；
5. 铁器时代；
6. 更好的镐；
7. 全副武装；
8. 第一颗钻石；
9. 钻石工具；
10. 黑曜石；
11. 另一个世界；
12. 烈焰猎人。

它们覆盖：

- item.obtain Counter；
- Inventory Snapshot；
- Equipment Composite Snapshot；
- entity.kill Counter；
- dimension_enter Milestone；
- Chapter 解锁；
- include_once / exclude；
- 完成快照；
- Reward Ledger；
- HUD Toast。

这 12 条未通过完整重启、迁移、领奖和任务包测试前，不扩完整预设库。

---

# 29. 最终验收

必须满足：

- [ ] 自定义任务继续工作；
- [ ] 预设与自定义来源分离；
- [ ] Pack / Chapter / Quest 内容图可验证；
- [ ] Quest / Goal / Reward / Selector / Capability 稳定 ID；
- [ ] 所有任务拥有 definitionVersion；
- [ ] 玩家状态主键切到 cmid；
- [ ] 旧名字数据可惰性迁移；
- [ ] daily / weekly / repeatable 历史不覆盖；
- [ ] Reward key 包含 instanceId；
- [ ] Counter、Distinct Counter、Snapshot、Milestone 分离；
- [ ] Snapshot current / peak 语义明确；
- [ ] 完成时冻结奖励快照和倍率；
- [ ] Reward Ledger 已实现；
- [ ] ambiguous crash 不自动复制奖励；
- [ ] 包关闭后已完成未领奖仍可领取；
- [ ] EventIndex 不全量扫描；
- [ ] Inventory Snapshot 复用 Summary；
- [ ] B/C 任务受 Capability 闸门控制；
- [ ] HUD 统一由 Broker 仲裁；
- [ ] Quest Toast 不破坏常驻 HUD；
- [ ] Fancy HUD 失败不影响任务状态；
- [ ] Domain 可在 Node 环境单测；
- [ ] Standard / Realms / BDS 构建通过；
- [ ] 第一批 12 条通过真实游戏矩阵。

---

# 30. 禁止事项

实现 AI 不得：

1. 先写 100 多条任务再补底层；
2. 把系统预设塞进自定义任务 DB；
3. 使用随机预设 ID；
4. 用 questId 单状态覆盖周期历史；
5. 让 repeatable 共用领奖键；
6. 用 item.obtain 冒充当前拥有；
7. 用物品变化冒充当前装备；
8. 用错误代理条件冒充结构发现；
9. 让 Quest 模块继续直接抢 ActionBar；
10. 假装所有奖励都能 exactly-once；
11. prepared 异常后从第一项盲目重放；
12. 继续用玩家名作为新版主键；
13. 因 Beta APIs 开启而假设 Gameplay Experiment 开启；
14. HUD 原型未通过就制作大量正式美术；
15. 让 planned/B/C 缺能力任务进入主线；
16. 把规则写成 eval 字符串；
17. 删除任务时抹除已完成玩家历史；
18. 奖励变更时改写已完成实例；
19. 在通知发送失败时回滚任务状态；
20. 跳过 Phase 0 至 Phase 2 直接实现完整预设库。

---

# 31. 预设内容共同原则

## 31.1 可靠性

- A：官方事件或当前状态可可靠读取；
- B：需要专用 Adapter / Reconcile，原型通过后上线；
- C：结构识别或复杂战斗语义，默认 planned。

## 31.2 回填

Counter：

- 默认从任务正式可用时开始；
- 不以当前库存伪造历史累计。

Snapshot：

- 解锁后立即扫描；
- 重新开包后立即扫描。

Milestone：

- current_state 只证明当前可观察事实；
- historical 必须有可信历史证据。

Structure / Challenge：

- 无可靠证据不回填。

## 31.3 奖励

默认奖励是建议值，服务器可设置 rewardScale。

奖励不应破坏原版流程，优先：

- 金币；
- 经验点；
- 少量消耗品；
- 后续称号、徽章和装饰。

经验奖励必须明确单位是经验点还是等级。默认 add_exp 表示经验点，等级奖励使用独立 action。

## 31.4 沙盒章节

Minecraft 不是强线性 RPG。

章节允许并行，只有明确剧情节点设置硬前置。

隐藏挑战不计主线完成度，hidden = true，通常 trackWhileHidden = true。

---

# 附录 A：完整预设任务目录

本附录保留 v1.0 内容库的全部任务表。表中的“可靠性”是内容评级，不代表对应 Capability 已实现。B/C 任务必须遵守主体中的发布闸门。

## 主线冒险｜第一章：生存启程

面向新玩家的第一小时。任务应自然完成，不要求机械刷量。默认自动开放。

| 稳定 Quest ID | 玩家名称 | 玩家说明 | 语义 | 实际判定 | 前置 | 回填策略 | 默认奖励 | 稀有度 | 可靠性 |
|---|---|---|---|---|---|---|---|---|---|
| `preset.core.survival.first_log` | 第一捆木头 | 开始收集最基础的建筑与制作材料。 | Counter | `item.obtain`：任意原木累计 4 个 | 无 | 不回填历史 Counter | 40 金币 + 10 经验 | 普通 | A |
| `preset.core.survival.crafting_table` | 动手制作 | 拥有第一个工作台。 | Snapshot | `item.possess`：当前拥有工作台 ≥1 | 章节开放 | 立即扫描背包 | 30 金币 + 10 经验 | 普通 | A |
| `preset.core.survival.stone_pickaxe` | 石器时代 | 进入石制工具阶段。 | Snapshot | 当前拥有石镐 ≥1 | 章节开放 | 立即扫描背包 | 50 金币 + 15 经验 | 普通 | A |
| `preset.core.survival.torches` | 黑暗中的光 | 准备第一批照明工具。 | Snapshot | 当前拥有火把 ≥8 | 章节开放 | 立即扫描背包 | 40 金币 + 10 经验 | 普通 | A |
| `preset.core.survival.furnace` | 温暖的炉火 | 拥有熔炉，开始冶炼。 | Snapshot | 当前拥有熔炉 ≥1 | 章节开放 | 立即扫描背包 | 50 金币 + 15 经验 | 普通 | A |
| `preset.core.survival.bed` | 今晚有地方睡了 | 拥有任意颜色的床。 | Snapshot | 当前拥有任意床 ≥1 | 章节开放 | 立即扫描背包 | 50 金币 + 15 经验 | 普通 | A |
| `preset.core.survival.shield` | 有备无患 | 拥有盾牌，进入更安全的生存阶段。 | Snapshot | 当前拥有盾牌 ≥1 | 章节开放 | 立即扫描背包 | 60 金币 + 20 经验 | 普通 | A |


## 主线冒险｜第二章：深入地底

完成“石器时代”或第一次获得铁锭后开放。开始正式区分“累计获得”和“当前拥有”。

| 稳定 Quest ID | 玩家名称 | 玩家说明 | 语义 | 实际判定 | 前置 | 回填策略 | 默认奖励 | 稀有度 | 可靠性 |
|---|---|---|---|---|---|---|---|---|---|
| `preset.core.mining.iron_ingots` | 铁器时代 | 累计获得足够的铁锭。 | Counter | `item.obtain`：铁锭累计 16 | 章节开放 | 不回填历史 Counter | 80 金币 + 25 经验 | 普通 | A |
| `preset.core.mining.iron_pickaxe` | 更好的镐 | 拥有铁镐。 | Snapshot | 当前拥有铁镐 ≥1 | 章节开放 | 立即扫描背包 | 70 金币 + 20 经验 | 普通 | A |
| `preset.core.mining.bucket` | 装下世界 | 拥有桶，为水、岩浆和其他玩法做准备。 | Snapshot | 当前拥有桶 ≥1 | 章节开放 | 立即扫描背包 | 60 金币 + 20 经验 | 普通 | A |
| `preset.core.mining.full_iron_armor` | 全副武装 | 当前真正穿着完整铁甲，而不是曾经捡到过。 | Composite Snapshot | 4 个稳定 Goal：铁头盔、铁胸甲、铁护腿、铁靴均装备 | 章节开放 | 立即扫描装备栏 | 180 金币 + 60 经验 | 稀有 | A |
| `preset.core.mining.redstone` | 地底红光 | 累计获得红石。 | Counter | 红石累计获得 16 | 章节开放 | 不回填历史 Counter | 70 金币 + 20 经验 | 普通 | A |
| `preset.core.mining.lapis` | 青金之蓝 | 累计获得青金石。 | Counter | 青金石累计获得 16 | 章节开放 | 不回填历史 Counter | 70 金币 + 20 经验 | 普通 | A |
| `preset.core.mining.first_diamond` | 第一颗钻石 | 获得第一颗钻石。 | Counter Milestone | 钻石累计获得 1 | 章节开放 | 不回填历史 Counter | 150 金币 + 60 经验 | 稀有 | A |
| `preset.core.mining.diamond_miner` | 钻石矿工 | 累计获得 10 颗钻石。 | Counter | 钻石累计获得 10 | 第一颗钻石 | 不回填历史 Counter | 250 金币 + 100 经验 | 稀有 | A |
| `preset.core.mining.diamond_pickaxe` | 钻石工具 | 当前拥有钻石镐。 | Snapshot | 当前拥有钻石镐 ≥1 | 第一颗钻石 | 立即扫描背包 | 180 金币 + 70 经验 | 稀有 | A |
| `preset.core.mining.obsidian` | 黑曜石 | 累计获得足够搭建下界传送门的黑曜石。 | Counter | 黑曜石累计获得 10 | 钻石工具 | 不回填历史 Counter | 200 金币 + 80 经验 | 稀有 | A |


## 主线冒险｜第三章：知识与附魔

与下界章节可以并行。目标是让玩家接触附魔和经验系统。

| 稳定 Quest ID | 玩家名称 | 玩家说明 | 语义 | 实际判定 | 前置 | 回填策略 | 默认奖励 | 稀有度 | 可靠性 |
|---|---|---|---|---|---|---|---|---|---|
| `preset.core.magic.enchanting_table` | 魔法之书 | 拥有附魔台。 | Snapshot | 当前拥有附魔台 ≥1 | 获得钻石或青金石 | 扫描背包 | 160 金币 + 70 经验 | 稀有 | A |
| `preset.core.magic.bookshelves` | 知识储备 | 准备 15 个书架。 | Snapshot | 当前拥有书架 ≥15 | 章节开放 | 扫描背包 | 180 金币 + 80 经验 | 稀有 | A |
| `preset.core.magic.first_enchant` | 第一次附魔 | 真正完成一次附魔行为。 | Milestone | `enchant.apply` 成功一次 | 章节开放 | 默认不历史回填 | 200 金币 + 90 经验 | 稀有 | B |
| `preset.core.magic.anvil` | 铁砧与经验 | 拥有铁砧。 | Snapshot | 当前拥有铁砧 ≥1 | 章节开放 | 扫描背包 | 120 金币 + 50 经验 | 普通 | A |
| `preset.core.magic.enchanted_book` | 书中的力量 | 拥有任意附魔书。 | Snapshot | 当前拥有附魔书 ≥1 | 章节开放 | 扫描背包 | 150 金币 + 60 经验 | 稀有 | A |


## 主线冒险｜第四章：下界远征

获得黑曜石或第一次进入下界后开放。下界合金属于高级目标，不作为打龙硬前置。

| 稳定 Quest ID | 玩家名称 | 玩家说明 | 语义 | 实际判定 | 前置 | 回填策略 | 默认奖励 | 稀有度 | 可靠性 |
|---|---|---|---|---|---|---|---|---|---|
| `preset.core.nether.enter` | 另一个世界 | 第一次进入下界。 | Milestone | `player.dimension_enter` = nether | 章节开放 | 若玩家当前就在下界，可回填 | 250 金币 + 100 经验 | 稀有 | A |
| `preset.core.nether.quartz` | 来自下界的晶体 | 累计获得下界石英。 | Counter | 下界石英累计 16 | 进入下界 | 不回填 Counter | 100 金币 + 35 经验 | 普通 | A |
| `preset.core.nether.piglin_barter` | 金色朋友 | 与猪灵完成一次以物易物。 | Milestone | 专用 Adapter 确认猪灵 barter 成功 | 进入下界 | 不回填 | 180 金币 + 70 经验 | 稀有 | B |
| `preset.core.nether.blaze_hunter` | 烈焰猎人 | 击杀 5 个烈焰人。 | Counter | `entity.kill`：blaze ×5 | 进入下界 | 不回填 | 200 金币 + 80 经验 | 稀有 | A |
| `preset.core.nether.blaze_rods` | 烈焰力量 | 累计获得 8 根烈焰棒。 | Counter | 烈焰棒累计 8 | 进入下界 | 不回填 | 220 金币 + 90 经验 | 稀有 | A |
| `preset.core.nether.nether_wart` | 诡异植物 | 当前拥有下界疣。 | Snapshot | 当前拥有下界疣 ≥1 | 进入下界 | 扫描背包 | 120 金币 + 40 经验 | 普通 | A |
| `preset.core.nether.brewing_stand` | 炼药开始 | 当前拥有酿造台。 | Snapshot | 当前拥有酿造台 ≥1 | 烈焰力量 | 扫描背包 | 150 金币 + 60 经验 | 普通 | A |
| `preset.core.nether.ancient_debris` | 远古残骸 | 获得第一块远古残骸。 | Counter Milestone | 远古残骸累计获得 1 | 进入下界 | 不回填 | 300 金币 + 120 经验 | 史诗 | A |
| `preset.core.nether.netherite_ingot` | 下界合金 | 当前拥有至少 1 个下界合金锭。 | Snapshot | 当前拥有下界合金锭 ≥1 | 远古残骸 | 扫描背包 | 500 金币 + 180 经验 | 史诗 | A |


## 主线冒险｜第五章：末路之眼

获得烈焰棒后开放。结构发现属于较低可靠性，不要用错误代理条件。

| 稳定 Quest ID | 玩家名称 | 玩家说明 | 语义 | 实际判定 | 前置 | 回填策略 | 默认奖励 | 稀有度 | 可靠性 |
|---|---|---|---|---|---|---|---|---|---|
| `preset.core.eye.ender_pearls` | 珍珠猎人 | 累计获得末影珍珠。 | Counter | 末影珍珠累计 12 | 章节开放 | 不回填 | 160 金币 + 60 经验 | 稀有 | A |
| `preset.core.eye.blaze_powder` | 烈焰粉末 | 当前拥有足够烈焰粉。 | Snapshot | 当前拥有烈焰粉 ≥12 | 章节开放 | 扫描背包 | 120 金币 + 50 经验 | 普通 | A |
| `preset.core.eye.eyes` | 末影之眼 | 当前拥有末影之眼 ≥12。 | Snapshot | 当前拥有末影之眼 ≥12 | 章节开放 | 扫描背包 | 220 金币 + 80 经验 | 稀有 | A |
| `preset.core.eye.stronghold` | 远古要塞 | 真正发现/进入要塞。 | Structure Milestone | `stronghold.discover` / `structure.enter` | 末影之眼 | 只有可信结构历史才能回填 | 300 金币 + 120 经验 | 史诗 | C |
| `preset.core.eye.enter_end` | 门后的世界 | 第一次进入末地。 | Milestone | `player.dimension_enter` = the_end | 章节开放 | 若当前就在末地，可回填 | 600 金币 + 250 经验 | 史诗 | A |


## 主线冒险｜第六章：终末之战

进入末地后开放。保持短、强仪式感。

| 稳定 Quest ID | 玩家名称 | 玩家说明 | 语义 | 实际判定 | 前置 | 回填策略 | 默认奖励 | 稀有度 | 可靠性 |
|---|---|---|---|---|---|---|---|---|---|
| `preset.core.end.kill_dragon` | 龙之末路 | 玩家归因击败末影龙。 | Milestone | `entity.kill` / Boss Adapter：ender_dragon | 进入末地 | 仅有可信 Boss 历史时回填 | 3000 金币 + 2000 经验 | 传奇 | A |
| `preset.core.end.dragon_breath` | 来自巨龙的气息 | 当前拥有龙息。 | Snapshot | 当前拥有龙息 ≥1 | 进入末地 | 扫描背包 | 300 金币 + 120 经验 | 稀有 | A |
| `preset.core.end.gateway` | 新的道路 | 通过末地折跃门前往外岛。 | Milestone | 专用末地 Gateway / 区域 Adapter | 龙之末路 | 可按当前区域谨慎回填 | 500 金币 + 180 经验 | 史诗 | B |


## 主线冒险｜第七章：末地远征

击败末影龙后开放，继续引导末地城、潜影盒和鞘翅。

| 稳定 Quest ID | 玩家名称 | 玩家说明 | 语义 | 实际判定 | 前置 | 回填策略 | 默认奖励 | 稀有度 | 可靠性 |
|---|---|---|---|---|---|---|---|---|---|
| `preset.core.endcity.chorus` | 奇异果实 | 当前拥有紫颂果。 | Snapshot | 当前拥有紫颂果 ≥1 | 章节开放 | 扫描背包 | 120 金币 + 40 经验 | 普通 | A |
| `preset.core.endcity.shulkers` | 末地居民 | 击杀潜影贝 5 只。 | Counter | `entity.kill`：shulker ×5 | 章节开放 | 不回填 | 300 金币 + 100 经验 | 稀有 | A |
| `preset.core.endcity.shells` | 坚硬外壳 | 累计获得潜影壳 4 个。 | Counter | 潜影壳累计获得 4 | 章节开放 | 不回填 | 250 金币 + 90 经验 | 稀有 | A |
| `preset.core.endcity.city` | 末地文明 | 真正发现/进入末地城。 | Structure Milestone | `structure.enter`：end_city | 章节开放 | 仅可靠结构历史可回填 | 400 金币 + 150 经验 | 史诗 | C |
| `preset.core.endcity.elytra` | 展开翅膀 | 当前拥有鞘翅。 | Snapshot | 当前拥有鞘翅 ≥1 | 章节开放 | 扫描背包 | 1200 金币 + 600 经验 | 传奇 | A |
| `preset.core.endcity.shulker_box` | 随身仓库 | 当前拥有任意潜影盒。 | Snapshot | 当前拥有任意潜影盒 ≥1 | 章节开放 | 扫描背包 | 350 金币 + 120 经验 | 史诗 | A |
| `preset.core.endcity.fly` | 飞向天空 | 真正进入一次鞘翅滑翔状态。 | Milestone | `player.glide` Adapter | 展开翅膀 | 不历史回填 | 500 金币 + 180 经验 | 史诗 | B |


## 主线冒险｜第八章：世界巅峰

终局 Boss 与信标。不会阻塞其他世界支线。

| 稳定 Quest ID | 玩家名称 | 玩家说明 | 语义 | 实际判定 | 前置 | 回填策略 | 默认奖励 | 稀有度 | 可靠性 |
|---|---|---|---|---|---|---|---|---|---|
| `preset.core.apex.wither_skulls` | 三颗头颅 | 当前拥有 3 个凋零骷髅头。 | Snapshot | 当前拥有凋零骷髅头 ≥3 | 章节开放 | 扫描背包 | 500 金币 + 180 经验 | 史诗 | A |
| `preset.core.apex.kill_wither` | 凋零终结 | 玩家归因击败凋零。 | Milestone | `entity.kill` / Boss Adapter：wither | 章节开放 | 仅可靠 Boss 历史回填 | 2000 金币 + 1200 经验 | 传奇 | A |
| `preset.core.apex.nether_star` | 下界之星 | 当前拥有下界之星。 | Snapshot | 当前拥有下界之星 ≥1 | 章节开放 | 扫描背包 | 600 金币 + 220 经验 | 史诗 | A |
| `preset.core.apex.beacon` | 指引之光 | 当前拥有信标。 | Snapshot | 当前拥有信标 ≥1 | 下界之星 | 扫描背包 | 600 金币 + 220 经验 | 史诗 | A |
| `preset.core.apex.full_beacon` | 世界巅峰 | 检测玩家完成满级信标激活。 | Snapshot / Milestone | 专用 Beacon Adapter 验证满级金字塔与激活状态 | 指引之光 | 允许扫描当前状态 | 2500 金币 + 1500 经验 | 传奇 | B |


## 世界冒险｜村庄与袭击

独立支线，不影响主线通关。

| 稳定 Quest ID | 玩家名称 | 玩家说明 | 语义 | 实际判定 | 前置 | 回填策略 | 默认奖励 | 稀有度 | 可靠性 |
|---|---|---|---|---|---|---|---|---|---|
| `preset.world.village.first_trade` | 文明的踪迹 | 与村民成功交易一次。 | Milestone | `villager.trade` 成功 | 支线开放 | 不回填 | 100 金币 + 35 经验 | 普通 | B |
| `preset.world.village.trader` | 绿宝石商人 | 成功完成 10 次村民交易。 | Counter | `villager.trade` ×10 | 文明的踪迹 | 不回填 | 200 金币 + 70 经验 | 稀有 | B |
| `preset.world.village.cure` | 村民的救赎 | 成功治愈一名僵尸村民。 | Milestone | `zombie_villager.cure` Adapter | 支线开放 | 不回填 | 350 金币 + 120 经验 | 史诗 | B |
| `preset.world.village.ominous_bottle` | 不祥之物 | 当前拥有任意不祥之瓶。 | Snapshot | 当前拥有不祥之瓶 ≥1 | 支线开放 | 扫描背包 | 180 金币 + 60 经验 | 稀有 | A |
| `preset.world.village.raid` | 保卫村庄 | 成功完成一次袭击。 | Milestone | `raid.win` | 不祥之物 | 只有可信袭击历史才回填 | 700 金币 + 260 经验 | 史诗 | B |
| `preset.world.village.totem` | 不死之力 | 当前拥有不死图腾。 | Snapshot | 当前拥有不死图腾 ≥1 | 支线开放 | 扫描背包 | 500 金币 + 180 经验 | 史诗 | A |


## 世界冒险｜海洋探险

围绕藏宝、海底神殿和潮涌核心。

| 稳定 Quest ID | 玩家名称 | 玩家说明 | 语义 | 实际判定 | 前置 | 回填策略 | 默认奖励 | 稀有度 | 可靠性 |
|---|---|---|---|---|---|---|---|---|---|
| `preset.world.ocean.enter` | 深蓝世界 | 进入海洋类生物群系。 | Milestone | `player.biome_enter`：ocean category | 支线开放 | 当前 biome 可回填 | 120 金币 + 40 经验 | 普通 | B |
| `preset.world.ocean.treasure_map` | 沉船线索 | 当前拥有藏宝图。 | Snapshot | 当前拥有藏宝图 ≥1 | 支线开放 | 扫描背包 | 150 金币 + 50 经验 | 稀有 | B |
| `preset.world.ocean.heart` | 海洋之心 | 当前拥有海洋之心。 | Snapshot | 当前拥有海洋之心 ≥1 | 支线开放 | 扫描背包 | 350 金币 + 120 经验 | 史诗 | A |
| `preset.world.ocean.guardians` | 深海守卫 | 击杀守卫者 10 只。 | Counter | `entity.kill`：guardian ×10 | 支线开放 | 不回填 | 220 金币 + 80 经验 | 稀有 | A |
| `preset.world.ocean.elder_guardian` | 古老守护者 | 击杀远古守卫者。 | Milestone | `entity.kill`：elder_guardian | 支线开放 | 不回填 | 600 金币 + 220 经验 | 史诗 | A |
| `preset.world.ocean.sponge` | 海绵收藏 | 当前拥有海绵或湿海绵。 | Snapshot | 当前拥有 sponge / wet_sponge ≥1 | 支线开放 | 扫描背包 | 220 金币 + 80 经验 | 稀有 | A |
| `preset.world.ocean.conduit` | 海神之力 | 让玩家附近存在有效激活的潮涌核心。 | Snapshot | Conduit Adapter 检测激活状态 | 海洋之心 | 允许扫描当前状态 | 700 金币 + 260 经验 | 史诗 | B |


## 世界冒险｜考古之旅

围绕刷子、陶片、装饰陶罐和嗅探兽。

| 稳定 Quest ID | 玩家名称 | 玩家说明 | 语义 | 实际判定 | 前置 | 回填策略 | 默认奖励 | 稀有度 | 可靠性 |
|---|---|---|---|---|---|---|---|---|---|
| `preset.world.archaeology.brush` | 一把刷子 | 当前拥有刷子。 | Snapshot | 当前拥有刷子 ≥1 | 支线开放 | 扫描背包 | 80 金币 + 25 经验 | 普通 | A |
| `preset.world.archaeology.brush_suspicious` | 历史的尘土 | 使用刷子成功从可疑沙/砂砾刷出物品。 | Milestone | 专用 Brush Adapter | 一把刷子 | 不回填 | 160 金币 + 55 经验 | 稀有 | B |
| `preset.world.archaeology.sherd` | 历史碎片 | 当前拥有任意陶片。 | Snapshot | 当前拥有任意 pottery sherd ≥1 | 支线开放 | 扫描背包 | 180 金币 + 60 经验 | 稀有 | A |
| `preset.world.archaeology.pot` | 古代文明 | 当前拥有装饰陶罐。 | Snapshot | 当前拥有 decorated pot ≥1 | 历史碎片 | 扫描背包 | 220 金币 + 80 经验 | 稀有 | A |
| `preset.world.archaeology.sniffer_egg` | 失落的生命 | 当前拥有嗅探兽蛋。 | Snapshot | 当前拥有 sniffer egg ≥1 | 支线开放 | 扫描背包 | 450 金币 + 160 经验 | 史诗 | A |
| `preset.world.archaeology.ancient_plants` | 远古花园 | 同时拥有火把花种子与瓶子草荚果。 | Composite Snapshot | 两个稳定 Goal 均满足 | 失落的生命 | 扫描背包 | 350 金币 + 120 经验 | 史诗 | A |


## 世界冒险｜寂静深处

不要把击杀监守者设成普通主线；它放到隐藏挑战。

| 稳定 Quest ID | 玩家名称 | 玩家说明 | 语义 | 实际判定 | 前置 | 回填策略 | 默认奖励 | 稀有度 | 可靠性 |
|---|---|---|---|---|---|---|---|---|---|
| `preset.world.deepdark.sculk` | 幽匿蔓延 | 当前拥有幽匿块。 | Snapshot | 当前拥有 sculk ≥1 | 支线开放 | 扫描背包 | 120 金币 + 40 经验 | 普通 | A |
| `preset.world.deepdark.enter` | 深暗之地 | 进入深暗之域。 | Milestone | `player.biome_enter`：deep_dark | 支线开放 | 当前 biome 可回填 | 220 金币 + 80 经验 | 稀有 | B |
| `preset.world.deepdark.ancient_city` | 失落城市 | 真正发现/进入古城。 | Structure Milestone | `structure.enter`：ancient_city | 深暗之地 | 只有可信结构历史可回填 | 450 金币 + 160 经验 | 史诗 | C |
| `preset.world.deepdark.echo_shard` | 过去的回声 | 当前拥有 8 个回响碎片。 | Snapshot | 当前拥有 echo shard ≥8 | 支线开放 | 扫描背包 | 450 金币 + 160 经验 | 史诗 | A |
| `preset.world.deepdark.recovery_compass` | 回家的方向 | 当前拥有追溯指针。 | Snapshot | 当前拥有 recovery compass ≥1 | 过去的回声 | 扫描背包 | 500 金币 + 180 经验 | 史诗 | A |
| `preset.world.deepdark.swift_sneak` | 悄无声息 | 当前持有带迅捷潜行的附魔书或装备。 | Snapshot | 读取 ItemStack enchantment component | 支线开放 | 扫描背包/装备 | 600 金币 + 220 经验 | 史诗 | B |


## 世界冒险｜试炼密室

围绕旋风人、钥匙、宝库、不祥试炼、重型核心与重锤。

| 稳定 Quest ID | 玩家名称 | 玩家说明 | 语义 | 实际判定 | 前置 | 回填策略 | 默认奖励 | 稀有度 | 可靠性 |
|---|---|---|---|---|---|---|---|---|---|
| `preset.world.trials.enter` | 试炼开始 | 真正进入试炼密室。 | Structure Milestone | `structure.enter`：trial_chamber | 支线开放 | 仅可靠结构历史可回填 | 250 金币 + 90 经验 | 稀有 | C |
| `preset.world.trials.breeze` | 风之敌 | 击杀旋风人 3 只。 | Counter | `entity.kill`：breeze ×3 | 支线开放 | 不回填 | 250 金币 + 90 经验 | 稀有 | A |
| `preset.world.trials.breeze_rod` | 风的力量 | 当前拥有旋风棒。 | Snapshot | 当前拥有 breeze rod ≥1 | 支线开放 | 扫描背包 | 220 金币 + 80 经验 | 稀有 | A |
| `preset.world.trials.trial_key` | 试炼钥匙 | 当前拥有试炼钥匙。 | Snapshot | 当前拥有 trial key ≥1 | 支线开放 | 扫描背包 | 220 金币 + 80 经验 | 稀有 | A |
| `preset.world.trials.vault` | 宝库 | 使用钥匙真正打开一次普通宝库。 | Milestone | `vault.unlock` 普通宝库 | 试炼钥匙 | 不回填 | 350 金币 + 120 经验 | 史诗 | B |
| `preset.world.trials.ominous` | 不祥试炼 | 获得试炼之兆 / 进入不祥试炼状态。 | Milestone | `effect.gain` 或 Ominous Trial Adapter | 支线开放 | 当前 effect 可回填 | 350 金币 + 120 经验 | 史诗 | B |
| `preset.world.trials.ominous_key` | 不祥钥匙 | 当前拥有不祥试炼钥匙。 | Snapshot | 当前拥有 ominous trial key ≥1 | 不祥试炼 | 扫描背包 | 400 金币 + 140 经验 | 史诗 | A |
| `preset.world.trials.heavy_core` | 重型核心 | 当前拥有重型核心。 | Snapshot | 当前拥有 heavy core ≥1 | 支线开放 | 扫描背包 | 700 金币 + 260 经验 | 史诗 | A |
| `preset.world.trials.mace` | 重锤 | 当前拥有重锤。 | Snapshot | 当前拥有 mace ≥1 | 重型核心 | 扫描背包 | 1000 金币 + 400 经验 | 传奇 | A |


## 世界冒险｜农牧生活

轻量生活支线。

| 稳定 Quest ID | 玩家名称 | 玩家说明 | 语义 | 实际判定 | 前置 | 回填策略 | 默认奖励 | 稀有度 | 可靠性 |
|---|---|---|---|---|---|---|---|---|---|
| `preset.world.farm.plant` | 第一块农田 | 成功种植 16 次基础作物。 | Counter | `crop.plant` ×16 | 支线开放 | 不回填 | 100 金币 + 30 经验 | 普通 | B |
| `preset.world.farm.harvest` | 丰收时刻 | 收获成熟作物 64 次/单位。 | Counter | `crop.harvest` 累计 64 | 支线开放 | 不回填 | 180 金币 + 60 经验 | 稀有 | B |
| `preset.world.farm.breed` | 新生命 | 成功繁殖一次动物。 | Milestone | `entity.breed` | 支线开放 | 不回填 | 120 金币 + 40 经验 | 普通 | B |
| `preset.world.farm.rancher` | 牧场主 | 成功繁殖 10 次动物。 | Counter | `entity.breed` ×10 | 新生命 | 不回填 | 260 金币 + 90 经验 | 稀有 | B |
| `preset.world.farm.tame` | 忠诚伙伴 | 驯服狼或猫。 | Milestone | `entity.tame`：wolf/cat | 支线开放 | 有可靠驯服历史才回填 | 220 金币 + 80 经验 | 稀有 | B |
| `preset.world.farm.honey` | 甜蜜收获 | 当前拥有蜂蜜瓶。 | Snapshot | 当前拥有 honey bottle ≥1 | 支线开放 | 扫描背包 | 120 金币 + 40 经验 | 普通 | A |


## 世界冒险｜红石与自动化

覆盖常用自动化组件，不要求复杂红石工程。

| 稳定 Quest ID | 玩家名称 | 玩家说明 | 语义 | 实际判定 | 前置 | 回填策略 | 默认奖励 | 稀有度 | 可靠性 |
|---|---|---|---|---|---|---|---|---|---|
| `preset.world.redstone.redstone` | 红石入门 | 当前拥有 16 个红石。 | Snapshot | 当前拥有 redstone ≥16 | 支线开放 | 扫描背包 | 80 金币 + 25 经验 | 普通 | A |
| `preset.world.redstone.piston` | 推动世界 | 当前拥有活塞。 | Snapshot | 当前拥有 piston ≥1 | 红石入门 | 扫描背包 | 100 金币 + 35 经验 | 普通 | A |
| `preset.world.redstone.observer` | 观察者 | 当前拥有侦测器。 | Snapshot | 当前拥有 observer ≥1 | 红石入门 | 扫描背包 | 100 金币 + 35 经验 | 普通 | A |
| `preset.world.redstone.comparator` | 比较与信号 | 当前拥有红石比较器。 | Snapshot | 当前拥有 comparator ≥1 | 红石入门 | 扫描背包 | 100 金币 + 35 经验 | 普通 | A |
| `preset.world.redstone.hopper` | 物流开始 | 当前拥有漏斗。 | Snapshot | 当前拥有 hopper ≥1 | 红石入门 | 扫描背包 | 100 金币 + 35 经验 | 普通 | A |
| `preset.world.redstone.crafter` | 自动合成 | 当前拥有自动合成器。 | Snapshot | 当前拥有 crafter ≥1 | 红石入门 | 扫描背包 | 180 金币 + 60 经验 | 稀有 | A |
| `preset.world.redstone.crafter_use` | 机器启动 | 自动合成器成功输出一次物品。 | Milestone | `crafter.output` Adapter | 自动合成 | 不回填 | 260 金币 + 90 经验 | 稀有 | B |


## 世界冒险｜苍白之园

正式世界支线，围绕苍白之园、嘎枝与树脂。

| 稳定 Quest ID | 玩家名称 | 玩家说明 | 语义 | 实际判定 | 前置 | 回填策略 | 默认奖励 | 稀有度 | 可靠性 |
|---|---|---|---|---|---|---|---|---|---|
| `preset.world.pale_garden.enter` | 苍白之地 | 进入苍白之园生物群系。 | Milestone | `player.biome_enter`：pale_garden | 支线开放 | 当前 biome 可回填 | 180 金币 + 60 经验 | 稀有 | B |
| `preset.world.pale_garden.pale_oak` | 苍白木材 | 当前拥有苍白橡木原木。 | Snapshot | 当前拥有 pale oak log ≥1 | 支线开放 | 扫描背包 | 100 金币 + 35 经验 | 普通 | A |
| `preset.world.pale_garden.creaking` | 森林中的凝视 | 与嘎枝产生一次有效接触或战斗。 | Milestone | 专用 creaking encounter Adapter | 苍白之地 | 默认不回填 | 250 金币 + 90 经验 | 稀有 | B |
| `preset.world.pale_garden.heart` | 它的心脏 | 当前拥有嘎枝之心。 | Snapshot | 当前拥有 creaking heart ≥1 | 支线开放 | 扫描背包 | 350 金币 + 120 经验 | 史诗 | A |
| `preset.world.pale_garden.resin` | 树脂收藏 | 当前拥有树脂相关核心物品。 | Snapshot | 当前拥有 resin clump / resin block 等 ≥1 | 支线开放 | 扫描背包 | 220 金币 + 80 经验 | 稀有 | A |


## 苦力怕菜单｜新手指南

这些任务必须在 CreeperMenu 业务真正成功后 emit 内部事件，不要通过轮询或聊天猜。

| 稳定 Quest ID | 玩家名称 | 玩家说明 | 语义 | 实际判定 | 前置 | 回填策略 | 默认奖励 | 稀有度 | 可靠性 |
|---|---|---|---|---|---|---|---|---|---|
| `preset.creeper.guide.open_menu` | 第一次打开苦力怕菜单 | 打开一次主菜单。 | Milestone | `creeper.menu.open` | 无 | 不回填 | 30 金币 + 10 经验 | 普通 | A |
| `preset.creeper.guide.waypoint` | 记住这里 | 创建第一个个人路点。 | Milestone | `creeper.waypoint.create` 成功 | 打开菜单 | 可按现有路点状态回填 | 80 金币 + 25 经验 | 普通 | A |
| `preset.creeper.guide.tpa` | 来我这里 | 成功完成一次 TPA。 | Milestone | `creeper.tpa.complete` | 打开菜单 | 不回填 | 100 金币 + 35 经验 | 普通 | A |
| `preset.creeper.guide.random_tp` | 去远方看看 | 成功完成一次随机传送。 | Milestone | `creeper.random_tp.complete` | 打开菜单 | 不回填 | 80 金币 + 25 经验 | 普通 | A |
| `preset.creeper.guide.land` | 我的地盘 | 创建第一块领地。 | Milestone | `creeper.land.create` | 打开菜单 | 可按当前领地所有权回填 | 200 金币 + 70 经验 | 稀有 | A |
| `preset.creeper.guide.public_waypoint` | 服务器地标 | 成功使用一次公共路点。 | Milestone | `creeper.public_waypoint.use` | 打开菜单 | 不回填 | 80 金币 + 25 经验 | 普通 | A |
| `preset.creeper.guide.market` | 第一笔生意 | 玩家市场成功完成一次买入或卖出。 | Milestone | `creeper.market.trade` | 打开菜单 | 可靠交易流水可回填 | 180 金币 + 60 经验 | 稀有 | A |
| `preset.creeper.guide.red_packet` | 分享快乐 | 成功发出或领取一次红包。 | Milestone | `creeper.red_packet` | 打开菜单 | 可靠红包记录可回填 | 120 金币 + 40 经验 | 普通 | A |
| `preset.creeper.guide.guild` | 找到伙伴 | 加入或创建公会。 | Milestone | `creeper.guild.join_or_create` | 打开菜单 | 当前公会状态可回填 | 200 金币 + 70 经验 | 稀有 | A |


## 新版本冒险｜铜器时代

正式内容。围绕铜装备、铜傀儡、铜箱子与架子。

| 稳定 Quest ID | 玩家名称 | 玩家说明 | 语义 | 实际判定 | 前置 | 回填策略 | 默认奖励 | 稀有度 | 可靠性 |
|---|---|---|---|---|---|---|---|---|---|
| `preset.update.copper.ingots` | 铜矿工 | 累计获得 32 个铜锭。 | Counter | 铜锭累计 32 | 任务包开启 | 不回填 Counter | 120 金币 + 40 经验 | 普通 | A |
| `preset.update.copper.pickaxe` | 铜器时代 | 当前拥有铜镐。 | Snapshot | 当前拥有 copper pickaxe ≥1 | 任务包开启 | 扫描背包 | 120 金币 + 40 经验 | 普通 | A |
| `preset.update.copper.full_armor` | 全套铜装 | 当前穿着完整铜甲。 | Composite Snapshot | 4 个 equipment.match Goal | 任务包开启 | 扫描装备栏 | 260 金币 + 90 经验 | 稀有 | A |
| `preset.update.copper.golem` | 机械伙伴 | 玩家成功生成一个铜傀儡。 | Milestone | `copper_golem.create` Adapter | 任务包开启 | 有可靠归属历史才回填 | 350 金币 + 120 经验 | 史诗 | B |
| `preset.update.copper.chest` | 智能仓库 | 当前拥有铜箱子。 | Snapshot | 当前拥有 copper chest ≥1 | 任务包开启 | 扫描背包 | 220 金币 + 80 经验 | 稀有 | A |
| `preset.update.copper.sorting` | 自动整理 | 铜傀儡完成一次取物并放入匹配箱子的完整循环。 | Milestone | `copper_golem.sort_success` | 机械伙伴 | 不回填 | 500 金币 + 180 经验 | 史诗 | B |
| `preset.update.copper.shelf` | 展示架 | 成功向架子放入或交换一次物品。 | Milestone | `player.interact_block` + shelf Adapter | 任务包开启 | 不回填 | 180 金币 + 60 经验 | 稀有 | B |


## 新版本冒险｜追逐天空

围绕干枯恶魂 → 小恶魂 → 快乐恶魂 → 缰绳 → 飞行。

| 稳定 Quest ID | 玩家名称 | 玩家说明 | 语义 | 实际判定 | 前置 | 回填策略 | 默认奖励 | 稀有度 | 可靠性 |
|---|---|---|---|---|---|---|---|---|---|
| `preset.update.skies.dried_ghast` | 干枯的恶魂 | 当前拥有干枯恶魂方块。 | Snapshot | 当前拥有 dried ghast ≥1 | 任务包开启 | 扫描背包 | 180 金币 + 60 经验 | 稀有 | A |
| `preset.update.skies.revive` | 重新赋予生命 | 让干枯恶魂进入正确的水中复苏流程。 | Milestone | `dried_ghast.hydration_started` Adapter | 干枯的恶魂 | 不回填 | 250 金币 + 90 经验 | 稀有 | B |
| `preset.update.skies.ghastling` | 小恶魂 | 玩家关联的复苏链成功生成小恶魂。 | Milestone | `ghastling.spawn_from_dried_ghast` | 重新赋予生命 | 可靠 ownership 历史可回填 | 300 金币 + 100 经验 | 史诗 | B |
| `preset.update.skies.happy_ghast` | 快乐恶魂 | 玩家关联的小恶魂成长为快乐恶魂。 | Milestone | `happy_ghast.grow` Adapter | 小恶魂 | 可靠 ownership 历史可回填 | 500 金币 + 180 经验 | 史诗 | B |
| `preset.update.skies.harness` | 准备起飞 | 当前拥有恶魂缰绳。 | Snapshot | 当前拥有 harness ≥1 | 任务包开启 | 扫描背包 | 220 金币 + 80 经验 | 稀有 | A |
| `preset.update.skies.ride` | 飞向天空 | 骑乘快乐恶魂。 | Milestone | `player.ride`：happy_ghast | 快乐恶魂 | 不回填 | 700 金币 + 260 经验 | 传奇 | B |


## 新版本冒险｜坐骑大乱斗

正式内容。围绕长矛、僵尸马、骆驼尸壳、干尸和鹦鹉螺。

| 稳定 Quest ID | 玩家名称 | 玩家说明 | 语义 | 实际判定 | 前置 | 回填策略 | 默认奖励 | 稀有度 | 可靠性 |
|---|---|---|---|---|---|---|---|---|---|
| `preset.update.mounts.spear` | 新的武器 | 当前拥有任意长矛。 | Snapshot | 当前拥有任意 spear ≥1 | 任务包开启 | 扫描背包 | 180 金币 + 60 经验 | 稀有 | A |
| `preset.update.mounts.spear_charge` | 骑枪冲锋 | 使用长矛完成一次有效冲锋命中。 | Challenge | `spear.charge_hit` Adapter | 新的武器 | 不回填 | 350 金币 + 120 经验 | 史诗 | C |
| `preset.update.mounts.zombie_horse` | 亡灵坐骑 | 成功驯服僵尸马。 | Milestone | `entity.tame`：zombie_horse | 任务包开启 | 可靠驯服历史可回填 | 350 金币 + 120 经验 | 史诗 | B |
| `preset.update.mounts.camel_husk` | 沙漠骑兵 | 解除敌对骑手后成功骑乘/驯服骆驼尸壳。 | Milestone | camel_husk Adapter | 任务包开启 | 不回填 | 350 金币 + 120 经验 | 史诗 | B |
| `preset.update.mounts.parched` | 沙漠亡灵 | 击杀干尸 3 只。 | Counter | `entity.kill`：parched ×3 | 任务包开启 | 不回填 | 220 金币 + 80 经验 | 稀有 | A |
| `preset.update.mounts.nautilus` | 海底坐骑 | 成功驯服鹦鹉螺。 | Milestone | `entity.tame`：nautilus | 任务包开启 | 可靠驯服历史可回填 | 450 金币 + 160 经验 | 史诗 | B |
| `preset.update.mounts.ride_nautilus` | 海洋骑士 | 骑乘鹦鹉螺。 | Milestone | `player.ride`：nautilus | 海底坐骑 | 不回填 | 500 金币 + 180 经验 | 史诗 | B |


## 新版本冒险｜小家伙接管

2026 年第一批正式内容。重点是幼年生物、可制作命名牌、金色蒲公英和铜制音符盒小号。

| 稳定 Quest ID | 玩家名称 | 玩家说明 | 语义 | 实际判定 | 前置 | 回填策略 | 默认奖励 | 稀有度 | 可靠性 |
|---|---|---|---|---|---|---|---|---|---|
| `preset.update.tiny.name_tag` | 名字属于你 | 当前拥有命名牌。 | Snapshot | 当前拥有 name tag ≥1 | 任务包开启 | 扫描背包 | 100 金币 + 35 经验 | 普通 | A |
| `preset.update.tiny.name_baby` | 给它一个名字 | 成功给幼年生物命名。 | Milestone | `baby_mob.name_tagged` Adapter | 名字属于你 | 不回填 | 180 金币 + 60 经验 | 稀有 | B |
| `preset.update.tiny.golden_dandelion` | 永远长不大 | 对支持的幼年生物成功使用金色蒲公英。 | Milestone | `golden_dandelion.used_on_baby` | 任务包开启 | 不回填 | 300 金币 + 100 经验 | 史诗 | B |
| `preset.update.tiny.baby_collection` | 幼儿园 | 记录 5 种不同幼年生物的有效接触。 | Composite / Set Counter | `baby_mob.encounter` distinct species ≥5 | 任务包开启 | 默认不历史回填 | 350 金币 + 120 经验 | 史诗 | B |
| `preset.update.tiny.trumpet` | 铜管乐手 | 让放在铜类方块上的音符盒成功发出小号音色。 | Milestone | `note_block.trumpet_played` Adapter | 任务包开启 | 不回填 | 220 金币 + 80 经验 | 稀有 | B |


## 新版本冒险｜混沌方块

Bedrock 26.30 正式内容。围绕硫磺泉、硫磺洞穴、硫磺方块怪、朱砂、喷泉和 Bounce 唱片。

| 稳定 Quest ID | 玩家名称 | 玩家说明 | 语义 | 实际判定 | 前置 | 回填策略 | 默认奖励 | 稀有度 | 可靠性 |
|---|---|---|---|---|---|---|---|---|---|
| `preset.update.chaos.sulfur` | 黄色矿物 | 累计获得硫磺相关基础材料 16。 | Counter | Sulfur 基础物品累计 16 | 任务包开启 | 不回填 Counter | 120 金币 + 40 经验 | 普通 | A |
| `preset.update.chaos.cinnabar` | 鲜红矿石 | 累计获得朱砂相关基础材料 16。 | Counter | Cinnabar 基础物品累计 16 | 任务包开启 | 不回填 Counter | 120 金币 + 40 经验 | 普通 | A |
| `preset.update.chaos.cave` | 地底异境 | 进入硫磺洞穴。 | Milestone | `player.biome_enter`：sulfur_caves | 任务包开启 | 当前 biome 可回填 | 250 金币 + 90 经验 | 稀有 | B |
| `preset.update.chaos.meet_cube` | 奇怪的方块 | 与硫磺方块怪产生一次有效接触/交互。 | Milestone | Sulfur Cube encounter Adapter | 任务包开启 | 不回填 | 180 金币 + 60 经验 | 稀有 | B |
| `preset.update.chaos.bucket_cube` | 带它回家 | 当前拥有装着硫磺方块怪的桶。 | Snapshot | 当前拥有 Bucket of Sulfur Cube ≥1 | 任务包开启 | 扫描背包 | 300 金币 + 100 经验 | 史诗 | A |
| `preset.update.chaos.feed_cube` | 什么都吃？ | 成功让硫磺方块怪吸收一种支持方块。 | Milestone | `sulfur_cube.feed_success` | 奇怪的方块 | 不回填 | 300 金币 + 100 经验 | 史诗 | B |
| `preset.update.chaos.tnt` | 危险实验 | 让硫磺方块怪吸收 TNT 并完成对应特殊玩法。 | Challenge | `sulfur_cube.feed_tnt` | 什么都吃？ | 不回填 | 500 金币 + 180 经验 | 史诗 | C |
| `preset.update.chaos.geyser` | 一飞冲天 | 被硫磺喷泉有效弹射。 | Challenge | `geyser.launch_player` Adapter | 地底异境 | 不回填 | 350 金币 + 120 经验 | 史诗 | B |
| `preset.update.chaos.bounce_disc` | Bounce！ | 当前拥有 Bounce 音乐唱片。 | Snapshot | 当前拥有 Bounce music disc ≥1 | 地底异境 | 扫描背包 | 700 金币 + 260 经验 | 传奇 | A |


## 玩法实验｜26.40 后续内容

这组默认不可用。只有世界真的开启对应 Gameplay Experiment 后才允许启用。当前官方仍把斑驳森林、废弃营地、杨树、红色灌木、架生蘑菇、坐垫、草床等列为实验内容。

| 稳定 Quest ID | 玩家名称 | 玩家说明 | 语义 | 实际判定 | 前置 | 回填策略 | 默认奖励 | 稀有度 | 可靠性 |
|---|---|---|---|---|---|---|---|---|---|
| `preset.experiment.drop3.dappled_forest` | 斑驳森林 | 进入斑驳森林。 | Milestone | `player.biome_enter`：dappled_forest | 玩法实验可用 | 当前 biome 可回填 | 150 金币 + 50 经验 | 稀有 | B |
| `preset.experiment.drop3.poplar` | 杨木收藏 | 当前拥有杨木原木。 | Snapshot | 当前拥有 Poplar log ≥1 | 玩法实验可用 | 扫描背包 | 100 金币 + 35 经验 | 普通 | A |
| `preset.experiment.drop3.shelf_mushroom` | 树上的蘑菇 | 当前拥有架生蘑菇。 | Snapshot | 当前拥有 Shelf Mushroom ≥1 | 玩法实验可用 | 扫描背包 | 120 金币 + 40 经验 | 普通 | A |
| `preset.experiment.drop3.red_shrub` | 红色灌木 | 当前拥有红色灌木。 | Snapshot | 当前拥有 Red Shrub ≥1 | 玩法实验可用 | 扫描背包 | 120 金币 + 40 经验 | 普通 | A |
| `preset.experiment.drop3.camp` | 被遗弃的营地 | 真正发现废弃营地。 | Structure Milestone | `structure.enter`：abandoned_camp | 玩法实验可用 | 仅可靠结构历史回填 | 300 金币 + 100 经验 | 史诗 | C |
| `preset.experiment.drop3.straw_bed` | 一次性的夜晚 | 成功使用草床完成对应睡眠行为。 | Milestone | `straw_bed.used_successfully` Adapter | 玩法实验可用 | 不回填 | 180 金币 + 60 经验 | 稀有 | B |
| `preset.experiment.drop3.cushion` | 坐一会儿 | 成功坐上坐垫。 | Milestone | `player.ride` / Cushion Adapter | 玩法实验可用 | 不回填 | 150 金币 + 50 经验 | 稀有 | B |


## 隐藏挑战

不计核心主线完成度。默认 `hidden=true`，可在完成时才揭晓。

| 稳定 Quest ID | 玩家名称 | 玩家说明 | 语义 | 实际判定 | 前置 | 回填策略 | 默认奖励 | 稀有度 | 可靠性 |
|---|---|---|---|---|---|---|---|---|---|
| `preset.hidden.warden` | 直面黑暗 | 玩家归因击败监守者。 | Milestone | `entity.kill`：warden | 隐藏任务开启 | 不回填 | 1500 金币 + 800 经验 | 传奇 | A |
| `preset.hidden.dragon_again` | 再战终末 | 第二次击败末影龙。 | Milestone | 持久 Boss kill count ≥2 | 龙之末路 | 需要持久 Boss 次数 | 1200 金币 + 600 经验 | 传奇 | B |
| `preset.hidden.mace_smash` | 从天而降 | 用重锤完成高坠落攻击并达到配置阈值。 | Challenge | `mace.high_fall_hit` | 拥有重锤 | 不回填 | 800 金币 + 300 经验 | 史诗 | C |
| `preset.hidden.happy_ghast_party` | 空中派对 | 快乐恶魂同时承载 4 名玩家。 | Challenge | Happy Ghast passenger count = 4 | 追逐天空任务包 | 不回填 | 800 金币 + 300 经验 | 史诗 | B |
| `preset.hidden.elytra_distance` | 远行者 | 解锁后累计鞘翅飞行 10,000 格。 | Counter | `elytra.distance` 累计 ≥10000 | 展开翅膀 | 只从解锁后累计 | 1000 金币 + 400 经验 | 传奇 | B |

---

# 附录 B：第一阶段发布清单

只实现：

    第一捆木头
    动手制作
    石器时代
    温暖的炉火
    铁器时代
    更好的镐
    全副武装
    第一颗钻石
    钻石工具
    黑曜石
    另一个世界
    烈焰猎人

验收链：

    解锁
    → 接受
    → Counter
    → Snapshot
    → 保存
    → 完成
    → Toast
    → 领奖
    → 重启
    → cmid
    → 关包
    → 重开

---

# 附录 C：稳定 Pack、Chapter 与事件需求

## C.1 Pack ID

    preset.core
    preset.world
    preset.creeper

    preset.update.copper
    preset.update.skies
    preset.update.mounts
    preset.update.tiny
    preset.update.chaos

    preset.experiment.drop3
    preset.hidden

## C.2 Chapter ID

    core.survival
    core.mining
    core.magic
    core.nether
    core.eye
    core.end
    core.endcity
    core.apex

    world.village
    world.ocean
    world.archaeology
    world.deepdark
    world.trials
    world.farm
    world.redstone
    world.pale_garden

## C.3 逐步支持的事件

A 级优先：

    entity.kill
    block.break
    block.place
    item.obtain
    item.use
    player.online_time
    player.dimension_enter
    player.interact_block
    player.interact_entity
    effect.gain

Snapshot：

    item.possess
    equipment.match
    effect.current
    creeper.state

B 级 Adapter：

    entity.tame
    entity.breed
    player.biome_enter
    player.glide
    player.ride
    enchant.apply
    raid.win
    vault.unlock
    villager.trade
    crop.plant
    crop.harvest
    crafter.output

C 级：

    structure.enter
    stronghold.discover
    ancient_city.discover
    trial_chamber.discover
    mace.high_fall_hit
    spear.charge_hit
    sulfur_cube.feed_tnt

CreeperMenu：

    creeper.menu.open
    creeper.waypoint.create
    creeper.tpa.complete
    creeper.random_tp.complete
    creeper.land.create
    creeper.public_waypoint.use
    creeper.market.trade
    creeper.red_packet
    creeper.guild.join_or_create

---

# 附录 D：玩家页面示意

    📖 冒险手册

    主线进度 42%

    ✓ 生存启程
    ✓ 深入地底
    ● 下界远征
    ○ 末路之眼
    🔒 终末之战

    世界冒险
    🏘 村庄与袭击   2/6
    🌊 海洋探险     1/7
    🌑 寂静深处     3/6
    ⚔ 试炼密室     4/9

    新版本冒险
    🟠 铜器时代     5/7
    ☁ 追逐天空     2/6
    🟡 混沌方块     3/9

---

# 附录 E：官方技术与内容参考

Script API：

- ScreenDisplay
  https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/screendisplay?view=minecraft-bedrock-stable
- WorldAfterEvents
  https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/worldafterevents?view=minecraft-bedrock-stable
- 实验功能 / Beta APIs
  https://learn.microsoft.com/en-us/minecraft/creator/documents/experimentalfeaturestoggle?view=minecraft-bedrock-stable
- 26.40 Creator 更新
  https://learn.microsoft.com/en-us/minecraft/creator/documents/update1.26.40?view=minecraft-bedrock-stable
- Bedrock JSON UI HUD 社区参考
  https://wiki.bedrock.dev/json-ui/add-hud-elements

内容：

- 铜器时代
  https://www.minecraft.net/en-us/updates/copper-age-drop
- 追逐天空 / 快乐恶魂
  https://www.minecraft.net/en-us/updates/introducing-chase-the-skies-drop
- 坐骑大乱斗
  https://www.minecraft.net/en-us/updates/mounts-of-mayhem-drop
- 小家伙接管
  https://www.minecraft.net/en-us/updates/tiny-takeover-drop
- 混沌方块 / Bedrock 26.30
  https://feedback.minecraft.net/hc/en-us/articles/46570672409997-Minecraft-Bedrock-Edition-26-30-Changelog-Chaos-Cubed
- 试炼更新
  https://www.minecraft.net/en-us/updates/tricky-trials
- 末地城
  https://www.minecraft.net/zh-hans/article/end-city

---

# 附录 F：给实现 AI 的最终指令

开始实现前必须阅读：

- 本文；
- 当前 Quest、HUD、Identity、Economy 和 Database 真实代码；
- 涉及菜单 UI 时阅读 design/menu-ui/JSON_UI_ROUTING.md；
- 涉及菜单 UI 时阅读 design/menu-ui/README.md；
- 涉及菜单 UI 时阅读 tests/creeper-menu-json-ui.test.cjs。

必须严格按 Phase 0 → Phase 1 → Phase 2 → Phase 3 执行。

每个 Phase 单独提交并运行对应测试与构建。

若本文 API 名称与仓库当前依赖不一致，先检查本地 @minecraft/server 类型声明；仍不确定时查 Microsoft Learn 当前官方文档，禁止凭记忆猜 API。

如果某个任务无法可靠判定，将其保持为 B/C 或 planned，不使用严重误判的替代条件。
