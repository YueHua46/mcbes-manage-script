/**
 * 领地系统表单
 * 完整迁移自 Modules/Land/Forms.ts (1079行)
 */

import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { color } from "../../../shared/utils/color";
import { Player, Vector3, world } from "@minecraft/server";
import landManager from "../../../features/land/services/land-manager";
import { openServerMenuForm } from "../server";
import { openConfirmDialogForm, openDialogForm } from "../../../ui/components/dialog";
import { landAreas } from "../../../events/handlers/land";
import { useFormatInfo, useFormatListInfo } from "../../../shared/hooks/use-form";
import { useAllPlayers } from "../../../shared/hooks/use-player";
import { useNotify } from "../../../shared/hooks/use-notify";
import type { ILand } from "../../../core/types";
import { openLandManageForm, openSystemSettingForm } from "../system";

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

// ==================== 领地申请 ====================

function createLandApplyForm(player: Player): ModalFormData {
  const form = new ModalFormData();
  form.title("领地申请");

  const defaultLandStartPos = landAreas.get(player.name)?.start || {
    x: player.location.x.toFixed(0),
    y: player.location.y.toFixed(0),
    z: player.location.z.toFixed(0),
  };
  const defaultLandEndPos = landAreas.get(player.name)?.end || {
    x: player.location.x.toFixed(0),
    y: player.location.y.toFixed(0),
    z: player.location.z.toFixed(0),
  };

  form.textField(color.white("领地名称"), color.gray("请输入领地名称"), {
    defaultValue: "",
    tooltip: "请输入领地名称",
  });
  form.textField(color.white("领地起始点"), color.gray("请输入领地起始点"), {
    defaultValue: `${defaultLandStartPos.x} ${defaultLandStartPos.y} ${defaultLandStartPos.z}`,
    tooltip: "请输入领地起始点",
  });
  form.textField(color.white("领地结束点"), color.gray("请输入领地结束点"), {
    defaultValue: `${defaultLandEndPos.x} ${defaultLandEndPos.y} ${defaultLandEndPos.z}`,
    tooltip: "请输入领地结束点",
  });
  form.submitButton("确认");

  return form;
}

function validateForm(formValues: (string | number | boolean | undefined)[], player: Player): boolean {
  if (formValues && formValues[0] && formValues[1] && formValues[2]) {
    const landStartPos = formValues[1] as string;
    const landEndPos = formValues[2] as string;

    const landStartPosVector3 = landManager.createVector3(landStartPos);
    const landEndPosVector3 = landManager.createVector3(landEndPos);

    if (typeof landStartPosVector3 === "string" || typeof landEndPosVector3 === "string") {
      openDialogForm(
        player,
        {
          title: "领地创建错误",
          desc: color.red("表单格式填写有误，请重新填写！"),
        },
        () => {
          openLandApplyForm(player);
        }
      );
      return false;
    }

    if (
      landStartPosVector3.x === landEndPosVector3.x ||
      landStartPosVector3.z === landEndPosVector3.z ||
      landStartPosVector3.y === landEndPosVector3.y
    ) {
      openDialogForm(
        player,
        {
          title: "领地创建错误",
          desc: color.red("领地起始点和结束点不能在同一直线上，且不能为同一坐标点！"),
        },
        () => {
          openLandApplyForm(player);
        }
      );
      return false;
    }

    return true;
  } else {
    openDialogForm(
      player,
      {
        title: "领地创建错误",
        desc: color.red("表单未填写完整，请重新填写！"),
      },
      () => {
        openLandApplyForm(player);
      }
    );
    return false;
  }
}

export function openLandApplyForm(player: Player): void {
  const form = createLandApplyForm(player);

  form.show(player).then(async (data) => {
    const { formValues, cancelationReason } = data;
    if (cancelationReason === "UserClosed") return;

    if (formValues && formValues[0] && formValues[1] && formValues[2]) {
      const landName = formValues[0] as string;
      const landStartPos = formValues[1] as string;
      const landEndPos = formValues[2] as string;

      if (validateForm(formValues, player)) {
        const landStartPosVector3 = landManager.createVector3(landStartPos);
        const landEndPosVector3 = landManager.createVector3(landEndPos);

        const landData: ILand = {
          id: `${Date.now()}_${player.name}`,
          name: landName,
          owner: player.name,
          dimension: player.dimension.id as any,
          members: [player.name],
          public_auth: {
            break: false,
            place: false,
            useBlock: false,
            isChestOpen: false,
            useEntity: false,
            useButton: false,
            explode: false,
            burn: false,
            useSign: false,
            useSmelting: false,
            useRedstone: false,
            attackNeutralMobs: false,
          },
          config_public_auth: {
            break: false,
            place: false,
            useBlock: false,
            isChestOpen: false,
            useEntity: false,
            useButton: false,
            explode: false,
            burn: false,
            useSign: false,
            useSmelting: false,
            useRedstone: false,
            attackNeutralMobs: false,
          },
          vectors: {
            start: landStartPosVector3 as Vector3,
            end: landEndPosVector3 as Vector3,
          },
          createdAt: Date.now(),
        };

        const res = await landManager.createLand(landData);
        if (typeof res === "string") {
          openDialogForm(
            player,
            {
              title: "领地创建错误",
              desc: color.red(res),
            },
            () => {
              openLandApplyForm(player);
            }
          );
        } else {
          player.sendMessage(color.yellow(`领地 ${landName} 创建成功！`));
          landAreas.delete(player.name);
        }
      }
    } else {
      openDialogForm(
        player,
        {
          title: "领地创建错误",
          desc: color.red("表单未填写完整，请重新填写！"),
        },
        () => {
          openLandApplyForm(player);
        }
      );
    }
  });
}

// ==================== 领地权限设置 ====================

export function openLandAuthForm(player: Player, myLand: ILand): void {
  const form = new ModalFormData();
  const _myLand = landManager.db.get(myLand.name);

  form.title("领地公开权限");
  form.toggle(color.white("破坏权限"), {
    defaultValue: _myLand.public_auth.break,
    tooltip: "是否允许玩家破坏领地内的方块",
  });
  form.toggle(color.white("放置权限"), {
    defaultValue: _myLand.public_auth.place,
    tooltip: "是否允许玩家放置领地内的方块",
  });
  form.toggle(color.white("与方块交互权限（包含可交互的各种方块：红石类、锻造类、告示牌类功能性等方块）"), {
    defaultValue: _myLand.public_auth.useBlock,
    tooltip: "是否允许玩家与方块交互",
  });
  form.toggle(color.white("箱子是否公开"), {
    defaultValue: _myLand.public_auth.isChestOpen,
    tooltip: "是否允许玩家打开领地内的箱子",
  });
  form.toggle(color.white("按钮是否公开"), {
    defaultValue: _myLand.public_auth.useButton,
    tooltip: "是否允许玩家使用按钮",
  });
  form.toggle(color.white("实体是否允许交互"), {
    defaultValue: _myLand.public_auth.useEntity,
    tooltip: "是否允许玩家与实体交互",
  });
  form.toggle(color.white("爆炸"), {
    defaultValue: _myLand.public_auth.explode,
    tooltip: "是否允许爆炸",
  });
  form.toggle(color.white("是否允许岩浆或燃烧"), {
    defaultValue: _myLand.public_auth.burn,
    tooltip: "是否允许岩浆或燃烧",
  });
  form.toggle(color.white("告示牌是否公开"), {
    defaultValue: _myLand.public_auth.useSign,
    tooltip: "是否允许玩家使用告示牌",
  });
  form.toggle(color.white("锻造类方块是否公开"), {
    defaultValue: _myLand.public_auth.useSmelting,
    tooltip: "是否允许玩家使用锻造台、熔炉等方块",
  });
  form.toggle(color.white("红石类方块是否公开"), {
    defaultValue: _myLand.public_auth.useRedstone,
    tooltip: "是否允许玩家使用红石相关方块",
  });
  form.toggle(color.white("攻击中立生物权限"), {
    defaultValue: _myLand.public_auth.attackNeutralMobs ?? false,
    tooltip: "是否允许玩家攻击领地内的中立生物",
  });

  form.submitButton("确认");

  form.show(player).then((data) => {
    const { formValues, cancelationReason } = data;
    if (cancelationReason === "UserClosed") return;

    const public_auth = {
      break: formValues?.[0] as boolean,
      place: formValues?.[1] as boolean,
      useBlock: formValues?.[2] as boolean,
      isChestOpen: formValues?.[3] as boolean,
      useButton: formValues?.[4] as boolean,
      useEntity: formValues?.[5] as boolean,
      explode: formValues?.[6] as boolean,
      burn: formValues?.[7] as boolean,
      useSign: formValues?.[8] as boolean,
      useSmelting: formValues?.[9] as boolean,
      useRedstone: formValues?.[10] as boolean,
      attackNeutralMobs: formValues?.[11] as boolean,
    };

    landManager.db.set(_myLand.name, {
      ..._myLand,
      public_auth,
    });

    openDialogForm(
      player,
      {
        title: "领地公开权限",
        desc: color.green("领地公开权限设置成功！"),
      },
      () => {
        openLandDetailForm(player, _myLand);
      }
    );
  });
}

// ==================== 领地成员管理 ====================

export function openLandMemberApplyForm(player: Player, _land: ILand): void {
  const form = new ModalFormData();
  const allPlayer = useAllPlayers();
  const allPlayerNames = allPlayer.map((player) => player.name);
  form.title("领地成员申请");

  form.dropdown(color.white("选择玩家"), allPlayerNames, {
    defaultValueIndex: 0,
    tooltip: "选择要添加到领地的玩家",
  });
  form.textField(color.white("或通过玩家名称添加（二选一，优先第二个）"), color.gray("输入玩家名称"), {
    defaultValue: "",
    tooltip: "如果列表中没有您要添加的玩家，可以直接输入玩家名称",
  });
  form.submitButton("确认");

  form.show(player).then((data) => {
    const { formValues, cancelationReason } = data;
    if (cancelationReason === "UserClosed") return;

    const selectPlayerName = allPlayer[Number(formValues?.[0])].name;
    const inputPlayerName = formValues?.[1] as string;

    const pn = inputPlayerName || selectPlayerName;

    if (pn) {
      const res = landManager.addMember(_land.name, pn);
      if (typeof res === "string") {
        openDialogForm(
          player,
          {
            title: "领地成员申请",
            desc: color.red(res),
          },
          () => {
            openLandMemberApplyForm(player, _land);
          }
        );
      } else {
        const targetPlayer = useAllPlayers().find((player) => player.name === pn);
        if (targetPlayer) {
          useNotify("chat", targetPlayer, `§a您已被 §e${player.name} §a添加到领地 §e${_land.name} §a成员中！`);
        }
        useNotify("chat", player, `§a玩家 §e${pn} §a已成功被添加到领地 §e${_land.name} §a成员中！`);
      }
    }
  });
}

export function openLandMemberDeleteForm(player: Player, _land: ILand): void {
  const form = new ModalFormData();
  form.title("领地成员删除");

  const allPlayerNames = _land.members;

  form.dropdown(color.white("选择玩家"), allPlayerNames);
  form.submitButton("确认");

  form.show(player).then((data) => {
    const { formValues, cancelationReason } = data;
    if (cancelationReason === "UserClosed") return;

    const selectPlayerName = allPlayerNames[Number(formValues?.[0])];

    if (selectPlayerName === _land.owner) {
      return openDialogForm(
        player,
        {
          title: "领地成员删除",
          desc: color.red("领地拥有者不能被移除！"),
        },
        () => {
          openLandMemberDeleteForm(player, _land);
        }
      );
    }

    if (selectPlayerName) {
      const targetPlayer = allPlayerNames.find((playerName) => playerName === selectPlayerName);
      if (!targetPlayer) {
        return openDialogForm(
          player,
          {
            title: "领地成员删除",
            desc: color.red("玩家不存在，请重新填写！"),
          },
          () => {
            openLandMemberDeleteForm(player, _land);
          }
        );
      }

      const res = landManager.removeMember(_land.name, targetPlayer);
      if (typeof res === "string") {
        openDialogForm(
          player,
          {
            title: "领地成员删除",
            desc: color.red(res),
          },
          () => {
            openLandMemberDeleteForm(player, _land);
          }
        );
      } else {
        useNotify("chat", player, `§a玩家 §e${targetPlayer} §a已成功被移除领地 §e${_land.name} §a成员！`);
      }
    } else {
      openDialogForm(
        player,
        {
          title: "领地成员删除",
          desc: color.red("表单未填写完整，请重新填写！"),
        },
        () => {
          openLandMemberDeleteForm(player, _land);
        }
      );
    }
  });
}

function createLandMemberForm(land: ILand): ActionFormData {
  const form = new ActionFormData();
  form.title("领地成员管理");

  const body = useFormatListInfo([
    {
      title: "领地成员",
      desc: "领地成员列表",
      list: land.members,
    },
  ]);

  form.body(body);

  const buttons = [
    {
      text: "添加成员",
      icon: "textures/icons/add",
    },
    {
      text: "删除成员",
      icon: "textures/icons/deny",
    },
    {
      text: "返回",
      icon: "textures/icons/back",
    },
  ];

  buttons.forEach((button) => {
    form.button(button.text, button.icon);
  });

  return form;
}

export function openLandMemberForm(player: Player, land: ILand): void {
  const form = createLandMemberForm(land);

  form.show(player).then((data) => {
    switch (data.selection) {
      case 0:
        openLandMemberApplyForm(player, land);
        break;
      case 1:
        openLandMemberDeleteForm(player, land);
        break;
      case 2:
        openLandDetailForm(player, land);
        break;
    }
  });
}

// ==================== 删除领地 ====================

export function openLandDeleteForm(player: Player, _land: ILand, isAdmin: boolean = false): void {
  const form = new ActionFormData();
  form.title("删除领地");
  form.body(color.red("删除领地后不可恢复，请谨慎操作！"));
  form.button("确认", "textures/icons/accept");
  form.button("取消", "textures/icons/deny");

  form.show(player).then((data) => {
    const { cancelationReason, selection } = data;
    if (cancelationReason === "UserClosed") return;

    if (selection === 0) {
      const res = landManager.removeLand(_land.name);
      if (typeof res === "string") {
        openDialogForm(
          player,
          {
            title: "删除领地",
            desc: color.red(res),
          },
          () => {
            openLandDetailForm(player, _land);
          }
        );
      } else {
        player.sendMessage(color.yellow(`领地 ${_land.name} 删除成功！`));
      }
    }
  });
}

export function openDeleteAllLandsConfirmForm(player: Player, targetPlayerName: string, returnForm?: () => void): void {
  openConfirmDialogForm(
    player,
    "删除所有领地",
    `是否确定删除玩家 ${color.yellow(targetPlayerName)} 的所有领地？\n${color.red("此操作不可恢复！")}`,
    () => {
      const count = landManager.deletePlayerLands(targetPlayerName);
      openDialogForm(
        player,
        {
          title: "删除成功",
          desc: color.green(`已成功删除玩家 ${targetPlayerName} 的 ${count} 个领地！`),
        },
        returnForm
      );
    },
    returnForm
  );
}

// ==================== 领地转让 ====================

export function openLandTransferForm(player: Player, _land: ILand): void {
  const form = new ModalFormData();
  form.title("领地转让");

  const allPlayer = useAllPlayers();
  const allPlayerNames = allPlayer.map((player) => player.name);

  form.dropdown(color.white("选择玩家"), allPlayerNames);
  form.submitButton("确认");

  form.show(player).then((data) => {
    const { formValues, cancelationReason } = data;
    if (cancelationReason === "UserClosed") return;

    const selectPlayerName = allPlayer[Number(formValues?.[0])].name;

    if (selectPlayerName) {
      const res = landManager.transferLand(_land.name, selectPlayerName);
      if (typeof res === "string") {
        openDialogForm(
          player,
          {
            title: "领地转让失败",
            desc: color.red(res),
          },
          () => {
            openLandTransferForm(player, _land);
          }
        );
      } else {
        player.sendMessage(color.yellow(`领地 ${_land.name} 转让成功！`));
      }
    } else {
      openDialogForm(
        player,
        {
          title: "领地转让",
          desc: color.red("表单未填写完整，请重新填写！"),
        },
        () => {
          openLandTransferForm(player, _land);
        }
      );
    }
  });
}

// ==================== 领地配置权限 ====================

export function openLandAuthConfigForm(player: Player, _land: ILand): void {
  const form = new ModalFormData();
  form.title("领地公开权限的配置权限");

  form.toggle(color.white("是否允许成员配置 破坏权限"), {
    defaultValue: _land.config_public_auth?.break ?? false,
    tooltip: "设置是否允许成员修改领地内的破坏权限设置",
  });
  form.toggle(color.white("是否允许成员配置 放置权限"), {
    defaultValue: _land.config_public_auth?.place ?? false,
    tooltip: "设置是否允许成员修改领地内的方块放置权限设置",
  });
  form.toggle(color.white("是否允许成员配置 功能性方块权限"), {
    defaultValue: _land.config_public_auth?.useBlock ?? false,
    tooltip: "设置是否允许成员修改领地内的功能性方块使用权限设置",
  });
  form.toggle(color.white("是否允许成员配置 箱子是否公开"), {
    defaultValue: _land.config_public_auth?.isChestOpen ?? false,
    tooltip: "设置是否允许成员修改领地内的箱子访问权限设置",
  });
  form.toggle(color.white("是否允许成员配置 按钮是否公开"), {
    defaultValue: _land.config_public_auth?.useButton ?? false,
    tooltip: "设置是否允许成员修改领地内的按钮使用权限设置",
  });
  form.toggle(color.white("是否允许成员配置 实体是否允许交互"), {
    defaultValue: _land.config_public_auth?.useEntity ?? false,
    tooltip: "设置是否允许成员修改领地内的实体交互权限设置",
  });
  form.toggle(color.white("是否允许成员配置 爆炸"), {
    defaultValue: _land.config_public_auth?.explode ?? false,
    tooltip: "设置是否允许成员修改领地内的爆炸保护设置",
  });
  form.toggle(color.white("是否允许成员配置 岩浆或燃烧"), {
    defaultValue: _land.config_public_auth?.burn ?? false,
    tooltip: "设置是否允许成员修改领地内的燃烧保护设置",
  });
  form.toggle(color.white("是否允许成员配置 告示牌是否公开"), {
    defaultValue: _land.config_public_auth?.useSign ?? false,
    tooltip: "设置是否允许成员修改领地内的告示牌使用权限设置",
  });
  form.toggle(color.white("是否允许成员配置 锻造类方块是否公开"), {
    defaultValue: _land.config_public_auth?.useSmelting ?? false,
    tooltip: "设置是否允许成员修改领地内的锻造台、熔炉等方块使用权限设置",
  });
  form.toggle(color.white("是否允许成员配置 红石类方块是否公开"), {
    defaultValue: _land.config_public_auth?.useRedstone ?? false,
    tooltip: "设置是否允许成员修改领地内的红石相关方块使用权限设置",
  });
  form.toggle(color.white("是否允许成员配置 攻击中立生物权限"), {
    defaultValue: _land.config_public_auth?.attackNeutralMobs ?? false,
    tooltip: "设置是否允许成员修改领地内的攻击生物权限设置",
  });
  form.submitButton("确认");

  form.show(player).then((data) => {
    const { formValues, cancelationReason } = data;
    if (cancelationReason === "UserClosed") return;

    const config_public_auth = {
      break: formValues?.[0] as boolean,
      place: formValues?.[1] as boolean,
      useBlock: formValues?.[2] as boolean,
      isChestOpen: formValues?.[3] as boolean,
      useButton: formValues?.[4] as boolean,
      useEntity: formValues?.[5] as boolean,
      explode: formValues?.[6] as boolean,
      burn: formValues?.[7] as boolean,
      useSign: formValues?.[8] as boolean,
      useSmelting: formValues?.[9] as boolean,
      useRedstone: formValues?.[10] as boolean,
      attackNeutralMobs: formValues?.[11] as boolean,
    };

    landManager.db.set(_land.name, {
      ..._land,
      config_public_auth: config_public_auth as any,
    });

    openDialogForm(
      player,
      {
        title: "领地公开权限的配置权限",
        desc: color.green("领地公开权限的配置权限设置成功！"),
      },
      () => {
        openLandDetailForm(player, _land);
      }
    );
  });
}

// ==================== 领地详情 ====================

export const openLandDetailForm = (
  player: Player,
  landData: ILand,
  isAdmin: boolean = false,
  returnForm?: () => void
): void => {
  const form = new ActionFormData();
  form.title("领地详细");
  const isOwner = landData.owner === player.name;

  const buttons = [
    {
      text: "领地公开权限",
      icon: "textures/icons/party_remove",
      action: () => openLandAuthForm(player, landData),
    },
  ];

  if (isOwner || isAdmin) {
    const actions = [
      {
        text: "领地成员管理",
        icon: "textures/icons/party_unavailable",
        action: () => openLandMemberForm(player, landData),
      },
      {
        text: "领地转让",
        icon: "textures/icons/quest_daily_common",
        action: () => openLandTransferForm(player, landData),
      },
      {
        text: "领地公开权限的配置权限",
        icon: "textures/icons/party_invites",
        action: () => openLandAuthConfigForm(player, landData),
      },
      {
        text: "删除领地",
        icon: "textures/icons/copkutusu",
        action: () => openLandDeleteForm(player, landData, isAdmin),
      },
    ];
    buttons.push(...actions);
  }

  buttons.push({
    text: "返回",
    icon: "textures/icons/back",
    action: () => {
      if (returnForm) returnForm();
      else if (isAdmin) openAllPlayerLandManageForm(player);
      else openLandListForm(player);
    },
  });

  buttons.forEach((button) => {
    form.button(button.text, button.icon);
  });

  form.body(
    useFormatListInfo([
      {
        title: "领地信息",
        desc: "",
        list: [
          "领地名称: " + color.yellow(landData.name),
          "领地坐标: " +
            color.yellow(
              landData.vectors.start.x +
                " " +
                landData.vectors.start.y +
                " " +
                landData.vectors.start.z +
                " -> " +
                landData.vectors.end.x +
                " " +
                landData.vectors.end.y +
                " " +
                landData.vectors.end.z
            ),
        ],
      },
      { title: "领地主人", desc: landData.owner, list: [] },
      { title: "领地成员", desc: landData.members.join("、 "), list: [] },
    ])
  );

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) {
      if (returnForm) returnForm();
      return;
    }
    if (data.selection === null || data.selection === undefined) return;
    buttons[data.selection].action();
  });
};

// ==================== 领地列表 ====================

function createLandListForm(): ActionFormData {
  const form = new ActionFormData();
  form.title("领地列表");
  form.body({
    rawtext: [
      {
        text: "",
      },
    ],
  });
  return form;
}

export function openLandListForm(player: Player, isAdmin: boolean = false, page: number = 1): void {
  const form = createLandListForm();
  const ll = landManager.getLandList();
  const myLands: ILand[] = [];

  for (const key in ll) {
    const landData = ll[key];
    if (landData.owner === player.name || isAdmin || landData.members.includes(player.name)) {
      myLands.push(landData);
    }
  }

  if (myLands.length === 0) {
    openDialogForm(
      player,
      {
        title: "领地列表",
        desc: color.red("您还没有领地，请先创建领地！"),
      },
      () => {
        openLandManageForms(player);
      }
    );
  } else {
    const totalPages = Math.ceil(myLands.length / 10);
    const start = (page - 1) * 10;
    const end = start + 10;
    const currentPageLands = myLands.slice(start, end);

    currentPageLands.forEach((landData) => {
      form.button(
        `${landData.name} ${
          isAdmin ? landData.owner : landData.owner === player.name ? "（个人领地）" : "（他人领地）"
        }`,
        "textures/icons/island"
      );
    });
    form.body(`第 ${page} 页 / 共 ${totalPages} 页`);

    let previousButtonIndex = currentPageLands.length;
    let nextButtonIndex = currentPageLands.length;

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

      const currentPageLandsCount = currentPageLands.length;

      if (selectionIndex < currentPageLandsCount) {
        openLandDetailForm(player, currentPageLands[selectionIndex], isAdmin);
      } else if (selectionIndex === previousButtonIndex - 1 && page > 1) {
        openLandListForm(player, isAdmin, page - 1);
      } else if (selectionIndex === nextButtonIndex - 1 && page < totalPages) {
        openLandListForm(player, isAdmin, page + 1);
      } else if (selectionIndex === nextButtonIndex) {
        openLandManageForms(player);
      }
    });
  }
}

// ==================== 领地管理主菜单 ====================

function createLandManageForm(): ActionFormData {
  const form = new ActionFormData();
  form.title("§w领地管理");

  const buttons = [
    {
      text: "§w领地列表",
      icon: "textures/icons/home",
    },
    {
      text: "§w领地申请",
      icon: "textures/icons/ada",
    },
    {
      text: "§w返回",
      icon: "textures/icons/back",
    },
  ];

  buttons.forEach((button) => {
    form.button(button.text, button.icon);
  });

  return form;
}

export function openLandManageForms(player: Player): void {
  const form = createLandManageForm();

  form.show(player).then((data) => {
    switch (data.selection) {
      case 0:
        openLandListForm(player);
        break;
      case 1:
        openLandApplyForm(player);
        break;
      case 2:
        openServerMenuForm(player);
        break;
    }
  });
}

// ==================== 玩家领地列表（管理员用） ====================

export const openPlayerLandListForm = (
  player: Player,
  targetPlayerName: string,
  page: number = 1,
  isAdmin: boolean = false,
  returnForm?: () => void
): void => {
  const form = new ActionFormData();
  form.title(`${color.blue(targetPlayerName)}的领地列表`);

  const playerLands = Object.values(landManager.getLandList()).filter((l) => l.owner === targetPlayerName);

  const pageSize = 10;
  const totalPages = Math.ceil(playerLands.length / pageSize);
  const start = (page - 1) * pageSize;
  const end = Math.min(start + pageSize, playerLands.length);
  const currentPageLands = playerLands.slice(start, end);

  currentPageLands.forEach((landData) => {
    form.button(
      `${landData.name}\n${getDimensionName(landData.dimension)} (${landData.vectors.start.x}, ${
        landData.vectors.start.y
      }, ${landData.vectors.start.z})`,
      "textures/icons/home"
    );
  });

  let previousButtonIndex = currentPageLands.length;
  let nextButtonIndex = currentPageLands.length;

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
  if (isAdmin && playerLands.length > 0) {
    form.button("§c一键删除所有领地", "textures/icons/copkutusu");
    deleteButtonIndex = nextButtonIndex;
    nextButtonIndex++;
  }

  form.button("§w返回", "textures/icons/back");
  form.body(`第 ${page} 页 / 共 ${totalPages} 页\n§7总计: ${playerLands.length} 个领地`);

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    const selectionIndex = data.selection;
    if (selectionIndex === null || selectionIndex === undefined) return;

    const currentPageLandsCount = currentPageLands.length;

    if (selectionIndex < currentPageLandsCount) {
      openLandDetailForm(player, currentPageLands[selectionIndex], isAdmin, () =>
        openPlayerLandListForm(player, targetPlayerName, page, isAdmin, returnForm)
      );
    } else if (selectionIndex === previousButtonIndex - 1 && page > 1) {
      openPlayerLandListForm(player, targetPlayerName, page - 1, isAdmin, returnForm);
    } else if (selectionIndex === nextButtonIndex - 1 && page < totalPages && deleteButtonIndex === -1) {
      openPlayerLandListForm(player, targetPlayerName, page + 1, isAdmin, returnForm);
    } else if (selectionIndex === nextButtonIndex - 2 && page < totalPages && deleteButtonIndex !== -1) {
      openPlayerLandListForm(player, targetPlayerName, page + 1, isAdmin, returnForm);
    } else if (isAdmin && deleteButtonIndex !== -1 && selectionIndex === deleteButtonIndex) {
      openDeleteAllLandsConfirmForm(player, targetPlayerName, () =>
        openPlayerLandListForm(player, targetPlayerName, page, isAdmin, returnForm)
      );
    } else {
      if (returnForm) returnForm();
    }
  });
};

// ==================== 搜索玩家领地 ====================

export const openSearchLandForm = (player: Player, returnForm?: () => void): void => {
  const onlinePlayers = world.getPlayers();
  const playerNames = onlinePlayers.map((p) => p.name);

  if (playerNames.length === 0) {
    // 没有在线玩家，只显示文本输入框
    const form = new ModalFormData();
    form.title("搜索玩家领地");
    form.textField("玩家名称", "请输入要搜索的玩家名称");
    form.submitButton("搜索");

    form.show(player).then((data) => {
      if (data.cancelationReason) return;
      const { formValues } = data;
      if (formValues?.[0]) {
        const playerName = formValues[0].toString().trim();
        if (playerName) {
          const playerLands = Object.values(landManager.getLandList()).filter((l) => l.owner === playerName);
          if (playerLands.length === 0) {
            openDialogForm(
              player,
              {
                title: "搜索结果",
                desc: color.red("未找到该玩家的领地或该玩家不存在"),
              },
              () => openSearchLandForm(player, returnForm)
            );
          } else {
            openPlayerLandListForm(player, playerName, 1, true, () => openSearchLandForm(player, returnForm));
          }
        }
      }
    });
  } else {
    // 有在线玩家，显示下拉框和文本输入框
    const form = new ModalFormData();
    form.title("搜索玩家领地");
    form.dropdown("选择在线玩家", ["-- 不选择 --", ...playerNames], {
      defaultValueIndex: 0,
    });
    form.textField("或直接输入玩家名称（二选一，优先使用输入）", "输入玩家名称", {
      defaultValue: "",
    });
    form.submitButton("搜索");

    form.show(player).then((data) => {
      if (data.cancelationReason) return;
      const { formValues } = data;

      let playerName = "";
      const selectedIndex = formValues?.[0] as number;
      const inputName = formValues?.[1] as string;

      // 优先使用文本输入，如果为空则使用下拉框选择
      if (inputName && inputName.trim() !== "") {
        playerName = inputName.trim();
      } else if (selectedIndex > 0) {
        playerName = playerNames[selectedIndex - 1];
      }

      if (playerName) {
        const playerLands = Object.values(landManager.getLandList()).filter((l) => l.owner === playerName);
        if (playerLands.length === 0) {
          openDialogForm(
            player,
            {
              title: "搜索结果",
              desc: color.red("未找到该玩家的领地或该玩家不存在"),
            },
            () => openSearchLandForm(player, returnForm)
          );
        } else {
          openPlayerLandListForm(player, playerName, 1, true, () => {
            if (returnForm) {
              returnForm();
            } else {
              openSystemSettingForm(player);
            }
          });
        }
      } else {
        openDialogForm(
          player,
          {
            title: "搜索错误",
            desc: color.red("请选择在线玩家或输入玩家名称"),
          },
          () => openSearchLandForm(player, returnForm)
        );
      }
    });
  }
};

// ==================== 所有玩家领地管理 ====================

export const openAllPlayerLandManageForm = (player: Player, page: number = 1, returnForm?: () => void): void => {
  const form = new ActionFormData();
  form.title("§w玩家领地管理");

  const players = landManager.getLandPlayers();

  const pageSize = 10;
  const totalPages = Math.ceil(players.length / pageSize);
  const start = (page - 1) * pageSize;
  const end = Math.min(start + pageSize, players.length);
  const currentPagePlayers = players.slice(start, end);

  currentPagePlayers.forEach((playerName) => {
    const playerLands = Object.values(landManager.getLandList()).filter((l) => l.owner === playerName);
    form.button(
      `${color.blue(playerName)} 的所有领地\n${color.darkPurple("领地数量:")} ${playerLands.length}`,
      "textures/icons/uye"
    );
  });

  let previousButtonIndex = currentPagePlayers.length;
  let nextButtonIndex = currentPagePlayers.length;

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
  form.body(`第 ${page} 页 / 共 ${totalPages} 页`);

  form.show(player).then(async (data) => {
    if (data.canceled || data.cancelationReason) return;
    const selectionIndex = data.selection;
    if (selectionIndex === null || selectionIndex === undefined) return;

    const currentPagePlayersCount = currentPagePlayers.length;
    const playerIndex = selectionIndex;

    if (playerIndex >= 0 && playerIndex < currentPagePlayersCount) {
      const selectedPlayer = currentPagePlayers[playerIndex];
      openPlayerLandListForm(player, selectedPlayer, 1, true, () =>
        openAllPlayerLandManageForm(player, page, returnForm)
      );
    } else if (selectionIndex === previousButtonIndex - 1 && page > 1) {
      openAllPlayerLandManageForm(player, page - 1, returnForm);
    } else if (selectionIndex === nextButtonIndex - 1 && page < totalPages) {
      openAllPlayerLandManageForm(player, page + 1, returnForm);
    } else {
      if (returnForm) {
        returnForm();
      } else {
        openSystemSettingForm(player);
      }
    }
  });
};
