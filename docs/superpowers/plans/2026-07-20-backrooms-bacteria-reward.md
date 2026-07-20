# Backrooms Bacteria Reward Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将后室 Lifeform 调整为名为 Bacteria 的 240 生命小 Boss，并提供 96 格追踪、16 格搜索、100 金币与 35 XP 奖励。

**Architecture:** 静态战斗属性和原版经验球由行为实体 JSON 负责；金币奖励复用现有通用怪物击杀服务及奖励表。测试直接解析资源文件和奖励模块，避免引入新的运行时死亡订阅。

**Tech Stack:** Minecraft Bedrock JSON、Script API TypeScript、Node.js `node:test`。

## Global Constraints

- 保持实体 ID `yuehua:backrooms_lifeform` 不变。
- 金币奖励必须经过现有经济开关、怪物奖励开关、真实玩家校验和每日上限。
- 经验必须由 `minecraft:experience_reward` 生成经验球。
- 不改变 PBR、生成器、移动速度、攻击伤害或遭遇概率。

---

### Task 1: 锁定 Bacteria 属性与显示名

**Files:**
- Modify: `tests/backrooms-lifeform-assets.test.cjs`
- Modify: `resource_packs/CreeperMenu/texts/zh_CN.lang`
- Modify: `resource_packs/CreeperMenu/texts/en_US.lang`
- Modify: `behavior_packs/CreeperMenu/entities/backrooms_lifeform.json`

**Interfaces:**
- Consumes: `entity.yuehua:backrooms_lifeform.name` 与行为实体组件。
- Produces: 240 生命、96 格追踪、16 格搜索和 35 XP 的静态实体定义。

- [ ] **Step 1: 写入失败测试**

```js
assert.equal(zh.get(key), "细菌（Bacteria）");
assert.equal(en.get(key), "Bacteria");
assert.deepEqual(components["minecraft:health"], { value: 240, max: 240 });
assert.equal(components["minecraft:follow_range"].value, 96);
assert.equal(components["minecraft:experience_reward"].on_death, "35");
assert.equal(search["minecraft:behavior.random_stroll"].xz_dist, 16);
```

- [ ] **Step 2: 运行测试并确认旧值导致失败**

Run: `node --test tests/backrooms-lifeform-assets.test.cjs`
Expected: FAIL，显示旧名称、48 生命、64 格追踪、8 格搜索或 0 XP。

- [ ] **Step 3: 修改资源和行为实体**

将语言值改为已确认名称；将生命、追踪与目标 `max_dist`、搜索 `xz_dist`、经验组件改为最终数值。

- [ ] **Step 4: 重新运行测试**

Run: `node --test tests/backrooms-lifeform-assets.test.cjs`
Expected: PASS。

### Task 2: 接入固定金币奖励并验证本地化

**Files:**
- Create: `tests/backrooms-bacteria-reward.test.cjs`
- Modify: `scripts/features/economic/data/monster-by-gold.ts`
- Modify: `scripts/features/economic/services/monster-kill-reward.ts`

**Interfaces:**
- Consumes: 通用 `monsterByGold` 奖励表、`deadEntity.typeId` 与 `economic.addGold`。
- Produces: `backrooms_lifeform: [100, 100]`，并以完整 type ID 查询翻译键。

- [ ] **Step 1: 写入失败测试**

```js
assert.deepEqual(monsterByGold.backrooms_lifeform, [100, 100]);
assert.match(service, /getMonsterLocalizationKey\(fullType\)/);
assert.match(service, /isRealPlayerEntity\(player\)/);
```

- [ ] **Step 2: 运行测试并确认奖励缺失**

Run: `node --test tests/backrooms-bacteria-reward.test.cjs`
Expected: FAIL，奖励表中不存在 `backrooms_lifeform`。

- [ ] **Step 3: 添加固定奖励并保留现有保护逻辑**

在奖励表加入 `[100, 100]`，把翻译键查询参数改为完整 `fullType`；不绕过设置开关、每日上限或真实玩家校验。

- [ ] **Step 4: 运行奖励测试和完整回归**

Run: `node --test tests/backrooms-bacteria-reward.test.cjs tests/backrooms-lifeform-assets.test.cjs`
Expected: PASS。

### Task 3: 版本、构建与交付验证

**Files:**
- Modify: `behavior_packs/CreeperMenu/manifest*.json`
- Modify: `resource_packs/CreeperMenu/manifest.json`

**Interfaces:**
- Consumes: 已通过测试的 BP/RP 文件。
- Produces: 能绕过旧客户端缓存的新标准兼容版 `.mcaddon`。

- [ ] **Step 1: 提升行为包与资源包补丁版本**

将 BP `3.1.1` 提升到 `3.1.2`，RP `3.2.1` 提升到 `3.2.2`，保持 `capabilities: ["pbr"]`。

- [ ] **Step 2: 运行完整验证**

Run: `node --test tests/backrooms-*.test.cjs tests/backrooms-bacteria-reward.test.cjs && npx tsc --noEmit && npx eslint scripts/features/economic/services/monster-kill-reward.ts scripts/features/economic/data/monster-by-gold.ts`
Expected: 所有测试与静态检查通过。

- [ ] **Step 3: 重新打包并检查内容**

Run: `npm run mcaddon:standard`
Expected: 标准兼容版 `.mcaddon` 创建成功，包内包含新版 BP/RP manifest 和实体定义。

