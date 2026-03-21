/**
 * 公会系统：全部通过服务器菜单与表单交互（不依赖聊天命令）
 */

import { Player, world } from "@minecraft/server";
import { ActionFormData, MessageFormData, ModalFormData } from "@minecraft/server-ui";
import { color } from "../../../shared/utils/color";
import guildService from "../../../features/guild/services/guild-service";
import landManager from "../../../features/land/services/land-manager";
import type { ILand } from "../../../core/types";
import type { GuildRole, IGuild } from "../../../features/guild/models/guild.model";
import economic from "../../../features/economic/services/economic";
import setting from "../../../features/system/services/setting";
import { openDialogForm, openConfirmDialogForm } from "../../components/dialog";
import { openServerMenuForm } from "../server";
import { openLandApplyForm } from "../land";
import wayPoint from "../../../features/waypoint/services/waypoint";
import { formatNumber, formatDateTime } from "../../../shared/utils/format";
import { useFormatListInfo } from "../../../shared/hooks/use-form";
import { getBehaviorEventLabel, type BehaviorLogEntry } from "../../../features/behavior-log/services/behavior-log";

function numSetting(key: "guildCreateCost" | "guildNameMaxLen" | "guildTagMaxLen"): number {
  const n = Number(setting.getState(key));
  return Number.isFinite(n) && n > 0
    ? Math.floor(n)
    : key === "guildCreateCost"
      ? 1000
      : key === "guildNameMaxLen"
        ? 16
        : 6;
}

/** 每公会人数上限（服务器设置 guildMaxMembers，与 guild-service 一致） */
function guildMaxMembersCap(): number {
  const n = Number(setting.getState("guildMaxMembers"));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 50;
}

const MAX_ANNOUNCE_IN_FORM = 450;
const MEMBERS_PER_PAGE = 10;
const GUILDS_LIST_PER_PAGE = 10;
const MAX_PUBLIC_MEMBER_NAMES = 28;
const GUILD_HISTORY_CHUNK = 100;
const GUILD_HISTORY_BODY_MAX_CHARS = 3800;

function stripSectionForUi(s: string): string {
  return s.replace(/§./g, "");
}

function metaTargetPlayer(m: string): string | undefined {
  const match = /target=([^\s]+)/.exec(m);
  return match ? match[1] : undefined;
}

/** 公会历史单行（中文） */
function formatGuildHistoryLine(entry: BehaviorLogEntry): string {
  const t = formatDateTime(entry.t);
  const who = stripSectionForUi(entry.p);
  const m = entry.m ?? "";
  const tgt = metaTargetPlayer(m);
  switch (entry.e) {
    case "guildCreate":
      return `§7${t} §f${who} §7创建公会`;
    case "guildJoin":
      return `§7${t} §f${who} §7加入公会`;
    case "guildLeave":
      return `§7${t} §f${who} §7退出公会`;
    case "guildKick":
      return `§7${t} §f${who} §7踢出成员 §f${tgt ?? "?"}`;
    case "guildDisband":
      return `§7${t} §f${who} §7解散公会`;
    case "guildTreasuryDeposit":
      return `§7${t} §f${who} §7捐入金库 §6${stripSectionForUi(m)}`;
    case "guildTreasuryWithdraw":
      return `§7${t} §f${who} §7金库支出 §6${stripSectionForUi(m)}`;
    case "guildInvite":
      return `§7${t} §f${who} §7邀请玩家 §f${tgt ?? "?"}`;
    case "guildApply":
      return `§7${t} §f${who} §7提交加入申请`;
    case "guildApplyApprove":
      return `§7${t} §f${who} §7批准 §f${tgt ?? "?"} §7加入`;
    case "guildApplyReject":
      return `§7${t} §f${who} §7拒绝 §f${tgt ?? "?"} §7的申请`;
    case "guildPromote": {
      if (m.includes("transfer owner")) {
        const to = m.split("transfer owner ->")[1]?.trim();
        return `§7${t} §f${who} §7将会长转让给 §f${to ?? "?"}`;
      }
      if (m.includes("wpAdd")) return `§7${t} §f${who} §7添加公会坐标`;
      if (m.includes("wpDel")) return `§7${t} §f${who} §7删除公会坐标`;
      if (m.includes("wpMove")) return `§7${t} §f${who} §7移动公会坐标`;
      if (m.includes("-> officer")) return `§7${t} §f${who} §7任命 §f${tgt ?? "?"} §7为副会长`;
      if (m.includes("-> member")) return `§7${t} §f${who} §7将 §f${tgt ?? "?"} §7降为成员`;
      return `§7${t} §f${who} §7职务变更 §7${stripSectionForUi(m)}`;
    }
    default:
      return `§7${t} §f${who} §7${getBehaviorEventLabel(entry.e)} §7${stripSectionForUi(m)}`;
  }
}

function splitWaypointDbKey(key: string): { ownerKey: string; pointName: string } | undefined {
  const i = key.indexOf(":");
  if (i < 1 || i >= key.length - 1) return undefined;
  return { ownerKey: key.slice(0, i), pointName: key.slice(i + 1) };
}

/** 与领地表单一致，用于列表副标题（不展示领主，用维度区分地块） */
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

function roleLabel(r: GuildRole): string {
  switch (r) {
    case "owner":
      return "会长";
    case "officer":
      return "副会长";
    default:
      return "成员";
  }
}

function truncateForInfoBody(text: string, maxLen: number): string {
  const t = text.replace(/\r/g, "").trim();
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen) + "§7...";
}

/**
 * 与「其他功能 → 服务器状态」相同：使用 MessageFormData 在信息框内展示，不写入聊天
 */
function createGuildInfoMessageForm(g: IGuild): MessageFormData {
  const form = new MessageFormData();
  form.title("§w公会信息与公告");
  const memberCount = Object.keys(g.members).length;
  const annRaw = g.announcement?.trim();
  const annDisplay = annRaw ? truncateForInfoBody(annRaw, MAX_ANNOUNCE_IN_FORM) : "§7（暂无公告）";

  form.body({
    rawtext: [
      { text: `§a---------------------------------\n` },
      { text: `§e名称: §f${g.name} §7[${g.tag}]\n` },
      { text: `§e会长: §f${g.ownerName}\n` },
      { text: `§e成员数: §f${memberCount}\n` },
      { text: `§e金库: §6${g.treasuryGold} §7金币\n` },
      { text: `§e公会ID: §7${g.id}\n` },
      { text: `§a---------------------------------\n` },
      { text: `§c公告\n` },
      { text: "§f" + annDisplay + "\n" },
      { text: `§a---------------------------------\n` },
    ],
  });
  form.button1("§w刷新");
  form.button2("§w返回");
  return form;
}

function buildOfficerNamesLine(g: IGuild): string {
  const names = Object.entries(g.members)
    .filter(([, m]) => m.role === "officer")
    .map(([n]) => stripSectionForUi(n))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return names.length > 0 ? names.join("§7, §f") : "§7（无）";
}

function buildMemberNamesPreview(g: IGuild): string {
  const names = Object.keys(g.members).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  if (names.length <= MAX_PUBLIC_MEMBER_NAMES) {
    return names.map((n) => stripSectionForUi(n)).join("§7, §f");
  }
  const slice = names.slice(0, MAX_PUBLIC_MEMBER_NAMES);
  return `${slice.map((n) => stripSectionForUi(n)).join("§7, §f")}\n§7... 等共 §f${names.length} §7人`;
}

/** 浏览用：不含金库 */
function createPublicGuildInfoMessageForm(g: IGuild): MessageFormData {
  const form = new MessageFormData();
  form.title(`§w§l[${stripSectionForUi(g.tag)}]§r §w公开信息`);
  const annRaw = g.announcement?.trim();
  const annDisplay = annRaw ? truncateForInfoBody(annRaw, MAX_ANNOUNCE_IN_FORM) : "§7（暂无公告）";
  const officers = buildOfficerNamesLine(g);
  const membersPreview = buildMemberNamesPreview(g);
  form.body({
    rawtext: [
      { text: `§a---------------------------------\n` },
      { text: `§e会长: §f${stripSectionForUi(g.ownerName)}\n` },
      { text: `§e副会长: §f${officers}\n` },
      { text: `§e创建时间: §f${formatDateTime(g.createdAt)}\n` },
      { text: `§e成员数: §f${Object.keys(g.members).length}\n` },
      { text: `§a---------------------------------\n` },
      { text: `§e成员\n` },
      { text: `§f${membersPreview}\n` },
      { text: `§a---------------------------------\n` },
      { text: `§c公告\n` },
      { text: "§f" + annDisplay + "\n" },
      { text: `§a---------------------------------\n` },
    ],
  });
  form.button1("§w刷新");
  form.button2("§w返回");
  return form;
}

/**
 * 全服公会列表（分页 ActionForm）；「返回」回到一级「公会列表 / 我的公会」菜单
 */
async function openGuildBrowseListForm(player: Player, page: number = 1): Promise<void> {
  const snap = guildService.getGuildsListSnapshot(page, GUILDS_LIST_PER_PAGE);
  const form = new ActionFormData();
  form.title("§w公会列表");
  form.body(
    [
      `§7共 §b§l${snap.total}§r §7个公会`,
      ``,
      `§7第 §b${snap.page}§7 / §b${snap.totalPages} §7页`,
      ``,
      `§7点选公会可查看公开信息与加入方式`,
    ].join("\n")
  );

  const memberCap = guildMaxMembersCap();
  const rowActions: Array<() => Promise<void>> = [];
  for (const row of snap.rows) {
    const tagPlain = stripSectionForUi(row.tag);
    const namePlain = stripSectionForUi(row.name);
    // 第二行用 §0 深字 + §b 人数，避免 §8 整行包一层在表单按钮上发灰发白看不清
    const line2 = `§0[${tagPlain}] ${namePlain} §8· §0人数 §b${row.memberCount}§0/§b${memberCap}`;
    form.button(`§l§e${namePlain}§r\n${line2}`, "textures/icons/island");
    rowActions.push(() => openGuildPublicDetailMenu(player, row.id, snap.page));
  }

  let btnIdx = snap.rows.length;
  let prevIdx = -1;
  let nextIdx = -1;
  if (snap.page > 1) {
    prevIdx = btnIdx;
    form.button("§0上一页", "textures/icons/left_arrow");
    btnIdx++;
  }
  if (snap.page < snap.totalPages) {
    nextIdx = btnIdx;
    form.button("§0下一页", "textures/icons/right_arrow");
    btnIdx++;
  }
  const backIdx = btnIdx;
  form.button("§0返回", "textures/icons/back");

  const res = await form.show(player);
  if (res.canceled || res.selection === undefined) return;
  const sel = res.selection;

  if (sel < snap.rows.length) {
    await rowActions[sel]();
    return;
  }
  if (prevIdx >= 0 && sel === prevIdx) {
    await openGuildBrowseListForm(player, snap.page - 1);
    return;
  }
  if (nextIdx >= 0 && sel === nextIdx) {
    await openGuildBrowseListForm(player, snap.page + 1);
    return;
  }
  if (sel === backIdx) {
    await openGuildMenuForm(player);
  }
}

function openGuildPublicInfoForm(player: Player, guildId: string, listPage: number): void {
  const g = guildService.getGuildById(guildId);
  if (!g) {
    openDialogForm(
      player,
      { title: "提示", desc: color.gray("该公会已不存在。") },
      () => void openGuildBrowseListForm(player, listPage)
    );
    return;
  }
  const form = createPublicGuildInfoMessageForm(g);
  form.show(player).then((data) => {
    if (data.canceled) return;
    switch (data.selection) {
      case 0:
        openGuildPublicInfoForm(player, guildId, listPage);
        break;
      case 1:
        void openGuildPublicDetailMenu(player, guildId, listPage);
        break;
      default:
        break;
    }
  });
}

async function openGuildPublicDetailMenu(player: Player, guildId: string, listPage: number = 1): Promise<void> {
  const g = guildService.getGuildById(guildId);
  if (!g) {
    openDialogForm(
      player,
      { title: "提示", desc: color.gray("该公会已不存在。") },
      () => void openGuildBrowseListForm(player, listPage)
    );
    return;
  }

  const form = new ActionFormData();
  form.title(`§w§l[${stripSectionForUi(g.tag)}]§r`);
  form.body(`§7${stripSectionForUi(g.name)} §7· §7${Object.keys(g.members).length} 人\n§8公开浏览：可申请加入`);
  form.button("§w公会信息", "textures/icons/duyuru");
  form.button("§w加入公会", "textures/icons/party_invites");
  form.button("§w返回", "textures/icons/back");

  const res = await form.show(player);
  if (res.canceled || res.selection === undefined) return;
  if (res.selection === 0) {
    openGuildPublicInfoForm(player, guildId, listPage);
  } else if (res.selection === 1) {
    await handleJoinGuildFromList(player, guildId, listPage);
  } else {
    await openGuildBrowseListForm(player, listPage);
  }
}

async function handleJoinGuildFromList(player: Player, guildId: string, listPage: number): Promise<void> {
  const target = guildService.getGuildById(guildId);
  if (!target) {
    openDialogForm(
      player,
      { title: "提示", desc: color.gray("该公会已不存在。") },
      () => void openGuildBrowseListForm(player, listPage)
    );
    return;
  }

  const myGid = guildService.getGuildIdForPlayerName(player.name);
  if (myGid === guildId) {
    openDialogForm(
      player,
      { title: "提示", desc: color.green("你已是该公会成员。") },
      () => void openGuildPublicDetailMenu(player, guildId, listPage)
    );
    return;
  }

  const pending = guildService.getPendingInviteSummary(player.name);
  if (pending) {
    if (pending.guildId !== guildId) {
      openDialogForm(
        player,
        {
          title: "提示",
          desc: color.yellow("你有一条其他公会的待处理邀请，请先在「我的公会」中处理或拒绝后再操作。"),
        },
        () => void openGuildPublicDetailMenu(player, guildId, listPage)
      );
      return;
    }
    openConfirmDialogForm(
      player,
      "§w接受邀请",
      `§7接受加入 §e[${target.tag}] ${stripSectionForUi(target.name)} §7？`,
      () => {
        const err = guildService.acceptInvite(player);
        openDialogForm(
          player,
          {
            title: err ? "无法接受" : "已加入",
            desc: err ? color.red(err) : color.green("欢迎加入公会！"),
          },
          () => void openGuildMenuForm(player)
        );
      },
      () => void openGuildPublicDetailMenu(player, guildId, listPage)
    );
    return;
  }

  if (myGid) {
    const myG = guildService.getGuildById(myGid);
    if (!myG) {
      openDialogForm(
        player,
        { title: "提示", desc: color.red("公会数据异常。") },
        () => void openGuildPublicDetailMenu(player, guildId, listPage)
      );
      return;
    }
    if (myG.ownerName === player.name) {
      openDialogForm(
        player,
        {
          title: "无法直接加入",
          desc: color.yellow("你是当前公会的会长，请先转让会长或解散公会后，再通过邀请加入其他公会。"),
        },
        () => void openGuildPublicDetailMenu(player, guildId, listPage)
      );
      return;
    }
    openConfirmDialogForm(
      player,
      "§w退出当前公会",
      `§7加入其他公会前需先退出 §e[${myG.tag}] ${stripSectionForUi(myG.name)} §7。\n是否退出？`,
      () => {
        const err = guildService.leaveGuild(player);
        openDialogForm(
          player,
          {
            title: err ? "失败" : "已退出",
            desc: err
              ? color.red(err)
              : color.gray("已退出当前公会。你可从公会列表向目标公会提交加入申请，或由对方邀请。"),
          },
          () => void openGuildPublicDetailMenu(player, guildId, listPage)
        );
      },
      () => void openGuildPublicDetailMenu(player, guildId, listPage),
      { dangerConfirm: true }
    );
    return;
  }

  const err = guildService.requestJoinGuild(player, guildId);
  openDialogForm(
    player,
    {
      title: err ? "无法申请" : "已提交申请",
      desc: err ? color.red(err) : color.gray("已向该公会提交加入申请，请等待会长或副会长在「申请加入列表」中处理。"),
    },
    () => void openGuildPublicDetailMenu(player, guildId, listPage)
  );
}

async function openGuildJoinRequestDecisionForm(player: Player, applicantName: string): Promise<void> {
  const form = new ActionFormData();
  form.title("§w处理申请");
  form.body(`§7申请人: §f${stripSectionForUi(applicantName)}\n\n§7是否同意该玩家加入本会？`);
  form.button("§w同意", "textures/icons/accept");
  form.button("§c拒绝", "textures/icons/deny");
  form.button("§w返回", "textures/icons/back");

  const res = await form.show(player);
  if (res.canceled || res.selection === undefined) return;

  if (res.selection === 0) {
    const err = guildService.approveJoinRequest(player, applicantName);
    openDialogForm(
      player,
      {
        title: err ? "操作失败" : "已同意",
        desc: err ? color.red(err) : color.green("该玩家已加入公会。"),
      },
      () => void openGuildJoinRequestListForm(player, 1)
    );
  } else if (res.selection === 1) {
    const err = guildService.rejectJoinRequest(player, applicantName);
    openDialogForm(
      player,
      {
        title: err ? "操作失败" : "已拒绝",
        desc: err ? color.red(err) : color.gray("已拒绝该申请。"),
      },
      () => void openGuildJoinRequestListForm(player, 1)
    );
  } else {
    await openGuildJoinRequestListForm(player, 1);
  }
}

async function openGuildJoinRequestListForm(player: Player, page: number = 1): Promise<void> {
  const g = guildService.getGuildForPlayer(player);
  const role = guildService.getMemberRole(player);
  if (!g || (role !== "owner" && role !== "officer")) {
    openDialogForm(player, { title: "提示", desc: color.red("无权查看。") }, () => void openGuildMyGuildMenu(player));
    return;
  }

  const rows = guildService.listJoinRequests(g.id);
  if (rows.length === 0) {
    openDialogForm(
      player,
      { title: "提示", desc: color.gray("暂无待处理的加入申请。") },
      () => void openGuildMyGuildMenu(player)
    );
    return;
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / MEMBERS_PER_PAGE));
  const pageClamped = Math.min(Math.max(1, page), totalPages);
  const start = (pageClamped - 1) * MEMBERS_PER_PAGE;
  const slice = rows.slice(start, start + MEMBERS_PER_PAGE);

  const form = new ActionFormData();
  form.title("§w申请加入列表");
  form.body(
    [
      `§7${stripSectionForUi(g.name)} §7· §7待审 §b${rows.length} §7人`,
      `§7第 §b${pageClamped}§7 / §b${totalPages} §7页`,
      ``,
      `§7点选玩家处理申请`,
    ].join("\n")
  );

  const rowActions: Array<() => Promise<void>> = [];
  for (const row of slice) {
    form.button(
      `§f${stripSectionForUi(row.playerName)}\n§7申请时间 ${formatDateTime(row.requestedAt)}`,
      "textures/icons/faces"
    );
    rowActions.push(() => openGuildJoinRequestDecisionForm(player, row.playerName));
  }

  let btnIdx = slice.length;
  let prevIdx = -1;
  let nextIdx = -1;
  if (pageClamped > 1) {
    prevIdx = btnIdx;
    form.button("§0上一页", "textures/icons/left_arrow");
    btnIdx++;
  }
  if (pageClamped < totalPages) {
    nextIdx = btnIdx;
    form.button("§0下一页", "textures/icons/right_arrow");
    btnIdx++;
  }
  const backIdx = btnIdx;
  form.button("§0返回", "textures/icons/back");

  const res = await form.show(player);
  if (res.canceled || res.selection === undefined) return;
  const sel = res.selection;

  if (sel < slice.length) {
    await rowActions[sel]();
    return;
  }
  if (prevIdx >= 0 && sel === prevIdx) {
    await openGuildJoinRequestListForm(player, pageClamped - 1);
    return;
  }
  if (nextIdx >= 0 && sel === nextIdx) {
    await openGuildJoinRequestListForm(player, pageClamped + 1);
    return;
  }
  if (sel === backIdx) {
    await openGuildMyGuildMenu(player);
  }
}

async function openGuildHistoryForm(
  player: Player,
  guildId: string,
  loadedOffset: number,
  accumulated: BehaviorLogEntry[]
): Promise<void> {
  const chunk = guildService.getGuildHistory(player, guildId, {
    limit: GUILD_HISTORY_CHUNK,
    offset: loadedOffset,
  });
  if (!chunk) {
    openDialogForm(
      player,
      { title: "提示", desc: color.red("无权查看或公会不存在。") },
      () => void openGuildMyGuildMenu(player)
    );
    return;
  }

  const merged = [...accumulated, ...chunk.items];
  if (merged.length === 0 && loadedOffset === 0) {
    openDialogForm(
      player,
      { title: "公会历史", desc: color.gray("暂无记录（或行为日志中未开启公会事件）。") },
      () => void openGuildMyGuildMenu(player)
    );
    return;
  }

  const hasMore = merged.length < chunk.total;
  const linesText = merged.map((e) => formatGuildHistoryLine(e)).join("\n");
  const displayText =
    linesText.length > GUILD_HISTORY_BODY_MAX_CHARS
      ? `${linesText.slice(0, GUILD_HISTORY_BODY_MAX_CHARS)}\n§7...`
      : linesText;

  const form = new ActionFormData();
  form.title("§w公会历史");
  form.body([`§7已加载 §b${merged.length}§7 / §b${chunk.total} §7条 §7· §7新在上`, ``, displayText].join("\n"));
  if (hasMore) {
    form.button("§w加载更多", "textures/icons/right_arrow");
  }
  form.button("§w返回", "textures/icons/back");

  const res = await form.show(player);
  if (res.canceled || res.selection === undefined) return;

  if (hasMore) {
    if (res.selection === 0) {
      await openGuildHistoryForm(player, guildId, loadedOffset + GUILD_HISTORY_CHUNK, merged);
    } else {
      await openGuildMyGuildMenu(player);
    }
  } else if (res.selection === 0) {
    await openGuildMyGuildMenu(player);
  }
}

async function openGuildMemberDetailForm(
  player: Player,
  row: {
    playerName: string;
    role: GuildRole;
    contribution: number;
    joinedAt: number;
  },
  page: number
): Promise<void> {
  const form = new ActionFormData();
  form.title("§w成员详情");
  form.body(
    useFormatListInfo([
      { title: "玩家名", desc: stripSectionForUi(row.playerName), list: [] },
      { title: "贡献度", desc: `${formatNumber(row.contribution)} 金币`, list: [] },
      { title: "加入公会时间", desc: formatDateTime(row.joinedAt), list: [] },
      { title: "头衔", desc: roleLabel(row.role), list: [] },
    ])
  );
  form.button("§w返回", "textures/icons/back");
  const res = await form.show(player);
  if (res.canceled || res.selection === undefined) return;
  await openGuildMemberListForm(player, page);
}

/**
 * 成员列表：按钮列表，按贡献度排序，分页；点击进入详情
 */
async function openGuildMemberListForm(player: Player, page: number = 1): Promise<void> {
  const snap = guildService.getMemberListSnapshot(player);
  if (!snap) {
    openDialogForm(
      player,
      { title: "提示", desc: color.yellow("你不在任何公会中。") },
      () => void openGuildMyGuildMenu(player)
    );
    return;
  }

  const totalPages = Math.max(1, Math.ceil(snap.total / MEMBERS_PER_PAGE));
  const pageClamped = Math.min(Math.max(1, page), totalPages);
  const start = (pageClamped - 1) * MEMBERS_PER_PAGE;
  const slice = snap.rows.slice(start, start + MEMBERS_PER_PAGE);

  const form = new ActionFormData();
  form.title("§w成员列表");
  form.body(
    [
      `§f§l[${stripSectionForUi(snap.tag)}]§r §7${stripSectionForUi(snap.name)}`,
      ``,
      `§7共 §b§l${snap.total}§r §7人 · §7按贡献度从高到低`,
      ``,
      `§7第 §b${pageClamped}§7 / §b${totalPages} §7页`,
    ].join("\n")
  );

  const rowActions: Array<() => Promise<void>> = [];
  for (const row of slice) {
    const nm = stripSectionForUi(row.playerName);
    const prefix = row.role === "owner" ? "§6§l[会长]§r " : row.role === "officer" ? "§b§l[副会]§r " : "";
    form.button(`${prefix}§l§e${nm}§r\n§8贡献 §b${formatNumber(row.contribution)} §7金币`, "textures/icons/amongus");
    rowActions.push(() => openGuildMemberDetailForm(player, row, pageClamped));
  }

  let btnIdx = slice.length;
  let prevIdx = -1;
  let nextIdx = -1;
  if (pageClamped > 1) {
    prevIdx = btnIdx;
    form.button("§w上一页", "textures/icons/left_arrow");
    btnIdx++;
  }
  if (pageClamped < totalPages) {
    nextIdx = btnIdx;
    form.button("§w下一页", "textures/icons/right_arrow");
    btnIdx++;
  }
  const backIdx = btnIdx;
  form.button("§w返回", "textures/icons/back");

  const res = await form.show(player);
  if (res.canceled || res.selection === undefined) return;
  const sel = res.selection;

  if (sel < slice.length) {
    await rowActions[sel]();
    return;
  }
  if (prevIdx >= 0 && sel === prevIdx) {
    await openGuildMemberListForm(player, pageClamped - 1);
    return;
  }
  if (nextIdx >= 0 && sel === nextIdx) {
    await openGuildMemberListForm(player, pageClamped + 1);
    return;
  }
  if (sel === backIdx) {
    await openGuildMyGuildMenu(player);
  }
}

/**
 * 在信息框中展示当前玩家所在公会的信息与公告（与服务器信息框同类 UI）
 */
export function openGuildInfoForm(player: Player): void {
  const g = guildService.getGuildForPlayer(player);
  if (!g) {
    openDialogForm(
      player,
      { title: "提示", desc: color.yellow("你不在任何公会中。") },
      () => void openGuildMyGuildMenu(player)
    );
    return;
  }

  const form = createGuildInfoMessageForm(g);
  form.show(player).then((data) => {
    if (data.canceled) return;
    switch (data.selection) {
      case 0:
        openGuildInfoForm(player);
        break;
      case 1:
        void openGuildMyGuildMenu(player);
        break;
      default:
        break;
    }
  });
}

/** 添加公会坐标：与私人坐标相同，输入名称 + 当前位置 */
async function openAddGuildWaypointForm(player: Player): Promise<void> {
  const form = new ModalFormData();
  form.title("§w添加公会坐标");
  form.label("§7添加公会坐标时，若管理员配置了费用，将从§6公会金库§7扣除（不按私人坐标规则扣个人）。");
  form.textField("§w坐标点名称", "与私人坐标相同：当前位置 + 名称；不占私人名额，不可含冒号");
  form.submitButton("确定");

  const res = await form.show(player);
  if (res.canceled) {
    await openGuildCoordMenu(player);
    return;
  }
  const raw = (res.formValues as unknown[] | undefined)?.[0];
  const name = raw !== undefined && raw !== null ? String(raw) : "";
  const err = guildService.addGuildWaypoint(player, name);
  openDialogForm(
    player,
    {
      title: err ? "失败" : "已添加",
      desc: err ? color.red(err) : color.green("已保存本会公会坐标。"),
    },
    () => void openGuildCoordMenu(player)
  );
}

async function openGuildCoordWaypointDetail(player: Player, dbKey: string, role: GuildRole): Promise<void> {
  const canOfficer = role === "owner" || role === "officer";
  if (!canOfficer) {
    const err = guildService.teleportToGuildWaypointDbKey(player, dbKey);
    if (err) {
      openDialogForm(player, { title: "无法传送", desc: color.red(err) }, () => void openGuildCoordMenu(player));
    }
    return;
  }

  const wp = wayPoint.getPointByDbKey(dbKey);
  const sp = splitWaypointDbKey(dbKey);
  const label = wp ? stripSectionForUi(wp.name) : sp ? stripSectionForUi(sp.pointName) : "?";

  const form = new ActionFormData();
  form.title("§w" + label);
  form.body(`§7公会坐标 · 本会共有\n§8${wp ? getDimensionName(wp.dimension) : "?"}`);

  const actions: Array<() => void | Promise<void>> = [];

  form.button("§w传送至此", "textures/icons/fast_travel");
  actions.push(() => {
    const err = guildService.teleportToGuildWaypointDbKey(player, dbKey);
    if (err) {
      openDialogForm(
        player,
        { title: "无法传送", desc: color.red(err) },
        () => void openGuildCoordWaypointDetail(player, dbKey, role)
      );
    }
  });

  form.button("§w更新为当前位置", "textures/icons/ada");
  actions.push(() => {
    const err = guildService.relocateGuildWaypointToHere(player, dbKey);
    openDialogForm(
      player,
      {
        title: err ? "失败" : "已更新",
        desc: err ? color.red(err) : color.green("已将该坐标更新为当前位置。"),
      },
      () => void openGuildCoordWaypointDetail(player, dbKey, role)
    );
  });

  form.button("§c删除此坐标", "textures/icons/deny");
  actions.push(() => {
    openConfirmDialogForm(
      player,
      "删除公会坐标",
      `§e确定删除「${label}」吗？`,
      () => {
        const err = guildService.removeGuildWaypointByDbKey(player, dbKey);
        openDialogForm(
          player,
          {
            title: err ? "失败" : "已删除",
            desc: err ? color.red(err) : color.gray("已删除该公会坐标。"),
          },
          () => void openGuildCoordMenu(player)
        );
      },
      () => void openGuildCoordWaypointDetail(player, dbKey, role),
      { dangerConfirm: true }
    );
  });

  form.button("§w返回", "textures/icons/back");
  actions.push(() => void openGuildCoordMenu(player));

  const res = await form.show(player);
  if (res.canceled || res.selection === undefined) return;
  const fn = actions[res.selection];
  if (fn) await fn();
}

/**
 * 公会坐标集合：列表传送；会长/副会长可添加（与私人坐标同名逻辑）、更新位置、删除
 */
async function openGuildCoordMenu(player: Player): Promise<void> {
  const guild = guildService.getGuildForPlayer(player);
  const role = guildService.getMemberRole(player);
  if (!guild || !role) {
    await openGuildMyGuildMenu(player);
    return;
  }

  guildService.ensureGuildWaypointsNormalized(guild);
  const keys = guildService.getGuildWaypointDbKeys(guild);
  const capRaw = Number(setting.getState("guildMaxWaypointsPerGuild"));
  const capN = Number.isFinite(capRaw) && capRaw >= 0 ? Math.floor(capRaw) : 20;

  const form = new ActionFormData();
  form.title("§w公会坐标");
  form.body(
    [
      `§f§l公会坐标§r §7· §7归属本会，与个人私人坐标独立`,
      ``,
      `§7本会已保存 §b§l${keys.length}§r §7/ §b${capN} §7个`,
      ``,
      `§7成员点选名称即可传送；会长/副会长可添加、改位置或删除。`,
      ``,
      `§7新增坐标可能消耗§6公会金库§7（管理员可配置）。`,
    ].join("\n")
  );

  const actions: Array<() => void | Promise<void>> = [];

  for (const dbKey of keys) {
    const wp = wayPoint.getPointByDbKey(dbKey);
    const sp = splitWaypointDbKey(dbKey);
    const nm = wp ? stripSectionForUi(wp.name) : sp ? stripSectionForUi(sp.pointName) : "?";
    const sub = wp ? getDimensionName(wp.dimension) : "数据失效";
    form.button(`§l§e${nm}§r\n§8${sub}`, "textures/icons/fast_travel");
    actions.push(() => openGuildCoordWaypointDetail(player, dbKey, role));
  }

  if (role === "owner" || role === "officer") {
    form.button("§w添加公会坐标（当前位置）", "textures/icons/add");
    actions.push(() => void openAddGuildWaypointForm(player));
  }

  form.button("§w返回", "textures/icons/back");
  actions.push(() => void openGuildMyGuildMenu(player));

  const res = await form.show(player);
  if (res.canceled || res.selection === undefined) return;
  const fn = actions[res.selection];
  if (fn) await fn();
}

async function openGuildLandSingleMenu(player: Player, land: ILand): Promise<void> {
  const role = guildService.getMemberRole(player);
  const canOfficer = role === "owner" || role === "officer";
  const isLandOwner = land.owner === player.name;
  if (!canOfficer && !isLandOwner) {
    openDialogForm(
      player,
      {
        title: "领地",
        desc: `${color.yellow(stripSectionForUi(land.name))}\n${color.gray("本会登记的公会领地（仅会长/副会长或圈地者可解除绑定）")}`,
      },
      () => void openGuildLandListSubmenu(player)
    );
    return;
  }

  const form = new ActionFormData();
  form.title("§w公会领地");
  form.body(`§e§l${stripSectionForUi(land.name)}§r\n§7公会领地 · 本会登记地块\n\n§8要解除本领地与公会的绑定吗？`);
  form.button("§c解除公会绑定", "textures/icons/deny");
  form.button("§w返回", "textures/icons/back");
  const res = await form.show(player);
  if (res.canceled || res.selection === undefined) return;
  if (res.selection === 0) {
    const err = isLandOwner
      ? guildService.unbindLandFromGuild(player, land.name)
      : guildService.unbindGuildLandByOfficer(player, land.name);
    openDialogForm(
      player,
      { title: err ? "失败" : "成功", desc: err ? color.red(err) : color.green("已解除公会领地绑定。") },
      () => void openGuildLandListSubmenu(player)
    );
  } else {
    openGuildLandListSubmenu(player);
  }
}

async function openBindGuildLandPickForm(player: Player): Promise<void> {
  if (!guildService.getGuildForPlayer(player)) {
    openDialogForm(
      player,
      { title: "提示", desc: color.gray("你不在公会中。") },
      () => void openGuildMyGuildMenu(player)
    );
    return;
  }
  const candidates = landManager.getPlayerLands(player.name).filter((l) => !l.guildId);
  if (candidates.length === 0) {
    openDialogForm(
      player,
      {
        title: "提示",
        desc: color.gray("你没有可登记的领地（需先创建领地，且尚未登记为公会领地）。"),
      },
      () => void openGuildLandsMenu(player)
    );
    return;
  }
  const form = new ModalFormData();
  form.title("§w登记公会领地");
  form.label(
    "§7选择要领地登记为公会领地：登记后该地块不再占用你的个人领地上限；公会侧受「每公会最大公会领地数」限制。若管理员配置了登记费用，将从§6公会金库§7扣除。"
  );
  const names = candidates.map((l) => l.name);
  form.dropdown("§w领地", names, { defaultValueIndex: 0 });
  form.submitButton("确认");
  const res = await form.show(player);
  if (res.canceled) {
    openGuildLandsMenu(player);
    return;
  }
  const idx = Number((res.formValues as unknown[] | undefined)?.[0]);
  const land = candidates[Number.isFinite(idx) ? idx : 0];
  if (!land) {
    openGuildLandsMenu(player);
    return;
  }
  const err = guildService.trustGuildMembersInLand(player, land.name);
  openDialogForm(
    player,
    { title: err ? "失败" : "成功", desc: err ? color.red(err) : color.green("已登记为公会领地。") },
    () => void openGuildLandListSubmenu(player)
  );
}

/** 子界面：列出本会已登记公会领地，点击条目进入详情 */
async function openGuildLandListSubmenu(player: Player): Promise<void> {
  const g = guildService.getGuildForPlayer(player);
  if (!g) {
    openDialogForm(
      player,
      { title: "提示", desc: color.gray("你不在公会中。") },
      () => void openGuildMyGuildMenu(player)
    );
    return;
  }
  const bound = guildService.getLandsBoundToGuild(g.id);
  const maxGuildLandsRaw = Number(setting.getState("guildMaxLandsPerGuild"));
  const maxGuildLandsCap =
    Number.isFinite(maxGuildLandsRaw) && maxGuildLandsRaw >= 0 ? Math.floor(maxGuildLandsRaw) : 5;

  const form = new ActionFormData();
  form.title("§w公会领地列表");
  if (bound.length === 0) {
    form.body(
      [`§f§l公会领地列表§r §7· §7本会暂无已登记地块`, ``, `§7配额 §b§l0§r §7/ §b${maxGuildLandsCap} §7块`].join("\n")
    );
  } else {
    form.body(
      [
        `§f§l公会领地列表§r §7· §7共 §b§l${bound.length}§r §7块`,
        ``,
        `§7配额 §b§l${bound.length}§r §7/ §b${maxGuildLandsCap} §7块`,
        ``,
        `§7点击下方条目可查看详情或解除绑定`,
      ].join("\n")
    );
  }

  const actions: Array<() => void | Promise<void>> = [];

  for (const land of bound) {
    const ln = stripSectionForUi(land.name);
    form.button(`§l§e${ln}§r\n§8${getDimensionName(land.dimension)}`, "textures/icons/island");
    actions.push(() => openGuildLandSingleMenu(player, land));
  }

  form.button("§w返回", "textures/icons/back");
  actions.push(() => void openGuildLandsMenu(player));

  const res = await form.show(player);
  if (res.canceled || res.selection === undefined) return;
  const fn = actions[res.selection];
  if (fn) await fn();
}

async function openGuildLandsMenu(player: Player): Promise<void> {
  const g = guildService.getGuildForPlayer(player);
  if (!g) {
    openDialogForm(
      player,
      { title: "提示", desc: color.gray("你不在公会中。") },
      () => void openGuildMyGuildMenu(player)
    );
    return;
  }
  const role = guildService.getMemberRole(player);
  const bound = guildService.getLandsBoundToGuild(g.id);
  const maxGuildLandsRaw = Number(setting.getState("guildMaxLandsPerGuild"));
  const maxGuildLandsCap =
    Number.isFinite(maxGuildLandsRaw) && maxGuildLandsRaw >= 0 ? Math.floor(maxGuildLandsRaw) : 5;

  const form = new ActionFormData();
  form.title("§w公会领地");
  const bodyLines = [
    `§f§l公会领地§r §7· §7与个人领地上限分开计算`,
    ``,
    `§7登记配额 §b§l${bound.length}§r §7/ §b${maxGuildLandsCap} §7块`,
    ``,
    `§7请点下方 §e「公会领地列表」§7 浏览已登记地块`,
    ``,
    `§7新建/登记公会领地时，相关费用从§6公会金库§7扣除（管理员可配置）。`,
  ];
  if (role === "owner" || role === "officer") {
    bodyLines.push(``, `§6§l会长 / 副会长§r §7可使用「新建」「登记」`, `§7（木棍圈两点，或先有个人领地再登记）`);
  }
  form.body(bodyLines.join("\n"));

  const actions: Array<() => void | Promise<void>> = [];

  form.button(`§e§l公会领地列表§r\n§8查看已登记领地`, "textures/icons/island");
  actions.push(() => void openGuildLandListSubmenu(player));

  if (role === "owner" || role === "officer") {
    form.button("§w新建公会领地（木棍圈地）", "textures/icons/ada");
    actions.push(() => {
      openLandApplyForm(player, { guildId: g.id, onSuccess: () => void openGuildLandListSubmenu(player) });
    });
    form.button("§w登记已有领地为公会领地", "textures/icons/add");
    actions.push(() => openBindGuildLandPickForm(player));
  }

  form.button("§w返回", "textures/icons/back");
  actions.push(() => void openGuildMyGuildMenu(player));

  const res = await form.show(player);
  if (res.canceled || res.selection === undefined) return;
  const fn = actions[res.selection];
  if (fn) await fn();
}

/**
 * 公会一级入口：「公会列表」「我的公会」「返回服务器菜单」
 */
export async function openGuildMenuForm(player: Player): Promise<void> {
  if (guildService.isModuleEnabled() !== true) {
    openDialogForm(
      player,
      { title: "提示", desc: color.red("公会功能已关闭。") },
      () => void openServerMenuForm(player)
    );
    return;
  }

  const pending = guildService.getPendingInviteSummary(player.name);
  const form = new ActionFormData();
  form.title("§w公会");
  let body = "§7请选择一项。\n";
  if (pending) {
    body += "§e你有待处理的公会邀请，请进入「我的公会」处理。\n";
  }
  form.body(body);
  form.button("§w公会列表", "textures/icons/island");
  form.button("§w我的公会", "textures/icons/bina");
  form.button("§w返回", "textures/icons/back");

  const res = await form.show(player);
  if (res.canceled || res.selection === undefined) return;
  if (res.selection === 0) {
    await openGuildBrowseListForm(player, 1);
  } else if (res.selection === 1) {
    await openGuildMyGuildMenu(player);
  } else {
    openServerMenuForm(player);
  }
}

/**
 * 我的公会：创建、邀请、金库、领地等（原主菜单）
 */
async function openGuildMyGuildMenu(player: Player): Promise<void> {
  const guild = guildService.getGuildForPlayer(player);
  const pending = guildService.getPendingInviteSummary(player.name);
  const role = guildService.getMemberRole(player);

  const form = new ActionFormData();
  form.title("§w我的公会");
  let body = "§7请选择下方操作。\n";
  if (pending) {
    body += "§e你有一条待处理的公会邀请。\n";
  }
  if (guild) {
    body += `§a当前公会: §f[${guild.tag}] ${guild.name}\n`;
    body += `${guildService.getGuildHomeSummaryLine(guild)}\n`;
    body += guildService.getGuildLandSummaryLine(guild);
  } else {
    body += "§7你尚未加入任何公会。";
  }
  form.body(body);

  const actions: Array<() => void | Promise<void>> = [];

  if (pending) {
    form.button("§w处理待处理邀请", "textures/icons/marker_quest");
    actions.push(() => openPendingInviteForm(player));
  }

  if (!guild) {
    form.button("§w创建公会", "textures/icons/add");
    actions.push(() => openCreateGuildForm(player));
  } else {
    form.button("§w公会信息与公告", "textures/icons/duyuru");
    actions.push(() => openGuildInfoForm(player));
    form.button("§w成员列表", "textures/icons/faces");
    actions.push(() => {
      openGuildMemberListForm(player);
    });
    form.button("§w公会坐标", "textures/icons/fast_travel");
    actions.push(() => void openGuildCoordMenu(player));
    form.button("§w公会领地", "textures/icons/bina");
    actions.push(() => void openGuildLandsMenu(player));
    form.button("§w公会历史", "textures/icons/saat");
    actions.push(() => void openGuildHistoryForm(player, guild.id, 0, []));
    if (role === "owner" || role === "officer") {
      form.button("§w邀请玩家", "textures/icons/party_invites");
      actions.push(() => openInvitePlayerForm(player));
    }
    if (role === "owner" || role === "officer") {
      form.button("§w申请加入列表", "textures/icons/social");
      actions.push(() => openGuildJoinRequestListForm(player, 1));
    }
    form.button("§w公会金库", "textures/icons/clock");
    actions.push(() => openGuildBankMenu(player));
    if (role === "owner" || role === "officer") {
      form.button("§w编辑公告", "textures/icons/marker_quest");
      actions.push(() => openAnnounceForm(player));
    }
    if (role === "owner" || role === "officer") {
      form.button("§w成员管理", "textures/icons/party_remove");
      actions.push(() => openMemberManageMenu(player));
    }
    if (role !== "owner") {
      form.button("§c退出公会", "textures/icons/deny");
      actions.push(() => confirmLeaveGuild(player));
    }
    if (role === "owner") {
      form.button("§c解散公会", "textures/icons/deny");
      actions.push(() => confirmDisbandGuild(player));
    }
  }

  form.button("§w返回", "textures/icons/back");
  actions.push(() => void openGuildMenuForm(player));

  const res = await form.show(player);
  if (res.canceled || res.selection === undefined) return;
  const fn = actions[res.selection];
  if (fn) await fn();
}

async function openPendingInviteForm(player: Player): Promise<void> {
  const s = guildService.getPendingInviteSummary(player.name);
  if (!s) {
    openDialogForm(
      player,
      { title: "提示", desc: color.gray("暂无待处理邀请。") },
      () => void openGuildMyGuildMenu(player)
    );
    return;
  }

  const form = new ActionFormData();
  form.title("§w公会邀请");
  form.body(`§e邀请者: §f${s.inviterName}\n§f[${s.guildTag}] ${s.guildName}\n\n§7请选择是否加入该公会。`);
  form.button("§w接受", "textures/icons/accept");
  form.button("§c拒绝", "textures/icons/deny");
  form.button("§w返回", "textures/icons/back");

  const r = await form.show(player);
  if (r.canceled || r.selection === undefined) return;

  if (r.selection === 0) {
    const err = guildService.acceptInvite(player);
    openDialogForm(
      player,
      {
        title: err ? "无法接受" : "已加入",
        desc: err ? color.red(err) : color.green("欢迎加入公会！"),
      },
      () => void openGuildMyGuildMenu(player)
    );
  } else if (r.selection === 1) {
    const err = guildService.declineInvite(player);
    openDialogForm(
      player,
      {
        title: "已拒绝",
        desc: err ? color.gray(err) : color.gray("已拒绝该邀请。"),
      },
      () => void openGuildMyGuildMenu(player)
    );
  } else {
    await openGuildMyGuildMenu(player);
  }
}

async function openCreateGuildForm(player: Player): Promise<void> {
  const cost = numSetting("guildCreateCost");
  const nameMax = numSetting("guildNameMaxLen");
  const tagMax = numSetting("guildTagMaxLen");

  const form = new ModalFormData();
  const economyOn = setting.getState("economy") === true;
  form.title(
    economyOn && cost > 0
      ? `§w创建公会 §7(§6${cost}§7 金币 · 余额 §6${economic.getWallet(player.name).gold}§7)`
      : "§w创建公会"
  );
  form.textField(`公会展示名（最多 ${nameMax} 字）`, "输入名称", { defaultValue: "" });
  form.textField(`公会短标签（最多 ${tagMax} 字，用于聊天/头顶前缀）`, "例如 ABC", { defaultValue: "" });
  form.submitButton("确认创建");

  const res = await form.show(player);
  if (res.canceled) {
    await openGuildMyGuildMenu(player);
    return;
  }

  const fv = res.formValues as string[] | undefined;
  const name = String(fv?.[0] ?? "").trim();
  const tag = String(fv?.[1] ?? "").trim();

  if (!name || !tag) {
    openDialogForm(
      player,
      { title: "创建失败", desc: color.red("名称与标签不能为空。") },
      () => void openGuildMyGuildMenu(player)
    );
    return;
  }

  const err = guildService.createGuild(player, name, tag);
  openDialogForm(
    player,
    {
      title: err ? "创建失败" : "创建成功",
      desc: err ? color.red(err) : color.green("公会已创建，你是会长。"),
    },
    () => void openGuildMyGuildMenu(player)
  );
}

async function openInvitePlayerForm(player: Player): Promise<void> {
  const eligibleNames = world
    .getPlayers()
    .map((p) => p.name)
    .filter((n) => n !== player.name)
    .filter((n) => !guildService.getGuildIdForPlayerName(n))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  if (eligibleNames.length === 0) {
    openDialogForm(
      player,
      {
        title: "提示",
        desc: color.gray("当前没有可邀请的在线玩家（需未加入任何公会）。"),
      },
      () => void openGuildMyGuildMenu(player)
    );
    return;
  }

  const form = new ModalFormData();
  form.title("§w邀请玩家");
  form.dropdown("§w选择要邀请的玩家", ["-- 请选择 --", ...eligibleNames], {
    defaultValueIndex: 0,
  });
  form.submitButton("发送邀请");

  const res = await form.show(player);
  if (res.canceled) {
    await openGuildMyGuildMenu(player);
    return;
  }

  const raw = (res.formValues as unknown[] | undefined)?.[0];
  const selectedIndex = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(selectedIndex) || selectedIndex < 1) {
    openDialogForm(
      player,
      { title: "失败", desc: color.red("请在下拉框中选择一名玩家。") },
      () => void openGuildMyGuildMenu(player)
    );
    return;
  }

  const target = eligibleNames[selectedIndex - 1];
  if (!target) {
    openDialogForm(
      player,
      { title: "失败", desc: color.red("请在下拉框中选择一名玩家。") },
      () => void openGuildMyGuildMenu(player)
    );
    return;
  }

  const err = guildService.invite(player, target);
  openDialogForm(
    player,
    {
      title: err ? "邀请失败" : "已发送",
      desc: err ? color.red(err) : color.green("若对方在线，将收到邀请提示；对方可在「公会」菜单中处理。"),
    },
    () => void openGuildMyGuildMenu(player)
  );
}

async function openGuildBankMenu(player: Player): Promise<void> {
  const g = guildService.getGuildForPlayer(player);
  const wallet = economic.getWallet(player.name).gold;
  const treasury = g?.treasuryGold ?? 0;

  const form = new ActionFormData();
  form.title("§w公会金库");
  form.body(`§7个人余额: §6${wallet}\n§7金库余额: §6${treasury}`);
  form.button("§w存入金币", "textures/icons/shop_bank");
  form.button("§w取出金币", "textures/icons/shop_bank");
  form.button("§w返回", "textures/icons/back");

  const res = await form.show(player);
  if (res.canceled || res.selection === undefined) return;

  if (res.selection === 2) {
    await openGuildMyGuildMenu(player);
    return;
  }

  const isDeposit = res.selection === 0;
  const amountForm = new ModalFormData();
  amountForm.title(isDeposit ? "§w存入金库" : "§w从金库取出");
  amountForm.textField("金额（正整数）", "输入金币数量", { defaultValue: "1" });
  amountForm.submitButton("确认");

  const ar = await amountForm.show(player);
  if (ar.canceled) {
    await openGuildBankMenu(player);
    return;
  }

  const amt = Math.floor(Number((ar.formValues as string[] | undefined)?.[0]));
  if (!Number.isFinite(amt) || amt <= 0) {
    openDialogForm(player, { title: "失败", desc: color.red("金额无效。") }, () => void openGuildBankMenu(player));
    return;
  }

  const err = isDeposit ? guildService.treasuryDeposit(player, amt) : guildService.treasuryWithdraw(player, amt);
  openDialogForm(
    player,
    {
      title: err ? "操作失败" : "成功",
      desc: err ? color.red(err) : color.green(isDeposit ? "已存入公会金库。" : "已从金库取出到钱包。"),
    },
    () => void openGuildBankMenu(player)
  );
}

async function openAnnounceForm(player: Player): Promise<void> {
  const form = new ModalFormData();
  form.title("§w编辑公告");
  form.textField("公告内容（最多约 200 字）", "输入公告", { defaultValue: "" });
  form.submitButton("保存");

  const res = await form.show(player);
  if (res.canceled) {
    await openGuildMyGuildMenu(player);
    return;
  }

  const text = String((res.formValues as string[] | undefined)?.[0] ?? "").trim();
  if (!text) {
    openDialogForm(
      player,
      { title: "失败", desc: color.red("公告不能为空。") },
      () => void openGuildMyGuildMenu(player)
    );
    return;
  }

  const err = guildService.setAnnouncement(player, text);
  openDialogForm(
    player,
    {
      title: err ? "失败" : "已保存",
      desc: err ? color.red(err) : color.green("公告已更新。"),
    },
    () => void openGuildMyGuildMenu(player)
  );
}

function sortMemberNames(names: string[]): string[] {
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/** 踢人可选名单：会长可踢除会长外所有人；副会长仅可踢普通成员 */
function buildKickTargetNames(g: IGuild, actorName: string): string[] {
  const actorRole = g.members[actorName]?.role;
  if (actorRole === "owner") {
    return sortMemberNames(Object.keys(g.members).filter((n) => n !== g.ownerName));
  }
  if (actorRole === "officer") {
    return sortMemberNames(Object.keys(g.members).filter((n) => g.members[n]?.role === "member"));
  }
  return [];
}

function buildPromoteTargetNames(g: IGuild): string[] {
  return sortMemberNames(Object.keys(g.members).filter((n) => g.members[n]?.role === "member"));
}

function buildDemoteTargetNames(g: IGuild): string[] {
  return sortMemberNames(Object.keys(g.members).filter((n) => g.members[n]?.role === "officer"));
}

function buildTransferTargetNames(g: IGuild, ownerName: string): string[] {
  return sortMemberNames(Object.keys(g.members).filter((n) => n !== ownerName));
}

/**
 * 从公会持久化成员列表中选择目标（含离线成员，不要求在线）
 */
async function openMemberTargetModal(
  player: Player,
  title: string,
  pickNames: (g: IGuild) => string[],
  run: (name: string) => string
): Promise<void> {
  const g = guildService.getGuildForPlayer(player);
  if (!g) {
    openDialogForm(
      player,
      { title: "失败", desc: color.red("无法获取公会数据。") },
      () => void openMemberManageMenu(player)
    );
    return;
  }

  const candidates = pickNames(g);
  if (candidates.length === 0) {
    openDialogForm(
      player,
      { title: "提示", desc: color.gray("没有符合条件的成员。") },
      () => void openMemberManageMenu(player)
    );
    return;
  }

  const form = new ModalFormData();
  form.title(`§w${title}`);
  form.dropdown("§w选择目标成员", ["-- 请选择 --", ...candidates], { defaultValueIndex: 0 });
  form.submitButton("确认");

  const res = await form.show(player);
  if (res.canceled) {
    await openMemberManageMenu(player);
    return;
  }

  const raw = (res.formValues as unknown[] | undefined)?.[0];
  const selectedIndex = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(selectedIndex) || selectedIndex < 1) {
    openDialogForm(
      player,
      { title: "失败", desc: color.red("请在下拉框中选择一名成员。") },
      () => void openMemberManageMenu(player)
    );
    return;
  }

  const target = candidates[selectedIndex - 1];
  if (!target) {
    openDialogForm(
      player,
      { title: "失败", desc: color.red("请在下拉框中选择一名成员。") },
      () => void openMemberManageMenu(player)
    );
    return;
  }

  const err = run(target);
  openDialogForm(
    player,
    {
      title: err ? "失败" : "成功",
      desc: err ? color.red(err) : color.green("操作已完成。"),
    },
    () => void openMemberManageMenu(player)
  );
}

async function openMemberManageMenu(player: Player): Promise<void> {
  const role = guildService.getMemberRole(player);
  const form = new ActionFormData();
  form.title("§w成员管理");
  form.body(
    "§7每项操作会列出本公会已登记成员（含离线），请在下拉框中选择。\n\n§c踢人：副会长不可踢副会长；副会长仅可踢普通成员。"
  );

  const actions: Array<() => void | Promise<void>> = [];

  form.button("§c踢出成员", "textures/icons/leave");
  actions.push(() =>
    openMemberTargetModal(
      player,
      "踢出成员",
      (g) => buildKickTargetNames(g, player.name),
      (name) => guildService.kick(player, name)
    )
  );

  if (role === "owner") {
    form.button("§w晋升为副会长", "textures/icons/accept");
    actions.push(() =>
      openMemberTargetModal(player, "晋升为副会长", buildPromoteTargetNames, (name) =>
        guildService.promote(player, name)
      )
    );
    form.button("§w降为成员", "textures/icons/requeue");
    actions.push(() =>
      openMemberTargetModal(player, "降为成员", buildDemoteTargetNames, (name) => guildService.demote(player, name))
    );
    form.button("§c转让会长", "textures/icons/shop_bank");
    actions.push(() =>
      openMemberTargetModal(
        player,
        "转让会长",
        (g) => buildTransferTargetNames(g, player.name),
        (name) => guildService.transferOwnership(player, name)
      )
    );
  }

  form.button("§w返回", "textures/icons/back");
  actions.push(() => void openGuildMyGuildMenu(player));

  const res = await form.show(player);
  if (res.canceled || res.selection === undefined) return;
  const fn = actions[res.selection];
  if (fn) await fn();
}

function confirmLeaveGuild(player: Player): void {
  openConfirmDialogForm(
    player,
    "§w退出公会",
    "§e确定退出当前公会吗？",
    () => {
      const err = guildService.leaveGuild(player);
      openDialogForm(
        player,
        {
          title: err ? "失败" : "已退出",
          desc: err ? color.red(err) : color.green("你已离开公会。"),
        },
        () => void openGuildMyGuildMenu(player)
      );
    },
    () => void openGuildMyGuildMenu(player),
    { dangerConfirm: true }
  );
}

function confirmDisbandGuild(player: Player): void {
  openConfirmDialogForm(
    player,
    "§w解散公会",
    "§c§l解散后所有成员将被移出，金库数据随公会删除。确定吗？",
    () => {
      const err = guildService.disbandGuild(player);
      openDialogForm(
        player,
        {
          title: err ? "失败" : "已解散",
          desc: err ? color.red(err) : color.red("公会已解散。"),
        },
        () => void openGuildMyGuildMenu(player)
      );
    },
    () => void openGuildMyGuildMenu(player),
    { dangerConfirm: true }
  );
}
