import { Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { color } from "../../utils/color";
import { openDialogForm, openConfirmDialogForm } from "../Forms/Dialog";
import productCategory, { IProduct } from "./ProcuctCategory";
import { openEconomyMenuForm } from "./Forms";
import ChestFormData from "../ChestUI/ChestForms";
import enconomic from "./Economic";
import { emojiKeyToEmojiPath } from "../../utils/utils";

// 打开商品类别列表表单
export function openCategoryListForm(player: Player, page: number = 1) {
  const form = new ActionFormData();
  form.title("§w商品类别列表");

  const categories = productCategory.getCategories();
  const pageSize = 10;
  const totalPages = Math.ceil(categories.length / pageSize);
  const start = (page - 1) * pageSize;
  const end = Math.min(start + pageSize, categories.length);
  const currentPageCategories = categories.slice(start, end);

  form.body(`第 ${page} 页 / 共 ${totalPages || 1} 页`);

  if (categories.length === 0) {
    form.body(`${color.red("暂无商品类别，请先添加！")}`);
  }

  currentPageCategories.forEach((category) => {
    form.button(
      `§w${category.name}\n§7${category.description || "无描述"}`,
      emojiKeyToEmojiPath(category.icon as string) || emojiKeyToEmojiPath(productCategory.defaultIcon)
    );
  });

  let previousButtonIndex = currentPageCategories.length;
  let nextButtonIndex = currentPageCategories.length;

  if (page > 1) {
    form.button("§w上一页", "textures/icons/left_arrow");
    previousButtonIndex++;
    nextButtonIndex++;
  }

  if (page < totalPages) {
    form.button("§w下一页", "textures/icons/right_arrow");
    nextButtonIndex++;
  }

  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;

    const selectionIndex = data.selection;
    if (selectionIndex === undefined) return;

    if (selectionIndex < currentPageCategories.length) {
      // 选择了某个类别
      openChestShopByCategoryForm(player, currentPageCategories[selectionIndex].name);
    } else if (selectionIndex === previousButtonIndex - 1 && page > 1) {
      // 上一页
      openCategoryListForm(player, page - 1);
    } else if (selectionIndex === nextButtonIndex - 1 && page < totalPages) {
      // 下一页
      openCategoryListForm(player, page + 1);
    } else {
      // 返回
      openEconomyMenuForm(player);
    }
  });
}

// 打开对应商品类别的所有物品的ChestUI表单
function openChestShopByCategoryForm(player: Player, categoryName: string, page: number = 1) {
  const category = productCategory.getCategory(categoryName);
  if (!category) {
    return openDialogForm(
      player,
      {
        title: "打开失败",
        desc: color.red(`§c商品类别 ${categoryName} 不存在！`),
      },
      () => openCategoryListForm(player)
    );
  }

  // 获取该类别下的所有商品
  const products = productCategory.getProductsByCategory(categoryName);

  if (!products || products.length === 0) {
    return openDialogForm(
      player,
      {
        title: "打开失败",
        desc: color.red(
          `§c类别 ${color.yellow(categoryName)} ${color.red("下不存在任何商品！请联系管理员添加商品。")}`
        ),
      },
      () => openCategoryListForm(player)
    );
  }

  // 计算分页
  const itemsPerPage = 45; // 箱子UI每页最多显示45个物品
  const totalPages = Math.ceil(products.length / itemsPerPage);
  const startIndex = (page - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, products.length);
  const currentPageProducts = products.slice(startIndex, endIndex);

  const chestForm = new ChestFormData("shop");
  chestForm.title(`${category.name} - 商品列表 (第${page}/${totalPages}页)`);

  // 添加商品到ChestUI
  for (let i = 0; i < currentPageProducts.length; i++) {
    const product = currentPageProducts[i];
    chestForm.button(i, product.name, [`价格: ${product.price} 金币/个`, "点击购买"], product.itemId, 1);
  }

  // 添加导航按钮
  if (page > 1) {
    chestForm.button(45, "上一页", ["查看上一页商品"], "textures/icons/left_arrow", 1);
  }

  chestForm.button(49, "返回", ["返回类别列表"], "textures/icons/back", 1);

  if (page < totalPages) {
    chestForm.button(53, "下一页", ["查看下一页商品"], "textures/icons/right_arrow", 1);
  }

  // 显示ChestUI并处理购买逻辑
  chestForm.show(player).then((response) => {
    if (response.canceled) {
      openCategoryListForm(player);
      return;
    }

    const selection = response.selection;

    // 处理导航按钮
    if (selection === 45 && page > 1) {
      // 上一页
      return openChestShopByCategoryForm(player, categoryName, page - 1);
    } else if (selection === 49) {
      // 返回
      return openCategoryListForm(player);
    } else if (selection === 53 && page < totalPages) {
      // 下一页
      return openChestShopByCategoryForm(player, categoryName, page + 1);
    }

    // 处理商品购买
    if (selection !== undefined && selection < currentPageProducts.length) {
      const selectedProduct = currentPageProducts[selection];
      openBuyQuantityForm(player, selectedProduct, categoryName, page);
    }
  });
}

// 打开购买数量选择表单
function openBuyQuantityForm(player: Player, product: IProduct, categoryName: string, page: number) {
  const form = new ModalFormData();
  form.title(`购买 ${product.name}`);
  form.slider("购买数量", 1, product.stock, {
    defaultValue: 1,
    tooltip: "购买数量",
    valueStep: 1,
  });
  form.submitButton("确认");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return openChestShopByCategoryForm(player, categoryName, page);

    const { formValues } = data;
    if (formValues) {
      const quantity = formValues[0] as number;
      const totalPrice = product.price * quantity;

      // 显示确认购买表单
      openConfirmPurchaseForm(player, product, quantity, totalPrice, categoryName, page);
    }
  });
}

// 打开确认购买表单
function openConfirmPurchaseForm(
  player: Player,
  product: any,
  quantity: number,
  totalPrice: number,
  categoryName: string,
  page: number
) {
  const form = new ActionFormData();
  form.title("确认购买");
  form.body(`您确定要购买 ${quantity} 个 ${product.name} 吗？\n\n总价: ${totalPrice} 金币`);
  form.button("确认购买", "textures/ui/confirm");
  form.button("取消", "textures/ui/cancel");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return openChestShopByCategoryForm(player, categoryName, page);

    if (data.selection === 0) {
      // 确认购买
      processPurchase(player, product, quantity, totalPrice, categoryName, page);
    } else {
      // 取消购买
      openChestShopByCategoryForm(player, categoryName, page);
    }
  });
}

// 处理购买逻辑
function processPurchase(
  player: Player,
  product: any,
  quantity: number,
  totalPrice: number,
  categoryName: string,
  page: number
) {
  // 检查玩家余额
  const wallet = enconomic.getWallet(player.name);
  if (wallet.gold < totalPrice) {
    openDialogForm(
      player,
      {
        title: "购买失败",
        desc: color.red(`余额不足！需要 ${totalPrice} 金币，但你只有 ${wallet.gold} 金币。`),
      },
      () => openChestShopByCategoryForm(player, categoryName, page)
    );
    return;
  }

  // 检查商品库存
  if (product.stock !== undefined && product.stock < quantity) {
    openDialogForm(
      player,
      {
        title: "购买失败",
        desc: color.red(`库存不足！当前库存: ${product.stock}，您想购买: ${quantity}`),
      },
      () => openChestShopByCategoryForm(player, categoryName, page)
    );
    return;
  }

  // 扣除金币
  const result = enconomic.transfer(player.name, "server", totalPrice, `购买商品: ${product.name} x${quantity}`);

  if (result) {
    // 给予物品
    try {
      player.runCommand(`give @s ${product.itemId} ${quantity}`);

      // 更新库存
      if (product.stock !== undefined) {
        product.stock -= quantity;
        productCategory.updateProduct(categoryName, product.name, product);
      }

      openDialogForm(
        player,
        {
          title: "购买成功",
          desc: color.green(`成功购买 ${product.name} x${quantity}，花费 ${totalPrice} 金币`),
        },
        () => openChestShopByCategoryForm(player, categoryName, page)
      );
    } catch (error) {
      // 如果给予物品失败，退还金币
      enconomic.transfer("server", player.name, totalPrice, `购买商品: ${product.name} 退款`);

      openDialogForm(
        player,
        {
          title: "购买失败",
          desc: color.red("物品发放失败，已退款"),
        },
        () => openChestShopByCategoryForm(player, categoryName, page)
      );
    }
  } else {
    openDialogForm(
      player,
      {
        title: "购买失败",
        desc: color.red("交易处理失败"),
      },
      () => openChestShopByCategoryForm(player, categoryName, page)
    );
  }
}
