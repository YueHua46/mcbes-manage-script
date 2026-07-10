import { Container, Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import fakePlayerService, { getFakePlayerType } from "../../../features/fake-player/services/fake-player";
import ChestFormData, { ChestFormResponse } from "../../components/chest-ui/chest-forms";
import { getChestItemDurabilityBarValue } from "../../components/chest-ui";
import { getItemDisplayName, hasAnyEnchantment } from "../../../shared/utils/item-utils";
import { openDialogForm } from "../../components/dialog";
import { color } from "../../../shared/utils/color";
import { getOnlineRealPlayers } from "../../../shared/utils/online-players";

const FAKE_INVENTORY_VISIBLE_SLOTS = 36;
const MSG_VIEWER_BAG_FULL = "§e你的背包已满，无法接收物品。";
const MSG_FAKE_BAG_FULL = "§e假人背包已满，物品已退回你的背包。";

function sameStackIdentity(a: { typeId: string; amount: number }, b: { typeId: string; amount: number }): boolean {
  return a.typeId === b.typeId && a.amount === b.amount;
}

function moveSlotToContainer(
  source: Container,
  sourceSlot: number,
  target: Container,
  onFull: (fullReturn: boolean) => void
): boolean {
  const item = source.getItem(sourceSlot);
  if (!item) return false;

  source.setItem(sourceSlot, undefined);
  const overflow = target.addItem(item);
  if (overflow) {
    source.setItem(sourceSlot, overflow);
    onFull(sameStackIdentity(overflow, item));
  }

  return true;
}

function formatViewerList(viewers: string[]): string {
  return viewers.length > 0 ? viewers.map((name) => `§f${name}`).join("§7, ") : "§7暂无额外授权玩家";
}

export function openFakePlayerInteractMenu(viewer: Player, fakeId: string): void {
  const fakeItem = fakePlayerService.getById(fakeId);
  if (!fakeItem) {
    openDialogForm(viewer, { title: "§c错误", desc: "这个假人的数据不存在。" }, () => undefined);
    return;
  }

  if (getFakePlayerType(fakeItem) === "entity") {
    const form = new ActionFormData();
    form.title(`旧版假人 · ${fakeItem.name}`);
    form.body(
      [
        `§a创建者: §e${fakeItem.ownerName}`,
        "§7这是兼容性更好的实体假人，可加载区块并维持红石、农作物运行。",
        "§e实体假人没有玩家背包，也不会参与原版玩家刷怪判定。",
        "§7创建者或管理员可从假人管理列表中移动、换肤、重生或删除它。",
      ].join("\n")
    );
    form.button("关闭", "textures/icons/back");
    form.show(viewer);
    return;
  }

  const canOpen = fakePlayerService.canAccessInventory(viewer, fakeItem);
  const canManage = fakePlayerService.canManageInventoryAccess(viewer, fakeItem);
  const viewers = fakePlayerService.getInventoryViewers(fakeItem);

  const form = new ActionFormData();
  form.title(`假人 · ${fakeItem.name}`);
  form.body(
    [
      `§a创建者: §e${fakeItem.ownerName}`,
      `§a可打开背包: §e创建者、管理员${viewers.length > 0 ? "、授权玩家" : ""}`,
      `§a授权玩家: ${formatViewerList(viewers)}`,
      canOpen ? "§7请选择要执行的操作。" : "§c你没有打开这个假人背包的权限。",
    ].join("\n")
  );

  const actions: Array<() => void> = [];
  if (canOpen) {
    form.button("查看假人背包", "textures/icons/quest_chest");
    actions.push(() => openFakePlayerInventoryForm(viewer, fakeId));
  }
  if (canManage) {
    form.button("管理背包权限", "textures/icons/settings");
    actions.push(() => openFakePlayerInventoryAccessForm(viewer, fakeId));
  }
  form.button("关闭", "textures/icons/back");
  actions.push(() => undefined);

  form.show(viewer).then((data) => {
    if (data.canceled || data.selection === undefined) return;
    actions[data.selection]?.();
  });
}

function openFakePlayerInventoryAccessForm(operator: Player, fakeId: string): void {
  const fakeItem = fakePlayerService.getById(fakeId);
  if (!fakeItem) {
    openDialogForm(operator, { title: "§c错误", desc: "这个假人的数据不存在。" }, () => undefined);
    return;
  }

  if (!fakePlayerService.canManageInventoryAccess(operator, fakeItem)) {
    openDialogForm(operator, { title: "§c无权管理", desc: "只有假人创建者和管理员可以管理背包权限。" }, () =>
      openFakePlayerInteractMenu(operator, fakeId)
    );
    return;
  }

  const viewers = fakePlayerService.getInventoryViewers(fakeItem);
  const form = new ActionFormData();
  form.title(`背包权限 · ${fakeItem.name}`);
  form.body(
    [`§a默认可访问: §e${fakeItem.ownerName} §7(创建者)§e、管理员`, `§a额外授权: ${formatViewerList(viewers)}`].join(
      "\n"
    )
  );
  form.button("添加授权玩家", "textures/icons/add");
  if (viewers.length > 0) {
    form.button("移除授权玩家", "textures/icons/deny");
  }
  form.button("返回", "textures/icons/back");

  form.show(operator).then((data) => {
    if (data.canceled || data.selection === undefined) {
      openFakePlayerInteractMenu(operator, fakeId);
      return;
    }

    if (data.selection === 0) {
      openAddInventoryViewerForm(operator, fakeId);
      return;
    }

    if (viewers.length > 0 && data.selection === 1) {
      openRemoveInventoryViewerForm(operator, fakeId);
      return;
    }

    openFakePlayerInteractMenu(operator, fakeId);
  });
}

function openAddInventoryViewerForm(operator: Player, fakeId: string): void {
  const fakeItem = fakePlayerService.getById(fakeId);
  if (!fakeItem) return;

  const candidates = getOnlineRealPlayers()
    .map((player) => player.name)
    .filter((name) => name !== fakeItem.ownerName && !fakePlayerService.getInventoryViewers(fakeItem).includes(name));

  if (candidates.length > 0) {
    const form = new ModalFormData();
    form.title("添加授权玩家");
    form.dropdown("选择在线玩家", candidates, { defaultValueIndex: 0 });
    form.submitButton("添加");

    form.show(operator).then((data) => {
      if (data.canceled || data.formValues?.[0] === undefined) {
        openFakePlayerInventoryAccessForm(operator, fakeId);
        return;
      }

      const name = candidates[data.formValues[0] as number];
      const result = fakePlayerService.addInventoryViewer(operator, fakeId, name);
      openDialogForm(
        operator,
        {
          title: result === true ? "添加成功" : "添加失败",
          desc: result === true ? color.green(`已允许 ${name} 打开这个假人背包。`) : color.red(String(result)),
        },
        () => openFakePlayerInventoryAccessForm(operator, fakeId)
      );
    });
    return;
  }

  const form = new ModalFormData();
  form.title("添加授权玩家");
  form.textField("玩家名", "输入玩家名", { defaultValue: "" });
  form.submitButton("添加");

  form.show(operator).then((data) => {
    if (data.canceled) {
      openFakePlayerInventoryAccessForm(operator, fakeId);
      return;
    }

    const name = String(data.formValues?.[0] ?? "");
    const result = fakePlayerService.addInventoryViewer(operator, fakeId, name);
    openDialogForm(
      operator,
      {
        title: result === true ? "添加成功" : "添加失败",
        desc: result === true ? color.green(`已允许 ${name.trim()} 打开这个假人背包。`) : color.red(String(result)),
      },
      () => openFakePlayerInventoryAccessForm(operator, fakeId)
    );
  });
}

function openRemoveInventoryViewerForm(operator: Player, fakeId: string): void {
  const fakeItem = fakePlayerService.getById(fakeId);
  if (!fakeItem) return;

  const viewers = fakePlayerService.getInventoryViewers(fakeItem);
  if (viewers.length === 0) {
    openFakePlayerInventoryAccessForm(operator, fakeId);
    return;
  }

  const form = new ModalFormData();
  form.title("移除授权玩家");
  form.dropdown("选择玩家", viewers, { defaultValueIndex: 0 });
  form.submitButton("移除");

  form.show(operator).then((data) => {
    if (data.canceled || data.formValues?.[0] === undefined) {
      openFakePlayerInventoryAccessForm(operator, fakeId);
      return;
    }

    const name = viewers[data.formValues[0] as number];
    const result = fakePlayerService.removeInventoryViewer(operator, fakeId, name);
    openDialogForm(
      operator,
      {
        title: result === true ? "移除成功" : "移除失败",
        desc: result === true ? color.green(`已移除 ${name} 的假人背包权限。`) : color.red(String(result)),
      },
      () => openFakePlayerInventoryAccessForm(operator, fakeId)
    );
  });
}

export function openFakePlayerInventoryForm(viewer: Player, fakeId: string): void {
  const fakeItem = fakePlayerService.getById(fakeId);
  if (!fakeItem) {
    openDialogForm(viewer, { title: "§c错误", desc: "这个假人的数据不存在。" }, () => undefined);
    return;
  }

  if (!fakePlayerService.canAccessInventory(viewer, fakeItem)) {
    openDialogForm(viewer, { title: "§c无权访问", desc: "你只能打开自己创建的假人背包。" }, () => undefined);
    return;
  }

  let fakePlayer = fakePlayerService.getLivePlayer(fakeId);
  if (!fakePlayer?.isValid) {
    fakePlayerService.refresh(fakeId);
    fakePlayer = fakePlayerService.getLivePlayer(fakeId);
  }

  if (!fakePlayer?.isValid) {
    openDialogForm(viewer, { title: "§c错误", desc: "假人当前不在线或所在区块未加载。" }, () => undefined);
    return;
  }

  const fakeContainer = fakePlayer.getComponent("inventory")?.container;
  const viewerContainer = viewer.getComponent("inventory")?.container;
  if (!fakeContainer || !viewerContainer) {
    openDialogForm(viewer, { title: "§c错误", desc: "无法读取背包容器。" }, () => undefined);
    return;
  }

  const targetSlots = Math.min(fakeContainer.size, FAKE_INVENTORY_VISIBLE_SLOTS);
  const chestForm = new ChestFormData("36_inv");
  chestForm.title(`§6上边容器为假人 §f${fakeItem.name} §6的背包\n§7下边容器即为你的背包`);

  for (let i = 0; i < targetSlots; i++) {
    const item = fakeContainer.getItem(i);
    if (!item) continue;

    const durComp = item.getComponent("durability");
    const lores: string[] = [`§e数量: §f${item.amount}`];
    if (durComp && durComp.damage > 0) {
      const pct = Math.round(((durComp.maxDurability - durComp.damage) / durComp.maxDurability) * 100);
      lores.push(`§e耐久: §f${pct}%`);
    }
    lores.push(i < 9 ? "§3快捷栏 · 点击取到你的背包" : "§3点击取到你的背包");

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

  chestForm.show(viewer, { appendViewerInventory: true }).then((data: ChestFormResponse) => {
    if (data.canceled) return;

    const selection = data.selection;
    if (selection === undefined) return;

    if (selection < targetSlots) {
      moveSlotToContainer(fakeContainer, selection, viewerContainer, (fullReturn) => {
        viewer.sendMessage(fullReturn ? MSG_VIEWER_BAG_FULL : "§e你的背包已满，部分物品已放回假人背包。");
      });
      fakePlayerService.persistInventory(fakeId);
      openFakePlayerInventoryForm(viewer, fakeId);
      return;
    }

    const viewerSlot = data.inventorySlot;
    if (viewerSlot === null || viewerSlot === undefined) {
      openFakePlayerInventoryForm(viewer, fakeId);
      return;
    }

    moveSlotToContainer(viewerContainer, viewerSlot, fakeContainer, (fullReturn) => {
      viewer.sendMessage(fullReturn ? MSG_FAKE_BAG_FULL : "§e假人背包已满，部分物品已退回你的背包。");
    });
    fakePlayerService.persistInventory(fakeId);
    openFakePlayerInventoryForm(viewer, fakeId);
  });
}
