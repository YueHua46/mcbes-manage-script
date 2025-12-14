# PVP系统实现文档

## 系统概述

本PVP系统是一个完整的玩家对战系统，支持玩家自主开关PVP、管理员全局控制、金币夺取机制、击杀特效、连杀统计和排行榜功能。

## 已实现功能

### 1. 核心功能

#### 1.1 PVP管理器 (`services/pvp-manager.ts`)
- ✅ 玩家PVP状态管理（开启/关闭）
- ✅ PVP切换冷却机制（默认30秒）
- ✅ 战斗标签系统（战斗中10秒内无法切换PVP）
- ✅ 战斗超时自动清除
- ✅ 全局PVP开关控制
- ✅ 管理员无视PVP设置攻击权限
- ✅ 领地保护集成（领地内禁止PVP）

#### 1.2 效果管理器 (`services/effect-manager.ts`)
- ✅ 闪电粒子效果（`minecraft:lightning_bolt_emitter`）
- ✅ 雷鸣音效（`ambient.weather.thunder`）
- ✅ 周围50格范围内玩家可见特效

#### 1.3 统计管理器 (`services/pvp-stats.ts`)
- ✅ 击杀/死亡统计
- ✅ 连杀系统（当前连杀、最佳连杀）
- ✅ 金币夺取统计（总夺取、总被夺取）
- ✅ 固定金额夺取模式
- ✅ 最低金币保护机制
- ✅ 排行榜系统（击杀、连杀、夺取金币）
- ✅ 击杀日志记录
- ✅ 连杀广播（3连杀以上）

### 2. 数据模型

#### 2.1 玩家PVP数据 (`models/pvp-data.ts`)
```typescript
interface IPvpPlayerData {
  pvpEnabled: boolean;        // PVP开关
  lastToggleTime: number;     // 上次切换时间
  inCombat: boolean;          // 战斗状态
  lastCombatTime: number;     // 最后战斗时间
  kills: number;              // 击杀数
  deaths: number;             // 死亡数
  killStreak: number;         // 当前连杀
  bestKillStreak: number;     // 最佳连杀
  totalSeized: number;        // 总夺取金币
  totalLost: number;          // 总被夺取金币
}
```

#### 2.2 PVP配置
```typescript
interface IPvpConfig {
  enabled: boolean;                // 全局开关
  seizeAmount: number;             // 夺取金额
  minGoldProtection: number;       // 最低保护
  toggleCooldown: number;          // 切换冷却（秒）
  combatTagDuration: number;       // 战斗标签（秒）
}
```

### 3. 事件处理

#### 3.1 PVP事件处理器 (`events/handlers/pvp.ts`)
- ✅ `beforeEvents.entityHurt` - PVP伤害判定
- ✅ `afterEvents.entityDie` - 击杀处理和金币夺取
- ✅ 战斗超时定时检查（每秒一次）

#### 3.2 领地事件兼容 (`events/handlers/land.ts`)
- ✅ 玩家攻击玩家优先交给PVP系统处理
- ✅ 保留原有领地保护逻辑

### 4. UI界面

#### 4.1 玩家界面 (`ui/forms/pvp/index.ts`)
- ✅ PVP主菜单
  - 显示当前PVP状态
  - 显示战斗状态
  - 显示基础统计
  - PVP开关按钮
- ✅ 详细统计页面
  - 击杀/死亡/K/D比
  - 连杀统计
  - 金币统计
  - 排名显示
- ✅ 排行榜系统
  - 击杀排行榜
  - 最佳连杀排行榜
  - 夺取金币排行榜
  - 奖牌标识（前3名）
  - 个人排名显示

#### 4.2 管理员界面 (`ui/forms/pvp/admin.ts`)
- ✅ PVP管理配置表单
  - 全局开关
  - 夺取金额配置（0-1000）
  - 最低保护配置（0-500）
  - 冷却时间配置（0-120秒）
  - 战斗标签时间配置（5-60秒）

### 5. 系统集成

#### 5.1 服务器菜单集成 (`ui/forms/server/index.ts`)
- ✅ 添加"PVP系统"主菜单按钮
- ✅ 根据全局开关显示/隐藏

#### 5.2 服务器设置集成 (`ui/forms/system/index.ts`)
- ✅ 添加"PVP管理"设置按钮
- ✅ 管理员专属权限

#### 5.3 系统设置集成 (`features/system/services/setting.ts`)
- ✅ 添加PVP相关配置项
- ✅ 默认配置设置

## 技术特性

### 1. 数据持久化
- 使用 `Database` 类存储所有数据
- 玩家PVP数据自动保存
- 配置通过系统设置管理
- 击杀日志自动清理（保留最近1000条）

### 2. 性能优化
- 战斗状态使用 `Map` 缓存，提高查询效率
- 战斗超时检查每秒执行一次
- 事件处理优先级合理，避免冲突
- 延迟消息发送（`system.run`），符合API规范

### 3. 用户体验
- 详细的提示消息
- 直观的UI设计
- 流畅的交互体验
- 清晰的视觉/音效反馈

### 4. 安全机制
- PVP切换冷却防止滥用
- 战斗标签防止逃跑
- 最低金币保护防止破产
- 管理员权限控制

## 配置说明

### 默认配置
```typescript
{
  pvp: true,                    // PVP系统菜单显示
  pvpEnabled: false,            // PVP功能全局开关（默认关闭）
  pvpSeizeAmount: "100",        // 固定夺取100金币
  pvpMinProtection: "100",      // 最低保留100金币
  pvpToggleCooldown: "30",      // 切换冷却30秒
  pvpCombatTagDuration: "10"    // 战斗标签10秒
}
```

### 配置修改方式
1. 游戏内：服务器菜单 → 服务器设置 → PVP管理
2. 代码：修改 `scripts/features/system/services/setting.ts` 中的 `defaultSetting`

## 文件结构

```
scripts/
├── features/pvp/
│   ├── models/
│   │   └── pvp-data.ts           # 数据模型
│   ├── services/
│   │   ├── pvp-manager.ts        # PVP管理器
│   │   ├── effect-manager.ts     # 效果管理器
│   │   └── pvp-stats.ts          # 统计管理器
│   ├── index.ts                  # 模块导出
│   ├── README.md                 # 本文档
│   └── PVP_TEST_GUIDE.md         # 测试指南
├── events/handlers/
│   └── pvp.ts                    # PVP事件处理器
└── ui/forms/pvp/
    ├── index.ts                  # 玩家UI
    ├── admin.ts                  # 管理员UI
    └── index.export.ts           # UI导出
```

## 使用说明

### 玩家使用
1. 打开服务器菜单
2. 点击"PVP系统"
3. 点击"开启PVP"按钮
4. 开始战斗！

### 管理员使用
1. 打开服务器菜单
2. 点击"服务器设置"
3. 点击"PVP管理"
4. 配置PVP参数

## 注意事项

1. **首次使用**：PVP功能默认关闭，管理员需要先启用
2. **领地保护**：领地内始终禁止PVP，无论双方设置
3. **管理员权限**：管理员可以攻击任何人，用于管理用途
4. **数据备份**：建议定期备份服务器数据

## 故障排除

### PVP系统按钮不显示
- 检查配置中 `pvp` 是否为 `true`
- 检查配置中 `pvpEnabled` 是否为 `true`

### 无法攻击其他玩家
- 确认双方都开启了PVP
- 确认不在领地内
- 确认PVP功能已全局启用

### 战斗标签无法清除
- 等待配置的战斗标签时间（默认10秒）
- 检查是否持续受到攻击

## 开发信息

- **版本**：1.0.0
- **开发者**：基于计划实现
- **依赖**：Minecraft Bedrock Server API
- **兼容性**：与现有领地、经济系统完全兼容

## 后续优化建议

1. 添加PVP区域系统（特定区域强制PVP）
2. 添加比例夺取模式（夺取百分比金币）
3. 添加PVP赛季系统
4. 添加更多击杀特效选择
5. 添加成就系统集成

