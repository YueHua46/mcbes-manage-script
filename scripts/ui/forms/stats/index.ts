/**
 * 全服数据统计中心：财富 / 怪物击杀 / 累计死亡 / PVP 击杀 / 等级 / 在线时长
 */

import { Player } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import economic from "../../../features/economic/services/economic";
import onlineTimeService, { formatOnlineDuration } from "../../../features/player/services/online-time";
import playerStats from "../../../features/statistics/services/player-stats";
import { openPvpLeaderboardForm } from "../pvp";

const TOP_N = 20;

export type StatsFocus = "wealth" | "mobKills" | "totalDeaths" | "pvpKills" | "level" | "onlineTime";

export interface OpenStatsHubOptions {
  focus?: StatsFocus;
  /** 主界面「返回」回调；子榜返回会回到 Hub 或上一级 */
  back?: () => void;
}

/** 与财富榜一致：glyph + `rank. §b名§f: 数值` */
function getStatsGlyphPrefix(): string {
  const { otherGlyphMap } = require("../../../assets/glyph-map");
  return otherGlyphMap.cat;
}

function buildStatsHeader(mainTitle: string, subtitleLines?: string[]): string {
  let s = `§e========= §6${mainTitle} §e=========\n\n`;
  if (subtitleLines?.length) {
    for (const line of subtitleLines) {
      s += `§3${line}\n`;
    }
    s += "\n";
  }
  return s;
}

function buildStatsFooter(rankDisplay: string, detailLines: string[]): string {
  let s = "\n§e=======================\n\n";
  s += `§a您的排名: §f${rankDisplay}\n`;
  for (const line of detailLines) {
    s += `${line}\n`;
  }
  return s.trimEnd();
}

function formatStatsRankRow(rank: number, name: string, valuePart: string): string {
  return `${getStatsGlyphPrefix()} ${rank}. §b${name}§f: ${valuePart}\n`;
}

function showStatsActionForm(player: Player, title: string, bodyText: string, navigateBack: () => void): void {
  const form = new ActionFormData();
  form.title(title);
  form.body({ rawtext: [{ text: bodyText }] });
  form.button("§w返回", "textures/icons/back");
  form.show(player).then((response) => {
    if (response.canceled) return;
    navigateBack();
  });
}

function defaultStatsBack(player: Player): void {
  void import("../server").then((m) => m.openServerMenuForm(player));
}

export function openStatsHubForm(player: Player, options?: OpenStatsHubOptions): void {
  const back = options?.back ?? (() => defaultStatsBack(player));

  if (options?.focus) {
    openStatsSubForm(player, options.focus, () => openStatsHubForm(player, { back }));
    return;
  }

  const form = new ActionFormData();
  form.title("§w数据统计");
  form.body({
    rawtext: [{ text: "§b查看全服排行榜（含离线玩家数据）\n§3请选择榜单类型" }],
  });

  form.button("§w财富排行榜", "textures/icons/trophy");
  form.button("§w击杀排行榜（非玩家生物）", "textures/icons/game_survival_games");
  form.button("§w死亡次数排行榜", "textures/icons/dead");
  form.button("§w击杀排行榜（玩家）", "textures/icons/kilic");
  form.button("§w等级排行榜", "textures/icons/gem");
  form.button("§w在线时长排行榜", "textures/icons/saat");
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled || data.cancelationReason) return;
    const sel = data.selection;
    if (sel === undefined) return;

    const goWealth = () => openStatsSubForm(player, "wealth", () => openStatsHubForm(player, { back }));
    const goMob = () => openStatsSubForm(player, "mobKills", () => openStatsHubForm(player, { back }));
    const goDeath = () => openStatsSubForm(player, "totalDeaths", () => openStatsHubForm(player, { back }));
    const goPvp = () => openStatsSubForm(player, "pvpKills", () => openStatsHubForm(player, { back }));
    const goLevel = () => openStatsSubForm(player, "level", () => openStatsHubForm(player, { back }));
    const goOnline = () => openStatsSubForm(player, "onlineTime", () => openStatsHubForm(player, { back }));

    switch (sel) {
      case 0:
        goWealth();
        return;
      case 1:
        goMob();
        return;
      case 2:
        goDeath();
        return;
      case 3:
        goPvp();
        return;
      case 4:
        goLevel();
        return;
      case 5:
        goOnline();
        return;
      case 6:
        back();
        return;
      default:
        return;
    }
  });
}

function openStatsSubForm(player: Player, focus: StatsFocus, navigateBack: () => void): void {
  switch (focus) {
    case "wealth":
      openWealthLeaderboardForm(player, navigateBack);
      break;
    case "mobKills":
      openMobKillsLeaderboardForm(player, navigateBack);
      break;
    case "totalDeaths":
      openTotalDeathsLeaderboardForm(player, navigateBack);
      break;
    case "pvpKills":
      openPvpLeaderboardForm(player, "kills", { limit: TOP_N, navigateBack, statsHubStyle: true });
      break;
    case "level":
      openLevelLeaderboardForm(player, navigateBack);
      break;
    case "onlineTime":
      openOnlineTimeLeaderboardInStats(player, navigateBack);
      break;
  }
}

function openWealthLeaderboardForm(player: Player, navigateBack: () => void): void {
  const allWallets = economic.getAllWallets();
  const sortedWallets = allWallets.sort((a, b) => b.gold - a.gold);
  const playerRank = sortedWallets.findIndex((wallet) => wallet.name === player.name) + 1;
  const playerWallet = economic.getWallet(player.name);
  const top = sortedWallets.slice(0, TOP_N);

  let bodyText = buildStatsHeader("金币排行榜");
  top.forEach((wallet, index) => {
    const rank = index + 1;
    bodyText += formatStatsRankRow(rank, wallet.name, `§e${wallet.gold} 金币`);
  });
  bodyText += buildStatsFooter(playerRank === 0 ? "未上榜" : String(playerRank), [
    `§a您的余额: §e${playerWallet.gold} 金币`,
  ]);

  showStatsActionForm(player, "§w财富排行榜", bodyText, navigateBack);
}

function openMobKillsLeaderboardForm(player: Player, navigateBack: () => void): void {
  const rows = playerStats.getLeaderboard("mobKills", TOP_N);
  const myVal = playerStats.getMobKills(player.name);
  const myRank = playerStats.getPlayerRank("mobKills", player.name);

  let bodyText = buildStatsHeader("非玩家击杀", [`累计击杀非玩家生物次数（TOP ${TOP_N}）`]);
  if (rows.length === 0) {
    bodyText += "§7暂无数据";
  } else {
    rows.forEach((r, i) => {
      const rank = i + 1;
      bodyText += formatStatsRankRow(rank, r.name, `§e${r.value} 次`);
    });
  }
  bodyText += buildStatsFooter(myRank === -1 ? "未上榜" : String(myRank), [`§a您的击杀: §e${myVal} 次`]);

  showStatsActionForm(player, "§w击杀排行榜（非玩家生物）", bodyText, navigateBack);
}

function openTotalDeathsLeaderboardForm(player: Player, navigateBack: () => void): void {
  const rows = playerStats.getLeaderboard("totalDeaths", TOP_N);
  const myVal = playerStats.getTotalDeaths(player.name);
  const myRank = playerStats.getPlayerRank("totalDeaths", player.name);

  let bodyText = buildStatsHeader("累计死亡", [
    `含怪物、环境、玩家等全部死亡（TOP ${TOP_N}）`,
    "与 PVP 菜单内「被玩家击杀」次数统计不同",
  ]);
  if (rows.length === 0) {
    bodyText += "§7暂无数据";
  } else {
    rows.forEach((r, i) => {
      const rank = i + 1;
      bodyText += formatStatsRankRow(rank, r.name, `§e${r.value} 次`);
    });
  }
  bodyText += buildStatsFooter(myRank === -1 ? "未上榜" : String(myRank), [`§a您的死亡次数: §e${myVal} 次`]);

  showStatsActionForm(player, "§w死亡次数排行榜", bodyText, navigateBack);
}

function openLevelLeaderboardForm(player: Player, navigateBack: () => void): void {
  const rows = playerStats.getLeaderboard("level", TOP_N);
  const mine = playerStats.getDisplayLevelByName(player.name);
  const myRank = playerStats.getPlayerRank("level", player.name);

  let bodyText = buildStatsHeader("等级", [`按等级与本级经验排序（TOP ${TOP_N}）`]);
  if (rows.length === 0) {
    bodyText += "§7暂无数据";
  } else {
    rows.forEach((r, i) => {
      const rank = i + 1;
      const xp = r.subValue ?? 0;
      bodyText += formatStatsRankRow(rank, r.name, `§e${r.value} 级 §f· §3经验 §e${xp}`);
    });
  }
  bodyText += buildStatsFooter(myRank === -1 ? "未上榜" : String(myRank), [
    `§a您的等级: §e${mine.level}`,
    `§a您的本级经验: §e${mine.xpAtCurrentLevel}`,
  ]);

  showStatsActionForm(player, "§w等级排行榜", bodyText, navigateBack);
}

function openOnlineTimeLeaderboardInStats(player: Player, navigateBack: () => void): void {
  const rows = onlineTimeService.getLeaderboard(TOP_N);
  const mySec = onlineTimeService.getDisplayTotalSeconds(player);
  const myRank = onlineTimeService.getPlayerRank(player.name);

  let bodyText = buildStatsHeader("在线时长", [`全服累计在线（TOP ${TOP_N}）`, "含本段在线未落库部分（个人数据）"]);
  if (rows.length === 0) {
    bodyText += "§7暂无已记录的排行数据（游玩后会逐步累计）。";
  } else {
    rows.forEach((r, i) => {
      const rank = i + 1;
      bodyText += formatStatsRankRow(rank, r.name, `§e${formatOnlineDuration(r.totalSeconds)}`);
    });
  }
  bodyText += buildStatsFooter(myRank === -1 ? "未上榜" : String(myRank), [
    `§a您的在线时长: §e${formatOnlineDuration(mySec)}`,
  ]);

  showStatsActionForm(player, "§w在线时长排行榜", bodyText, navigateBack);
}
