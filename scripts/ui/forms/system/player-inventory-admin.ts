/**
 * 管理员查看/操作玩家背包
 * 使用 Chest-UI 双栏布局：上方为目标玩家背包+装备栏，下方为管理员背包，点击即可在两者间转移物品
 * - Bedrock 玩家 container 共 36 槽：前 9 槽为快捷栏（0-8），后 27 槽为背包（9-35）
 * - 5 个装备栏（头盔/胸甲/腿甲/靴子/副手）通过 EntityEquippableComponent 读写，显示在上方第 37–41 格
 * @see https://github.com/Herobrine643928/Chest-UI （Inventory Section：上半箱子 + 下半查看者背包）
 */

import { Player, world, EntityEquippableComponent, EquipmentSlot } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { openDialogForm } from "../../components/dialog";
import { isAdmin } from "../../../shared/utils/common";
import ChestFormData from "../../components/chest-ui/chest-forms";
import type { ChestFormResponse } from "../../components/chest-ui/chest-forms";
import { getChestItemDurabilityBarValue } from "../../components/chest-ui";
import { getItemDisplayName, hasAnyEnchantment } from "../../../shared/utils/item-utils";

/** 上方表单中装备栏对应的按钮索引（紧接在 36 个背包槽之后） */
const EQUIPMENT_BUTTON_OFFSET = 36;
const EQUIPMENT_SLOTS: [EquipmentSlot, string, string][] = [
  [EquipmentSlot.Head, "头盔", "textures/ui/empty_armor_slot_helmet"],
  [EquipmentSlot.Chest, "胸甲", "textures/ui/empty_armor_slot_chestplate"],
  [EquipmentSlot.Legs, "腿甲", "textures/ui/empty_armor_slot_leggings"],
  [EquipmentSlot.Feet, "靴子", "textures/ui/empty_armor_slot_boots"],
  [EquipmentSlot.Offhand, "副手/盾牌", "textures/ui/empty_armor_slot_shield"],
];

function isShulkerBox(typeId: string): boolean {
  return (
    typeId === "minecraft:shulker_box" || typeId === "minecraft:undyed_shulker_box" || typeId.endsWith("_shulker_box")
  );
}

function moveItemToAdminInventory(
  adminPlayer: Player,
  targetPlayer: Player,
  sourceType: "inventory" | "equipment",
  sourceSlot: number | EquipmentSlot
): void {
  const adminContainer = adminPlayer.getComponent("inventory")?.container;
  if (!adminContainer) {
    openPlayerInventoryDualForm(adminPlayer, targetPlayer);
    return;
  }

  if (sourceType === "inventory") {
    const targetInv = targetPlayer.getComponent("inventory")?.container;
    if (!targetInv) {
      openPlayerInventoryDualForm(adminPlayer, targetPlayer);
      return;
    }
    const item = targetInv.getItem(sourceSlot as number);
    if (!item) {
      openPlayerInventoryDualForm(adminPlayer, targetPlayer);
      return;
    }

    targetInv.setItem(sourceSlot as number, undefined);
    const overflow = adminContainer.addItem(item);
    if (overflow) {
      targetInv.setItem(sourceSlot as number, overflow);
      adminPlayer.sendMessage("§e背包已满，部分物品已放回目标背包。");
    }
    openPlayerInventoryDualForm(adminPlayer, targetPlayer);
    return;
  }

  const targetEquippable = targetPlayer.getComponent(EntityEquippableComponent.componentId) as
    | EntityEquippableComponent
    | undefined;
  if (!targetEquippable) {
    openPlayerInventoryDualForm(adminPlayer, targetPlayer);
    return;
  }
  const equipSlot = sourceSlot as EquipmentSlot;
  const item = targetEquippable.getEquipment(equipSlot);
  if (!item) {
    openPlayerInventoryDualForm(adminPlayer, targetPlayer);
    return;
  }
  targetEquippable.setEquipment(equipSlot, undefined);
  const overflow = adminContainer.addItem(item);
  if (overflow) {
    targetEquippable.setEquipment(equipSlot, overflow);
    adminPlayer.sendMessage("§e背包已满，装备已穿回目标玩家。");
  }
  openPlayerInventoryDualForm(adminPlayer, targetPlayer);
}

function copyItemToAdminInventory(adminPlayer: Player, item: any): void {
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

function openShulkerActionForm(adminPlayer: Player, targetPlayer: Player, sourceSlot: number): void {
  const targetContainer = targetPlayer.getComponent("inventory")?.container;
  if (!targetContainer) {
    openPlayerInventoryDualForm(adminPlayer, targetPlayer);
    return;
  }
  const item = targetContainer.getItem(sourceSlot);
  if (!item) {
    openPlayerInventoryDualForm(adminPlayer, targetPlayer);
    return;
  }

  const form = new ActionFormData()
    .title("§d潜影盒操作")
    .body(
      "§7你选择的是潜影盒。\n\n§e说明：当前 Script API 无法稳定直接读取“玩家背包中”潜影盒内部槽位详情。\n§7可先复制/取走后再进行后续处理。"
    )
    .button("§a取走潜影盒（从目标背包移除）")
    .button("§b复制一份潜影盒（目标保留原件）")
    .button("§8返回");

  form.show(adminPlayer).then((res) => {
    if (res.canceled || res.selection === undefined || res.selection === 2) {
      openPlayerInventoryDualForm(adminPlayer, targetPlayer);
      return;
    }
    if (res.selection === 0) {
      moveItemToAdminInventory(adminPlayer, targetPlayer, "inventory", sourceSlot);
      return;
    }
    if (res.selection === 1) {
      copyItemToAdminInventory(adminPlayer, item);
      openPlayerInventoryDualForm(adminPlayer, targetPlayer);
    }
  });
}

/**
 * 打开玩家背包管理入口（选择目标玩家）
 */
export function openPlayerInventoryAdminForm(adminPlayer: Player): void {
  if (!isAdmin(adminPlayer)) {
    adminPlayer.sendMessage("§c只有管理员可以查看玩家背包。");
    return;
  }

  const onlinePlayers = world.getPlayers().filter((p) => p.id !== adminPlayer.id);
  const playerNames = onlinePlayers.map((p) => p.name);

  if (playerNames.length === 0) {
    openDialogForm(adminPlayer, { title: "§c提示", desc: "当前无其他在线玩家（已排除自己）。" }, () => {
      const { openSystemSettingForm } = require("./index");
      openSystemSettingForm(adminPlayer);
    });
    return;
  }

  const form = new ModalFormData();
  form.title("§6玩家背包管理");
  form.dropdown("选择要查看背包的玩家", playerNames, { defaultValueIndex: 0 });
  form.submitButton("§a查看背包");

  form.show(adminPlayer).then((data) => {
    if (data.cancelationReason) return;
    const idx = data.formValues?.[0] as number;
    if (idx === undefined) return;
    const targetName = playerNames[idx];
    const targetPlayer = world.getPlayers().find((p) => p.name === targetName);
    if (!targetPlayer) {
      openDialogForm(adminPlayer, { title: "§c错误", desc: "目标玩家已离线。" }, () =>
        openPlayerInventoryAdminForm(adminPlayer)
      );
      return;
    }
    openPlayerInventoryDualForm(adminPlayer, targetPlayer);
  });
}

/**
 * 双栏 Chest-UI：上方 45 格（5 行）= 目标 36 槽 + 5 装备栏（头盔/胸甲/腿甲/靴子/副手），下方仅在此表单显示（标题含 §inv§1 时 RP 才渲染）
 * 点击上方格：从目标背包/装备取物到管理员背包；点击下方格：从管理员背包放到目标背包
 */
function openPlayerInventoryDualForm(adminPlayer: Player, targetPlayer: Player): void {
  const targetInv = targetPlayer.getComponent("inventory");
  if (!targetInv?.container) {
    openDialogForm(adminPlayer, { title: "§c错误", desc: "无法获取该玩家背包。" }, () =>
      openPlayerInventoryAdminForm(adminPlayer)
    );
    return;
  }

  const targetContainer = targetInv.container;
  const targetSize = targetContainer.size;
  const chestForm = new ChestFormData("45_inv");
  chestForm.title(`§6【上】目标: §f${targetPlayer.name} §6【下】§e你的背包 §7(下方即你的背包)`);

  for (let i = 0; i < targetSize; i++) {
    const item = targetContainer.getItem(i);
    if (item) {
      const slotHint = i < 9 ? "§8快捷栏 " : "";
      const durComp = item.getComponent("durability");
      const lores: string[] = [`§e数量: §f${item.amount}`];
      if (durComp && durComp.damage > 0) {
        const pct = Math.round(((durComp.maxDurability - durComp.damage) / durComp.maxDurability) * 100);
        lores.push(`§e耐久: §f${pct}%`);
      }
      lores.push(`§7${slotHint}点击 → 取到你的背包`);
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
        lores.push(`§7装备·${label} §8点击 → 取到你的背包`);
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
      openPlayerInventoryAdminForm(adminPlayer);
      return;
    }

    const selection = data.selection;
    if (selection === undefined) return;

    const adminContainer = adminPlayer.getComponent("inventory")?.container;
    if (!adminContainer) {
      openPlayerInventoryDualForm(adminPlayer, targetPlayer);
      return;
    }

    // 点击了上方：目标玩家背包槽位 [0, targetSize-1]（0-8 快捷栏，9-35 背包）
    if (selection < targetSize) {
      const item = targetContainer.getItem(selection);
      if (!item) {
        openPlayerInventoryDualForm(adminPlayer, targetPlayer);
        return;
      }

      // 潜影盒给出专门操作：取走 or 复制
      if (isShulkerBox(item.typeId)) {
        openShulkerActionForm(adminPlayer, targetPlayer, selection);
        return;
      }

      moveItemToAdminInventory(adminPlayer, targetPlayer, "inventory", selection);
      return;
    }

    // 点击了上方装备栏（头盔/胸甲/腿甲/靴子/副手）
    const equipmentIndex = selection - EQUIPMENT_BUTTON_OFFSET;
    if (equipmentIndex >= 0 && equipmentIndex < EQUIPMENT_SLOTS.length && targetEquippable) {
      const [equipSlot] = EQUIPMENT_SLOTS[equipmentIndex];
      moveItemToAdminInventory(adminPlayer, targetPlayer, "equipment", equipSlot);
      return;
    }

    // 点击了下方：管理员背包槽位，inventorySlot 为 0 到 container.size-1
    const adminSlot = data.inventorySlot;
    if (adminSlot === null || adminSlot === undefined) {
      openPlayerInventoryDualForm(adminPlayer, targetPlayer);
      return;
    }

    const item = adminContainer.getItem(adminSlot);
    if (!item) {
      openPlayerInventoryDualForm(adminPlayer, targetPlayer);
      return;
    }
    adminContainer.setItem(adminSlot, undefined);
    const overflow = targetContainer.addItem(item);
    if (overflow) {
      adminContainer.setItem(adminSlot, overflow);
      adminPlayer.sendMessage("§e目标玩家背包已满，部分物品已退回你的背包。");
    }
    openPlayerInventoryDualForm(adminPlayer, targetPlayer);
  });
}
