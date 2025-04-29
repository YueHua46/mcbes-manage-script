import { Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { color } from "../../utils/color";
import { openDialogForm, openConfirmDialogForm } from "../Forms/Dialog";
import productCategory from "./ProcuctCategory";
import { openEconomyMenuForm } from "./Forms";

// 商品类别管理主菜单
export function openCategoryManageForm(player: Player) {
  const form = new ActionFormData();
  form.title("§w商品类别管理");

  const buttons = [
    {
      text: "§w查看所有商品类别",
      icon: "textures/ui/icon_recipe_item",
      action: () => openCategoryListForm(player),
    },
    {
      text: "§w添加商品类别",
      icon: "textures/icons/add",
      action: () => openAddCategoryForm(player),
    },
    {
      text: "§w删除商品类别",
      icon: "textures/ui/icon_recipe_item",
      action: () => openDeleteCategoryForm(player),
    },
    {
      text: "§w返回",
      icon: "textures/icons/back",
      action: () => openEconomyMenuForm(player),
    },
  ];

  buttons.forEach(({ text, icon }) => form.button(text, icon));

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    if (typeof data.selection === "number") {
      buttons[data.selection].action();
    }
  });
}

// 添加商品类别表单
function openAddCategoryForm(player: Player) {
  const form = new ModalFormData();
  form.title("§w添加商品类别");

  form.textField("§类别名称", "请输入类别名称(如: 食物、武器、材料)", "");
  form.textField("§w类别描述", "请输入类别描述", "");
  form.textField("§w类别对应的图标", "（可选）请输入类别显示物品图标，格式类似：minecraft:diamond_ore", "");

  form.submitButton("§w确认添加");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;

    const { formValues } = data;
    if (formValues?.[0] && formValues?.[1]) {
      const result = productCategory.createCategory({
        name: formValues[0].toString(),
        description: formValues[1]?.toString(),
        icon: formValues[2].toString() || productCategory.defaultIcon,
        createdBy: player.name,
      });

      if (typeof result === "string") {
        openDialogForm(
          player,
          {
            title: "添加失败",
            desc: color.red(result),
          },
          () => openAddCategoryForm(player)
        );
      } else {
        openDialogForm(
          player,
          {
            title: "添加成功",
            desc: color.green("商品类别添加成功！"),
          },
          () => openCategoryManageForm(player)
        );
      }
    } else {
      openDialogForm(
        player,
        {
          title: "添加失败",
          desc: color.red("类别名称和描述不能为空！"),
        },
        () => openAddCategoryForm(player)
      );
    }
  });
}

// 删除商品类别表单
function openDeleteCategoryForm(player: Player) {
  const form = new ActionFormData();
  form.title("§w删除商品类别");

  const categories = productCategory.getCategories();
  categories.forEach((category) => {
    form.button(`§w${category.name}\n§7${category.description || "无描述"}`, category.icon);
  });

  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;

    const selectionIndex = data.selection;
    if (selectionIndex === undefined) return;

    const category = categories[selectionIndex];
    if (category) {
      openConfirmDialogForm(
        player,
        "删除确认",
        `${color.red(`确定要删除商品类别 ${color.green(category.name)} ${color.red("吗？")}`)}`,
        () => {
          const result = productCategory.deleteCategory(category.name);
          if (typeof result === "string") {
            openDialogForm(
              player,
              {
                title: "删除失败",
                desc: color.red(result),
              },
              () => openDeleteCategoryForm(player)
            );
          }
        }
      );
    }
  });
}

// 商品类别详情表单
function openCategoryDetailForm(player: Player, categoryId: string) {
  const category = productCategory.getCategory(categoryId);
  if (!category) {
    return openDialogForm(
      player,
      {
        title: "错误",
        desc: color.red("商品类别不存在！"),
      },
      () => openCategoryListForm(player)
    );
  }

  const form = new ActionFormData();
  form.title("§w商品类别详情");

  form.body(
    `§a类别名称: §e${category.name}\n` +
      `§a类别描述: §e${category.description || "无"}\n` +
      `§a创建时间: §e${category.created}\n` +
      `§a修改时间: §e${category.modified}\n` +
      `§a创建者: §e${category.createdBy || "未知"}`
  );

  form.button("§w编辑", "textures/icons/edit2");
  form.button("§w删除", "textures/icons/deny");
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;

    switch (data.selection) {
      case 0:
        openEditCategoryForm(player, categoryId);
        break;
      case 1:
        openConfirmDialogForm(
          player,
          "删除确认",
          `${color.red("确定要删除商品类别")} ${color.green(category.name)} ${color.red("吗？")}`,
          () => {
            const result = productCategory.deleteCategory(categoryId);
            if (typeof result === "string") {
              openDialogForm(
                player,
                {
                  title: "删除失败",
                  desc: color.red(result),
                },
                () => openCategoryDetailForm(player, categoryId)
              );
            } else {
              openDialogForm(
                player,
                {
                  title: "删除成功",
                  desc: color.green("商品类别删除成功！"),
                },
                () => openCategoryListForm(player)
              );
            }
          }
        );
        break;
      case 2:
        openCategoryListForm(player);
        break;
    }
  });
}

// 编辑商品类别表单
function openEditCategoryForm(player: Player, categoryId: string) {
  const category = productCategory.getCategory(categoryId);
  if (!category) {
    return openDialogForm(
      player,
      {
        title: "错误",
        desc: color.red("商品类别不存在！"),
      },
      () => openCategoryListForm(player)
    );
  }

  const form = new ModalFormData();
  form.title("§w编辑商品类别");

  form.textField("§w类别名称", "请输入类别名称", category.name);
  form.textField("§w类别描述", "请输入类别描述", category.description || "");
  form.textField("§w类别图标", "请输入类别图标路径", category.icon || productCategory.defaultIcon);

  form.submitButton("§w确认修改");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;

    const { formValues } = data;
    if (formValues?.[0]) {
      const result = productCategory.updateCategory({
        name: categoryId,
        description: formValues[1]?.toString(),
        icon: formValues[2]?.toString() || productCategory.defaultIcon,
      });

      if (typeof result === "string") {
        openDialogForm(
          player,
          {
            title: "修改失败",
            desc: color.red(result),
          },
          () => openEditCategoryForm(player, categoryId)
        );
      } else {
        openDialogForm(
          player,
          {
            title: "修改成功",
            desc: color.green("商品类别修改成功！"),
          },
          () => openCategoryDetailForm(player, categoryId)
        );
      }
    } else {
      openDialogForm(
        player,
        {
          title: "修改失败",
          desc: color.red("类别名称不能为空！"),
        },
        () => openEditCategoryForm(player, categoryId)
      );
    }
  });
}

// 打开商品类别列表表单
function openCategoryListForm(player: Player, page: number = 1) {
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
      category.icon || "textures/ui/icon_recipe_item"
    );
  });

  let previousButtonIndex = currentPageCategories.length;
  let nextButtonIndex = currentPageCategories.length;

  if (page > 1) {
    form.button("§w上一页", "textures/ui/arrow_left");
    previousButtonIndex++;
    nextButtonIndex++;
  }

  if (page < totalPages) {
    form.button("§w下一页", "textures/ui/arrow_right");
    nextButtonIndex++;
  }

  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;

    const selectionIndex = data.selection;
    if (selectionIndex === undefined) return;

    if (selectionIndex < currentPageCategories.length) {
      // 选择了某个类别
      openCategoryDetailForm(player, currentPageCategories[selectionIndex].name);
    } else if (selectionIndex === previousButtonIndex - 1 && page > 1) {
      // 上一页
      openCategoryListForm(player, page - 1);
    } else if (selectionIndex === nextButtonIndex - 1 && page < totalPages) {
      // 下一页
      openCategoryListForm(player, page + 1);
    } else {
      // 返回
      openCategoryManageForm(player);
    }
  });
}

// 导出所有表单函数
export { openCategoryListForm, openAddCategoryForm };
