import { Player, ItemStack, ItemComponentTypes } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { color } from "../../utils/color";
import { openServerMenuForm } from "../Forms/Forms";
import { openDialogForm } from "../Forms/Dialog";
import ChestFormData from "../ChestUI/ChestForms";
import shop, { IShopItem } from "./PlayerShop";
import { MinecraftItemTypes } from "@minecraft/vanilla-data";

// 玩家商店主界面
export function openPlayerShopForm(player: Player) {
  const form = new ActionFormData();
  form.title("§w玩家商店");
  form.button("§w个人物品管理", "textures/packs/diamond");
  form.button("§w所有上架中的物品", "textures/packs/010-gift-box");
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;

    switch (data.selection) {
      case 0:
        openPersonalItemManageForm(player);
        break;
      case 1:
        openAllListedItemsForm(player);
        break;
      case 2:
        openServerMenuForm(player);
        break;
    }
  });
}

// 个人物品管理界面
export function openPersonalItemManageForm(player: Player) {
  const form = new ActionFormData();
  form.title("§w个人物品管理");
  form.button("§w上架个人物品", "textures/icons/add");
  form.button("§w下架个人物品", "textures/icons/deny");
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;

    switch (data.selection) {
      case 0:
        openPersonalItemListForm(player);
        break;
      case 1:
        openPersonalItemUnlistForm(player);
        break;
      case 2:
        openPlayerShopForm(player);
        break;
    }
  });
}

// 上架个人物品界面
export function openPersonalItemListForm(player: Player) {
  const chestForm = new ChestFormData("shop");

  // 获取玩家背包和快捷栏的物品
  const inventory = player.getComponent("inventory");
  if (!inventory) {
    return openDialogForm(player, {
      title: "错误",
      desc: color.red("无法获取玩家背包信息"),
    });
  }

  // 渲染玩家背包内容到ChestUI
  const container = inventory.container;
  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    const durability = item?.getComponent(ItemComponentTypes.Durability);
    if (item) {
      chestForm.button(
        i,
        item.nameTag,
        [`§7物品类别：${item.typeId.split(":")[1] || item.typeId}`, `§7数量: ${item.amount}`],
        item.typeId,
        item.amount,
        durability?.damage,
        false
      );
    }
  }
  // 添加返回按钮
  chestForm.button(45, "返回", ["§7返回上一级"], "textures/ui/realms_red_x");

  // 显示表单
  chestForm.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    const slotIndex = data.selection;
    // 当玩家关闭表单时，返回到个人物品管理界面
    if (slotIndex === 45) {
      openPersonalItemManageForm(player);
      return;
    }
    if (slotIndex === null || slotIndex === undefined) return;
    const targetSlot = container.getItem(slotIndex);

    if (!targetSlot) {
      return openDialogForm(
        player,
        {
          title: "错误",
          desc: color.red("无法获取物品信息"),
        },
        () => openPersonalItemListForm(player)
      );
    }

    // 弹出物品信息表单
    openListItemConfirmForm(player, targetSlot, slotIndex);
  });
}

// 上架物品确认表单
function openListItemConfirmForm(player: Player, item: ItemStack, slot: number) {
  const form = new ModalFormData();
  form.title("上架物品确认");

  const itemName = item.typeId.split(":")[1] || item.typeId;
  form.textField(color.white("物品名称"), color.gray("物品显示名称"), itemName);
  form.textField(color.white("价格"), color.gray("请输入物品价格"), "1");
  form.textField(color.white("数量"), color.gray("请输入上架数量(最大" + item.amount + ")"), item.amount.toString());
  form.textField(color.white("描述"), color.gray("物品描述(可选)"), "");
  form.submitButton("确认上架");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;

    const { formValues } = data;
    if (!formValues) return;

    const displayName = formValues[0] as string;
    const price = parseInt(formValues[1] as string);
    const amount = parseInt(formValues[2] as string);
    const description = formValues[3] as string;

    // 物品名称是必选
    if (!displayName.trim()) {
      return openDialogForm(
        player,
        {
          title: "上架失败",
          desc: color.red("物品名称不能为空"),
        },
        () => openListItemConfirmForm(player, item, slot)
      );
    }

    if (isNaN(price) || price <= 0) {
      return openDialogForm(
        player,
        {
          title: "上架失败",
          desc: color.red("价格必须是大于0的数字"),
        },
        () => openListItemConfirmForm(player, item, slot)
      );
    }

    if (isNaN(amount) || amount <= 0 || amount > item.amount) {
      return openDialogForm(
        player,
        {
          title: "上架失败",
          desc: color.red(`数量必须是1到${item.amount}之间的数字`),
        },
        () => openListItemConfirmForm(player, item, slot)
      );
    }

    console.warn(`item.nameTag -> ${item.typeId}`);

    // 调用商店系统的上架方法
    shop.listItem(
      player,
      {
        item,
        slot,
        displayName,
        price,
        amount,
        description,
        seller: player.name,
        listTime: new Date().toISOString(),
      },
      () => openPersonalItemManageForm(player)
    );
  });
}

// 下架个人物品界面 - 使用ChestUI
export function openPersonalItemUnlistForm(player: Player, page: number = 1) {
  // 获取该玩家上架的所有物品
  const listedItems = shop.getPlayerListedItems(player.name);

  // 计算分页信息
  const itemsPerPage = 45; // 箱子UI每页最多显示45个物品
  const totalPages = Math.ceil(listedItems.length / itemsPerPage);
  const startIndex = (page - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, listedItems.length);
  const currentPageItems = listedItems.slice(startIndex, endIndex);

  const chestForm = new ChestFormData("shop");
  chestForm.title(`个人物品管理 - 下架物品 (第${page}/${totalPages || 1}页)`);

  // 添加商品到ChestUI
  for (let i = 0; i < currentPageItems.length; i++) {
    const item = currentPageItems[i];
    chestForm.button(
      i,
      item.displayName,
      [
        `§7价格: §e${item.price} 金币`,
        `§7数量: §a${item.amount}`,
        `§7上架时间: §f${item.listTime}`,
        item.description ? `§7描述: §f${item.description}` : "",
        "§7点击下架",
      ],
      item.item.typeId,
      item.amount
    );
  }

  // 添加导航按钮
  if (page > 1) {
    chestForm.button(45, "上一页", ["查看上一页物品"], "textures/icons/left_arrow", 1);
  }

  chestForm.button(49, "返回", ["返回个人物品管理"], "textures/icons/back", 1);

  if (page < totalPages) {
    chestForm.button(53, "下一页", ["查看下一页物品"], "textures/icons/right_arrow", 1);
  }

  // 显示ChestUI并处理下架逻辑
  chestForm.show(player).then((response) => {
    if (response.canceled) {
      openPersonalItemManageForm(player);
      return;
    }

    const selection = response.selection;

    // 处理导航按钮
    if (selection === 45 && page > 1) {
      // 上一页
      return openPersonalItemUnlistForm(player, page - 1);
    } else if (selection === 49) {
      // 返回
      return openPersonalItemManageForm(player);
    } else if (selection === 53 && page < totalPages) {
      // 下一页
      return openPersonalItemUnlistForm(player, page + 1);
    }

    // 处理物品下架
    if (selection !== undefined && selection < currentPageItems.length) {
      const selectedItem = currentPageItems[selection];
      openUnlistItemConfirmForm(player, selectedItem, () => openPersonalItemUnlistForm(player, page));
    }
  });
}

// 下架物品确认表单
function openUnlistItemConfirmForm(player: Player, item: IShopItem, returnCallback: () => void) {
  const form = new ActionFormData();
  form.title("下架物品确认");
  form.body(
    `您确定要下架以下物品吗？\n\n` +
      `${color.yellow("物品名称:")} ${color.green(item.displayName)}\n` +
      `${color.yellow("价格:")} ${color.green(item.price + "")}\n` +
      `${color.yellow("数量:")} ${color.green(item.amount + "")}\n` +
      `${color.yellow("描述:")} ${color.green(item.description || "无")}\n\n`
  );
  form.button("§w确认下架", "textures/icons/accept");
  form.button("§w取消", "textures/icons/deny");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;

    switch (data.selection) {
      case 0:
        // 调用商店系统的下架方法
        const rason = shop.unlistItem(player, item.id, returnCallback);
        if (typeof rason === "string") {
          openDialogForm(player, {
            title: "下架失败",
            desc: color.red(rason),
          });
        }
        break;
      case 1:
        // 取消下架，返回上一级
        returnCallback();
        break;
    }
  });
}

// 所有上架中的物品界面 - 使用ChestUI
export function openAllListedItemsForm(player: Player, page: number = 1) {
  // 获取所有上架的物品
  const listedItems = shop.getAllListedItems();

  // 计算分页信息
  const itemsPerPage = 45; // 箱子UI每页最多显示45个物品
  const totalPages = Math.ceil(listedItems.length / itemsPerPage);
  const startIndex = (page - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, listedItems.length);
  const currentPageItems = listedItems.slice(startIndex, endIndex);

  const chestForm = new ChestFormData("shop");
  chestForm.title(`玩家商店 - 所有上架物品 (第${page}/${totalPages || 1}页)`);

  // 添加商品到ChestUI
  for (let i = 0; i < currentPageItems.length; i++) {
    const item = currentPageItems[i];
    chestForm.button(
      i,
      item.displayName,
      [
        `§7卖家: ${item.seller}`,
        `§7价格: §e${item.price} 金币`,
        `§7数量: §a${item.amount}`,
        `§7上架时间: §f${item.listTime}`,
        item.description ? `§7描述: §f${item.description}` : "",
        "§7点击购买",
      ],
      item.item.typeId,
      item.amount
    );
  }

  // 添加导航按钮
  if (page > 1) {
    chestForm.button(45, "上一页", ["查看上一页商品"], "textures/icons/left_arrow", 1);
  }

  chestForm.button(49, "返回", ["返回玩家商店"], "textures/icons/back", 1);

  if (page < totalPages) {
    chestForm.button(53, "下一页", ["查看下一页商品"], "textures/icons/right_arrow", 1);
  }

  // 显示ChestUI并处理购买逻辑
  chestForm.show(player).then((response) => {
    if (response.canceled) {
      openPlayerShopForm(player);
      return;
    }

    const selection = response.selection;

    // 处理导航按钮
    if (selection === 45 && page > 1) {
      // 上一页
      return openAllListedItemsForm(player, page - 1);
    } else if (selection === 49) {
      // 返回
      return openPlayerShopForm(player);
    } else if (selection === 53 && page < totalPages) {
      // 下一页
      return openAllListedItemsForm(player, page + 1);
    }

    // 处理商品购买
    if (selection !== undefined && selection < currentPageItems.length) {
      const selectedItem = currentPageItems[selection];
      openBuyItemConfirmForm(player, selectedItem, () => openAllListedItemsForm(player, page));
    }
  });
}

// 购买物品确认表单
function openBuyItemConfirmForm(player: Player, item: IShopItem, returnCallback: () => void) {
  const form = new ActionFormData();
  form.title("购买物品确认");
  form.body(
    `您确定要购买以下物品吗？\n\n` +
      `${color.yellow("物品名称:")} ${color.green(item.displayName)}\n` +
      `${color.yellow("价格:")} ${color.green(item.price + "")}\n` +
      `${color.yellow("数量:")} ${color.green(item.amount + "")}\n` +
      `${color.yellow("卖家:")} ${color.green(item.seller)}\n` +
      `${color.yellow("上架时间:")} ${color.green(item.listTime)}\n` +
      `${color.yellow("描述:")} ${color.green(item.description || "无")}\n\n`
  );
  form.button("§w确认购买", "textures/icons/accept");
  form.button("§w取消", "textures/icons/deny");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;

    switch (data.selection) {
      case 0:
        // 调用商店系统的购买方法
        const rason = shop.buyItem(player, item.id, returnCallback);
        if (typeof rason === "string") {
          openDialogForm(player, {
            title: "购买失败",
            desc: color.red(rason),
          });
        }
        break;
      case 1:
        // 取消购买，返回上一级
        returnCallback();
        break;
    }
  });
}
