/**
 * 经济系统表单
 * 完整迁移自 Modules/Economic/Forms.ts
 */

import { Player } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { color } from "../../../shared/utils/color";
import { openServerMenuForm } from "../server";
import economic from "../../../features/economic/services/economic";
import { openDialogForm } from "../../../ui/components/dialog";
import transferForm from "./transfer-form";
import sellItemsForm from "./sell-items-form";
import ahf from "./auction-house-form";
import { officeShopForm } from "./office-shop-form";

// 经济系统主菜单
export function openEconomyMenuForm(player: Player): void {
  const form = new ActionFormData();
  form.title("§w经济系统");
  form.body({
    rawtext: [
      { text: "§a- 请选择你要进行的操作。\n" },
      { text: "§a- 当前余额: §e" + economic.getWallet(player.name).gold + " 金币" },
    ],
  });

  form.button("§w钱包", "textures/icons/rewards");
  form.button("§w商店", "textures/icons/shop");
  form.button("§w拍卖行", "textures/icons/sandik");
  form.button("§w出售物品", "textures/icons/coins");
  form.button("§w转账", "textures/icons/trade");
  form.button("§w排行榜", "textures/icons/trophy");
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((data) => {
    if (data.canceled) return;

    switch (data.selection) {
      case 0:
        openMyWalletForm(player);
        break;
      case 1:
        // 商店
        officeShopForm.openCategoryList(player);
        break;
      case 2:
        // 拍卖行
        ahf.openMainMenu(player);
        break;
      case 3:
        // 出售物品
        sellItemsForm.openSellItemsMenu(player);
        break;
      case 4:
        // 转账
        transferForm.openTransferMenu(player);
        break;
      case 5:
        openEconomyRankingForm(player);
        break;
      case 6:
        openServerMenuForm(player);
        break;
    }
  });
}

// 我的钱包界面
function openMyWalletForm(player: Player): void {
  const wallet = economic.getWallet(player.name);
  const transactions = economic.getPlayerTransactions(player.name, 5);
  const dailyLimit = economic.getDailyGoldLimit();
  const remainingLimit = economic.getRemainingDailyLimit(player.name);

  const form = new ActionFormData();
  form.title("§w我的钱包");

  let bodyText = `§a当前余额: §e${wallet.gold} 金币\n`;
  bodyText += `§a今日已获得: §e${wallet.dailyEarned} / ${dailyLimit} 金币\n`;
  bodyText += `§a今日剩余额度: §e${remainingLimit} 金币\n\n`;
  bodyText += `§a最近交易记录:\n`;

  if (transactions.length === 0) {
    bodyText += "§7暂无交易记录";
  } else {
    transactions.forEach((tx) => {
      const date = new Date(tx.timestamp).toLocaleString();
      const isIncome = tx.to === player.name;
      const amount = isIncome ? `§a+${tx.amount}` : `§c-${tx.amount}`;
      const otherParty = isIncome ? tx.from : tx.to;

      bodyText += `§7${date} §f| ${amount} §f| ${otherParty} §f| ${tx.reason}\n`;
    });
  }

  form.body({ rawtext: [{ text: bodyText }] });
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((response) => {
    if (response.canceled) return;
    openEconomyMenuForm(player);
  });
}

// 玩家经济排行界面
function openEconomyRankingForm(player: Player): void {
  const allWallets = economic.getAllWallets();
  const sortedWallets = allWallets.sort((a, b) => b.gold - a.gold);

  const playerRank = sortedWallets.findIndex((wallet) => wallet.name === player.name) + 1;
  const playerWallet = economic.getWallet(player.name);

  const top10 = sortedWallets.slice(0, 10);

  const form = new ActionFormData();
  form.title("§w玩家经济排行榜");

  let bodyText = "§e========= §6金币排行榜 §e=========\n\n";

  top10.forEach((wallet, index) => {
    const { otherGlyphMap } = require("../../../assets/glyph-map");
    const namePrefix = otherGlyphMap.cat;
    const rank = index + 1;
    bodyText += `${namePrefix} ${rank}. §b${wallet.name}§f: §e${wallet.gold} 金币\n`;
  });

  bodyText += "\n§e=======================\n\n";

  bodyText += `§a您的排名: §f${playerRank === 0 ? "未上榜" : playerRank}\n`;
  bodyText += `§a您的余额: §e${playerWallet.gold} 金币`;

  form.body({ rawtext: [{ text: bodyText }] });
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((response) => {
    if (response.canceled) return;
    openEconomyMenuForm(player);
  });
}
