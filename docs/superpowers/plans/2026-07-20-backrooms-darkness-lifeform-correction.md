# Backrooms Darkness, Material Unity, and Lifeform Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement the assigned task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the over-bright Backrooms, unify its Kane-style aged yellow-green material palette, and make the Lifeform a tall, persistent, hostile, rare-but-findable encounter.

**Architecture:** Lighting remains deterministic and block-light-driven, but fixtures are spaced beyond constant overlap and the fog becomes a dark distance medium instead of golden ambient fill. Textures share one aged fluorescent white balance while material identity comes from pattern frequency and luminance. The Lifeform keeps native Bedrock AI for pursuit and combat, while SAPI only owns natural encounter pacing; manually summoned entities remain autonomous.

**Tech Stack:** Minecraft Bedrock behavior/resource-pack JSON, SAPI TypeScript, Node test runner, Python Pillow texture pipeline.

## Global Constraints

- Keep `resource_packs/CreeperMenu/manifest.json` capability exactly including `"pbr"`.
- Only lit fluorescent blocks emit light; do not add global illumination, night vision, or bright fog fill.
- Use Kane Pixels imagery as atmosphere reference while retaining original project assets and sounds.
- Wall, ceiling, carpet, and lamps share an aged yellow/olive white balance but remain visibly different materials.
- Natural Lifeforms never spawn in groups: at most one per player session and four across the Backrooms director.
- Manual `/summon yuehua:backrooms_lifeform` entities persist and autonomously attack players in any dimension.
- Do not modify the welcome-music system.

---

### Task 1: Local fluorescent lighting and true dark falloff

**Files:**
- Modify: `tests/backrooms-lighting-policy.test.cjs`
- Modify: `tests/backrooms-block-material-policy.test.cjs`
- Modify: `tests/backrooms-runtime-policy.test.cjs`
- Modify: `scripts/features/backrooms/layout-adapter.ts`
- Modify: `behavior_packs/CreeperMenu/blocks/backrooms_fluorescent_on.json`
- Modify: `resource_packs/CreeperMenu/fogs/backrooms.json`

**Interfaces:**
- Consumes: deterministic room geometry and `createLamps()` fixture placements.
- Produces: two-block fixture rows with 6–9 block along-row spacing, 10–12 block cross-row spacing, emission level 9, and dark olive-brown distance fog.

- [ ] **Step 1: Tighten the tests before production changes.** Assert emission `9`; assert fixture-to-fixture step belongs to `6..9`; assert rows are normally separated by `10..12`; sample at least 121 regions and require both broadly lit rooms and deterministic dark pockets; assert fog colors have RGB channels below `0x70` and begin no closer than 16 blocks.
- [ ] **Step 2: Run RED.** Run `node --test tests/backrooms-lighting-policy.test.cjs tests/backrooms-block-material-policy.test.cjs tests/backrooms-runtime-policy.test.cjs`; expect failures reporting current emission `12`, 4–6 spacing, and bright fog.
- [ ] **Step 3: Implement local-light geometry.** Change lit fluorescence to `minecraft:light_emission: 9`; plan longitudinal fixture steps as `rng.nextInt(6, 9)` and cross rows at 10–12 blocks; keep seeded dead lamps and whole-room/row omissions so nearby bulbs cover most traversed rooms without covering every block.
- [ ] **Step 4: Implement dark distance fog.** Set air/weather fog to a low-luminance olive-brown close to `#4C4930`, with air start/end near `18/46`, so unlit areas fall into darkness while lamp blocks remain the only luminance source.
- [ ] **Step 5: Run GREEN.** Re-run the three focused tests and confirm all pass.

### Task 2: Unified aged-yellow material family

**Files:**
- Create: `assets/backrooms/source_material_atlas_v3.png`
- Modify: `tools/process-backrooms-textures.py`
- Modify: `tests/backrooms-texture-policy.test.cjs`
- Regenerate: `resource_packs/CreeperMenu/textures/blocks/backrooms/backrooms_wallpaper.png`
- Regenerate: `resource_packs/CreeperMenu/textures/blocks/backrooms/backrooms_wallpaper_stained.png`
- Regenerate: `resource_packs/CreeperMenu/textures/blocks/backrooms/backrooms_carpet.png`
- Regenerate: `resource_packs/CreeperMenu/textures/blocks/backrooms/backrooms_carpet_damp.png`
- Regenerate: `resource_packs/CreeperMenu/textures/blocks/backrooms/backrooms_ceiling_tile.png`
- Regenerate: `resource_packs/CreeperMenu/textures/blocks/backrooms/backrooms_fluorescent_on.png`
- Regenerate: `resource_packs/CreeperMenu/textures/blocks/backrooms/backrooms_fluorescent_dead.png`

**Interfaces:**
- Consumes: the user reference image as color and frequency reference.
- Produces: seven deterministic 64×64 textures with a shared yellow/olive chroma axis, distinct luminance, and material-specific spatial frequency.

- [ ] **Step 1: Replace separation-by-color tests.** Assert the wall/ceiling/carpet normalized RGB chroma vectors remain close, their luminance order remains wall/ceiling above carpet, wallpaper retains a subtle repeating motif, carpet high-frequency energy is low, ceiling has fine matte speckling, and the lit lamp is warm ivory rather than pure white.
- [ ] **Step 2: Run RED.** Run `node --test tests/backrooms-texture-policy.test.cjs`; expect the current orange carpet and forced mean-color-distance assertions to violate the new palette contract.
- [ ] **Step 3: Generate and grade the source atlas.** Build an original wallpaper/carpet/ceiling/lamp atlas guided by the reference: target approximate means wall `(168,164,105)`, ceiling `(154,149,96)`, carpet `(142,132,84)`, with hue differences smaller than texture/luminance differences.
- [ ] **Step 4: Update deterministic processing.** Preserve low-contrast wallpaper pattern, strongly low-pass the carpet and suppress fiber-sized contrast, apply fine non-directional ceiling speckle, and use a soft warm-ivory lamp rolloff; generate stained/damp/dead variants by luminance and moisture changes without shifting to a different hue family.
- [ ] **Step 5: Visually inspect and run GREEN.** Open the atlas and all seven outputs, then run the focused test and deterministic regeneration comparison.

### Task 3: Persistent hostile and taller Lifeform

**Files:**
- Modify: `tests/backrooms-lifeform-director.test.cjs`
- Modify: `tests/backrooms-lifeform-runtime.test.cjs`
- Modify: `tests/backrooms-lifeform-assets.test.cjs`
- Modify: `scripts/features/backrooms/lifeform/config.ts`
- Modify: `scripts/features/backrooms/lifeform/director.ts`
- Modify: `behavior_packs/CreeperMenu/entities/backrooms_lifeform.json`
- Modify: `resource_packs/CreeperMenu/models/entity/backrooms_lifeform.geo.json`
- Modify: `resource_packs/CreeperMenu/animations/backrooms_lifeform.animation.json`
- Modify: `resource_packs/CreeperMenu/entity/backrooms_lifeform.entity.json`
- Modify: `resource_packs/CreeperMenu/texts/zh_CN.lang`
- Modify: `resource_packs/CreeperMenu/texts/en_US.lang`

**Interfaces:**
- Consumes: director encounter ownership tags and native Bedrock target/navigation components.
- Produces: natural eligibility at 3 minutes plus 4 regions, guarantee at 8 minutes or 10 regions, 8% base chance increasing 1% per miss to 25%, autonomous manual-summon chase, and a narrow 3.6–3.8 block visual silhouette.

- [ ] **Step 1: Write regression tests for all observed failures.** Require unowned/manual entities to survive orphan cleanup; require the default spawned group to target every player without a director tag; require director-spawned dormant events to remove that manual group; assert the new encounter thresholds; assert collision near `0.68 × 3.45` and visual height between 3.6 and 3.8 blocks.
- [ ] **Step 2: Run RED.** Run `node --test tests/backrooms-lifeform-director.test.cjs tests/backrooms-lifeform-runtime.test.cjs tests/backrooms-lifeform-assets.test.cjs`; expect failures for orphan removal, dormant default behavior, old encounter thresholds, and the short model.
- [ ] **Step 3: Separate manual and director ownership.** Add a manual-autonomous component group to `minecraft:entity_spawned` with nearest-player targeting and chase/attack components; make `yuehua:phase_dormant` remove it before adding director-controlled dormant behavior; in `cleanupOrphans()`, remove only entities carrying director owner/slot metadata that no longer correspond to a tracked encounter.
- [ ] **Step 4: Make natural encounters findable but solitary.** Set eligibility to 3 minutes and 4 unique regions, guarantee to 8 minutes or 10 regions, probability to 8% plus 1% per miss capped at 25%, while preserving the one-per-session, four-global, and 30-minute cooldown limits.
- [ ] **Step 5: Rebuild the silhouette.** Scale/reposition bones into a 3.6–3.8 block tall, narrow, long-limbed figure; use a `0.68` wide and `3.45` high collision box; lengthen locomotion stride and align attack reach/timing with the new arms without turning the body bulky.
- [ ] **Step 6: Run GREEN.** Re-run the three focused tests, parse every entity/geometry/animation JSON file, and run scoped TypeScript checking.
- [ ] **Step 7: Localize and calibrate pursuit.** Add `entity.yuehua:backrooms_lifeform.name=后室生命体` with an English fallback, then raise manual/chase base movement from `0.25` to `0.35` and delayed-attack speed multiplier to `1.15`; tests must prove the literal `%entity...name` can no longer leak and both pursuit groups share the player-comparable values.

### Task 4: Integration and review

**Files:**
- Modify tests only if an independently verified Bedrock constraint requires a corrected assertion.

- [ ] **Step 1: Run all Backrooms tests.** Run `node --test tests/backrooms-*.test.cjs` and require zero failures.
- [ ] **Step 2: Run static verification.** Run scoped ESLint for `scripts/features/backrooms/**/*.ts`, TypeScript compilation, JSON parsing, resource cross-reference checks, and `git diff --check`.
- [ ] **Step 3: Confirm invariants.** Inspect the manifest for retained `pbr`; confirm the already-corrected non-slippery carpet values remain dry `0.40` and damp `0.37` (Bedrock friction semantics make the earlier `0.65/0.72` values noticeably faster); confirm no edits reached welcome-music handling.
- [ ] **Step 4: Build distributables.** Build BDS, then the standard `.mcaddon`, and inspect package entries for the updated fog, blocks, textures, model, entity, animations, and scripts.
- [ ] **Step 5: Request independent code review.** Review the implementation against this plan, fix all Critical/Important findings, and repeat the focused tests after any fix.

### Task 5: Second-pass lighting root cause and generated-region migration

**Files:**
- Modify: `tests/backrooms-lighting-policy.test.cjs`
- Modify: `tests/backrooms-runtime-policy.test.cjs`
- Modify: `tests/backrooms-block-material-policy.test.cjs`
- Modify: `scripts/features/backrooms/layout-adapter.ts`
- Modify: `scripts/features/backrooms/runtime/contracts.ts`
- Modify: `scripts/features/backrooms/runtime/region-marker.ts`
- Modify: `behavior_packs/CreeperMenu/blocks/backrooms_fluorescent_on.json`
- Create: `resource_packs/CreeperMenu/local_lighting/local_lighting.json`
- Create: seven adjacent `resource_packs/CreeperMenu/textures/blocks/backrooms/*.texture_set.json` material declarations

- [ ] **Step 1: Reproduce the persistence defect in a test.** Prove marker schema v1 accepts old ready regions without replacing their dense v1 lamp field; require marker schema v2 to reject/migrate the old sentinel material so every visited region is rebuilt with the current layout.
- [ ] **Step 2: Test the renderer contract.** Require opaque Backrooms blocks to have full light dampening, lit lamps to use local emission no higher than `8`, and a warm static local-light registration for only `yuehua:backrooms_fluorescent_on`; require PBR MER definitions to set emissive zero on every material except the live lamp. Do not ship reserved `lighting/global.json`, because current Bedrock has no Backrooms-dimension binding for it and it could affect the other custom void dimensions.
- [ ] **Step 3: Run RED.** The old marker schema, emission `9`, missing lighting JSON, and existing density must fail.
- [ ] **Step 4: Implement the migration and local-light model.** Advance the marker sentinel schema without changing topology, so old ready areas are re-shelled and old lamps are removed; use a pure row-slot planner with directly testable 2–4 fixture groups and 1–2 missing slots, and lower emission so non-lamp cells genuinely reach darkness; retain broad but incomplete coverage.
- [ ] **Step 5: Run GREEN and document engine limits.** Verify the static/block-light fallback and Vibrant Visuals path independently; do not claim visual completion until an in-game rebuild has been tested.

### Task 6: Pale reference-faithful albedo reconstruction

**Files:**
- Create: `assets/backrooms/source_material_atlas_v4.png`
- Modify: `tools/process-backrooms-textures.py`
- Modify: `tests/backrooms-texture-policy.test.cjs`
- Regenerate: all seven `resource_packs/CreeperMenu/textures/blocks/backrooms/*.png`

- [ ] **Step 1: Compare the current screenshot and reference before editing.** Treat the reference as pale physical albedo and lighting as the source of darkness; do not bake darkness into the wallpaper, ceiling, or carpet.
- [ ] **Step 2: Write RED palette tests.** Require a pale low-saturation yellow/olive family near wall `(194,191,145)`, ceiling `(178,174,128)`, carpet `(164,155,116)` while keeping the existing material-frequency rules.
- [ ] **Step 3: Generate an original v4 atlas and deterministic outputs.** Make walls creamy aged yellow-green, ceiling a paler yellowed acoustic board, and carpet a low-frequency beige/taupe; preserve the separate material structures.
- [ ] **Step 4: Visually inspect, run GREEN, and repeat generation.** Require seven stable hashes and no seams, dense fibers, pure-white lamps, or dark olive albedo compensation.

### Task 7: Lifeform low-ceiling collision and navigation safety

**Files:**
- Modify: `tests/backrooms-lifeform-assets.test.cjs`
- Modify: `tests/backrooms-lifeform-runtime.test.cjs`
- Modify: `behavior_packs/CreeperMenu/entities/backrooms_lifeform.json`
- Modify: `scripts/features/backrooms/lifeform/director.ts`

- [ ] **Step 1: Encode the observed regression.** Assert the Lifeform collision box fits the three-block low-room air column with safety margin, while the visual silhouette remains tall; assert natural clearance accepts three air blocks and rejects two.
- [ ] **Step 2: Run RED.** Current collision height `3.45` and four-air-block clearance must fail.
- [ ] **Step 3: Correct physics without shrinking the visual identity.** Use a narrow collision height at most `2.85`, keep the ~3.7-block visual rig, and align spawn/route clearance to low rooms so manual summons neither suffocate nor have an impossible navigation envelope.
- [ ] **Step 4: Run GREEN.** Re-run Lifeform assets/runtime/director tests, JSON parse, TypeScript, and scoped ESLint.
