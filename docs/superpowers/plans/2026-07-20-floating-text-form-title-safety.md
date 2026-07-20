# Floating Text Form Title Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent numeric or marker-injected floating-text names from activating overlapping ChestUI layouts.

**Architecture:** Add a small title-formatting helper beside the floating-text form code. It strips only the resource pack's reserved ChestUI/FurnaceUI markers and adds a fixed nonnumeric prefix before the name; no global resource-pack routing or other forms change.

**Tech Stack:** TypeScript, Node.js built-in test runner, Minecraft Bedrock Script API

## Global Constraints

- Only the floating-text detail title changes.
- Stored names and rendered world text remain unchanged.
- ChestUI and FurnaceUI global routing remains unchanged.

---

### Task 1: Safeguard the floating-text detail title

**Files:**
- Modify: `scripts/ui/forms/floating-text/index.ts:33-40,220`
- Create: `tests/floating-text-form-title.test.cjs`

**Interfaces:**
- Produces: `formatFloatingTextDetailTitle(name: string): string`
- Consumes: a persisted floating-text display name

- [x] **Step 1: Write the failing regression test**

Create a source-level regression test that requires an exported formatter, a fixed `悬浮文字 · ` prefix, removal of ChestUI and FurnaceUI markers, and use of the formatter in `form.title(...)`.

- [x] **Step 2: Run the regression test and verify RED**

Run: `node --test tests/floating-text-form-title.test.cjs`

Expected: FAIL because `formatFloatingTextDetailTitle` and its detail-form call do not exist.

- [x] **Step 3: Implement the minimal formatter**

Add:

```ts
const FORM_LAYOUT_MARKER_REGEX = /(?:§c§h§e§s§t|§f§u§r§n§a§c§e)(?:§[0-9a-z])*(?:§r)?/gi;

export function formatFloatingTextDetailTitle(name: string): string {
  const safeName = name.replace(FORM_LAYOUT_MARKER_REGEX, "").trim() || "未命名";
  return `悬浮文字 · ${safeName}`;
}
```

Change the detail title to:

```ts
form.title(formatFloatingTextDetailTitle(latest.name));
```

- [x] **Step 4: Verify GREEN and regression safety**

Run:

```powershell
node --test tests/floating-text-form-title.test.cjs
npm test
npm run build
```

Expected: all tests pass and the TypeScript build exits successfully.

- [x] **Step 5: Review the scoped diff**

Run: `git diff --check` and `git diff -- scripts/ui/forms/floating-text/index.ts tests/floating-text-form-title.test.cjs`

Expected: no whitespace errors; no unrelated form or resource-pack changes.
