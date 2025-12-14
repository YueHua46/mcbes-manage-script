/**
 * 官方商店设置表单
 * 迁移自 Modules/Economic/OfficeShop/OfficeShopSettingForm.ts
 * 注意：这是管理员用于管理商店的表单
 */

import { ItemStack, Player, RawMessage } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import officeShop, { OfficeShopItemData } from "../../../features/economic/services/office-shop";
import { openDialogForm } from "../../components/dialog";
import { glyphKeys } from "../../../assets/glyph-map";
import ChestFormData from "../../components/chest-ui/chest-forms";
import { getItemDisplayName, getItemDurability, hasAnyEnchantment } from "../../../shared/utils/item-utils";

/**
 * 通过 emoji key 获得 emojiPath
 */
function emojiKeyToEmojiPath(emojiKey: string): string {
  return `textures/icons/${emojiKey}`;
}

// 简化实现的商店设置表单
class OfficeShopSettingForm {
  /**
   * 打开官方商店管理主菜单
   */
  openMainMenu(player: Player): void {
    const { openEconomyManageForm } = require("./index");

    const form = new ActionFormData()
      .title("§w官方商店管理")
      .body("请选择要执行的操作")
      .button("§w所有商品类别", "textures/icons/gadgets")
      .button("§w创建新类别", "textures/icons/add")
      .button("§w返回", "textures/icons/back");

    form.show(player).then((response) => {
      if (response.canceled) return;

      const selection = response.selection;
      if (selection === undefined) return;

      switch (selection) {
        case 0:
          // 所有商品类别
          this.openCategoryList(player);
          break;
        case 1:
          // 创建新类别
          this.openAddCategoryForm(player);
          break;
        case 2:
          // 返回
          openEconomyManageForm(player);
          break;
      }
    });
  }

  /**
   * 打开分类列表管理
   */
  openCategoryList(player: Player): void {
    const categories = officeShop.getCategories();

    const form = new ActionFormData().title("§w所有商品类别").body("请选择要管理的类别");

    categories.forEach((category) => {
      form.button(`§w${category.name}`, category.icon || officeShop.defaultIcon);
    });

    form.button("§w返回", "textures/icons/back");

    form.show(player).then((response) => {
      if (response.canceled) return;

      const selection = response.selection;
      if (selection === undefined) return;

      if (selection === categories.length) {
        // 返回
        this.openMainMenu(player);
      } else if (selection >= 0 && selection < categories.length) {
        // 选择了某个类别
        const selectedCategory = categories[selection];
        this.manageCategoryItems(player, selectedCategory.name);
      }
    });
  }

  /**
   * 添加商品类别
   */
  private openAddCategoryForm(player: Player): void {
    const categoryIconKeys = officeShop.getCategoryIcons()[0];
    const categoryIcons = officeShop.getCategoryIcons()[1];

    const modal = new ModalFormData()
      .title("§w添加商品类别")
      .textField("类别名称", "请输入商品类别名称")
      .textField("类别描述", "请输入商品类别描述")
      .dropdown("类别图标", categoryIcons, { defaultValueIndex: 0 });

    modal.show(player).then((res) => {
      if (res.canceled || !res.formValues) return;

      const [name, description, iconIndex] = res.formValues;

      if (typeof name !== "string" || typeof description !== "string" || typeof iconIndex !== "number") {
        openDialogForm(player, { title: "§c失败", desc: "请输入完整且正确的信息" }, () =>
          this.openAddCategoryForm(player)
        );
        return;
      }

      if (name.length === 0 || description.length === 0) {
        openDialogForm(player, { title: "§c失败", desc: "类别名称和描述不能为空" }, () =>
          this.openAddCategoryForm(player)
        );
        return;
      }

      if (officeShop.getCategory(name)) {
        openDialogForm(player, { title: "§c失败", desc: "商品类别已存在" }, () => this.openAddCategoryForm(player));
        return;
      }

      officeShop.createCategory({
        name,
        description,
        icon: emojiKeyToEmojiPath(categoryIconKeys[iconIndex]),
        player,
      });

      openDialogForm(player, { title: "§a成功", desc: "商品类别添加成功" }, () => this.openMainMenu(player));
    });
  }

  /**
   * 管理类别中的商品
   */
  private manageCategoryItems(player: Player, categoryName: string): void {
    const category = officeShop.getCategory(categoryName);

    if (!category) {
      openDialogForm(
        player,
        {
          title: "§c错误",
          desc: "商品类别不存在",
        },
        () => this.openMainMenu(player)
      );
      return;
    }

    const form = new ActionFormData()
      .title(`§w商品管理`)
      .button("§w查看和编辑商品", "textures/icons/edit2")
      .button("§w添加商品", "textures/icons/add")
      .button("§w删除类别", "textures/icons/deny")
      .button("§w返回", "textures/icons/back");

    form.show(player).then((res) => {
      if (res.canceled) return;

      switch (res.selection) {
        case 0:
          // 查看和编辑商品
          this.openCategoryItemListForm(player, categoryName);
          break;
        case 1:
          // 添加商品
          this.openAddCategoryItemForm(player, categoryName);
          break;
        case 2:
          // 删除类别
          this.openDeleteCategoryConfirm(player, categoryName);
          break;
        case 3:
          // 返回
          this.openCategoryList(player);
          break;
      }
    });
  }

  /**
   * 删除类别确认
   */
  private openDeleteCategoryConfirm(player: Player, categoryName: string): void {
    const form = new ActionFormData()
      .title("§c确认删除")
      .body(`§c您确定要删除类别 §e${categoryName}§c 吗？\n此操作不可撤销，该类别下的所有商品也将被删除。`)
      .button("§c确认删除", "textures/icons/deny")
      .button("§w取消", "textures/icons/back");

    form.show(player).then((res) => {
      if (res.canceled || res.selection === 1) {
        this.manageCategoryItems(player, categoryName);
        return;
      }

      officeShop.deleteCategory(categoryName);
      openDialogForm(player, { title: "§a成功", desc: `类别 ${categoryName} 已删除` }, () =>
        this.openCategoryList(player)
      );
    });
  }

  /**
   * 查看商品列表
   */
  private openCategoryItemListForm(player: Player, categoryName: string, page: number = 1): void {
    const category = officeShop.getCategory(categoryName);

    if (!category) {
      openDialogForm(
        player,
        {
          title: "§c错误",
          desc: "商品类别不存在",
        },
        () => this.openMainMenu(player)
      );
      return;
    }

    const items = officeShop.getCategoryItems(categoryName);

    if (items.length === 0) {
      openDialogForm(
        player,
        {
          title: "§w商店为空",
          desc: "当前没有任何商品",
        },
        () => this.manageCategoryItems(player, categoryName)
      );
      return;
    }

    // 计算分页信息
    const itemsPerPage = 45; // 箱子UI每页最多显示45个物品
    const totalPages = Math.ceil(items.length / itemsPerPage);
    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, items.length);
    const currentPageItems = items.slice(startIndex, endIndex);

    const form = new ChestFormData("shop").title(`商品列表管理 (第${page}/${totalPages}页)`);

    // 填充商品
    currentPageItems.forEach((itemData, index) => {
      const displayName = getItemDisplayName(itemData.item);
      const lores = [`§e单价: §f${itemData.data.price}`, `§e库存: §f${itemData.data.amount}`, `§e点击编辑或删除`];
      const itemIconPath = itemData.item.typeId;
      const amount = itemData.data.amount; // 使用商品库存数量，而不是物品本身的数量
      const durability = getItemDurability(itemData.item);
      const isEnchanted = hasAnyEnchantment(itemData.item);

      form.button(index, displayName, lores, itemIconPath, amount, durability, isEnchanted);
    });

    // 添加导航按钮
    if (page > 1) {
      form.button(45, "上一页", ["查看上一页商品"], "textures/icons/left_arrow", 1);
    }
    form.button(49, "返回", ["返回商品管理"], "textures/icons/back", 1);
    if (page < totalPages) {
      form.button(53, "下一页", ["查看下一页商品"], "textures/icons/right_arrow", 1);
    }

    form.show(player).then((response) => {
      if (response.canceled) return;

      const selection = response.selection;
      if (selection === undefined) return;

      // 处理导航按钮
      if (selection === 45 && page > 1) {
        return this.openCategoryItemListForm(player, categoryName, page - 1);
      } else if (selection === 49) {
        return this.manageCategoryItems(player, categoryName);
      } else if (selection === 53 && page < totalPages) {
        return this.openCategoryItemListForm(player, categoryName, page + 1);
      }

      // 处理商品选择
      if (selection < currentPageItems.length) {
        const selectedItem = currentPageItems[selection];
        if (selectedItem) {
          this.openItemManageForm(player, categoryName, selectedItem);
        }
      }
    });
  }

  /**
   * 商品管理表单
   */
  private openItemManageForm(player: Player, categoryName: string, item: OfficeShopItemData): void {
    const displayName = getItemDisplayName(item.item);
    const title: RawMessage = {
      rawtext: [
        {
          text: "商品管理 - ",
        },
        displayName as any,
      ],
    };
    const body: RawMessage = {
      rawtext: [
        {
          text: `商品: `,
        },
        displayName as any,
        {
          text: `\n`,
        },
        {
          text: `单价: ${item.data.price}\n`,
        },
        {
          text: `库存: ${item.data.amount}\n`,
        },
        {
          text: `请选择要执行的操作`,
        },
      ],
    };
    const form = new ActionFormData()
      .title(title)
      .body(body)
      .button("编辑商品", "textures/icons/edit2")
      .button("删除商品", "textures/icons/deny")
      .button("返回", "textures/icons/back");

    form.show(player).then((res) => {
      if (res.canceled) {
        this.openCategoryItemListForm(player, categoryName);
        return;
      }

      if (res.selection === 0) {
        this.openEditItemForm(player, categoryName, item);
      } else if (res.selection === 1) {
        this.openDeleteItemConfirmForm(player, categoryName, item);
      } else {
        this.openCategoryItemListForm(player, categoryName);
      }
    });
  }

  /**
   * 编辑商品表单
   */
  private openEditItemForm(player: Player, categoryName: string, item: OfficeShopItemData): void {
    const displayName = getItemDisplayName(item.item);
    const title: RawMessage = {
      rawtext: [
        {
          text: "编辑商品 - ",
        },
        displayName as any,
      ],
    };

    const form = new ModalFormData()
      .title(title)
      .textField("库存数量", "请输入新的库存数量", { defaultValue: item.data.amount.toString() })
      .textField("单价", "请输入商品单价", { defaultValue: item.data.price.toString() });

    form.show(player).then((res) => {
      if (res.canceled) return;
      if (!res.formValues) {
        this.openItemManageForm(player, categoryName, item);
        return;
      }

      const [newAmountStr, newPriceStr] = res.formValues;
      const newPrice = parseInt(newPriceStr as string);
      const newAmount = parseInt(newAmountStr as string);

      if (isNaN(newPrice) || newPrice <= 0) {
        openDialogForm(
          player,
          {
            title: "§c错误",
            desc: "请输入有效的单价",
          },
          () => this.openEditItemForm(player, categoryName, item)
        );
        return;
      }

      if (isNaN(newAmount) || newAmount <= 0) {
        openDialogForm(
          player,
          {
            title: "§c错误",
            desc: "请输入有效的库存数量",
          },
          () => this.openEditItemForm(player, categoryName, item)
        );
        return;
      }

      // 更新商品信息
      officeShop.updateItemMeta(item.data, {
        ...item.data,
        amount: newAmount,
        price: newPrice,
      });

      openDialogForm(
        player,
        {
          title: "§a成功",
          desc: "商品信息已更新",
        },
        () => this.openCategoryItemListForm(player, categoryName)
      );
    });
  }

  /**
   * 删除商品确认表单
   */
  private openDeleteItemConfirmForm(player: Player, categoryName: string, item: OfficeShopItemData): void {
    const displayName = getItemDisplayName(item.item);

    const body: RawMessage = {
      rawtext: [
        {
          text: `§c您确定要删除商品 §e`,
        },
        displayName as any,
        {
          text: `§c 吗？此操作不可撤销。`,
        },
      ],
    };

    const form = new ActionFormData()
      .title(`§c确认删除`)
      .body(body)
      .button("§c确认删除", "textures/icons/deny")
      .button("§w取消", "textures/icons/back");

    form.show(player).then((res) => {
      if (res.canceled) return;
      if (res.selection === 1) {
        this.openItemManageForm(player, categoryName, item);
        return;
      }

      // 删除商品
      officeShop.deleteItem(item.data);

      openDialogForm(
        player,
        {
          title: "§a成功",
          desc: "商品已删除",
        },
        () => this.openCategoryItemListForm(player, categoryName)
      );
    });
  }

  /**
   * 添加商品到分类
   */
  private openAddCategoryItemForm(player: Player, categoryName: string): void {
    const category = officeShop.getCategory(categoryName);

    if (!category) {
      openDialogForm(
        player,
        {
          title: "§c错误",
          desc: "商品类别不存在",
        },
        () => this.openMainMenu(player)
      );
      return;
    }

    // 获取玩家背包
    const inventory = player.getComponent("inventory");
    if (!inventory) {
      openDialogForm(
        player,
        {
          title: "§c错误",
          desc: "无法获取玩家背包",
        },
        () => this.manageCategoryItems(player, categoryName)
      );
      return;
    }

    // 使用ChestUI显示玩家背包中的所有物品
    const chestForm = new ChestFormData("shop");
    chestForm.title(`选择要添加到 ${category.name} 的物品`);

    // 渲染玩家背包内容到ChestUI
    const container = inventory.container;
    if (!container) {
      openDialogForm(
        player,
        {
          title: "§c错误",
          desc: "无法获取背包容器",
        },
        () => this.manageCategoryItems(player, categoryName)
      );
      return;
    }

    for (let i = 0; i < container.size; i++) {
      const item = container.getItem(i);
      if (item) {
        const durability = getItemDurability(item);
        const lores: string[] = [`§e数量: §f${item.amount}`, `§e耐久: §f${durability}`];

        chestForm.button(
          i,
          getItemDisplayName(item),
          lores,
          item.typeId,
          item.amount,
          durability,
          hasAnyEnchantment(item)
        );
      }
    }

    // 添加返回按钮
    chestForm.button(49, "返回", ["§7返回上一级"], "textures/icons/back");

    // 显示表单
    chestForm.show(player).then((data) => {
      if (data.canceled) {
        this.manageCategoryItems(player, categoryName);
        return;
      }

      const slotIndex = data.selection;
      if (slotIndex === undefined) return;

      // 处理返回按钮
      if (slotIndex === 49) {
        this.manageCategoryItems(player, categoryName);
        return;
      }

      // 获取选中的物品
      const selectedItem = container.getItem(slotIndex);
      if (!selectedItem) {
        openDialogForm(
          player,
          {
            title: "§c错误",
            desc: "无法获取物品信息",
          },
          () => this.openAddCategoryItemForm(player, categoryName)
        );
        return;
      }

      // 显示商品添加表单
      this.openItemAddDetailsForm(player, categoryName, selectedItem, slotIndex);
    });
  }

  /**
   * 商品添加详情表单
   */
  private openItemAddDetailsForm(player: Player, categoryName: string, item: ItemStack, slot: number): void {
    const form = new ModalFormData()
      .title(`添加商品到 ${categoryName}`)
      .textField("数量", "请输入商品数量", { defaultValue: "1" })
      .textField("单价", "请输入商品单价", { defaultValue: "1" });

    form.show(player).then((response) => {
      if (response.canceled) return;
      if (!response.formValues) {
        openDialogForm(
          player,
          {
            title: "§c错误",
            desc: "无法获取表单值，没有填写完整",
          },
          () => this.openAddCategoryItemForm(player, categoryName)
        );
        return;
      }

      const [amountStr, priceStr] = response.formValues;
      const amount = parseInt(amountStr as string);
      const price = parseInt(priceStr as string);

      if (isNaN(price) || price <= 0) {
        openDialogForm(
          player,
          {
            title: "§c错误",
            desc: "请输入有效的商品单价",
          },
          () => this.openItemAddDetailsForm(player, categoryName, item, slot)
        );
        return;
      }

      if (isNaN(amount) || amount <= 0) {
        openDialogForm(
          player,
          {
            title: "§c错误",
            desc: "请输入有效的数量",
          },
          () => this.openItemAddDetailsForm(player, categoryName, item, slot)
        );
        return;
      }

      // 添加商品到分类
      officeShop.addItemToCategory({
        player,
        categoryName,
        item,
        amount,
        price,
        cb: () =>
          openDialogForm(
            player,
            {
              title: "§a成功",
              desc: {
                rawtext: [
                  {
                    text: `已成功添加商品 `,
                  },
                  getItemDisplayName(item) as any,
                  {
                    text: ` x${amount}`,
                  },
                  {
                    text: ` 单价: ${price}`,
                  },
                ],
              },
            },
            () => this.manageCategoryItems(player, categoryName)
          ),
      });
    });
  }
}

const officeShopSettingForm = new OfficeShopSettingForm();
export { officeShopSettingForm };
