import { Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import fakePlayerService, {
  FakePlayerType,
  getFakePlayerType,
  IFakePlayer,
} from "../../../features/fake-player/services/fake-player";
import {
  FAKE_PLAYER_SKINS,
  getFakePlayerSkinName,
} from "../../../features/fake-player/services/fake-player-skins";
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
      `§7创建时可选择兼容性更好的旧版实体，或可参与原版刷怪判定的新版模拟玩家。`,
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
  const form = new ActionFormData();
  form.title("选择假人类型");
  form.body(
    [
      "§b旧版实体假人",
      "§7兼容性更好，可更换二次元皮肤；能够加载区块并维持红石、农作物运行，但不会参与玩家刷怪判定。",
      "",
      "§d新版模拟玩家",
      "§7能够加载区块并参与原版玩家刷怪判定；不支持二次元皮肤，部分模组可能将其误判为真实玩家，从而导致模组报错（具体会不会影响该模组核心功能则需自行测试）",
      "",
      "§e请选择更适合当前用途的版本。",
    ].join("\n")
  );
  form.button("旧版实体假人\n§7兼容性好 · 支持换肤", "textures/icons/profile");
  form.button("新版模拟玩家\n§7支持原版刷怪机制", "textures/icons/spectator");
  form.button("返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) {
      openFakePlayerMenu(player, back);
      return;
    }
    if (data.selection === 0) {
      openCreateFakePlayerDetailsForm(player, "entity", back);
    } else if (data.selection === 1) {
      openCreateFakePlayerDetailsForm(player, "simulated", back);
    } else {
      openFakePlayerMenu(player, back);
    }
  });
}

function openCreateFakePlayerDetailsForm(player: Player, type: FakePlayerType, back: () => void): void {
  const isLegacy = type === "entity";
  const form = new ModalFormData();
  form.title(isLegacy ? "创建旧版实体假人" : "创建新版模拟玩家");
  form.textField("假人名称", "例如: 地狱树场加载点", {
    defaultValue: `${player.name}的假人`,
  });
  if (isLegacy) {
    form.dropdown("二次元皮肤", FAKE_PLAYER_SKINS.map((skin) => skin.name), { defaultValueIndex: 0 });
  }
  form.submitButton("确认创建");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) {
      openCreateFakePlayerForm(player, back);
      return;
    }

    const name = String(data.formValues?.[0] ?? "");
    const skinId = isLegacy ? (FAKE_PLAYER_SKINS[Number(data.formValues?.[1])]?.id ?? 0) : undefined;
    const result = fakePlayerService.create({ player, name, type, skinId });
    if (typeof result === "string") {
      openDialogForm(player, { title: "创建失败", desc: color.red(result) }, () =>
        openCreateFakePlayerDetailsForm(player, type, back)
      );
      return;
    }

    openDialogForm(
      player,
      {
        title: "创建成功",
        desc: [
          `§a已在当前位置创建假人 §e${result.name}§a。`,
          `§a类型: §e${getFakePlayerType(result) === "entity" ? "旧版实体假人" : "新版模拟玩家"}`,
          `§7${formatLocation(result)}`,
          "",
          "§e右键这个假人可以打开交互菜单。",
          ...(getFakePlayerType(result) === "simulated"
            ? [
                "§e默认只有创建者和管理员可以查看假人背包。",
                "§e创建者或管理员可以在交互菜单里添加其他可查看背包的玩家。",
              ]
            : ["§e可在假人详情中随时更换二次元皮肤。", "§7旧版实体假人不提供玩家背包。"]),
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
    const typeLabel = getFakePlayerType(item) === "entity" ? "旧版" : "新版";
    form.button(`${item.name}\n§7[${typeLabel}] ${item.ownerName} · ${formatLocation(item)}`, "textures/icons/spectator");
  });
  if (adminView && items.length > 0) {
    form.button("§c一键清除全部假人\n§7删除数据并踢出在线假人", "textures/icons/deny");
  }
  form.button("返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    const clearAllIndex = adminView && items.length > 0 ? items.length : -1;
    const backIndex = clearAllIndex >= 0 ? items.length + 1 : items.length;

    if (data.selection === clearAllIndex) {
      openClearAllFakePlayersConfirmForm(player, back);
      return;
    }

    if (data.selection === backIndex) {
      openFakePlayerMenu(player, back);
      return;
    }
    if (typeof data.selection !== "number") return;
    const item = items[data.selection];
    if (!item) return;
    openFakePlayerDetailForm(player, item, adminView, back);
  });
}

function openClearAllFakePlayersConfirmForm(player: Player, back: () => void): void {
  if (!isAdmin(player)) {
    openDialogForm(player, { title: "无权操作", desc: color.red("只有管理员可以清除全服假人。") }, () =>
      openFakePlayerMenu(player, back)
    );
    return;
  }

  const count = fakePlayerService.listAllForAdmin().length;
  openConfirmDialogForm(
    player,
    "清除全部假人",
    [
      `§c确定删除全服 ${count} 个假人吗？`,
      "§c此操作会删除所有假人数据，并踢出/移除当前在线假人。",
      "§7假人背包会按现有移除逻辑先尝试持久化，但删除数据后不会再自动恢复。",
    ].join("\n"),
    () => {
      const result = fakePlayerService.deleteAll(player);
      openDialogForm(
        player,
        {
          title: typeof result === "string" ? "清除失败" : "清除完成",
          desc:
            typeof result === "string"
              ? color.red(result)
              : color.green(`已删除 ${result.deleted} 条假人数据，并踢出/移除 ${result.kicked} 个在线假人。`),
        },
        () => openFakePlayerMenu(player, back)
      );
    },
    () => openFakePlayerListForm(player, true, back),
    { dangerConfirm: true }
  );
}

function openFakePlayerDetailForm(player: Player, item: IFakePlayer, adminView: boolean, back: () => void): void {
  const form = new ActionFormData();
  form.title(`${item.name}`);
  form.body(
    [
      `§a拥有者: §e${item.ownerName}`,
      `§a类型: §e${getFakePlayerType(item) === "entity" ? "旧版实体假人" : "新版模拟玩家"}`,
      ...(getFakePlayerType(item) === "entity" ? [`§a皮肤: §e${getFakePlayerSkinName(item.skinId)}`] : []),
      `§a位置: §e${formatLocation(item)}`,
      `§a创建时间: §e${item.created}`,
    ].join("\n")
  );
  if (getFakePlayerType(item) === "simulated") {
    form.button("背包与权限", "textures/icons/quest_chest");
  } else {
    form.button("更换二次元皮肤", "textures/icons/edit2");
  }
  form.button("移动到我的当前位置", "textures/icons/fast_travel");
  form.button("重新生成", "textures/icons/requeue");
  form.button("删除假人", "textures/icons/deny");
  form.button("返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    switch (data.selection) {
      case 0: {
        if (getFakePlayerType(item) === "entity") {
          openLegacyFakePlayerSkinForm(player, item, adminView, back);
        } else {
          openFakePlayerInteractMenu(player, item.id);
        }
        break;
      }
      case 1: {
        const result = fakePlayerService.moveToOperator(player, item.id);
        openDialogForm(
          player,
          {
            title: typeof result === "string" ? "移动结果" : "移动成功",
            desc: typeof result === "string" ? color.yellow(result) : color.green("假人已移动到你的当前位置。"),
          },
          () => openFakePlayerListForm(player, adminView, back)
        );
        break;
      }
      case 2: {
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
      case 3:
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
      case 4:
        openFakePlayerListForm(player, adminView, back);
        break;
    }
  });
}

function openLegacyFakePlayerSkinForm(player: Player, item: IFakePlayer, adminView: boolean, back: () => void): void {
  const form = new ModalFormData();
  form.title(`更换皮肤 · ${item.name}`);
  form.dropdown("二次元皮肤", FAKE_PLAYER_SKINS.map((skin) => skin.name), {
    defaultValueIndex: Math.max(0, FAKE_PLAYER_SKINS.findIndex((skin) => skin.id === item.skinId)),
  });
  form.submitButton("应用皮肤");
  form.show(player).then((data) => {
    if (data.canceled || !data.formValues) {
      openFakePlayerDetailForm(player, item, adminView, back);
      return;
    }
    const skin = FAKE_PLAYER_SKINS[Number(data.formValues[0])] ?? FAKE_PLAYER_SKINS[0];
    const result = fakePlayerService.setLegacySkin(player, item.id, skin.id);
    openDialogForm(
      player,
      {
        title: typeof result === "string" ? "更换失败" : "更换成功",
        desc: typeof result === "string" ? color.red(result) : color.green(`皮肤已更换为 ${skin.name}。`),
      },
      () => openFakePlayerListForm(player, adminView, back)
    );
  });
}
