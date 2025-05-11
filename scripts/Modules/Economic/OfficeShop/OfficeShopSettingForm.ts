import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { officeShopForm } from "./OfficeShopForm";
import { ItemStack, Player, RawMessage } from "@minecraft/server";
import { openEconomyMenuForm } from "../Forms";
import officeShop from "./OfficeShop";
import { openDialogForm } from "../../Forms/Dialog";
import {
  emojiKeyToEmojiPath,
  emojiPathToEmoji,
  emojiPathToEmojiKey,
  getItemDisplayName,
  getItemDurability,
  hasAnyEnchantment,
} from "../../../utils/utils";
import { glyphKeys } from "../../../glyphMap";
import ChestFormData from "../../ChestUI/ChestForms";
import { OfficeShopItemData } from "./types";
import { openSystemSettingForm } from "../../System/Forms";

class OfficeShopSettingForm {
  // 官方商店设置主菜单
  openOfficeShopSettingMainMenu(player: Player): void {
    const form = new ActionFormData()
      .title("官方商店设置主菜单")
      .button("所有商品类别", "textures/icons/more")
      .button("添加商品类别", "textures/icons/add")
      .button("返回", "textures/icons/back");

    form.show(player).then((res) => {
      if (res.canceled) return;
      if (res.selection === 0) {
        this.openCategoryList(player);
      } else if (res.selection === 1) {
        this.openAddCategoryForm(player);
      } else {
        openSystemSettingForm(player);
      }
    });
  }
  // 打开分类列表
  openCategoryList(player: Player, page: number = 1): void {
    const categories = officeShop.getCategories();

    if (categories.length === 0) {
      openDialogForm(
        player,
        {
          title: "商店为空",
          desc: "当前没有任何商品类别",
        },
        () => this.openOfficeShopSettingMainMenu(player)
      );
      return;
    }

    // 计算分页信息
    const itemsPerPage = 8; // ActionForm每页显示8个类别
    const totalPages = Math.ceil(categories.length / itemsPerPage);
    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, categories.length);
    const currentPageCategories = categories.slice(startIndex, endIndex);

    const form = new ActionFormData().title(`官方商店 - 商品类别管理 (第${page}/${totalPages}页)`);

    // 添加类别说明
    form.body("选择一个商品类别进行管理");

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
        return this.openOfficeShopSettingMainMenu(player);
      } else if (page < totalPages && selection === nextPageIndex) {
        // 下一页
        return this.openCategoryList(player, page + 1);
      }

      // 处理类别选择
      if (selection < categoryCount) {
        const selectedCategory = currentPageCategories[selection];
        if (selectedCategory) {
          this.openCategoryManage(player, selectedCategory.name);
        }
      }
    });
  }

  // 添加商品类别
  openAddCategoryForm(player: Player): void {
    const categoryIconKeys = officeShop.getCategoryIcons()[0];
    const categoryIcons = officeShop.getCategoryIcons()[1];

    const modal = new ModalFormData()
      .title("添加商品类别")
      .textField("类别名称", "请输入商品类别名称")
      .textField("类别描述", "请输入商品类别描述")
      .dropdown("类别图标", categoryIcons, {
        defaultValueIndex: 0,
      });

    modal.show(player).then((res) => {
      if (!res.formValues) return;
      const [name, description, iconIndex] = res.formValues;
      if (typeof name !== "string" || typeof description !== "string" || typeof iconIndex !== "number") {
        openDialogForm(player, { title: "失败", desc: "请输入完整且正确的信息" }, () =>
          this.openAddCategoryForm(player)
        );
        return;
      }
      if (name.length === 0 || description.length === 0) return;
      if (officeShop.getCategory(name)) {
        openDialogForm(player, { title: "失败", desc: "商品类别已存在" }, () => this.openAddCategoryForm(player));
        return;
      }
      officeShop.createCategory({
        name,
        description,
        icon: emojiKeyToEmojiPath(categoryIconKeys[iconIndex]),
        player,
      });
      openDialogForm(player, { title: "成功", desc: "商品类别添加成功" }, () => this.openCategoryList(player));
    });
  }

  // 点击对应分类列表，展示分类管理（分类管理、商品管理）
  openCategoryManage(player: Player, categoryName: string): void {
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
    const form = new ActionFormData().title(`分类管理`);

    form.body("选择一个选项进行管理");
    form.button("分类管理", "textures/packs/035-cyclone");
    form.button("商品管理", "textures/packs/028-candy");
    form.button("返回", "textures/icons/back");

    form.show(player).then((res) => {
      if (res.canceled) {
        return;
      }

      if (res.selection === 0) {
        this.openCategoryManageForm(player, categoryName);
      } else if (res.selection === 1) {
        this.openCategoryItemManageForm(player, categoryName);
      } else {
        this.openCategoryList(player);
      }
    });
  }

  // 处理分类管理
  openCategoryManageForm(player: Player, categoryName: string): void {
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

    const modal = new ActionFormData().title(`分类管理`);

    modal.button("修改分类", "textures/icons/edit");
    modal.button("删除分类", "textures/icons/deny");
    modal.button("返回", "textures/icons/back");

    modal.show(player).then((res) => {
      if (res.canceled) return;

      if (res.selection === 0) {
        this.openEditCategoryForm(player, categoryName);
      } else if (res.selection === 1) {
        this.openDeleteCategoryForm(player, categoryName);
      } else {
        this.openCategoryManage(player, categoryName);
      }
    });
  }
  // 处理分类编辑
  openEditCategoryForm(player: Player, categoryName: string): void {
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

    const modal = new ModalFormData().title(`分类编辑`);

    modal.textField("新的分类描述", "请输入新的分类描述", {
      defaultValue: category.description,
    });
    modal.dropdown("新的分类图标", officeShop.getCategoryIcons()[1], {
      defaultValueIndex: glyphKeys.indexOf(emojiPathToEmojiKey(category.icon || officeShop.defaultIcon)),
    });

    modal.show(player).then((res) => {
      if (!res.formValues) return;
      const [newDescription, newIconIndex] = res.formValues;

      if (typeof newDescription !== "string" || typeof newIconIndex !== "number") {
        openDialogForm(player, { title: "失败", desc: "请输入完整且正确的信息" }, () =>
          this.openEditCategoryForm(player, categoryName)
        );
        return;
      }
      // 处理编辑逻辑
      officeShop.editCategory(categoryName, {
        description: newDescription,
        icon: emojiKeyToEmojiPath(officeShop.getCategoryIcons()[0][newIconIndex]),
      });

      openDialogForm(player, { title: "成功", desc: "商品类别编辑成功" }, () => this.openCategoryList(player));
    });
  }
  // 处理分类删除
  openDeleteCategoryForm(player: Player, categoryName: string): void {
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
    // 处理删除逻辑
    officeShop.deleteCategory(categoryName);

    openDialogForm(player, { title: "成功", desc: "商品类别删除成功" }, () => this.openCategoryList(player));
  }
  // 处理商品（物品）管理
  openCategoryItemManageForm(player: Player, categoryName: string): void {
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

    const form = new ActionFormData().title(`商品管理`);

    form.button("查看和编辑商品", "textures/icons/edit");
    form.button("添加商品", "textures/icons/add");
    form.button("返回", "textures/icons/back");

    form.show(player).then((res) => {
      if (res.canceled) {
        return;
      }

      if (res.selection === 0) {
        this.openCategoryItemListForm(player, categoryName);
      } else if (res.selection === 1) {
        this.openAddCategoryItemForm(player, categoryName);
      } else {
        this.openCategoryManage(player, categoryName);
      }
    });
  }

  // 处理商品（物品）列表
  openCategoryItemListForm(player: Player, categoryName: string, page: number = 1): void {
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

    const items = officeShop.getCategoryItems(categoryName);

    if (items.length === 0) {
      openDialogForm(
        player,
        {
          title: "商店为空",
          desc: "当前没有任何商品",
        },
        () => this.openCategoryItemManageForm(player, categoryName)
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
      const amount = itemData.item.amount;
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
        // 上一页
        return this.openCategoryItemListForm(player, categoryName, page - 1);
      } else if (selection === 49) {
        // 返回
        return this.openCategoryItemManageForm(player, categoryName);
      } else if (selection === 53 && page < totalPages) {
        // 下一页
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

  // 商品管理表单
  openItemManageForm(player: Player, categoryName: string, item: OfficeShopItemData): void {
    const displayName = getItemDisplayName(item.item);
    const title: RawMessage = {
      rawtext: [
        {
          text: "商品管理 - ",
        },
        displayName,
      ],
    };
    const body: RawMessage = {
      rawtext: [
        {
          text: `商品: `,
        },
        displayName,
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
      .button("编辑商品", "textures/icons/edit")
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

  // 编辑商品表单
  openEditItemForm(player: Player, categoryName: string, item: OfficeShopItemData): void {
    const displayName = getItemDisplayName(item.item);
    const title: RawMessage = {
      rawtext: [
        {
          text: "编辑商品 - ",
        },
        displayName,
      ],
    };

    const form = new ModalFormData()
      .title(title)
      .slider("库存数量", 1, 64, {
        defaultValue: item.data.amount,
        valueStep: 1,
      })
      .textField("单价", "请输入商品单价", {
        defaultValue: item.data.price.toString(),
      });

    form.show(player).then((res) => {
      if (res.canceled || !res.formValues) {
        this.openItemManageForm(player, categoryName, item);
        return;
      }

      const [newAmount, newPriceStr] = res.formValues;
      const newPrice = parseInt(newPriceStr as string);

      if (isNaN(newPrice) || newPrice <= 0) {
        openDialogForm(
          player,
          {
            title: "错误",
            desc: "请输入有效的单价",
          },
          () => this.openEditItemForm(player, categoryName, item)
        );
        return;
      }

      // 更新商品信息
      officeShop.updateItemMeta(item.data, {
        ...item.data,
        amount: newAmount as number,
        price: newPrice,
      });

      openDialogForm(
        player,
        {
          title: "成功",
          desc: "商品信息已更新",
        },
        () => this.openCategoryItemListForm(player, categoryName)
      );
    });
  }

  // 删除商品确认表单
  openDeleteItemConfirmForm(player: Player, categoryName: string, item: OfficeShopItemData): void {
    const displayName = getItemDisplayName(item.item);

    const form = new ActionFormData()
      .title(`确认删除 - ${displayName}`)
      .body(`您确定要删除商品 "${displayName}" 吗？此操作不可撤销。`)
      .button("确认删除", "textures/ui/icon_trash")
      .button("取消", "textures/icons/back");

    form.show(player).then((res) => {
      if (res.canceled || res.selection === 1) {
        this.openItemManageForm(player, categoryName, item);
        return;
      }

      // 删除商品
      officeShop.deleteItem(item.data);

      openDialogForm(
        player,
        {
          title: "成功",
          desc: "商品已删除",
        },
        () => this.openCategoryItemListForm(player, categoryName)
      );
    });
  }
  // 处理添加商品
  openAddCategoryItemForm(player: Player, categoryName: string): void {
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

    // 获取玩家背包
    const inventory = player.getComponent("inventory");
    if (!inventory) {
      openDialogForm(
        player,
        {
          title: "错误",
          desc: "无法获取玩家背包",
        },
        () => this.openCategoryItemManageForm(player, categoryName)
      );
      return;
    }

    // 使用ChestUI显示玩家背包中的所有物品
    const chestForm = new ChestFormData("shop");
    chestForm.title(`选择要添加到 ${category.name} 的物品`);

    // 渲染玩家背包内容到ChestUI
    const container = inventory.container;
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
        this.openCategoryItemManageForm(player, categoryName);
        return;
      }

      const slotIndex = data.selection;
      if (slotIndex === undefined) return;

      // 处理返回按钮
      if (slotIndex === 49) {
        this.openCategoryItemManageForm(player, categoryName);
        return;
      }

      // 获取选中的物品
      const selectedItem = container.getItem(slotIndex);
      if (!selectedItem) {
        openDialogForm(
          player,
          {
            title: "错误",
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

  // 商品添加详情表单
  openItemAddDetailsForm(player: Player, categoryName: string, item: ItemStack, slot: number): void {
    const form = new ModalFormData()
      .title(`添加商品到 ${categoryName}`)
      .textField("数量", "请输入商品数量", {
        defaultValue: "1",
        tooltip: "请输入商品数量",
      })
      .textField("单价", "请输入商品单价", {
        defaultValue: "1",
        tooltip: "请输入商品单价",
      });

    form.show(player).then((response) => {
      if (response.canceled) return;
      if (!response.formValues) {
        openDialogForm(
          player,
          {
            title: "错误",
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
            title: "错误",
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
            title: "错误",
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
              title: "成功",
              desc: {
                rawtext: [
                  {
                    text: `已成功添加商品 `,
                  },
                  getItemDisplayName(item),
                  {
                    text: ` x${amount}`,
                  },
                  {
                    text: ` 单价: ${price}`,
                  },
                ],
              },
            },
            () => this.openCategoryItemManageForm(player, categoryName)
          ),
      });
    });
  }
}

// 导出单例实例
export const officeShopSettingForm = new OfficeShopSettingForm();
