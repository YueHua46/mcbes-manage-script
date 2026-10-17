/**
 * 物品数据库维护（管理员）
 * - 查看官方商店 / 玩家交易市场物品数据库的状态与保护原因
 * - 以实体为准重建索引，解除保护状态
 * - 查看隔离物品，取回到自己的背包或销毁
 */

import { Player } from "@minecraft/server";
import { CreeperActionFormData as ActionFormData } from "../../creeper-action-form";
import { openConfirmDialogForm, openDialogForm } from "../../components/dialog";
import { color } from "../../../shared/utils/color";
import { isAdmin } from "../../../shared/utils/common";
import ItemDatabase, { getItemDatabases, QuarantinedItemInfo } from "../../../features/economic/services/item-database";

const DATABASE_LABELS: Record<string, string> = {
  officeShopItems: "官方商店",
  "AuctionHouse2.0": "玩家交易市场",
};

function databaseLabel(db: ItemDatabase): string {
  return DATABASE_LABELS[db.name] ?? db.name;
}

function statusLine(db: ItemDatabase): string {
  const status = db.getStatus();
  if (!status.loaded) return "§7加载中";
  if (status.protection) return "§c保护状态";
  return status.quarantined > 0
    ? `§e${status.items} 件商品 · ${status.quarantined} 件隔离`
    : `§a${status.items} 件商品`;
}

export function openItemDatabaseMaintenanceForm(player: Player, back: () => void): void {
  if (!isAdmin(player)) {
    player.sendMessage(color.red("只有管理员可以维护物品数据库。"));
    return;
  }

  const databases = getItemDatabases();
  const form = new ActionFormData()
    .title("物品数据库维护")
    .body("官方商店与玩家交易市场的物品存储状态。进入保护状态时可在这里处理。");
  for (const db of databases) {
    form.button(`${databaseLabel(db)}\n${statusLine(db)}`, "textures/icons/gear");
  }
  form.button("返回", "textures/icons/back");

  form.show(player).then((res) => {
    if (res.canceled || res.selection === undefined) return;
    const db = databases[res.selection];
    if (!db) {
      back();
      return;
    }
    openDatabaseDetailForm(player, db, () => openItemDatabaseMaintenanceForm(player, back));
  });
}

function openDatabaseDetailForm(player: Player, db: ItemDatabase, back: () => void): void {
  const status = db.getStatus();
  const lines = [
    `§f数据库：§e${databaseLabel(db)}`,
    `§f对外商品：§a${status.items}`,
    `§f隔离物品：§e${status.quarantined}`,
    `§f待清理残留：§7${status.staleCopies}`,
    `§f存储实体：§7${status.entities}`,
  ];
  if (status.protection) {
    lines.push("", `§c保护状态：§f${status.protection}`);
    lines.push("§7保护状态下商店不可使用。可以“以实体为准重建索引”解除：");
    lines.push("§7实体中的物品若能对上原有记录则保留为商品，其余全部隔离，不会删除任何物品。");
  }

  const actions: Array<{ label: string; run: () => void }> = [];
  if (status.protection) {
    actions.push({ label: "以实体为准重建索引", run: () => confirmRebuild(player, db, back) });
  } else if (status.quarantined > 0) {
    actions.push({
      label: `查看隔离物品（${status.quarantined}）`,
      run: () => openQuarantineListForm(player, db, () => openDatabaseDetailForm(player, db, back)),
    });
  }

  const form = new ActionFormData().title(databaseLabel(db)).body(lines.join("\n"));
  for (const action of actions) form.button(action.label, "textures/icons/gear");
  form.button("返回", "textures/icons/back");

  form.show(player).then((res) => {
    if (res.canceled || res.selection === undefined) return;
    const action = actions[res.selection];
    if (action) action.run();
    else back();
  });
}

function confirmRebuild(player: Player, db: ItemDatabase, back: () => void): void {
  openConfirmDialogForm(
    player,
    "重建索引",
    "将以存储实体中的物品为准重建索引并解除保护状态。\n对不上原有记录的物品会被隔离，之后可以在这里取回或销毁。\n确定继续吗？",
    () => {
      try {
        const result = db.rebuildIndexFromEntities();
        openDialogForm(
          player,
          {
            title: "重建完成",
            desc: `§a已解除保护状态。\n§f保留商品：§a${result.items}\n§f隔离物品：§e${result.quarantined}`,
          },
          () => openDatabaseDetailForm(player, db, back)
        );
      } catch (error) {
        openDialogForm(player, { title: "重建失败", desc: color.red(`重建索引失败：${String(error)}`) }, back);
      }
    },
    back,
    { dangerConfirm: true }
  );
}

function openQuarantineListForm(player: Player, db: ItemDatabase, back: () => void): void {
  let items: QuarantinedItemInfo[];
  try {
    items = db.listQuarantined();
  } catch (error) {
    openDialogForm(player, { title: "读取失败", desc: color.red(String(error)) }, back);
    return;
  }
  if (items.length === 0) {
    openDialogForm(player, { title: "隔离物品", desc: "当前没有隔离物品。" }, back);
    return;
  }

  const form = new ActionFormData()
    .title("隔离物品")
    .body("这些物品在存储实体中，但没有可信的商品记录，因此没有在商店中展示。");
  for (const item of items) {
    form.button(`${item.typeId} x${item.amount}\n§7槽位 ${item.slot}`, "textures/icons/gear");
  }
  form.button("返回", "textures/icons/back");

  form.show(player).then((res) => {
    if (res.canceled || res.selection === undefined) return;
    const item = items[res.selection];
    if (!item) {
      back();
      return;
    }
    openQuarantineItemForm(player, db, item, () => openQuarantineListForm(player, db, back));
  });
}

function openQuarantineItemForm(player: Player, db: ItemDatabase, item: QuarantinedItemInfo, back: () => void): void {
  const detected = item.detectedAt ? new Date(item.detectedAt).toISOString() : "未知";
  const form = new ActionFormData()
    .title("隔离物品")
    .body(
      [
        `§f物品：§e${item.typeId} x${item.amount}`,
        `§f槽位：§7${item.slot}`,
        `§f原因：§7${item.reason ?? "未知"}`,
        `§f发现时间：§7${detected}`,
      ].join("\n")
    )
    .button("取回到我的背包", "textures/icons/accept")
    .button("销毁", "textures/icons/deny")
    .button("返回", "textures/icons/back");

  form.show(player).then((res) => {
    if (res.canceled || res.selection === undefined) return;
    if (res.selection === 0) {
      const container = player.getComponent("inventory")?.container;
      if (!container) {
        openDialogForm(player, { title: "取回失败", desc: color.red("无法读取你的背包") }, back);
        return;
      }
      try {
        db.takeQuarantined(item.id, container);
        openDialogForm(player, { title: "取回成功", desc: "§a物品已放入你的背包。" }, back);
      } catch (error) {
        openDialogForm(player, { title: "取回失败", desc: color.red(String(error)) }, back);
      }
      return;
    }
    if (res.selection === 1) {
      openConfirmDialogForm(
        player,
        "销毁隔离物品",
        `确定要永久销毁 ${item.typeId} x${item.amount} 吗？`,
        () => {
          try {
            db.discardQuarantined(item.id);
            openDialogForm(player, { title: "已销毁", desc: "§a隔离物品已销毁。" }, back);
          } catch (error) {
            openDialogForm(player, { title: "销毁失败", desc: color.red(String(error)) }, back);
          }
        },
        back,
        { dangerConfirm: true }
      );
      return;
    }
    back();
  });
}
