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
import guildService from "../../../features/guild/services/guild-service";
import setting from "../../../features/system/services/setting";
import {
  tryStartLandFlightSession,
  canShowLandFlightEntry,
  getSecondsUntilNextLandFlightBilling,
  isPlayerStandingOnLand,
} from "../../../features/land/services/land-flight";
import { openSystemSettingForm } from "../system";
import { formatDateTime } from "../../../shared/utils/format";
import { isAdmin } from "../../../shared/utils/common";

/** 从公会菜单「纯公会圈地」创建时传入，写入 ILand.guildId */
export type GuildLandApplyContext = {
  guildId: string;
  onSuccess?: () => void;
  /** 在说明页点「返回」时回调（例如回到公会领地子菜单） */
  onCancel?: () => void;
};

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

function buildGuildLandApplyInfoBody(guildId: string): string {
  const rawCost = Number(setting.getState("guildTreasuryCostLandCreate" as never));
  const costN = Number.isFinite(rawCost) && rawCost > 0 ? Math.floor(rawCost) : 0;
  const g = guildService.getGuildById(guildId);
  const treasury = g?.treasuryGold ?? 0;
  const bodyLines: string[] = [];
  if (costN > 0) {
    bodyLines.push(`${color.white("创建费用：")}${color.gold(`从公会金库扣除 ${costN} 金币`)}`);
  } else {
    bodyLines.push(color.gray("创建公会领地：金库不扣费（费用为 0）。"));
  }
  bodyLines.push(`${color.white("公会金库余额：")}${color.yellow(String(treasury))}`);
  bodyLines.push(color.gray("不按个人方块费扣个人金币；成功后为本会公会领地，不占个人领地上限。"));
  bodyLines.push("");
  bodyLines.push(color.darkGray("点「继续」后填写领地名称与坐标。"));
  return bodyLines.join("\n");
}

function createLandApplyForm(player: Player, guildApply?: GuildLandApplyContext): ModalFormData {
  const form = new ModalFormData();
  form.title(guildApply?.guildId ? "§w创建公会领地" : "领地申请");

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
  form.toggle(color.white("设置传送点（使用当前位置）"), {
    defaultValue: false,
    tooltip: "是否将当前位置设置为领地传送点，可在领地详细界面传送回领地",
  });
  form.submitButton("确认");

  return form;
}

/** 解析 ModalForm：按类型收集，避免 body/label 等导致下标错位 */
function extractLandApplyFields(
  formValues: (string | number | boolean | undefined)[] | undefined
): { landName: string; landStartPos: string; landEndPos: string; setTeleportPoint: boolean } | null {
  if (!formValues) return null;
  const strings = formValues.filter((x): x is string => typeof x === "string");
  const bools = formValues.filter((x): x is boolean => typeof x === "boolean");
  const landName = strings[0]?.trim() ?? "";
  const landStartPos = strings[1]?.trim() ?? "";
  const landEndPos = strings[2]?.trim() ?? "";
  const setTeleportPoint = bools[bools.length - 1] ?? false;
  if (!landName || !landStartPos || !landEndPos) return null;
  return { landName, landStartPos, landEndPos, setTeleportPoint };
}

function validateForm(
  landStartPos: string,
  landEndPos: string,
  player: Player,
  guildApply?: GuildLandApplyContext
): boolean {
  if (landStartPos && landEndPos) {
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
          openLandApplyModalOnly(player, guildApply);
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
          openLandApplyModalOnly(player, guildApply);
        }
      );
      return false;
    }

    return true;
  }
  openDialogForm(
    player,
    {
      title: "领地创建错误",
      desc: color.red("表单未填写完整，请重新填写！"),
    },
    () => {
      openLandApplyModalOnly(player, guildApply);
    }
  );
  return false;
}

function openLandApplyModalOnly(player: Player, guildApply?: GuildLandApplyContext): void {
  const form = createLandApplyForm(player, guildApply);

  form.show(player).then(async (data) => {
    const { formValues, cancelationReason } = data;
    if (data.canceled || cancelationReason) {
      return;
    }

    const extracted = extractLandApplyFields(formValues);
    if (extracted) {
      const { landName, landStartPos, landEndPos, setTeleportPoint } = extracted;

      if (validateForm(landStartPos, landEndPos, player, guildApply)) {
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
            allowEnter: true,
            allowWater: true,
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
            allowEnter: false,
            allowWater: false,
          },
          vectors: {
            start: landStartPosVector3 as Vector3,
            end: landEndPosVector3 as Vector3,
          },
          createdAt: Date.now(),
          // 如果选择了设置传送点，使用当前位置
          teleportPoint: setTeleportPoint
            ? {
                x: Math.round(player.location.x),
                y: Math.round(player.location.y),
                z: Math.round(player.location.z),
              }
            : undefined,
        };

        if (guildApply?.guildId) {
          landData.guildId = guildApply.guildId;
          landData.members = [];
        }

        // 如果设置了传送点，先检查是否在领地范围内
        if (setTeleportPoint) {
          const teleportPoint = {
            x: Math.round(player.location.x),
            y: Math.round(player.location.y),
            z: Math.round(player.location.z),
          };
          const tempLand: ILand = {
            ...landData,
            vectors: {
              start: landStartPosVector3 as Vector3,
              end: landEndPosVector3 as Vector3,
            },
          };
          if (!landManager.isLocationInLand(teleportPoint, tempLand)) {
            openDialogForm(
              player,
              {
                title: "领地创建错误",
                desc: color.red("当前位置不在领地范围内！\n请确保您站在要创建的领地范围内，或取消设置传送点选项"),
              },
              () => {
                openLandApplyModalOnly(player, guildApply);
              }
            );
            return;
          }
        }

        const res = await landManager.createLand(landData);
        if (typeof res === "string") {
          openDialogForm(
            player,
            {
              title: "领地创建错误",
              desc: color.red(res),
            },
            () => {
              openLandApplyModalOnly(player, guildApply);
            }
          );
        } else {
          if (guildApply?.guildId) {
            player.sendMessage(color.gold(`公会领地 ${landName} 创建成功！`));
            player.sendMessage(color.gray("该地块已登记为本会领地，不占个人领地上限。"));
          } else {
            player.sendMessage(color.yellow(`领地 ${landName} 创建成功！`));
          }
          if (setTeleportPoint) {
            player.sendMessage(color.green("已设置领地传送点，可在领地详细界面传送回领地"));
          }
          landAreas.delete(player.name);
          guildApply?.onSuccess?.();
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
          openLandApplyModalOnly(player, guildApply);
        }
      );
    }
  });
}

/** 领地申请：公会圈地先 ActionForm 展示金库费用与余额（body），再打开 Modal 填写 */
export function openLandApplyForm(player: Player, guildApply?: GuildLandApplyContext): void {
  if (guildApply?.guildId) {
    const info = new ActionFormData();
    info.title("§w创建公会领地");
    info.body(buildGuildLandApplyInfoBody(guildApply.guildId));
    info.button("§w继续填写", "textures/icons/ada");
    info.button("§w返回", "textures/icons/back");
    info.show(player).then((data) => {
      if (data.canceled || data.cancelationReason) {
        return;
      }
      if (data.selection === 0) {
        openLandApplyModalOnly(player, guildApply);
      } else if (data.selection === 1) {
        guildApply.onCancel?.();
      }
    });
    return;
  }
  openLandApplyModalOnly(player, undefined);
}

// ==================== 领地权限设置 ====================

export function openLandAuthForm(player: Player, myLand: ILand, reopenDetail?: () => void): void {
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
  form.toggle(color.white("是否允许玩家进入你的领地"), {
    defaultValue: _myLand.public_auth.allowEnter ?? true,
    tooltip: "如果关闭，非领地成员进入领地时会被自动传送出去",
  });
  form.toggle(color.white("是否允许领地里有水"), {
    defaultValue: _myLand.public_auth.allowWater ?? true,
    tooltip: "如果关闭，领地内的水方块会被自动清除（类似岩浆）",
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
      allowEnter: (formValues?.[12] as boolean) ?? true,
      allowWater: (formValues?.[13] as boolean) ?? true,
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
        if (reopenDetail) reopenDetail();
        else {
          const fresh = landManager.getLand(_myLand.name);
          if (typeof fresh !== "string") openLandDetailForm(player, fresh);
        }
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

export function openLandDeleteForm(
  player: Player,
  _land: ILand,
  isAdmin: boolean = false,
  opts?: { afterSuccess?: () => void; reopenDetail?: () => void }
): void {
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
            if (opts?.reopenDetail) opts.reopenDetail();
            else openLandDetailForm(player, _land, isAdmin);
          }
        );
      } else {
        player.sendMessage(color.yellow(`领地 ${_land.name} 删除成功！`));
        if (opts?.afterSuccess) opts.afterSuccess();
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
  form.toggle(color.white("是否允许成员配置 是否允许玩家进入你的领地"), {
    defaultValue: _land.config_public_auth?.allowEnter ?? false,
    tooltip: "设置是否允许成员修改领地内的玩家进入权限设置",
  });
  form.toggle(color.white("是否允许成员配置 是否允许领地里有水"), {
    defaultValue: _land.config_public_auth?.allowWater ?? false,
    tooltip: "设置是否允许成员修改领地内的水权限设置",
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
      allowEnter: (formValues?.[12] as boolean) ?? false,
      allowWater: (formValues?.[13] as boolean) ?? true,
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

// ==================== 领地传送点设置 ====================

export function openLandTeleportPointForm(player: Player, _land: ILand, returnToDetail?: () => void): void {
  const form = new ActionFormData();
  form.title("领地传送点设置");

  const reopenDetail = () => {
    if (returnToDetail) returnToDetail();
    else {
      const fresh = landManager.getLand(_land.name);
      if (typeof fresh !== "string") openLandDetailForm(player, fresh);
    }
  };

  const buttons = [
    {
      text: "使用当前位置设置传送点",
      icon: "textures/icons/uye",
      action: () => {
        const res = landManager.setTeleportPoint(_land.name, player.location);
        if (typeof res === "string") {
          openDialogForm(
            player,
            {
              title: "设置传送点",
              desc: color.red(res),
            },
            () => openLandTeleportPointForm(player, _land, returnToDetail)
          );
        } else {
          openDialogForm(
            player,
            {
              title: "设置传送点",
              desc: color.green(
                `传送点已设置为: ${Math.round(player.location.x)}, ${Math.round(player.location.y)}, ${Math.round(player.location.z)}`
              ),
            },
            reopenDetail
          );
        }
      },
    },
  ];

  if (_land.teleportPoint) {
    buttons.push({
      text: "删除传送点",
      icon: "textures/icons/copkutusu",
      action: () => {
        const res = landManager.removeTeleportPoint(_land.name);
        if (typeof res === "string") {
          openDialogForm(
            player,
            {
              title: "删除传送点",
              desc: color.red(res),
            },
            () => openLandTeleportPointForm(player, _land, returnToDetail)
          );
        } else {
          openDialogForm(
            player,
            {
              title: "删除传送点",
              desc: color.green("传送点已删除"),
            },
            reopenDetail
          );
        }
      },
    });
  }

  buttons.push({
    text: "返回",
    icon: "textures/icons/back",
    action: reopenDetail,
  });

  buttons.forEach((button) => {
    form.button(button.text, button.icon);
  });

  const currentPoint = _land.teleportPoint
    ? `${_land.teleportPoint.x}, ${_land.teleportPoint.y}, ${_land.teleportPoint.z}`
    : "未设置";

  form.body(
    useFormatListInfo([
      {
        title: "当前传送点",
        desc: currentPoint,
        list: [],
      },
      {
        title: "当前位置",
        desc: `${Math.round(player.location.x)}, ${Math.round(player.location.y)}, ${Math.round(player.location.z)}`,
        list: [],
      },
    ])
  );

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) {
      reopenDetail();
      return;
    }
    if (data.selection === null || data.selection === undefined) return;
    buttons[data.selection].action();
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
  const canAccess = isOwner || isAdmin || landManager.isPlayerTrustedOnLand(landData, player.name);
  const isGuildLand = setting.getState("guild") === true && !!landData.guildId;

  const reopenDetail = () => {
    const fresh = landManager.getLand(landData.name);
    if (typeof fresh !== "string") openLandDetailForm(player, fresh, isAdmin, returnForm);
  };

  /** 公会领地：会长/副会长或管理员可管理传送点与删除 */
  const canManageGuildLand =
    isGuildLand && (guildService.canOfficerManageGuildLand(player, landData) || isAdmin);

  type Btn = { text: string; icon: string; action: () => void };
  const buttons: Btn[] = [];

  if (isGuildLand) {
    if (landData.teleportPoint && canAccess) {
      buttons.push({
        text: "传送回领地",
        icon: "textures/icons/durbun",
        action: () => {
          const res = landManager.teleportToLand(player, landData.name);
          if (typeof res === "string") {
            useNotify("chat", player, color.red(res));
          }
        },
      });
    }

    // 管理员从「领地系统管理 → 公会领地（管理员）」进入时不展示：已有飞行权限，无需限时领地飞行入口
    if (
      !isAdmin &&
      canAccess &&
      canShowLandFlightEntry(player) &&
      isPlayerStandingOnLand(player, landData.name)
    ) {
      buttons.push({
        text: "领地飞行（限时）",
        icon: "textures/icons/ada",
        action: () => {
          const err = tryStartLandFlightSession(player);
          if (typeof err === "string") {
            openDialogForm(
              player,
              { title: "领地飞行", desc: err },
              () => openLandDetailForm(player, landData, isAdmin, returnForm)
            );
          } else {
            openDialogForm(
              player,
              { title: "领地飞行", desc: color.green("已尝试开启，请查看聊天提示。") },
              () => openLandDetailForm(player, landData, isAdmin, returnForm)
            );
          }
        },
      });
    }

    if (canManageGuildLand) {
      buttons.push({
        text: landData.teleportPoint ? "修改传送点" : "设置传送点",
        icon: "textures/icons/ada",
        action: () => openLandTeleportPointForm(player, landData, reopenDetail),
      });
      buttons.push({
        text: "删除领地",
        icon: "textures/icons/copkutusu",
        action: () =>
          openLandDeleteForm(player, landData, isAdmin, {
            afterSuccess: () => {
              if (returnForm) returnForm();
              else openLandListForm(player);
            },
            reopenDetail,
          }),
      });
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

    const g = landData.guildId ? guildService.getGuildById(landData.guildId) : undefined;
    const infoList: string[] = [
      "领地名称: " + color.yellow(landData.name),
      "创建人: " + color.yellow(landData.owner),
      "创建时间: " + color.yellow(formatDateTime(landData.createdAt)),
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
    ];

    if (landData.teleportPoint) {
      infoList.push(
        "传送点: " + color.yellow(`${landData.teleportPoint.x}, ${landData.teleportPoint.y}, ${landData.teleportPoint.z}`)
      );
    } else {
      infoList.push("传送点: " + color.gray("未设置"));
    }

    infoList.push(
      "所属公会: " +
        (g ? color.green(`[${g.tag}] ${g.name}`) : color.gray("（公会数据异常）"))
    );
    infoList.push(color.gray("公会成员均视为可信，不单独维护领地成员名单。"));

    form.body(
      useFormatListInfo([
        {
          title: "公会领地信息",
          desc: "",
          list: infoList,
        },
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
    return;
  }

  const reopenDetailAfterAuth = () => {
    const fresh = landManager.getLand(landData.name);
    if (typeof fresh !== "string") openLandDetailForm(player, fresh, isAdmin, returnForm);
  };

  buttons.push({
    text: "领地公开权限",
    icon: "textures/icons/party_remove",
    action: () => openLandAuthForm(player, landData, reopenDetailAfterAuth),
  });

  if (landData.teleportPoint && canAccess) {
    buttons.push({
      text: "传送回领地",
      icon: "textures/icons/durbun",
      action: () => {
        const res = landManager.teleportToLand(player, landData.name);
        if (typeof res === "string") {
          useNotify("chat", player, color.red(res));
        }
      },
    });
  }

  if (
    canAccess &&
    canShowLandFlightEntry(player) &&
    isPlayerStandingOnLand(player, landData.name)
  ) {
    buttons.push({
      text: "领地飞行（限时）",
      icon: "textures/icons/ada",
      action: () => {
        const err = tryStartLandFlightSession(player);
        if (typeof err === "string") {
          openDialogForm(
            player,
            { title: "领地飞行", desc: err },
            () => openLandDetailForm(player, landData, isAdmin, returnForm)
          );
        } else {
          openDialogForm(
            player,
            { title: "领地飞行", desc: color.green("已尝试开启，请查看聊天提示。") },
            () => openLandDetailForm(player, landData, isAdmin, returnForm)
          );
        }
      },
    });
  }

  if (isOwner || isAdmin) {
    const actions: Btn[] = [
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
        text: landData.teleportPoint ? "修改传送点" : "设置传送点",
        icon: "textures/icons/ada",
        action: () => openLandTeleportPointForm(player, landData, reopenDetail),
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

  const infoList = [
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
  ];

  if (landData.teleportPoint) {
    infoList.push(
      "传送点: " + color.yellow(`${landData.teleportPoint.x}, ${landData.teleportPoint.y}, ${landData.teleportPoint.z}`)
    );
  } else {
    infoList.push("传送点: " + color.gray("未设置"));
  }

  if (setting.getState("guild") === true) {
    if (landData.guildId) {
      const g = guildService.getGuildById(landData.guildId);
      infoList.push(
        "公会领地: " +
          (g ? color.green(`[${g.tag}] ${g.name}`) : color.gray("已登记（公会数据异常）")) +
          color.gray("（在「服务器菜单 → 公会 → 公会领地」管理）")
      );
    } else {
      infoList.push("公会领地: " + color.gray("仅可在公会菜单内创建公会领地"));
    }
  }

  form.body(
    useFormatListInfo([
      {
        title: "领地信息",
        desc: "",
        list: infoList,
      },
      { title: "领地主人", desc: landData.owner, list: [] },
      { title: "领地成员", desc: landData.members.join("、 ") || "无", list: [] },
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
    if (landData.guildId) continue;
    if (landData.owner === player.name || isAdmin || landManager.isPlayerTrustedOnLand(landData, player.name)) {
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

// ==================== 领地系统管理主菜单（服务器菜单 → 领地） ====================

function buildLandFlightButtonLabel(player: Player): string {
  const intervalSec = Number(setting.getState("landFlightBillingIntervalSec")) || 60;
  const useEco = setting.getState("landFlightUseEconomy") === true;
  const economyOn = setting.getState("economy") === true;
  const gold = Number(setting.getState("landFlightGoldPerInterval")) || 0;
  const nextBill = getSecondsUntilNextLandFlightBilling(player);
  let sub = "";
  if (useEco && economyOn && gold > 0) {
    sub = `§b每 §e${intervalSec} §b秒扣 §e${gold} §b金币`;
  } else if (useEco && economyOn && gold === 0) {
    sub = `§3已开扣费但金额为 0（不扣钱）`;
  } else {
    sub = `§a免费飞行`;
  }
  if (nextBill !== null && nextBill > 0) {
    sub += ` §b| 约 §e${nextBill}s §b后下次扣费`;
  }
  sub += `\n§3仅在当前领地内有效，离开即收回`;
  return `§w领地飞行\n${sub}`;
}

export function openLandManageForms(player: Player): void {
  const form = new ActionFormData();
  form.title("§w领地系统管理");

  const buttons: { text: string; icon: string; action: () => void }[] = [];

  if (canShowLandFlightEntry(player)) {
    buttons.push({
      text: buildLandFlightButtonLabel(player),
      icon: "textures/icons/durbun",
      action: () => {
        const err = tryStartLandFlightSession(player);
        if (typeof err === "string") {
          openDialogForm(
            player,
            { title: "领地飞行", desc: err },
            () => openLandManageForms(player)
          );
        } else {
          openDialogForm(
            player,
            { title: "领地飞行", desc: color.green("已尝试开启，请查看聊天提示。") },
            () => openLandManageForms(player)
          );
        }
      },
    });
  }

  buttons.push(
    {
      text: "§w领地列表",
      icon: "textures/icons/home",
      action: () => openLandListForm(player),
    },
    {
      text: "§w领地申请",
      icon: "textures/icons/ada",
      action: () => openLandApplyForm(player),
    },
    {
      text: "§w返回",
      icon: "textures/icons/back",
      action: () => openServerMenuForm(player),
    }
  );

  buttons.forEach((b) => form.button(b.text, b.icon));

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    if (data.selection === null || data.selection === undefined) return;
    buttons[data.selection]?.action();
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

  const playerLands = Object.values(landManager.getLandList()).filter(
    (l) => l.owner === targetPlayerName && !l.guildId
  );

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
          const playerLands = Object.values(landManager.getLandList()).filter(
            (l) => l.owner === playerName && !l.guildId
          );
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
        const playerLands = Object.values(landManager.getLandList()).filter(
          (l) => l.owner === playerName && !l.guildId
        );
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

// ==================== 管理员：公会领地列表 ====================

/** 仅管理员：列出所有带 guildId 的领地，进入详情后可删改传送点等 */
export function openAdminGuildLandListForm(player: Player, page: number = 1, returnForm?: () => void): void {
  if (!isAdmin(player)) {
    openDialogForm(
      player,
      { title: "提示", desc: color.red("只有管理员可操作") },
      () => {
        if (returnForm) returnForm();
        else openSystemSettingForm(player);
      }
    );
    return;
  }

  const ll = landManager.getLandList();
  const guildLands: ILand[] = [];
  for (const key in ll) {
    const land = ll[key];
    if (land.guildId) guildLands.push(land);
  }

  guildLands.sort((a, b) => {
    const ta = guildService.getGuildById(a.guildId!)?.tag ?? "";
    const tb = guildService.getGuildById(b.guildId!)?.tag ?? "";
    const c = ta.localeCompare(tb, undefined, { sensitivity: "base" });
    if (c !== 0) return c;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  if (guildLands.length === 0) {
    openDialogForm(
      player,
      { title: "公会领地", desc: color.gray("当前没有公会领地数据。") },
      () => {
        if (returnForm) returnForm();
        else openSystemSettingForm(player);
      }
    );
    return;
  }

  const pageSize = 10;
  const totalPages = Math.ceil(guildLands.length / pageSize) || 1;
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  const currentPageLands = guildLands.slice(start, start + pageSize);

  const form = new ActionFormData();
  form.title("§w公会领地（管理员）");
  form.body(`第 ${safePage} / ${totalPages} 页 · 共 ${guildLands.length} 块`);

  currentPageLands.forEach((landData) => {
    const g = landData.guildId ? guildService.getGuildById(landData.guildId) : undefined;
    const tag = g ? `[${g.tag}]` : "[?]";
    form.button(
      `${landData.name}\n${tag} ${landData.owner} · ${getDimensionName(landData.dimension)}`,
      "textures/icons/island"
    );
  });

  let previousButtonIndex = currentPageLands.length;
  let nextButtonIndex = currentPageLands.length;

  if (safePage > 1) {
    form.button("§w上一页", "textures/icons/left_arrow");
    previousButtonIndex++;
    nextButtonIndex++;
  }
  if (safePage < totalPages) {
    form.button("§w下一页", "textures/icons/right_arrow");
    nextButtonIndex++;
  }

  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    const selectionIndex = data.selection;
    if (selectionIndex === null || selectionIndex === undefined) return;

    const count = currentPageLands.length;
    if (selectionIndex >= 0 && selectionIndex < count) {
      openLandDetailForm(player, currentPageLands[selectionIndex], true, () =>
        openAdminGuildLandListForm(player, safePage, returnForm)
      );
    } else if (selectionIndex === previousButtonIndex - 1 && safePage > 1) {
      openAdminGuildLandListForm(player, safePage - 1, returnForm);
    } else if (selectionIndex === nextButtonIndex - 1 && safePage < totalPages) {
      openAdminGuildLandListForm(player, safePage + 1, returnForm);
    } else {
      if (returnForm) returnForm();
      else openSystemSettingForm(player);
    }
  });
}

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
    const playerLands = Object.values(landManager.getLandList()).filter(
      (l) => l.owner === playerName && !l.guildId
    );
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
