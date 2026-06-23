import { Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import fakePlayerService, { IFakePlayer } from "../../../features/fake-player/services/fake-player";
import { FAKE_PLAYER_SKINS, getFakePlayerSkinName } from "../../../features/fake-player/services/fake-player-skins";
import { color, colorCodes } from "../../../shared/utils/color";
import { isAdmin } from "../../../shared/utils/common";
import { openConfirmDialogForm, openDialogForm } from "../../../ui/components/dialog";

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
      `§7假人会作为区块加载锚点维持附近区块活跃。`,
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
  form.dropdown(
    "假人皮肤",
    FAKE_PLAYER_SKINS.map((skin) => `${skin.name}`),
    { defaultValueIndex: 0 }
  );
  form.submitButton("确认创建");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) {
      openFakePlayerMenu(player, back);
      return;
    }

    const name = String(data.formValues?.[0] ?? "");
    const skinId = FAKE_PLAYER_SKINS[Number(data.formValues?.[1] ?? 0)]?.id ?? 0;
    const result = fakePlayerService.create({ player, name, skinId });
    if (typeof result === "string") {
      openDialogForm(player, { title: "创建失败", desc: color.red(result) }, () => openCreateFakePlayerForm(player, back));
      return;
    }

    openDialogForm(
      player,
      {
        title: "创建成功",
        desc: `§a已在当前位置创建假人 §e${result.name}§a。\n§a皮肤: §e${getFakePlayerSkinName(result.skinId)}\n§0${formatLocation(result)}`,
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
    form.button(`${item.name}\n§0${item.ownerName} · ${formatLocation(item)}`, "textures/icons/spectator");
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
    [
      `§a拥有者: §e${item.ownerName}`,
      `§a皮肤: §e${getFakePlayerSkinName(item.skinId)}`,
      `§a位置: §e${formatLocation(item)}`,
      `§a创建时间: §e${item.created}`,
    ].join("\n")
  );
  form.button("重生成实体", "textures/icons/requeue");
  form.button("更换皮肤", "textures/icons/edit2");
  form.button("删除假人", "textures/icons/deny");
  form.button("返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    switch (data.selection) {
      case 0: {
        const result = fakePlayerService.refresh(item.id);
        openDialogForm(
          player,
          {
            title: typeof result === "string" ? "重生成失败" : "重生成成功",
            desc: typeof result === "string" ? color.red(result) : color.green("假人实体已重新生成并绑定。"),
          },
          () => openFakePlayerListForm(player, adminView, back)
        );
        break;
      }
      case 1:
        openFakePlayerSkinForm(player, item, adminView, back);
        break;
      case 2:
        openConfirmDialogForm(
          player,
          "删除假人",
          `§c确定删除假人 §e${item.name}§c 吗？\n§0创建费用不会退回。`,
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

function openFakePlayerSkinForm(player: Player, item: IFakePlayer, adminView: boolean, back: () => void): void {
  const form = new ModalFormData();
  const currentIndex = FAKE_PLAYER_SKINS.findIndex((skin) => skin.id === (item.skinId ?? 0));
  form.title("更换假人皮肤");
  form.dropdown(
    "假人皮肤",
    FAKE_PLAYER_SKINS.map((skin) => `${skin.name}`),
    { defaultValueIndex: Math.max(0, currentIndex) }
  );
  form.submitButton("确认");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) {
      openFakePlayerDetailForm(player, item, adminView, back);
      return;
    }

    const skinId = FAKE_PLAYER_SKINS[Number(data.formValues?.[0] ?? 0)]?.id ?? 0;
    const result = fakePlayerService.updateSkin(player, item.id, skinId);
    openDialogForm(
      player,
      {
        title: typeof result === "string" ? "更换失败" : "更换成功",
        desc: typeof result === "string" ? color.red(result) : color.green(`皮肤已更换为 ${getFakePlayerSkinName(result.skinId)}。`),
      },
      () => openFakePlayerListForm(player, adminView, back)
    );
  });
}
