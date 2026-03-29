/**
 * 用 ChestUI 展示订阅物品快照（装备 + 全背包格，中文名为 translate）
 * 潜影盒/收纳袋等可点击进入子容器，52 返回上一层，53 关闭回到存档列表。
 */

import { Player, RawMessage } from "@minecraft/server";
import { ChestFormData } from "../../../ui/components/chest-ui/chest-forms";
import { formatDateTimeBeijing } from "../../../shared/utils/datetime-beijing";
import { resolveItemLocalizationKey } from "./item-watch-collect";
import type { ItemWatchSnapshotPayload, ItemWatchSlotLine } from "./item-watch-snapshot-store";

const GLASS = "minecraft:light_gray_stained_glass_pane";
const SEPARATOR = "minecraft:black_stained_glass_pane";

const SLOT_NEST_BACK = 52;
const SLOT_CLOSE = 53;

interface DrillFrame {
  line: ItemWatchSlotLine;
  titleHint: string;
}

/** 54 格：0–5 装备，6–8 分隔，9–35 主背包，36–44 快捷栏（与玩家容器槽位 9–35 / 0–8 对应） */
function inventoryChestSlot(invIdx: number): number {
  if (invIdx >= 0 && invIdx <= 8) return 36 + invIdx;
  if (invIdx >= 9 && invIdx <= 35) return invIdx;
  return -1;
}

function chestSlotToInvIndex(chestSlot: number): number | undefined {
  for (let invIdx = 0; invIdx < 36; invIdx++) {
    if (inventoryChestSlot(invIdx) === chestSlot) return invIdx;
  }
  return undefined;
}

function snapshotChestTitle(payload: ItemWatchSnapshotPayload): string | RawMessage {
  const timeLine = formatDateTimeBeijing(payload.t);
  const locKey = resolveItemLocalizationKey(payload.acquiredTypeId, payload.acquiredLocalizationKey);
  if (locKey) {
    return {
      rawtext: [
        { text: "§w获得物品时的背包存档\n§3" },
        { text: payload.playerName },
        { text: " §3· §f" },
        { translate: locKey },
        { text: `\n§3${timeLine}` },
      ],
    };
  }
  return `§w获得物品时的背包存档\n§3${payload.playerName} §3· §f${payload.acquiredTypeId}\n§3${timeLine}`;
}

function nestedSnapshotTitle(payload: ItemWatchSnapshotPayload, chain: DrillFrame[]): RawMessage | string {
  const path = chain.map((f) => f.titleHint).join(" §8>§r ");
  const pathLine = `\n§7容器: ${path}`;
  const base = snapshotChestTitle(payload);
  if (typeof base === "string") {
    return `${base}${pathLine}`;
  }
  const parts = base.rawtext as { text?: string; translate?: string }[];
  return { rawtext: [...parts, { text: pathLine }] };
}

function appendItemLore(base: string[], line: ItemWatchSlotLine): void {
  if (line.contents?.length) {
    base.push("§a点击查看内部");
  }
  if (line.contentsTruncated) {
    base.push("§e部分内容未完全记录");
  }
}

function buildRootChestForm(payload: ItemWatchSnapshotPayload): ChestFormData {
  const form = new ChestFormData("54");
  form.title(snapshotChestTitle(payload));

  for (let i = 0; i < 6; i++) {
    const row = payload.equipment[i];
    if (!row?.slot) {
      form.button(
        i,
        `${row?.label ?? "?"} §3空`,
        ["§3该槽位当时无物品"],
        GLASS,
        1,
        0,
        false
      );
      continue;
    }
    const s = row.slot;
    const lore = [`§b${row.label}`, `§3${s.typeId}`, `§ex${s.amount}`];
    appendItemLore(lore, s);
    form.button(
      i,
      { translate: s.localizationKey },
      lore,
      s.typeId,
      Math.min(Math.max(s.amount, 1), 99),
      0,
      false
    );
  }

  for (let g = 6; g <= 8; g++) {
    form.button(g, " ", ["§3─"], SEPARATOR, 1, 0, false);
  }

  const byInv = new Map<number, ItemWatchSlotLine & { slotIndex: number }>();
  for (const line of payload.slots) {
    byInv.set(line.slotIndex, line);
  }

  for (let invIdx = 0; invIdx < 36; invIdx++) {
    const chestSlot = inventoryChestSlot(invIdx);
    if (chestSlot < 0) continue;
    const line = byInv.get(invIdx);
    if (line) {
      const lore = [`§b槽位 §f#${line.slotIndex}`, `§3${line.typeId}`, `§ex${line.amount}`];
      appendItemLore(lore, line);
      form.button(
        chestSlot,
        { translate: line.localizationKey },
        lore,
        line.typeId,
        Math.min(Math.max(line.amount, 1), 99),
        0,
        false
      );
    } else {
      form.button(
        chestSlot,
        `§3#${invIdx} 空`,
        ["§3背包格当时为空"],
        GLASS,
        1,
        0,
        false
      );
    }
  }

  for (let u = 45; u <= 51; u++) {
    form.button(u, " ", ["§3─"], SEPARATOR, 1, 0, false);
  }
  form.button(SLOT_NEST_BACK, " ", ["§3─"], SEPARATOR, 1, 0, false);
  form.button(SLOT_CLOSE, "§e关闭", ["§b关闭并返回存档列表"], "minecraft:barrier", 1, 0, false);

  return form;
}

function buildNestedChestForm(payload: ItemWatchSnapshotPayload, chain: DrillFrame[]): ChestFormData {
  const form = new ChestFormData("54");
  form.title(nestedSnapshotTitle(payload, chain));

  const parent = chain[chain.length - 1];
  const contents = parent.line.contents ?? [];

  for (let i = 0; i < 27; i++) {
    const line = contents.find((c) => c.slotIndex === i);
    if (line) {
      const lore = [`§b槽位 §f#${i}`, `§3${line.typeId}`, `§ex${line.amount}`];
      appendItemLore(lore, line);
      form.button(
        i,
        { translate: line.localizationKey },
        lore,
        line.typeId,
        Math.min(Math.max(line.amount, 1), 99),
        0,
        false
      );
    } else {
      form.button(i, `§3#${i} 空`, ["§3此格当时为空"], GLASS, 1, 0, false);
    }
  }

  for (let u = 27; u <= 51; u++) {
    form.button(u, " ", ["§3─"], SEPARATOR, 1, 0, false);
  }

  form.button(
    SLOT_NEST_BACK,
    "§e返回上一层",
    ["§b回到上一界面"],
    "minecraft:arrow",
    1,
    0,
    false
  );
  form.button(SLOT_CLOSE, "§e关闭", ["§b关闭并返回存档列表"], "minecraft:barrier", 1, 0, false);

  return form;
}

function interpretRootSelection(
  sel: number,
  payload: ItemWatchSnapshotPayload
): { kind: "exit" } | { kind: "noop" } | { kind: "enter"; frame: DrillFrame } {
  if (sel === SLOT_CLOSE) {
    return { kind: "exit" };
  }
  if (sel >= 0 && sel <= 5) {
    const row = payload.equipment[sel];
    const s = row?.slot;
    if (s?.contents?.length) {
      return {
        kind: "enter",
        frame: { line: s, titleHint: `${row?.label ?? "?"}内` },
      };
    }
    return { kind: "noop" };
  }
  if (sel >= 6 && sel <= 8 || sel === SLOT_NEST_BACK || (sel >= 45 && sel <= 51)) {
    return { kind: "noop" };
  }

  const invIdx = chestSlotToInvIndex(sel);
  if (invIdx === undefined) {
    return { kind: "noop" };
  }

  const line = payload.slots.find((s) => s.slotIndex === invIdx);
  if (line?.contents?.length) {
    return {
      kind: "enter",
      frame: { line, titleHint: `背包#${invIdx}内` },
    };
  }
  return { kind: "noop" };
}

function interpretNestedSelection(
  sel: number,
  chain: DrillFrame[]
): { kind: "exit" } | { kind: "back" } | { kind: "enter"; frame: DrillFrame } | { kind: "noop" } {
  if (sel === SLOT_CLOSE) {
    return { kind: "exit" };
  }
  if (sel === SLOT_NEST_BACK) {
    return { kind: "back" };
  }
  if (sel < 0 || sel > 26 || (sel >= 27 && sel <= 51)) {
    return { kind: "noop" };
  }

  const parent = chain[chain.length - 1];
  const line = parent.line.contents?.find((c) => c.slotIndex === sel);
  if (line?.contents?.length) {
    return {
      kind: "enter",
      frame: { line, titleHint: `#${sel}内` },
    };
  }
  return { kind: "noop" };
}

export async function openItemWatchSnapshotChestForm(
  player: Player,
  payload: ItemWatchSnapshotPayload,
  onClose: () => void
): Promise<void> {
  const chain: DrillFrame[] = [];

  try {
    for (;;) {
      const form = chain.length === 0 ? buildRootChestForm(payload) : buildNestedChestForm(payload, chain);

      const response = await form.show(player);
      if (response.canceled || response.selection === undefined) {
        break;
      }

      const sel = response.selection;

      if (chain.length === 0) {
        const action = interpretRootSelection(sel, payload);
        if (action.kind === "exit") break;
        if (action.kind === "enter") chain.push(action.frame);
        continue;
      }

      const nested = interpretNestedSelection(sel, chain);
      if (nested.kind === "exit") break;
      if (nested.kind === "back") {
        chain.pop();
        continue;
      }
      if (nested.kind === "enter") {
        chain.push(nested.frame);
        continue;
      }
    }
  } catch {
    player.sendMessage("§c打开背包存档界面失败。");
  }

  onClose();
}
