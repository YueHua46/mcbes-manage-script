/**
 * 黑名单管理表单
 *
 * 提供管理员对黑名单的增删查操作，遵循 openTrialModeManageForm 的表单模式。
 * 仅管理员可访问（由调用方保证）。
 */

import { Player, world } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { color } from "../../../shared/utils/color";
import { openDialogForm } from "../../components/dialog";
import { IBlacklistEntry } from "../../../core/types";
import blacklistService from "../../../features/blacklist/services/blacklist";
import setting from "../../../features/system/services/setting";
import { playerPersistentIdMap } from "../.././../events/handlers/blacklist";

const PAGE_SIZE = 10;

// ==================== 主菜单 ====================

export function openBlacklistManageForm(player: Player): void {
  const isEnabled = setting.getState("blacklistEnabled") as boolean;
  const form = new ActionFormData();
  form.title("§w黑名单管理");
  const warningLine = isEnabled
    ? "§a✔ 黑名单拦截已启用"
    : "§c✘ 黑名单拦截【未启用】，封禁玩家将无法被阻止重新进入！\n§e请前往系统设置开启「黑名单系统」";
  form.body(`§e⚠ 仅 BDS 服务器可用\n${warningLine}\n§7管理员可在此添加、查看、移除被封禁的玩家`);

  form.button("§w查看黑名单列表", "textures/icons/social");
  form.button("§w添加到黑名单", "textures/icons/deny");
  form.button("§w从黑名单移除", "textures/icons/requeue");
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    switch (data.selection) {
      case 0:
        openBlacklistListForm(player, 1);
        break;
      case 1:
        openAddBlacklistForm(player);
        break;
      case 2:
        openRemoveBlacklistForm(player, 1);
        break;
      case 3: {
        import("../system").then(({ openSystemSettingForm }) => openSystemSettingForm(player));
        break;
      }
    }
  });
}

// ==================== 黑名单列表（分页） ====================

export function openBlacklistListForm(player: Player, page: number = 1): void {
  const all = blacklistService.getAll();

  const form = new ActionFormData();
  form.title("§w黑名单列表");

  if (all.length === 0) {
    form.body(color.yellow("当前黑名单为空"));
    form.button("§8返回", "textures/icons/back");
    form.show(player).then((data) => {
      if (!data.canceled) openBlacklistManageForm(player);
    });
    return;
  }

  const totalPages = Math.ceil(all.length / PAGE_SIZE);
  const start = (page - 1) * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, all.length);
  const currentPage = all.slice(start, end);

  form.body(`共 ${all.length} 条记录 | 第 ${page} / ${totalPages} 页`);

  currentPage.forEach((entry) => {
    const bannedDate = new Date(entry.bannedAt).toLocaleDateString("zh-CN");
    const reason = entry.reason || "未填写理由";
    form.button(
      `${color.darkRed(entry.name)}\n${color.darkGray(reason)} §8| §8${bannedDate}`,
      "textures/icons/profile"
    );
  });

  if (page > 1) form.button("§8上一页", "textures/icons/left_arrow");
  if (page < totalPages) form.button("§8下一页", "textures/icons/right_arrow");
  form.button("§8返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    const sel = data.selection ?? -1;
    const itemCount = currentPage.length;

    let offset = 0;
    if (page > 1 && sel === itemCount + offset) {
      openBlacklistListForm(player, page - 1);
      return;
    }
    if (page > 1) offset++;
    if (page < totalPages && sel === itemCount + offset) {
      openBlacklistListForm(player, page + 1);
      return;
    }
    if (page < totalPages) offset++;
    if (sel === itemCount + offset) {
      openBlacklistManageForm(player);
      return;
    }
    // 点击了具体条目，显示详情
    if (sel >= 0 && sel < itemCount) {
      openBlacklistDetailForm(player, currentPage[sel], page);
    }
  });
}

// ==================== 黑名单条目详情 ====================

function openBlacklistDetailForm(player: Player, entry: IBlacklistEntry, returnPage: number): void {
  const form = new ActionFormData();
  form.title("§w黑名单详情");

  const bannedDate = new Date(entry.bannedAt).toLocaleString("zh-CN");
  form.body(
    `§e玩家名：§f${entry.name}\n` +
    `§e XUID：§7${entry.xuid}\n` +
    `§e封禁理由：§f${entry.reason || "未填写"}\n` +
    `§e封禁时间：§7${bannedDate}\n` +
    `§e操作管理员：§f${entry.bannedBy}`
  );

  form.button("§c移除黑名单", "textures/icons/deny");
  form.button("§8返回列表", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    if (data.selection === 0) {
      blacklistService.remove(entry.xuid);
      openDialogForm(
        player,
        {
          title: "移除成功",
          desc: color.green(`已将玩家 ${color.yellow(entry.name)} 从黑名单中移除`),
        },
        () => openBlacklistListForm(player, returnPage)
      );
    } else {
      openBlacklistListForm(player, returnPage);
    }
  });
}

// ==================== 添加到黑名单 ====================

export function openAddBlacklistForm(player: Player): void {
  const onlinePlayers = world.getAllPlayers();
  const playerNames = onlinePlayers
    .filter((p) => p.name !== player.name)
    .map((p) => p.name);

  const form = new ModalFormData();
  form.title("§w添加玩家到黑名单");

  if (playerNames.length > 0) {
    form.dropdown("选择在线玩家", ["── 不选择 ──", ...playerNames], { defaultValueIndex: 0 });
  }

  form.textField(
    playerNames.length > 0
      ? "或手动输入玩家名（优先使用输入框，支持离线玩家）"
      : "输入玩家名（支持离线玩家）",
    "玩家 Gamertag",
    { defaultValue: "" }
  );
  form.textField(
    "封禁理由（可选，不填则使用默认提示）",
    "例如：多次破坏他人建筑",
    { defaultValue: "" }
  );
  form.submitButton("确认封禁");

  form.show(player).then(async (data) => {
    if (data.cancelationReason) return;
    const { formValues } = data;
    if (!formValues) return;

    let fieldOffset = 0;
    let targetName = "";

    // 有在线玩家下拉框时，offset 需要偏移
    if (playerNames.length > 0) {
      const dropdownIndex = formValues[0] as number;
      const inputName = (formValues[1] as string)?.trim();
      const reason = (formValues[2] as string)?.trim();
      fieldOffset = 1;

      if (inputName) {
        targetName = inputName;
      } else if (dropdownIndex > 0) {
        targetName = playerNames[dropdownIndex - 1];
      }

      await processAddBlacklist(player, targetName, reason);
    } else {
      const inputName = (formValues[0] as string)?.trim();
      const reason = (formValues[1] as string)?.trim();

      targetName = inputName;
      await processAddBlacklist(player, targetName, reason);
    }
  });
}

async function processAddBlacklist(player: Player, targetName: string, reason: string): Promise<void> {
  if (!targetName) {
    openDialogForm(
      player,
      { title: "添加失败", desc: color.red("请选择在线玩家或输入玩家名称") },
      () => openAddBlacklistForm(player)
    );
    return;
  }

  // 检查是否已在黑名单
  const existing = blacklistService.isBlacklistedByName(targetName);
  if (existing) {
    openDialogForm(
      player,
      {
        title: "已在黑名单",
        desc: color.yellow(`玩家 ${color.white(targetName)} 已在黑名单中，无需重复添加`),
      },
      () => openBlacklistManageForm(player)
    );
    return;
  }

  // 仅 BDS 版支持通过 xuid 解析添加；标准版不加载 xuid-resolver，避免单人/Realms 报 server-net 未识别
  if (typeof __BDS_BUILD__ === "undefined" || !__BDS_BUILD__) {
    openDialogForm(
      player,
      {
        title: "不可用",
        desc: color.gray("按玩家名解析 xuid 仅在使用 BDS 版附加包时可用。\n请安装带「BDS」的 .mcaddon 并在 BDS 服务器中使用。"),
      },
      () => openBlacklistManageForm(player)
    );
    return;
  }

  player.sendMessage(color.yellow(`§e[黑名单] 正在查询玩家 ${targetName} 的 xuid，请稍候...`));

  let xuid: string | null = null;
  try {
    const { resolveXuid } = await import("../../../features/blacklist/services/xuid-resolver");
    xuid = await resolveXuid(targetName);
  } catch (e) {
    // server-net 不可用或接口异常
  }

  if (!xuid) {
    openDialogForm(
      player,
      {
        title: "添加失败",
        desc:
          color.red(`暂时无法获取玩家 ${color.yellow(targetName)} 的 xuid。\n`) +
          color.gray("可能原因：\n· 该玩家名不存在或拼写有误\n· 第三方查询接口暂时不可用\n请稍后重试，或确认玩家名正确后再操作"),
      },
      () => openAddBlacklistForm(player)
    );
    return;
  }

  // 再次检查 xuid 是否已在黑名单（防止同一 xuid 以不同名字被重复添加）
  const existingByXuid = blacklistService.isBlacklistedByXuid(xuid);
  if (existingByXuid) {
    openDialogForm(
      player,
      {
        title: "已在黑名单",
        desc: color.yellow(
          `该玩家（xuid: ${xuid}）已在黑名单中，\n记录名: ${color.white(existingByXuid.name)}`
        ),
      },
      () => openBlacklistManageForm(player)
    );
    return;
  }

  // 写入黑名单（从运行时映射表取 persistentId，仅在线玩家有值）
  const persistentId = playerPersistentIdMap.get(targetName) ?? null;
  blacklistService.add(targetName, xuid, persistentId, reason, player.name);

  // 如果玩家当前在线，直接踢出
  const onlineTarget = world.getAllPlayers().find((p) => p.name === targetName);
  if (onlineTarget) {
    try {
      onlineTarget.runCommand(
        `kick "${targetName}" ${reason || "您已被该服务器封禁，如有疑问请联系管理员"}`
      );
    } catch (_) {
      // kick 命令可能因权限失败，忽略
    }
  }

  const isEnabled = setting.getState("blacklistEnabled") as boolean;
  const disabledWarning = isEnabled
    ? ""
    : color.red("\n\n⚠ 警告：黑名单拦截系统【未启用】！\n") +
      color.yellow("该玩家已被记录，但重新进入时不会被阻止。\n请前往「系统设置」开启「黑名单系统」后封禁才会生效！");

  openDialogForm(
    player,
    {
      title: "添加成功",
      desc:
        color.green(`已将玩家 ${color.yellow(targetName)} 加入黑名单\n`) +
        color.gray(`XUID: ${xuid}\n`) +
        (reason ? color.gray(`理由: ${reason}`) : color.darkGray("（未填写理由，将使用默认提示）")) +
        disabledWarning,
    },
    () => openBlacklistManageForm(player)
  );
}

// ==================== 从黑名单移除（列表选择） ====================

export function openRemoveBlacklistForm(player: Player, page: number = 1): void {
  const all = blacklistService.getAll();

  const form = new ActionFormData();
  form.title("§w从黑名单移除");

  if (all.length === 0) {
    form.body(color.yellow("黑名单为空，无可移除的记录"));
    form.button("§8返回", "textures/icons/back");
    form.show(player).then((data) => {
      if (!data.canceled) openBlacklistManageForm(player);
    });
    return;
  }

  const totalPages = Math.ceil(all.length / PAGE_SIZE);
  const start = (page - 1) * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, all.length);
  const currentPage = all.slice(start, end);

  form.body(`选择要解除封禁的玩家 | 第 ${page} / ${totalPages} 页`);

  currentPage.forEach((entry) => {
    const reason = entry.reason || "无";
    form.button(
      `${color.darkGray(entry.name)}\n${color.darkGray(`理由: ${reason}`)}`,
      "textures/icons/profile"
    );
  });

  if (page > 1) form.button("§8上一页", "textures/icons/left_arrow");
  if (page < totalPages) form.button("§8下一页", "textures/icons/right_arrow");
  form.button("§8返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    const sel = data.selection ?? -1;
    const itemCount = currentPage.length;

    let offset = 0;
    if (page > 1 && sel === itemCount + offset) {
      openRemoveBlacklistForm(player, page - 1);
      return;
    }
    if (page > 1) offset++;
    if (page < totalPages && sel === itemCount + offset) {
      openRemoveBlacklistForm(player, page + 1);
      return;
    }
    if (page < totalPages) offset++;
    if (sel === itemCount + offset) {
      openBlacklistManageForm(player);
      return;
    }

    if (sel >= 0 && sel < itemCount) {
      const entry = currentPage[sel];
      confirmRemoveBlacklist(player, entry, page);
    }
  });
}

function confirmRemoveBlacklist(player: Player, entry: IBlacklistEntry, returnPage: number): void {
  const form = new ActionFormData();
  form.title("§w确认解除封禁");
  form.body(
    `§e确定要将以下玩家从黑名单中移除吗？\n\n` +
    `§f玩家名：${entry.name}\n` +
    `§7XUID：${entry.xuid}\n` +
    `§7理由：${entry.reason || "未填写"}`
  );
  form.button("§a确认移除", "textures/icons/accept");
  form.button("§c取消", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason || data.selection === 1) {
      openRemoveBlacklistForm(player, returnPage);
      return;
    }
    blacklistService.remove(entry.xuid);
    openDialogForm(
      player,
      {
        title: "解除成功",
        desc: color.green(`已将玩家 ${color.yellow(entry.name)} 从黑名单中解除封禁`),
      },
      () => openBlacklistManageForm(player)
    );
  });
}
