# Backrooms Atmosphere Remaster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development before production changes. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `backrooms` 使用规则但有缺口的实体灯带、统一暖黄但材质分明的贴图、正常地毯脚感、柔和无重叠的环境声，并在维度内隔离原版音乐。

**Architecture:** 灯具布局仍由 `BackroomsLayoutAdapter` 基于种子确定性产生，但改为房间长轴灯带。声音由原创生成脚本产出并由 `ambience.ts` 管理，使用 silent music lock 隔离原版音乐。材质由参考图驱动的源图集和确定性后处理脚本生成，并由 JSON 组件固定摩擦与发光参数。

**Tech Stack:** TypeScript, Minecraft Bedrock SAPI, resource/behavior pack JSON, Python NumPy/Wave/Pillow, Node test runner.

## Global Constraints

- 保留 `resource_packs/CreeperMenu/manifest.json` 中的 `"capabilities": ["pbr"]`。
- 欢迎音乐系统不属于本次修改范围。
- 墙纸、地毯、天花板共享暖黄色环境色调，但必须保持不同材质特征。
- 普通地毯摩擦精确为 `0.65`，潮湿地毯摩擦精确为 `0.72`。
- 后室常规空间大部分有灯光覆盖，但必须存在有规律的缺灯与真实暗区。

---

### Task 1: Deterministic fluorescent light rows

**Files:**
- Modify: `scripts/features/backrooms/layout-adapter.ts`
- Create: `tests/backrooms-lighting-policy.test.cjs`

**Interfaces:**
- Consumes: `RegionLayout.rooms`, `DeterministicRandom`, `RelativeBlockPlacement`.
- Produces: `createLamps()` output consisting of deterministic 2-block fixtures arranged along room axes.

- [ ] Write a failing test sampling at least 121 regions that groups lamps by room and asserts collinear/equal-step fixture rows, no wall collisions, deterministic output, common-room coverage, and a nonzero bounded dark-room/failed-fixture rate.
- [ ] Run `node --test tests/backrooms-lighting-policy.test.cjs` and confirm it fails because current lamps are random scatter.
- [ ] Replace random point placement with long-axis row planning: derive row offsets from room dimensions, step fixtures at 4–6 block intervals, preserve 2-block fixture geometry, and use seeded omissions/dead fixtures.
- [ ] Keep blackout regions mostly dark and ensure low-ceiling rooms use their existing lamp Y.
- [ ] Re-run the lighting test and existing Backrooms tests.

### Task 2: Calm ambience and vanilla-music isolation

**Files:**
- Modify: `tools/generate-backrooms-audio.py`
- Modify: `scripts/features/backrooms/ambience.ts`
- Modify: `resource_packs/CreeperMenu/sounds/sound_definitions.json`
- Modify: `resource_packs/CreeperMenu/sounds/ATTRIBUTION.txt`
- Regenerate: `resource_packs/CreeperMenu/sounds/backrooms/*.wav`
- Create: `tests/backrooms-audio-policy.test.cjs`

**Interfaces:**
- Consumes: player dimension lifecycle and existing custom sound events.
- Produces: calm non-overlapping ambient hum plus `yuehua.backrooms.music_lock` silent loop lifecycle.

- [ ] Write failing tests for music-lock definition/lifecycle, hum duration versus replay ticks, reduced high-frequency energy, and lower playback volumes/surge frequency.
- [ ] Run the audio policy test and confirm expected failures.
- [ ] Generate a tiny zero-amplitude music-lock WAV and register it in category `music`.
- [ ] On Backrooms entry call `stopMusic()` then `playMusic(..., { volume: 0, fade: 0, loop: true })`; on exit call `stopMusic()`. Do not edit the welcome handler.
- [ ] Re-synthesize hum without strong 2.85/4.72 kHz partials, prevent overlap, reduce volumes, and make surges rarer.
- [ ] Add dry/damp × walk/run footstep events with at least three original variants each; schedule them from grounded horizontal distance accumulation and sampled speed.
- [ ] Re-run focused and existing sound tests.

### Task 3: Physical block tuning

**Files:**
- Modify: `behavior_packs/CreeperMenu/blocks/backrooms_carpet.json`
- Modify: `behavior_packs/CreeperMenu/blocks/backrooms_carpet_damp.json`
- Modify: `behavior_packs/CreeperMenu/blocks/backrooms_fluorescent_on.json`
- Modify: `behavior_packs/CreeperMenu/blocks/backrooms_fluorescent_dead.json`
- Modify: remaining Backrooms block `map_color` values where needed
- Create: `tests/backrooms-block-material-policy.test.cjs`

**Interfaces:**
- Produces: exact friction values, warm map colors, lamp emission constrained to local lighting.

- [ ] Write a failing JSON policy test asserting friction `0.65/0.72`, warm distinct map colors, lit/dead lamp contrast, and unchanged PBR capability.
- [ ] Run the policy test and confirm expected failures.
- [ ] Apply the exact friction values and tune lamp/map colors without changing custom block identifiers.
- [ ] Re-run the policy test and existing resource tests.

### Task 4: Warm, distinct material textures

**Files:**
- Create: `assets/backrooms/source_material_atlas_v2.png`
- Modify: `tools/process-backrooms-textures.py`
- Regenerate: `resource_packs/CreeperMenu/textures/blocks/backrooms/*.png`
- Create: `tests/backrooms-texture-policy.test.cjs`
- Modify: `resource_packs/CreeperMenu/fogs/backrooms.json`

**Interfaces:**
- Consumes: user reference images as color/atmosphere references, not edit targets.
- Produces: seven 64×64 project textures with shared warm grading and distinct material statistics.

- [ ] Write a failing texture policy test checking dimensions, warm-yellow channel relationships, distinct surface means, low carpet high-frequency energy, subtle wallpaper patterning, and non-white lamp center.
- [ ] Generate a new four-material atlas using the two reference images for color and mood.
- [ ] Update the processor with material-specific tone mapping: wallpaper pattern preservation, aggressive carpet low-pass/contrast compression, fine matte ceiling grain, warm ivory lamp rolloff.
- [ ] Adjust fog so it begins away from the camera and darkens distance without acting as ambient fill.
- [ ] Inspect every generated texture and run the texture policy test.

### Task 5: Integration verification

**Files:**
- Modify tests only if a verified engine/resource constraint requires expectation correction.

- [ ] Run `npx tsc --noEmit`.
- [ ] Run all Backrooms and welcome-sound tests.
- [ ] Run scoped ESLint on changed TypeScript files.
- [ ] Build BDS first, then build the standard `.mcaddon` last so the package remains in `dist/packages`.
- [ ] Inspect package entries for fog, audio, textures, blocks and scripts.
- [ ] Review the final diff against every global constraint, especially retained PBR capability and untouched welcome handler.
