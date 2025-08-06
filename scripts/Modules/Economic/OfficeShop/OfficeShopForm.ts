import { ItemStack, Player, RawMessage } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import officeShop from "./OfficeShop";
import ChestFormData from "../../ChestUI/ChestForms";
import { openDialogForm } from "../../Forms/Dialog";
import economic from "../Economic";
import { color } from "@mcbe-mods/utils";
import { emojiKeyToEmojiPath, getItemDisplayName, getItemDurability, hasAnyEnchantment } from "../../../utils/utils";
import { OfficeShopItemData, OfficeShopItemMetaData } from "./types";
import { openEconomyMenuForm } from "../Forms";
import { glyphMap } from "../../../glyphMap";
import { colorCodes } from "../../../utils/color";

class OfficeShopForm {
  private static instance: OfficeShopForm;

  private constructor() {}

  public static getInstance(): OfficeShopForm {
    if (!OfficeShopForm.instance) {
      OfficeShopForm.instance = new OfficeShopForm();
    }
    return OfficeShopForm.instance;
  }

  // 打开分类列表
  openCategoryList(player: Player, page: number = 1): void {
    const categories = officeShop.getCategories();

    if (categories.length === 0) {
      openDialogForm(
        player,
        {
          title: "商店为空",
          desc: "当前没有任何商品类别，请联系管理员添加！",
        },
        () => openEconomyMenuForm(player)
      );
      return;
    }

    // 计算分页信息
    const itemsPerPage = 8; // ActionForm每页显示8个类别
    const totalPages = Math.ceil(categories.length / itemsPerPage);
    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, categories.length);
    const currentPageCategories = categories.slice(startIndex, endIndex);

    const form = new ActionFormData().title(`官方商店 - 商品类别 (第${page}/${totalPages}页)`);

    // 添加类别说明
    form.body("请选择您要浏览的商品类别");

    // 填充类别
    currentPageCategories.forEach((category) => {
      const buttonText = `${category.name}\n§e${category.description || "无描述"}`;
      form.button(buttonText, category.icon || officeShop.defaultIcon);
    });

    // 添加导航按钮
    if (page > 1) {
      form.button("上一页", "textures/icons/left_arrow");
    }

    form.button("返回主菜单", "textures/icons/back");

    if (page < totalPages) {
      form.button("下一页", "textures/icons/right_arrow");
    }

    form.show(player).then((response) => {
      if (response.canceled) return;

      const selection = response.selection;
      if (selection === undefined) return;

      // 计算导航按钮的索引位置
      const categoryCount = currentPageCategories.length;
      const prevPageIndex = categoryCount;
      const backIndex = page > 1 ? prevPageIndex + 1 : prevPageIndex;
      const nextPageIndex = page > 1 ? backIndex + 1 : backIndex + 1;

      // 处理导航按钮
      if (page > 1 && selection === prevPageIndex) {
        // 上一页
        return this.openCategoryList(player, page - 1);
      } else if (selection === backIndex) {
        // 返回
        return openEconomyMenuForm(player);
      } else if (page < totalPages && selection === nextPageIndex) {
        // 下一页
        return this.openCategoryList(player, page + 1);
      }

      // 处理类别选择
      if (selection < categoryCount) {
        const selectedCategory = currentPageCategories[selection];
        if (selectedCategory) {
          this.openCategoryProducts(player, selectedCategory.name);
        }
      }
    });
  }

  // 打开指定类别商品列表
  openCategoryProducts(player: Player, categoryName: string, page: number = 1): void {
    const itemDatas = officeShop.getCategoryItems(categoryName);
    const category = officeShop.getCategory(categoryName);

    if (!category) {
      openDialogForm(
        player,
        {
          title: "错误",
          desc: "商品类别不存在",
        },
        () => this.openCategoryList(player)
      );
      return;
    }

    if (itemDatas.length === 0) {
      openDialogForm(
        player,
        {
          title: `${category.name}`,
          desc: "该类别下暂无商品",
        },
        () => this.openCategoryList(player)
      );
      return;
    }

    // 计算分页信息
    const itemsPerPage = 45; // 箱子UI每页最多显示45个物品
    const totalPages = Math.ceil(itemDatas.length / itemsPerPage);
    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, itemDatas.length);
    const currentPageProducts = itemDatas.slice(startIndex, endIndex);

    const form = new ChestFormData("shop").title(`${category.name} - 商品列表 (第${page}/${totalPages}页)`);

    // 填充商品
    currentPageProducts.forEach((itemData, index) => {
      const displayName = getItemDisplayName(itemData.item);
      const lores = itemData.item.getLore();
      const itemIconPath = itemData.item.typeId;
      const amount = itemData.item.amount;
      const durability = getItemDurability(itemData.item);
      const isEnchanted = hasAnyEnchantment(itemData.item);

      form.button(index, displayName, lores, itemIconPath, amount, durability, isEnchanted);
    });

    // 添加导航按钮
    if (page > 1) {
      form.button(45, "上一页", ["查看上一页商品"], "textures/icons/left_arrow", 1);
    }
    form.button(49, "返回", ["返回类别列表"], "textures/icons/back", 1);
    if (page < totalPages) {
      form.button(53, "下一页", ["查看下一页商品"], "textures/icons/right_arrow", 1);
    }

    form.show(player).then((response) => {
      if (response.canceled) return;

      const selection = response.selection;
      if (selection === undefined) return;

      // 处理导航按钮
      if (selection === 45 && page > 1) {
        // 上一页
        return this.openCategoryProducts(player, categoryName, page - 1);
      } else if (selection === 49) {
        // 返回
        return this.openCategoryList(player);
      } else if (selection === 53 && page < totalPages) {
        // 下一页
        return this.openCategoryProducts(player, categoryName, page + 1);
      }

      // 处理商品选择
      if (selection < currentPageProducts.length) {
        const selectedProduct = currentPageProducts[selection];
        if (selectedProduct) {
          this.showProductDetails(player, selectedProduct);
        }
      }
    });
  }

  /** 1. 先让玩家选数量 */
  private askBuyQuantity(player: Player, item: OfficeShopItemData): void {
    const maxAmount = item.data.amount;
    const title: RawMessage = {
      rawtext: [
        {
          text: `购买 - `,
        },
        getItemDisplayName(item.item),
      ],
    };
    const modal = new ModalFormData().title(title).textField(`请输入购买数量`, "1", {
      defaultValue: "1",
    });
    modal
      .show(player)
      .then((res) => {
        if (!res.formValues) return;

        // 修复：正确处理textField返回的字符串值
        const qtyStr = res.formValues[0] as string;
        if (!qtyStr || qtyStr.trim() === "") {
          openDialogForm(player, { title: "错误", desc: "请输入有效的购买数量" }, () =>
            this.askBuyQuantity(player, item)
          );
          return;
        }

        const qty = parseInt(qtyStr);
        if (isNaN(qty) || qty <= 0) {
          openDialogForm(player, { title: "错误", desc: "请输入有效的购买数量" }, () =>
            this.askBuyQuantity(player, item)
          );
          return;
        }

        this.executePurchase(player, item, qty);
      })
      .catch(console.error);
  }

  /** 2. 真正的购买逻辑 */
  private executePurchase(player: Player, item: OfficeShopItemData, qty: number): void {
    // 库存 & 余额检查
    if (qty > item.data.amount) {
      openDialogForm(player, { title: "失败", desc: "库存不足" }, () => this.showProductDetails(player, item));
      return;
    }
    const totalPrice = item.data.price * qty;
    const wallet = economic.getWallet(player.name);
    if (wallet.gold < totalPrice) {
      openDialogForm(player, { title: "失败", desc: "余额不足" }, () => this.showProductDetails(player, item));
      return;
    }

    // 扣款
    const result = economic.removeGold(player.name, totalPrice, `购买了 ${item.item.typeId.split(":")[1]} x${qty}`);
    if (typeof result === "string") {
      openDialogForm(player, { title: "失败", desc: result }, () => this.showProductDetails(player, item));
      return;
    }

    // 发物
    try {
      const inv = player.getComponent("inventory")?.container;
      if (inv?.emptySlotsCount === 0) {
        openDialogForm(player, { title: "失败", desc: "背包已满" }, () => this.showProductDetails(player, item));
        return;
      }
      const oneItem = item.item.clone();
      oneItem.amount = 1;

      for (let i = 0; i < qty; i++) inv?.addItem(oneItem);
    } catch (e) {
      console.error("发物失败", e);
    }

    // 更新库存
    officeShop.updateItemMeta(item.data, { ...item.data, amount: item.data.amount - qty });

    // 如果库存为空，则删除该商品。
    console.warn(`当前库存：${item.data.amount}`);
    if (item.data.amount === 0) {
      officeShop.deleteItem(item.data);
    }

    // 成功提示
    const displayName = getItemDisplayName(item.item);
    const desc: RawMessage = {
      rawtext: [
        {
          text: `${colorCodes.yellow}已购买 ${colorCodes.green}`,
        },
        displayName,
        {
          text: `${colorCodes.yellow} x${qty}`,
        },
      ],
    };
    openDialogForm(player, { title: "购买成功", desc }, () => this.openCategoryProducts(player, item.data.category));
  }

  // 展示商品详细购买页
  showProductDetails(player: Player, item: OfficeShopItemData): void {
    const displayName = getItemDisplayName(item.item);
    const lores = item.item.getLore();
    const durability = getItemDurability(item.item);
    const isEnchanted = hasAnyEnchantment(item.item);
    const wallet = economic.getWallet(player.name);

    const title: RawMessage = {
      rawtext: [
        {
          text: `商品详细 - `,
        },
        displayName,
      ],
    };

    const body: RawMessage = {
      rawtext: [
        {
          text: `${colorCodes.yellow}商品： ${colorCodes.white}`,
        },
        displayName,
        {
          text: `\n`,
        },
        {
          text: `${colorCodes.yellow}描述： ${colorCodes.white}${lores.join(", ")}\n`,
        },
        {
          text: `${colorCodes.yellow}单价： ${colorCodes.white}${item.data.price}\n`,
        },
        {
          text: `${colorCodes.yellow}库存： ${colorCodes.white}${item.data.amount}\n`,
        },
        {
          text: `${colorCodes.yellow}耐久： ${colorCodes.white}${durability}\n`,
        },
        {
          text: `${colorCodes.yellow}附魔： ${colorCodes.white}${isEnchanted ? "有" : "无"}\n\n`,
        },
        {
          text: `${colorCodes.yellow}余额： ${colorCodes.white}${wallet.gold}\n`,
        },
      ],
    };

    const form = new ActionFormData()
      .title(title)
      .body(body)
      .button("购买", "textures/packs/15174544")
      .button("返回", "textures/icons/back");

    form
      .show(player)
      .then((res) => {
        if (res.canceled) {
          return;
        } else if (res.selection === 1) {
          this.openCategoryProducts(player, item.data.category);
        } else {
          this.askBuyQuantity(player, item);
        }
      })
      .catch(console.error);
  }
}

export const officeShopForm = OfficeShopForm.getInstance();
