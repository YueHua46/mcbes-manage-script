/**
 * 路径点系统表单
 * 完整迁移自 Modules/WayPoint/Forms.ts (614行)
 */

import { Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { color } from "../../../shared/utils/color";
import { openServerMenuForm } from "../server";
import wayPoint from "../../../features/waypoint/services/waypoint";
import type { IWayPoint } from "../../../features/waypoint/services/waypoint";
import { useFormatListInfo, useNotify } from "../../../shared/hooks";
import { openConfirmDialogForm, openDialogForm } from "../../../ui/components/dialog";
import { openSystemSettingForm } from "../system";
import { isAdmin } from "../../../shared";

const ITEMS_PER_PAGE = 10;

/**
 * 获取维度显示名称
 */
function getDimensionName(dimension: string): string {
  switch (dimension) {
    case "minecraft:overworld":
    case "overworld":
      return "主世界";
    case "minecraft:nether":
    case "nether":
      return "下界";
    case "minecraft:the_end":
    case "the_end":
      return "末地";
    default:
      return dimension;
  }
}

// ==================== 删除所有坐标点 ====================

export function openDeleteAllPointsConfirmForm(
  player: Player,
  targetPlayerName: string,
  returnForm?: () => void
): void {
  openConfirmDialogForm(
    player,
    "删除所有坐标点",
    `是否确定删除玩家 ${color.yellow(targetPlayerName)} 的所有坐标点？\n${color.red("此操作不可恢复！")}`,
    () => {
      const count = wayPoint.deletePlayerPoints(targetPlayerName);
      openDialogForm(
        player,
        {
          title: "删除成功",
          desc: color.green(`已成功删除玩家 ${targetPlayerName} 的 ${count} 个坐标点！`),
        },
        returnForm
      );
    },
    returnForm
  );
}

// ==================== 搜索玩家坐标点 ====================

export const openSearchWayPointForm = (player: Player): void => {
  const form = new ModalFormData();

  form.title("搜索用户坐标点");
  form.textField("玩家名称", "请输入要搜索的玩家名称");
  form.submitButton("搜索");

  form.show(player).then((data) => {
    if (data.cancelationReason) return;
    const { formValues } = data;
    if (formValues?.[0]) {
      const playerName = formValues[0].toString();
      const wayPoints = wayPoint.getPointsByPlayer(playerName);
      if (wayPoints.length === 0) {
        openDialogForm(
          player,
          {
            title: "搜索结果",
            desc: color.red("未找到该玩家的坐标点或该玩家不存在"),
          },
          () => openSearchWayPointForm(player)
        );
      } else {
        openSearchResultsForm(player, wayPoints, playerName);
      }
    }
  });
};

const openSearchResultsForm = (player: Player, wayPoints: IWayPoint[], playerName: string, page: number = 1): void => {
  const form = new ActionFormData();

  form.title(`搜索结果 - ${playerName}`);
  const totalPages = Math.ceil(wayPoints.length / 10);
  const start = (page - 1) * 10;
  const end = start + 10;
  const currentPageWayPoints = wayPoints.slice(start, end);

  currentPageWayPoints.forEach((point) => {
    form.button(` ${point.name}`, "textures/ui/World");
  });

  let previousButtonIndex = currentPageWayPoints.length;
  let nextButtonIndex = currentPageWayPoints.length;
  if (page > 1) {
    form.button("上一页", "textures/icons/left_arrow");
    previousButtonIndex++;
    nextButtonIndex++;
  }
  if (page < totalPages) {
    form.button("下一页", "textures/icons/right_arrow");
    nextButtonIndex++;
  }

  let deleteButtonIndex = -1;
  if (wayPoints.length > 0) {
    form.button("§c一键删除所有坐标点", "textures/ui/trash");
    deleteButtonIndex = nextButtonIndex;
    nextButtonIndex++;
  }

  form.body(`第 ${page} 页 / 共 ${totalPages} 页`);
  form.button("返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.cancelationReason) return;
    const selectionIndex = data.selection;
    if (selectionIndex === null || selectionIndex === undefined) return;

    const currentPageWayPointsCount = currentPageWayPoints.length;

    if (selectionIndex < currentPageWayPointsCount) {
      const pointName = currentPageWayPoints[selectionIndex].name;
      if (pointName) {
        openWayPointDetailForm(player, pointName, false, "public", () => {
          openWayPointMenuForms(player);
        });
      }
    } else if (selectionIndex === previousButtonIndex - 1 && page > 1) {
      openSearchResultsForm(player, wayPoints, playerName, page - 1);
    } else if (selectionIndex === nextButtonIndex - 1 && page < totalPages && deleteButtonIndex === -1) {
      openSearchResultsForm(player, wayPoints, playerName, page + 1);
    } else if (selectionIndex === nextButtonIndex - 2 && page < totalPages && deleteButtonIndex !== -1) {
      openSearchResultsForm(player, wayPoints, playerName, page + 1);
    } else if (deleteButtonIndex !== -1 && selectionIndex === deleteButtonIndex) {
      openDeleteAllPointsConfirmForm(player, playerName, () => openWayPointMenuForms(player));
    } else if (
      (deleteButtonIndex === -1 && selectionIndex === nextButtonIndex) ||
      (deleteButtonIndex !== -1 && selectionIndex === nextButtonIndex)
    ) {
      openWayPointMenuForms(player);
    }
  });
};

// ==================== 更新坐标点 ====================

export const openWayPointUpdateForm = (
  player: Player,
  pointName: string,
  isAdmin: boolean = false,
  type: "private" | "public" = "private"
): void => {
  const form = new ModalFormData();

  form.title("编辑坐标点");
  form.textField("坐标点名称", "请输入坐标点名称（不允许重复）", {
    defaultValue: pointName,
    tooltip: "请输入坐标点名称（不允许重复）",
  });
  form.toggle("是否更新坐标为当前坐标", {
    defaultValue: false,
    tooltip: "是否更新坐标为当前坐标",
  });
  form.submitButton("确定");

  form.show(player).then((data) => {
    if (data.cancelationReason) return;
    const { formValues } = data;
    if (formValues?.[0]) {
      const res = wayPoint.updatePoint({
        player,
        pointName,
        updatePointName: formValues?.[0].toString(),
        isUpdateLocation: formValues?.[1] as boolean,
      });
      if (typeof res === "string") {
        return openDialogForm(
          player,
          {
            title: "坐标点更新失败",
            desc: color.red(res),
          },
          () => openWayPointUpdateForm(player, pointName, isAdmin, type)
        );
      }
      openDialogForm(
        player,
        {
          title: "坐标点更新成功",
          desc: color.green("坐标点更新成功！"),
        },
        () => openWayPointListForm(player, isAdmin, type)
      );
    }
  });
};

// ==================== 坐标点详情 ====================

export const openWayPointDetailForm = (
  player: Player,
  pointName: string,
  isAdmin: boolean = false,
  type: "private" | "public",
  returnForm: () => void
): void => {
  const form = new ActionFormData();

  const point = wayPoint.getPoint(pointName);
  if (!point) {
    return openDialogForm(player, { title: "坐标点不存在", desc: color.red("坐标点不存在！") }, returnForm);
  }

  form.title("坐标点详细");
  form.body(
    useFormatListInfo([
      {
        title: "坐标点名称",
        desc: point.name,
      },
      {
        title: "创建玩家",
        desc: point.playerName,
      },
      {
        title: "所在维度",
        desc: getDimensionName(point.dimension),
      },
      {
        title: "坐标点位置",
        desc: `${point.location.x}, ${point.location.y}, ${point.location.z}`,
      },
      {
        title: "类型",
        desc: point.type === "public" ? color.darkGreen("公开") : color.darkRed("私有"),
      },
      {
        title: "是否置顶",
        desc: point.isStarred ? color.yellow("是") : "否",
      },
    ])
  );

  const buttons = [
    {
      text: "传送至此",
      icon: "textures/ui/portalBg",
      action: () => {
        const res = wayPoint.teleport(player, pointName);
        if (typeof res === "string") useNotify("chat", player, res);
      },
    },
  ];

  if (wayPoint.checkOwner(player, pointName) || isAdmin) {
    buttons.push(
      {
        text: "编辑",
        icon: "textures/icons/edit2",
        action: () => {
          openWayPointUpdateForm(player, pointName, isAdmin, point.type);
        },
      },
      {
        text: "删除",
        icon: "textures/icons/deny",
        action: () => {
          openConfirmDialogForm(player, "删除坐标点", "是否确定删除该坐标点？", () => {
            const isSuccess = wayPoint.deletePoint(pointName);
            if (isSuccess) {
              openDialogForm(
                player,
                {
                  title: "坐标点删除成功",
                  desc: color.green("坐标点删除成功！"),
                },
                returnForm
              );
            } else {
              openDialogForm(
                player,
                {
                  title: "坐标点删除失败",
                  desc: color.red("坐标点删除失败！"),
                },
                () => openWayPointDetailForm(player, pointName, isAdmin, type, returnForm)
              );
            }
          });
        },
      }
    );

    if (type === "private") {
      buttons.splice(1, 0, {
        text: point.isStarred ? "取消置顶" : "置顶",
        icon: "textures/ui/filledStarFocus",
        action: () => {
          const isSuccess = wayPoint.toggleStar(pointName, !point.isStarred);
          if (typeof isSuccess !== "string") {
            openDialogForm(
              player,
              {
                title: "置顶状态更新成功",
                desc: color.green("置顶状态更新成功！"),
              },
              () => openWayPointDetailForm(player, pointName, isAdmin, type, returnForm)
            );
          } else {
            openDialogForm(
              player,
              {
                title: "置顶状态更新失败",
                desc: color.red("置顶状态更新失败！"),
              },
              () => openWayPointDetailForm(player, pointName, isAdmin, type, returnForm)
            );
          }
        },
      });
    }
  }

  buttons.push({
    text: "返回",
    icon: "textures/icons/back",
    action: returnForm,
  });

  buttons.forEach(({ text, icon }) => form.button(text, icon));

  form.show(player).then((data) => {
    if (data.cancelationReason || typeof data.selection !== "number") return;
    const selectedButton = buttons[data.selection];
    if (selectedButton && selectedButton.action) {
      selectedButton.action();
    }
  });
};

// ==================== 添加坐标点 ====================

export const openAddWayPointForm = (player: Player, type: "private" | "public" = "private"): void => {
  const form = new ModalFormData();

  form.title(type === "private" ? "添加私人坐标点" : "添加公共坐标点");
  form.textField("坐标点名称", "请输入坐标点名称（不允许重复）");
  form.submitButton("确定");

  form.show(player).then((data) => {
    if (data.cancelationReason) return;
    const { formValues } = data;
    if (formValues?.[0]) {
      const res = wayPoint.createPoint({
        location: player.location,
        player,
        pointName: formValues?.[0].toString(),
        type,
      });
      if (typeof res === "string") {
        return openDialogForm(
          player,
          {
            title: "坐标点添加失败",
            desc: color.red(res),
          },
          () => openAddWayPointForm(player)
        );
      }
      openDialogForm(
        player,
        {
          title: "坐标点添加成功",
          desc: color.green("坐标点添加成功！"),
        },
        () => openWayPointListForm(player)
      );
    }
  });
};

// ==================== 坐标点列表 ====================

export const openWayPointListForm = (
  player: Player,
  isAdmin: boolean = false,
  type: "private" | "public" = "private",
  page: number = 1
): void => {
  const form = new ActionFormData();

  form.title(isAdmin ? "所有玩家坐标点列表" : type === "private" ? "私人坐标点列表" : "公共坐标点列表");
  let wayPoints: IWayPoint[];
  if (isAdmin) wayPoints = wayPoint.getPoints();
  else if (type === "private") wayPoints = wayPoint.getPlayerPoints(player);
  else wayPoints = wayPoint.getPublicPoints();

  wayPoints.sort((a, b) => {
    if (a.type === "private" && b.type === "private") return (b.isStarred ? 1 : 0) - (a.isStarred ? 1 : 0);
    return 0;
  });

  const totalPages = Math.ceil(wayPoints.length / 10);
  const start = (page - 1) * 10;
  const end = start + 10;
  const currentPageWayPoints = wayPoints.slice(start, end);

  form.body(`第 ${page} 页 / 共 ${totalPages} 页`);

  currentPageWayPoints.forEach((point) => {
    const starSymbol = point.type === "private" ? (point.isStarred ? "" : "") : "";
    if (isAdmin) {
      form.button(`${starSymbol} ${point.playerName} ${point.name}`, "textures/ui/World");
    } else {
      form.button(`${starSymbol} ${point.name} ${type === "public" ? point.playerName : ""}`, "textures/ui/World");
    }
  });

  let previousButtonIndex = currentPageWayPoints.length;
  let nextButtonIndex = currentPageWayPoints.length;
  if (page > 1) {
    form.button("上一页", "textures/icons/left_arrow");
    previousButtonIndex++;
    nextButtonIndex++;
  }
  if (page < totalPages) {
    form.button("下一页", "textures/icons/right_arrow");
    nextButtonIndex++;
  }

  form.button("返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.cancelationReason) return;
    const selectionIndex = data.selection;
    if (selectionIndex === null || selectionIndex === undefined) return;

    const currentPageWayPointsCount = currentPageWayPoints.length;

    if (selectionIndex < currentPageWayPointsCount) {
      const pointName = currentPageWayPoints[selectionIndex].name;
      if (pointName) {
        openWayPointDetailForm(player, pointName, isAdmin, type, () => {
          openWayPointListForm(player, isAdmin, type, page);
        });
      }
    } else if (selectionIndex === previousButtonIndex - 1 && page > 1) {
      openWayPointListForm(player, isAdmin, type, page - 1);
    } else if (selectionIndex === nextButtonIndex - 1 && page < totalPages) {
      openWayPointListForm(player, isAdmin, type, page + 1);
    } else if (selectionIndex === nextButtonIndex) {
      if (!isAdmin) {
        openWayPointMenuForms(player);
      } else {
        openSystemSettingForm(player);
      }
    }
  });
};

// ==================== 玩家坐标点列表（管理员用） ====================

export const openPlayerWayPointListForm = (
  player: Player,
  targetPlayerName: string,
  page: number = 1,
  isAdmin: boolean = false,
  returnForm?: () => void
): void => {
  const form = new ActionFormData();
  form.title(`${color.blue(targetPlayerName)}的坐标点列表`);

  const privatePoints = wayPoint.getPointsByPlayer(targetPlayerName).filter((p) => p.type === "private");
  const publicPoints = wayPoint.getPointsByPlayer(targetPlayerName).filter((p) => p.type === "public");
  const allPoints = [...privatePoints, ...publicPoints];

  const totalPages = Math.ceil(allPoints.length / ITEMS_PER_PAGE);
  const start = (page - 1) * ITEMS_PER_PAGE;
  const end = Math.min(start + ITEMS_PER_PAGE, allPoints.length);
  const currentPagePoints = allPoints.slice(start, end);

  currentPagePoints.forEach((point) => {
    const isPublic = point.type === "public" ? `${color.darkGreen("公开")}` : `${color.darkRed("[私有]")}`;
    const isStarred = point.isStarred ? `${color.yellow("★")}` : "";
    form.button(
      `${isPublic} ${isStarred}${point.name}\n ${getDimensionName(point.dimension)} (${point.location.x}, ${
        point.location.y
      }, ${point.location.z})`,
      "textures/ui/World"
    );
  });

  let previousButtonIndex = currentPagePoints.length;
  let nextButtonIndex = currentPagePoints.length;

  if (page > 1) {
    form.button("§w上一页", "textures/icons/left_arrow");
    previousButtonIndex++;
    nextButtonIndex++;
  }

  if (page < totalPages) {
    form.button("§w下一页", "textures/icons/right_arrow");
    nextButtonIndex++;
  }

  let deleteButtonIndex = -1;
  if (isAdmin && allPoints.length > 0) {
    form.button("§c一键删除所有坐标点", "textures/ui/trash");
    deleteButtonIndex = nextButtonIndex;
    nextButtonIndex++;
  }

  form.button("§w返回", "textures/icons/back");
  form.body(
    `第 ${page} 页 / 共 ${totalPages} 页\n§7总计: ${allPoints.length} 个坐标点 (私有: ${privatePoints.length}, 公开: ${publicPoints.length})`
  );

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    const selectionIndex = data.selection;
    if (selectionIndex === null || selectionIndex === undefined) return;

    const currentPagePointsCount = currentPagePoints.length;

    if (selectionIndex < currentPagePointsCount) {
      const selectedPoint = currentPagePoints[selectionIndex];
      openWayPointDetailForm(
        player,
        selectedPoint.name,
        true,
        selectedPoint.type === "public" ? "public" : "private",
        () => {
          openPlayerWayPointListForm(player, targetPlayerName, page, isAdmin, returnForm);
        }
      );
    } else if (selectionIndex === previousButtonIndex - 1 && page > 1) {
      openPlayerWayPointListForm(player, targetPlayerName, page - 1, isAdmin, returnForm);
    } else if (selectionIndex === nextButtonIndex - 1 && page < totalPages && deleteButtonIndex === -1) {
      openPlayerWayPointListForm(player, targetPlayerName, page + 1, isAdmin, returnForm);
    } else if (selectionIndex === nextButtonIndex - 2 && page < totalPages && deleteButtonIndex !== -1) {
      openPlayerWayPointListForm(player, targetPlayerName, page + 1, isAdmin, returnForm);
    } else if (deleteButtonIndex !== -1 && selectionIndex === deleteButtonIndex) {
      openDeleteAllPointsConfirmForm(player, targetPlayerName, () => {
        if (returnForm) returnForm();
      });
    } else {
      if (returnForm) {
        returnForm();
      }
    }
  });
};

// ==================== 路径点主菜单 ====================

export const openWayPointMenuForms = (player: Player): void => {
  const form = new ActionFormData();

  form.title("坐标点管理");
  const buttons = [
    {
      text: "私人坐标点列表",
      icon: "textures/icons/region",
      action: () => openWayPointListForm(player),
    },
    {
      text: "公共坐标点列表",
      icon: "textures/icons/overworld",
      action: () => openWayPointListForm(player, false, "public"),
    },
    {
      text: "添加当前私人坐标点",
      icon: "textures/icons/carneval",
      action: () => openAddWayPointForm(player),
    },
    {
      text: "添加当前公共坐标点",
      icon: "textures/icons/carneval_unavailable",
      action: () => openAddWayPointForm(player, "public"),
    },
  ];
  if (isAdmin(player)) {
    buttons.push({
      text: "搜索用户坐标点",
      icon: "textures/icons/spectator",
      action: () => openSearchWayPointForm(player),
    });
  }
  buttons.forEach(({ text, icon }) => form.button(text, icon));
  form.button("返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.cancelationReason) return;
    switch (data.selection) {
      case buttons.length:
        openServerMenuForm(player);
        break;
      default:
        if (typeof data.selection === "number") buttons[data.selection].action();
    }
  });
};
