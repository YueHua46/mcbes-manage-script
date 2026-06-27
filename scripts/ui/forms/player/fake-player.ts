import { Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import fakePlayerService, { IFakePlayer } from "../../../features/fake-player/services/fake-player";
import { color } from "../../../shared/utils/color";
import { isAdmin } from "../../../shared/utils/common";
import { openConfirmDialogForm, openDialogForm } from "../../../ui/components/dialog";
import { openFakePlayerInteractMenu } from "./fake-player-inventory";

function formatLocation(item: IFakePlayer): string {
  return `${item.dimension.replace("minecraft:", "")} ${item.location.x}, ${item.location.y}, ${item.location.z}`;
}

export function openFakePlayerMenu(player: Player, back: () => void): void {
  if (!fakePlayerService.canUse(player)) {
    openDialogForm(player, { title: "功能未开放", desc: "§c服务器暂未开放假人功能。" }, back);
    return;
  }

  const own = fakePlayerService.listForPlayer(player.name);
  const max = fakePlayerService.getMaxPerPlayer();
  const cost = fakePlayerService.getCreateCost();

  const form = new ActionFormData();
  form.title("假人管理");
  form.body(
    [
      `§a我的假人: §e${own.length}/${isAdmin(player) ? "不限" : max}`,
      `§a创建费用: §e${cost} 金币`,
      `§7假人会作为模拟玩家维持原版刷怪等行为。`,
    ].join("\n")
  );
  form.button("在当前位置创建假人", "textures/icons/add");
  form.button("我的假人列表", "textures/icons/spectator");
  if (isAdmin(player)) {
    form.button("全服假人管理", "textures/icons/mod_shield");
  }
  form.button("返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    const admin = isAdmin(player);
    const backIndex = admin ? 3 : 2;
    switch (data.selection) {
      case 0:
        openCreateFakePlayerForm(player, back);
        break;
      case 1:
        openFakePlayerListForm(player, false, back);
        break;
      case 2:
        admin ? openFakePlayerListForm(player, true, back) : back();
        break;
      case backIndex:
        back();
        break;
    }
  });
}

function openCreateFakePlayerForm(player: Player, back: () => void): void {
  const form = new ModalFormData();
  form.title("创建假人");
  form.textField("假人名称", "例如: 地狱树场加载点", {
    defaultValue: `${player.name}的假人`,
  });
  form.submitButton("确认创建");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) {
      openFakePlayerMenu(player, back);
      return;
    }

    const name = String(data.formValues?.[0] ?? "");
    const result = fakePlayerService.create({ player, name });
    if (typeof result === "string") {
      openDialogForm(player, { title: "创建失败", desc: color.red(result) }, () =>
        openCreateFakePlayerForm(player, back)
      );
      return;
    }

    openDialogForm(
      player,
      {
        title: "创建成功",
        desc: [
          `§a已在当前位置创建模拟玩家 §e${result.name}§a。`,
          `§7${formatLocation(result)}`,
          "",
          "§e右键这个假人可以打开交互菜单。",
          "§e默认只有创建者和管理员可以查看假人背包。",
          "§e创建者或管理员可以在交互菜单里添加其他可查看背包的玩家。",
        ].join("\n"),
      },
      () => openFakePlayerMenu(player, back)
    );
  });
}

function openFakePlayerListForm(player: Player, adminView: boolean, back: () => void): void {
  const items = adminView ? fakePlayerService.listAllForAdmin() : fakePlayerService.listForPlayer(player.name);
  const form = new ActionFormData();
  form.title(adminView ? "全服假人管理" : "我的假人");

  if (items.length === 0) {
    form.body(adminView ? "§e当前全服没有假人。" : "§e你还没有创建任何假人。");
  } else {
    form.body(`§a共 ${items.length} 个假人`);
  }

  items.forEach((item) => {
    form.button(`${item.name}\n§7${item.ownerName} · ${formatLocation(item)}`, "textures/icons/spectator");
  });
  form.button("返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    if (data.selection === items.length) {
      openFakePlayerMenu(player, back);
      return;
    }
    if (typeof data.selection !== "number") return;
    const item = items[data.selection];
    if (!item) return;
    openFakePlayerDetailForm(player, item, adminView, back);
  });
}

function openFakePlayerDetailForm(player: Player, item: IFakePlayer, adminView: boolean, back: () => void): void {
  const form = new ActionFormData();
  form.title(`${item.name}`);
  form.body(
    [`§a拥有者: §e${item.ownerName}`, `§a位置: §e${formatLocation(item)}`, `§a创建时间: §e${item.created}`].join("\n")
  );
  form.button("背包与权限", "textures/icons/quest_chest");
  form.button("重新生成", "textures/icons/requeue");
  form.button("删除假人", "textures/icons/deny");
  form.button("返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    switch (data.selection) {
      case 0: {
        openFakePlayerInteractMenu(player, item.id);
        break;
      }
      case 1: {
        const result = fakePlayerService.refresh(item.id);
        openDialogForm(
          player,
          {
            title: typeof result === "string" ? "重新生成失败" : "重新生成成功",
            desc: typeof result === "string" ? color.red(result) : color.green("假人已重新生成。"),
          },
          () => openFakePlayerListForm(player, adminView, back)
        );
        break;
      }
      case 2:
        openConfirmDialogForm(
          player,
          "删除假人",
          `§c确定删除假人 §e${item.name}§c 吗？\n§7创建费用不会退回。`,
          () => {
            const result = fakePlayerService.delete(player, item.id);
            openDialogForm(
              player,
              {
                title: result === true ? "删除成功" : "删除失败",
                desc: result === true ? color.green("假人已删除。") : color.red(String(result)),
              },
              () => openFakePlayerListForm(player, adminView, back)
            );
          },
          () => openFakePlayerDetailForm(player, item, adminView, back),
          { dangerConfirm: true }
        );
        break;
      case 3:
        openFakePlayerListForm(player, adminView, back);
        break;
    }
  });
}
