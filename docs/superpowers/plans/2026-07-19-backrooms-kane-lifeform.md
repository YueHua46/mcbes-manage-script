# Kane-style Backrooms Lifeform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development before production changes. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Kane Pixels 风格的 `backrooms` 中加入无来源人声和稀有、单体、完整动画/声音/AI 的原创 Lifeform 遭遇。

**Architecture:** 行为包承担实体物理、导航和攻击；资源包承担模型、材质和动画；SAPI 遭遇导演承担门槛、概率、墙后出生、所有者隔离、状态切换和清理。普通幻听与实体诱饵使用独立调度。

**Tech Stack:** Minecraft Bedrock entity JSON/Molang, SAPI TypeScript, Python deterministic audio synthesis, PNG texture, Node tests.

## Global Constraints

- 主要参考 Kane Pixels 影像体系，但模型、贴图、动画和声音必须原创。
- 普通幻听大多数没有实体来源。
- 每 manifestation 同时最多 1 只、全维度最多 4 只，绝不自然成群生成。
- 不删除或修改资源包的 `"capabilities": ["pbr"]`。
- 不使用脚本逐 tick teleport 实体，不创建实体 ticking area。

---

### Task 1: Complete entity behavior and client assets

**Files:**
- Create: `behavior_packs/CreeperMenu/entities/backrooms_lifeform.json`
- Create: `resource_packs/CreeperMenu/entity/backrooms_lifeform.entity.json`
- Create: `resource_packs/CreeperMenu/models/entity/backrooms_lifeform.geo.json`
- Create: `resource_packs/CreeperMenu/animations/backrooms_lifeform.animation.json`
- Create: `resource_packs/CreeperMenu/animation_controllers/backrooms_lifeform.animation_controllers.json`
- Create: `resource_packs/CreeperMenu/render_controllers/backrooms_lifeform.render_controllers.json`
- Create: `resource_packs/CreeperMenu/textures/entity/backrooms_lifeform.png`
- Create: `tests/backrooms-lifeform-assets.test.cjs`

- [ ] Write failing cross-reference and policy tests for entity components, 35–42 bone geometry, 128×128 texture, nine complete animations, controller priority and zero spawn rules.
- [ ] Run focused test and observe expected missing-asset failures.
- [ ] Implement the complete BP entity, original model, texture, render controller, animation files and phase events from the design spec.
- [ ] Re-run focused test and parse every JSON file.

### Task 2: Original voices and Lifeform sound library

**Files:**
- Modify: `tools/generate-backrooms-audio.py`
- Modify: `resource_packs/CreeperMenu/sounds/sound_definitions.json`
- Modify: `resource_packs/CreeperMenu/sounds/ATTRIBUTION.txt`
- Create/regenerate: `resource_packs/CreeperMenu/sounds/backrooms/voices/*.wav`
- Create/regenerate: `resource_packs/CreeperMenu/sounds/backrooms/lifeform/*.wav`
- Create: `tests/backrooms-lifeform-audio.test.cjs`

- [ ] Write failing tests for ordinary discussion/call variants and all hostile Lifeform events, category, distance, duration, PCM validity, non-silence and deterministic regeneration.
- [ ] Run focused test and observe missing-event failures.
- [ ] Synthesize original muffled multi-speaker discussion, calls, lure, body/step/roar/attack/hurt/death sounds; do not extract film audio.
- [ ] Register exact IDs from the design spec and update attribution.
- [ ] Re-run focused audio tests and deterministic hash comparison.

### Task 3: Hallucination and encounter director

**Files:**
- Create: `scripts/features/backrooms/voices.ts`
- Create: `scripts/features/backrooms/lifeform/config.ts`
- Create: `scripts/features/backrooms/lifeform/contracts.ts`
- Create: `scripts/features/backrooms/lifeform/spawn-site-selector.ts`
- Create: `scripts/features/backrooms/lifeform/encounter-director.ts`
- Create: `scripts/features/backrooms/lifeform/index.ts`
- Modify: `scripts/features/backrooms/index.ts`
- Modify: `scripts/features/backrooms/protection.ts`
- Create: `tests/backrooms-lifeform-director.test.cjs`
- Create: `tests/backrooms-lifeform-spawn-site.test.cjs`

- [ ] Write failing pure-policy tests for eligibility, escalating probability, guarantee, limits, cooldown and state transitions.
- [ ] Write failing layout tests for BFS reachability, wall occlusion, distance, loaded-region bounds and deterministic ranking.
- [ ] Run focused tests and observe expected missing-module failures.
- [ ] Implement ordinary voices with approach disappearance/relocation and only 10% entity-lure eligibility.
- [ ] Implement director and spawn selector, using native entity AI after spawn and SAPI only for phase/orchestration.
- [ ] Whitelist only the Lifeform in protection and wire cleanup for leave/death/world load.
- [ ] Re-run focused, Backrooms regression, TypeScript and ESLint.

### Task 4: Integration and content validation

- [ ] Verify all sound, geometry, animation and render-controller references.
- [ ] Run TypeScript and every Backrooms/welcome test.
- [ ] Build BDS, then standard `.mcaddon` last.
- [ ] Inspect package contents and run `git diff --check`.
- [ ] Review every design constraint and document any behavior that requires in-game validation rather than static tests.
