/**
 * PVP系统UI表单
 */

import { Player, system } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import pvpManager from "../../../features/pvp/services/pvp-manager";
import statsManager from "../../../features/pvp/services/pvp-stats";
import { color } from "../../../shared/utils/color";
import { openServerMenuForm } from "../server";

/**
 * 打开PVP主菜单
 */
export async function openPvpSystemForm(player: Player): Promise<void> {
  const data = pvpManager.getPlayerData(player.name);
  const config = pvpManager.getConfig();

  // 检查PVP功能是否启用
  if (!config.enabled) {
    player.sendMessage(color.red("PVP功能未启用！"));
    return;
  }

  const form = new ActionFormData();
  form.title("§wPVP系统");

  const status = data.pvpEnabled ? "§a已开启" : "§c已关闭";
  const combatStatus = data.inCombat ? "§c战斗中" : "§a安全";

  form.body(
    `当前PVP状态：${status}\n战斗状态：${combatStatus}\n\n§e击杀数：§f${data.kills}\n§e死亡数：§f${data.deaths}\n§e当前连杀：§f${data.killStreak}\n§e最佳连杀：§f${data.bestKillStreak}\n§e总夺取金币：§f${data.totalSeized}\n§e总被夺取金币：§f${data.totalLost}`
  );

  form.button(data.pvpEnabled ? "§c关闭PVP" : "§a开启PVP", "textures/icons/sword");
  form.button("§w查看详细统计", "textures/icons/book");
  form.button("§w排行榜", "textures/icons/clock");
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((response) => {
    if (response.canceled) return;

    switch (response.selection) {
      case 0: // 切换PVP
        const result = pvpManager.togglePvp(player);
        player.sendMessage(result.success ? color.green(result.message) : color.red(result.message));
        if (result.success) {
          system.runTimeout(() => openPvpSystemForm(player), 20);
        } else {
          system.runTimeout(() => openPvpSystemForm(player), 40);
        }
        break;
      case 1: // 查看统计
        openPvpStatsForm(player);
        break;
      case 2: // 排行榜
        openPvpLeaderboardMenu(player);
        break;
      case 3: // 返回
        openServerMenuForm(player);
        break;
    }
  });
}

/**
 * 打开PVP统计表单
 */
function openPvpStatsForm(player: Player): void {
  const data = pvpManager.getPlayerData(player.name);

  // 计算K/D比
  const kd = data.deaths === 0 ? data.kills : (data.kills / data.deaths).toFixed(2);

  // 获取玩家排名
  const killRank = statsManager.getPlayerRank(player.name, "kills");
  const streakRank = statsManager.getPlayerRank(player.name, "killStreak");
  const seizeRank = statsManager.getPlayerRank(player.name, "seize");

  const form = new ActionFormData();
  form.title("§wPVP统计");

  form.body(
    `§e=== 战斗统计 ===\n` +
      `§e击杀数：§f${data.kills} §7(排名: ${killRank === -1 ? "未上榜" : `#${killRank}`})\n` +
      `§e死亡数：§f${data.deaths}\n` +
      `§eK/D比：§f${kd}\n\n` +
      `§e=== 连杀统计 ===\n` +
      `§e当前连杀：§f${data.killStreak}\n` +
      `§e最佳连杀：§f${data.bestKillStreak} §7(排名: ${streakRank === -1 ? "未上榜" : `#${streakRank}`})\n\n` +
      `§e=== 金币统计 ===\n` +
      `§e总夺取金币：§f${data.totalSeized} §7(排名: ${seizeRank === -1 ? "未上榜" : `#${seizeRank}`})\n` +
      `§e总被夺取金币：§f${data.totalLost}\n` +
      `§e净收益：§f${data.totalSeized - data.totalLost}`
  );

  form.button("§w返回", "textures/icons/back");

  form.show(player).then((response) => {
    if (response.canceled) return;
    openPvpSystemForm(player);
  });
}

/**
 * 打开排行榜菜单
 */
function openPvpLeaderboardMenu(player: Player): void {
  const form = new ActionFormData();
  form.title("§wPVP排行榜");

  form.button("§w击杀排行榜", "textures/icons/sword");
  form.button("§w最佳连杀排行榜", "textures/icons/fire");
  form.button("§w夺取金币排行榜", "textures/icons/clock");
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((response) => {
    if (response.canceled) return;

    switch (response.selection) {
      case 0: // 击杀排行
        openPvpLeaderboardForm(player, "kills");
        break;
      case 1: // 连杀排行
        openPvpLeaderboardForm(player, "killStreak");
        break;
      case 2: // 夺取金币排行
        openPvpLeaderboardForm(player, "seize");
        break;
      case 3: // 返回
        openPvpSystemForm(player);
        break;
    }
  });
}

/**
 * 打开具体排行榜
 */
function openPvpLeaderboardForm(player: Player, type: "kills" | "killStreak" | "seize"): void {
  const leaderboard = statsManager.getLeaderboard(type);

  let title = "";
  let valueName = "";
  switch (type) {
    case "kills":
      title = "击杀排行榜";
      valueName = "击杀数";
      break;
    case "killStreak":
      title = "最佳连杀排行榜";
      valueName = "连杀数";
      break;
    case "seize":
      title = "夺取金币排行榜";
      valueName = "夺取金币";
      break;
  }

  const form = new ActionFormData();
  form.title(`§w${title}`);

  let bodyText = `§e=== ${title} ===\n\n`;
  if (leaderboard.length === 0) {
    bodyText += "§7暂无数据";
  } else {
    leaderboard.forEach((entry, index) => {
      const rank = index + 1;
      const medal = rank === 1 ? "§6🥇" : rank === 2 ? "§f🥈" : rank === 3 ? "§c🥉" : `§7#${rank}`;
      bodyText += `${medal} §e${entry.name}§f - §a${entry.value} §7${valueName}\n`;
    });

    // 显示玩家自己的排名
    const playerRank = statsManager.getPlayerRank(player.name, type);
    if (playerRank > 0) {
      const playerData = pvpManager.getPlayerData(player.name);
      let playerValue = 0;
      switch (type) {
        case "kills":
          playerValue = playerData.kills;
          break;
        case "killStreak":
          playerValue = playerData.bestKillStreak;
          break;
        case "seize":
          playerValue = playerData.totalSeized;
          break;
      }
      bodyText += `\n§e--- 你的排名 ---\n`;
      bodyText += `§7#${playerRank} §e${player.name}§f - §a${playerValue} §7${valueName}`;
    }
  }

  form.body(bodyText);
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((response) => {
    if (response.canceled) return;
    openPvpLeaderboardMenu(player);
  });
}

