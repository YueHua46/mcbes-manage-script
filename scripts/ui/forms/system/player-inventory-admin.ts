/**
 * 管理员查看/操作玩家背包或末影箱
 * 使用 Chest-UI 双栏布局：上方为目标容器，下方为管理员背包，点击即可在两者间转移物品
 * - main：上方 45 格 = 36 背包槽 + 5 装备栏（头盔/胸甲/腿甲/靴子/副手）
 * - ender：上方 27 格 = 末影箱（minecraft:ender_inventory）
 * @see https://github.com/Herobrine643928/Chest-UI （Inventory Section：上半箱子 + 下半查看者背包）
 */

import {
  Player,
  world,
  EntityEquippableComponent,
  EquipmentSlot,
  EntityComponentTypes,
  ItemStack,
} from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { openDialogForm } from "../../components/dialog";
import { isAdmin } from "../../../shared/utils/common";
import ChestFormData from "../../components/chest-ui/chest-forms";
import type { ChestFormResponse } from "../../components/chest-ui/chest-forms";
import { getChestItemDurabilityBarValue } from "../../components/chest-ui";
import { getItemDisplayName, hasAnyEnchantment } from "../../../shared/utils/item-utils";

/** 管理员查看模式：主背包+装备 或 末影箱 */
export type InventoryAdminMode = "main" | "ender";

/** 上方表单中装备栏对应的按钮索引（紧接在 36 个背包槽之后） */
const EQUIPMENT_BUTTON_OFFSET = 36;
const EQUIPMENT_SLOTS: [EquipmentSlot, string, string][] = [
  [EquipmentSlot.Head, "头盔", "textures/ui/empty_armor_slot_helmet"],
  [EquipmentSlot.Chest, "胸甲", "textures/ui/empty_armor_slot_chestplate"],
  [EquipmentSlot.Legs, "腿甲", "textures/ui/empty_armor_slot_leggings"],
  [EquipmentSlot.Feet, "靴子", "textures/ui/empty_armor_slot_boots"],
  [EquipmentSlot.Offhand, "副手/盾牌", "textures/ui/empty_armor_slot_shield"],
];

const MSG_BAG_FULL = "§e你的背包已满，无法接收物品。";

function isShulkerBox(typeId: string): boolean {
  return (
    typeId === "minecraft:shulker_box" || typeId === "minecraft:undyed_shulker_box" || typeId.endsWith("_shulker_box")
  );
}

function getTargetEnderContainer(targetPlayer: Player) {
  return targetPlayer.getComponent(EntityComponentTypes.EnderInventory)?.container;
}

function sameStackIdentity(a: ItemStack, b: ItemStack): boolean {
  return a.typeId === b.typeId && a.amount === b.amount;
}

function moveItemToAdminInventory(
  adminPlayer: Player,
  targetPlayer: Player,
  inventoryMode: InventoryAdminMode,
  sourceKind: "inventory" | "equipment" | "ender",
  sourceSlot: number | EquipmentSlot,
  reopen?: () => void
): void {
  const doReopen = reopen ?? (() => openPlayerInventoryDualForm(adminPlayer, targetPlayer, inventoryMode));
  const adminContainer = adminPlayer.getComponent("inventory")?.container;
  if (!adminContainer) {
    doReopen();
    return;
  }

  if (sourceKind === "ender") {
    const targetEnder = getTargetEnderContainer(targetPlayer);
    if (!targetEnder) {
      doReopen();
      return;
    }
    const item = targetEnder.getItem(sourceSlot as number);
    if (!item) {
      doReopen();
      return;
    }
    targetEnder.setItem(sourceSlot as number, undefined);
    const overflow = adminContainer.addItem(item);
    if (overflow) {
      targetEnder.setItem(sourceSlot as number, overflow);
      adminPlayer.sendMessage(sameStackIdentity(overflow, item) ? MSG_BAG_FULL : "§e背包已满，部分物品已放回目标末影箱。");
    }
    doReopen();
    return;
  }

  if (sourceKind === "inventory") {
    const targetInv = targetPlayer.getComponent("inventory")?.container;
    if (!targetInv) {
      doReopen();
      return;
    }
    const item = targetInv.getItem(sourceSlot as number);
    if (!item) {
      doReopen();
      return;
    }

    targetInv.setItem(sourceSlot as number, undefined);
    const overflow = adminContainer.addItem(item);
    if (overflow) {
      targetInv.setItem(sourceSlot as number, overflow);
      adminPlayer.sendMessage(sameStackIdentity(overflow, item) ? MSG_BAG_FULL : "§e背包已满，部分物品已放回目标背包。");
    }
    doReopen();
    return;
  }

  const targetEquippable = targetPlayer.getComponent(EntityEquippableComponent.componentId) as
    | EntityEquippableComponent
    | undefined;
  if (!targetEquippable) {
    doReopen();
    return;
  }
  const equipSlot = sourceSlot as EquipmentSlot;
  const item = targetEquippable.getEquipment(equipSlot);
  if (!item) {
    doReopen();
    return;
  }
  targetEquippable.setEquipment(equipSlot, undefined);
  const overflow = adminContainer.addItem(item);
  if (overflow) {
    targetEquippable.setEquipment(equipSlot, overflow);
    adminPlayer.sendMessage(sameStackIdentity(overflow, item) ? MSG_BAG_FULL : "§e背包已满，装备已穿回目标玩家。");
  }
  doReopen();
}

function copyItemToAdminInventory(adminPlayer: Player, item: ItemStack): void {
  const adminContainer = adminPlayer.getComponent("inventory")?.container;
  if (!adminContainer) return;
  const clone = item.clone();
  const overflow = adminContainer.addItem(clone);
  if (overflow) {
    adminPlayer.sendMessage("§e你的背包已满，复制失败或仅复制了部分。");
  } else {
    adminPlayer.sendMessage("§a已复制一份物品到你的背包。");
  }
}

function openShulkerActionForm(
  adminPlayer: Player,
  targetPlayer: Player,
  sourceSlot: number,
  inventoryMode: InventoryAdminMode,
  reopen?: () => void
): void {
  const doReopen = reopen ?? (() => openPlayerInventoryDualForm(adminPlayer, targetPlayer, inventoryMode));
  const targetContainer =
    inventoryMode === "ender"
      ? getTargetEnderContainer(targetPlayer)
      : targetPlayer.getComponent("inventory")?.container;
  if (!targetContainer) {
    doReopen();
    return;
  }
  const item = targetContainer.getItem(sourceSlot);
  if (!item) {
    doReopen();
    return;
  }

  const placeLabel = inventoryMode === "ender" ? "末影箱" : "玩家背包";
  const form = new ActionFormData()
    .title("§d潜影盒操作")
    .body(
      `§b你选择的是潜影盒（${placeLabel}）。\n\n§3可先取走整盒，或复制一份；无法在脚本内展开盒内格子（与游戏内打开盒子不同）。`
    )
    .button(`§a取走潜影盒（从目标${placeLabel}移除）`)
    .button("§b复制一份潜影盒（目标保留原件）")
    .button("§3返回");

  form.show(adminPlayer).then((res) => {
    if (res.canceled || res.selection === undefined || res.selection === 2) {
      doReopen();
      return;
    }
    if (res.selection === 0) {
      moveItemToAdminInventory(
        adminPlayer,
        targetPlayer,
        inventoryMode,
        inventoryMode === "ender" ? "ender" : "inventory",
        sourceSlot,
        reopen
      );
      return;
    }
    if (res.selection === 1) {
      copyItemToAdminInventory(adminPlayer, item);
      doReopen();
    }
  });
}

/**
 * 打开玩家背包管理入口：先选「背包 / 末影箱」，再选玩家
 */
export function openPlayerInventoryAdminForm(adminPlayer: Player): void {
  if (!isAdmin(adminPlayer)) {
    adminPlayer.sendMessage("§c只有管理员可以查看玩家背包。");
    return;
  }

  const form = new ActionFormData()
    .title("§6玩家背包管理")
    .body("§b请选择要查看的内容，然后选择在线玩家。")
    .button("§a查看玩家背包", "textures/icons/quest_chest")
    .button("§d查看玩家末影箱", "textures/blocks/ender_chest_front")
    .button("返回", "textures/icons/back");

  form.show(adminPlayer).then((res) => {
    if (res.canceled || res.selection === undefined) return;
    if (res.selection === 2) {
      const { openSystemSettingForm } = require("./index");
      openSystemSettingForm(adminPlayer);
      return;
    }
    const mode: InventoryAdminMode = res.selection === 0 ? "main" : "ender";
    openPlayerInventoryTargetForm(adminPlayer, mode);
  });
}

/**
 * 选择目标玩家（在已选 main/ender 模式后）
 */
function openPlayerInventoryTargetForm(adminPlayer: Player, mode: InventoryAdminMode): void {
  const onlinePlayers = world.getPlayers().filter((p) => p.id !== adminPlayer.id);
  const playerNames = onlinePlayers.map((p) => p.name);

  if (playerNames.length === 0) {
    openDialogForm(adminPlayer, { title: "§c提示", desc: "当前无其他在线玩家（已排除自己）。" }, () => {
      openPlayerInventoryAdminForm(adminPlayer);
    });
    return;
  }

  const form = new ModalFormData();
  form.title(mode === "main" ? "§6查看玩家背包" : "§6查看玩家末影箱");
  form.dropdown("选择玩家", playerNames, { defaultValueIndex: 0 });
  form.submitButton("§a查看");

  form.show(adminPlayer).then((data) => {
    if (data.cancelationReason) {
      openPlayerInventoryAdminForm(adminPlayer);
      return;
    }
    const idx = data.formValues?.[0] as number;
    if (idx === undefined) return;
    const targetName = playerNames[idx];
    const targetPlayer = world.getPlayers().find((p) => p.name === targetName);
    if (!targetPlayer) {
      openDialogForm(adminPlayer, { title: "§c错误", desc: "目标玩家已离线。" }, () =>
        openPlayerInventoryTargetForm(adminPlayer, mode)
      );
      return;
    }
    openPlayerInventoryDualForm(adminPlayer, targetPlayer, mode);
  });
}

/**
 * 双栏 Chest-UI：上方为目标容器，下方为管理员背包
 */
function openPlayerInventoryDualForm(adminPlayer: Player, targetPlayer: Player, mode: InventoryAdminMode): void {
  if (mode === "ender") {
    openPlayerInventoryEnderDualForm(adminPlayer, targetPlayer);
    return;
  }
  openPlayerInventoryMainDualForm(adminPlayer, targetPlayer);
}

function openPlayerInventoryMainDualForm(adminPlayer: Player, targetPlayer: Player): void {
  const inventoryMode: InventoryAdminMode = "main";
  const targetInv = targetPlayer.getComponent("inventory");
  if (!targetInv?.container) {
    openDialogForm(adminPlayer, { title: "§c错误", desc: "无法获取该玩家背包。" }, () =>
      openPlayerInventoryTargetForm(adminPlayer, inventoryMode)
    );
    return;
  }

  const targetContainer = targetInv.container;
  const targetSize = targetContainer.size;
  const chestForm = new ChestFormData("45_inv");
  chestForm.title(
    `§6上边容器为目标玩家 §f${targetPlayer.name} §6的背包\n§3下边容器即为你的背包`
  );

  for (let i = 0; i < targetSize; i++) {
    const item = targetContainer.getItem(i);
    if (item) {
      const slotHint = i < 9 ? "快捷栏 · " : "";
      const durComp = item.getComponent("durability");
      const lores: string[] = [`§e数量: §f${item.amount}`];
      if (durComp && durComp.damage > 0) {
        const pct = Math.round(((durComp.maxDurability - durComp.damage) / durComp.maxDurability) * 100);
        lores.push(`§e耐久: §f${pct}%`);
      }
      if (isShulkerBox(item.typeId)) {
        lores.push(`§3${slotHint}潜影盒 · 点击选择取走或复制`);
      } else {
        lores.push(`§3${slotHint}点击 → 取到你的背包`);
      }
      chestForm.button(
        i,
        getItemDisplayName(item),
        lores,
        item.typeId,
        item.amount,
        getChestItemDurabilityBarValue(item),
        hasAnyEnchantment(item)
      );
    }
  }

  const targetEquippable = targetPlayer.getComponent(EntityEquippableComponent.componentId) as
    | EntityEquippableComponent
    | undefined;
  if (targetEquippable) {
    EQUIPMENT_SLOTS.forEach(([slot, label, emptyTexture], idx) => {
      const buttonIndex = EQUIPMENT_BUTTON_OFFSET + idx;
      const item = targetEquippable.getEquipment(slot);
      if (item) {
        const durComp = item.getComponent("durability");
        const lores: string[] = [`§e数量: §f${item.amount}`];
        if (durComp && durComp.damage > 0) {
          const pct = Math.round(((durComp.maxDurability - durComp.damage) / durComp.maxDurability) * 100);
          lores.push(`§e耐久: §f${pct}%`);
        }
        if (isShulkerBox(item.typeId)) {
          lores.push(`§3装备·${label} · 潜影盒 · 点击整件取到你的背包`);
        } else {
          lores.push(`§3装备·${label} · 点击 → 取到你的背包`);
        }
        chestForm.button(
          buttonIndex,
          getItemDisplayName(item),
          lores,
          item.typeId,
          item.amount,
          getChestItemDurabilityBarValue(item),
          hasAnyEnchantment(item)
        );
      } else {
        chestForm.button(buttonIndex, `§8空·${label}`, [`§7装备栏·${label}`], emptyTexture, 1, 0, false);
      }
    });
  }

  chestForm.show(adminPlayer, { appendViewerInventory: true }).then((data: ChestFormResponse) => {
    if (data.canceled) {
      openPlayerInventoryTargetForm(adminPlayer, inventoryMode);
      return;
    }

    const selection = data.selection;
    if (selection === undefined) return;

    const adminContainer = adminPlayer.getComponent("inventory")?.container;
    if (!adminContainer) {
      openPlayerInventoryDualForm(adminPlayer, targetPlayer, inventoryMode);
      return;
    }

    if (selection < targetSize) {
      const item = targetContainer.getItem(selection);
      if (!item) {
        openPlayerInventoryDualForm(adminPlayer, targetPlayer, inventoryMode);
        return;
      }

      if (isShulkerBox(item.typeId)) {
        openShulkerActionForm(adminPlayer, targetPlayer, selection, inventoryMode);
        return;
      }

      moveItemToAdminInventory(adminPlayer, targetPlayer, inventoryMode, "inventory", selection);
      return;
    }

    const equipmentIndex = selection - EQUIPMENT_BUTTON_OFFSET;
    if (equipmentIndex >= 0 && equipmentIndex < EQUIPMENT_SLOTS.length && targetEquippable) {
      const [equipSlot] = EQUIPMENT_SLOTS[equipmentIndex];
      moveItemToAdminInventory(adminPlayer, targetPlayer, inventoryMode, "equipment", equipSlot);
      return;
    }

    const adminSlot = data.inventorySlot;
    if (adminSlot === null || adminSlot === undefined) {
      openPlayerInventoryDualForm(adminPlayer, targetPlayer, inventoryMode);
      return;
    }

    const item = adminContainer.getItem(adminSlot);
    if (!item) {
      openPlayerInventoryDualForm(adminPlayer, targetPlayer, inventoryMode);
      return;
    }
    adminContainer.setItem(adminSlot, undefined);
    const overflow = targetContainer.addItem(item);
    if (overflow) {
      adminContainer.setItem(adminSlot, overflow);
      adminPlayer.sendMessage("§e目标玩家背包已满，部分物品已退回你的背包。");
    }
    openPlayerInventoryDualForm(adminPlayer, targetPlayer, inventoryMode);
  });
}

/** 末影箱双栏：上为目标末影箱，下为查看者背包 */
export type EnderDualFormOptions = {
  onCancel: () => void;
  titleText: string;
  /** 无法读取末影箱时的说明，默认「无法获取该玩家末影箱。」 */
  missingEnderDesc?: string;
};

/**
 * 末影箱 + 查看者背包双栏；管理员与本人共用（本人时 viewer === target）。
 */
export function openEnderChestDualForm(viewer: Player, target: Player, opts: EnderDualFormOptions): void {
  const missingDesc = opts.missingEnderDesc ?? "无法获取该玩家末影箱。";
  const targetEnder = getTargetEnderContainer(target);
  if (!targetEnder) {
    openDialogForm(viewer, { title: "§c错误", desc: missingDesc }, opts.onCancel);
    return;
  }

  const reopen = () => openEnderChestDualForm(viewer, target, opts);
  const targetSize = targetEnder.size;
  const chestForm = new ChestFormData("27_inv");
  chestForm.title(opts.titleText);

  for (let i = 0; i < targetSize; i++) {
    const item = targetEnder.getItem(i);
    if (item) {
      const durComp = item.getComponent("durability");
      const lores: string[] = [`§e数量: §f${item.amount}`];
      if (durComp && durComp.damage > 0) {
        const pct = Math.round(((durComp.maxDurability - durComp.damage) / durComp.maxDurability) * 100);
        lores.push(`§e耐久: §f${pct}%`);
      }
      if (isShulkerBox(item.typeId)) {
        lores.push("§3末影箱槽 · 潜影盒 · 点击选择取走或复制");
      } else {
        lores.push("§3末影箱槽 · 点击 → 取到你的背包");
      }
      chestForm.button(
        i,
        getItemDisplayName(item),
        lores,
        item.typeId,
        item.amount,
        getChestItemDurabilityBarValue(item),
        hasAnyEnchantment(item)
      );
    }
  }

  chestForm.show(viewer, { appendViewerInventory: true }).then((data: ChestFormResponse) => {
    if (data.canceled) {
      opts.onCancel();
      return;
    }

    const selection = data.selection;
    if (selection === undefined) return;

    const viewerContainer = viewer.getComponent("inventory")?.container;
    if (!viewerContainer) {
      reopen();
      return;
    }

    if (selection < targetSize) {
      const item = targetEnder.getItem(selection);
      if (!item) {
        reopen();
        return;
      }

      if (isShulkerBox(item.typeId)) {
        openShulkerActionForm(viewer, target, selection, "ender", reopen);
        return;
      }

      moveItemToAdminInventory(viewer, target, "ender", "ender", selection, reopen);
      return;
    }

    const viewerSlot = data.inventorySlot;
    if (viewerSlot === null || viewerSlot === undefined) {
      reopen();
      return;
    }

    const item = viewerContainer.getItem(viewerSlot);
    if (!item) {
      reopen();
      return;
    }
    viewerContainer.setItem(viewerSlot, undefined);
    const overflow = targetEnder.addItem(item);
    if (overflow) {
      viewerContainer.setItem(viewerSlot, overflow);
      viewer.sendMessage("§e目标末影箱已满，部分物品已退回你的背包。");
    }
    reopen();
  });
}

function openPlayerInventoryEnderDualForm(adminPlayer: Player, targetPlayer: Player): void {
  openEnderChestDualForm(adminPlayer, targetPlayer, {
    onCancel: () => openPlayerInventoryTargetForm(adminPlayer, "ender"),
    titleText: `§5上边容器为目标玩家 §f${targetPlayer.name} §5的末影箱\n§3下边容器即为你的背包`,
  });
}

/** 本人末影箱 + 本人背包；取消时由 onCancel 返回（例如其他功能菜单） */
export function openMyEnderChestForm(player: Player, onCancel: () => void): void {
  openEnderChestDualForm(player, player, {
    onCancel,
    missingEnderDesc: "无法获取你的末影箱。",
    titleText: `§5上边容器为你的末影箱\n§3下边容器即为我的背包`,
  });
}
