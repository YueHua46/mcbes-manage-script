/**
 * 经济系统表单
 * 完整迁移自 Modules/Economic/Forms.ts
 */

import { Player } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { color } from "../../../shared/utils/color";
import { formatDateTime } from "../../../shared/utils/format";
import { openServerMenuForm } from "../server";
import { openStatsHubForm } from "../stats";
import economic from "../../../features/economic/services/economic";
import { openDialogForm } from "../../../ui/components/dialog";
import transferForm from "./transfer-form";
import sellItemsForm from "./sell-items-form";
import ahf from "./auction-house-form";
import { officeShopForm } from "./office-shop-form";
import { getPendingRedPacketHint, openRedPacketMenu } from "./red-packet-form";

// 经济系统主菜单
export function openEconomyMenuForm(player: Player): void {
  const form = new ActionFormData();
  form.title("§w经济系统");

  const hint = getPendingRedPacketHint(player);
  const rawtext: Array<{ text: string }> = [
    { text: "§a- 请选择你要进行的操作。\n" },
    { text: "§a- 当前余额: §e" + economic.getWallet(player.name).gold + " 金币" },
  ];
  if (hint) {
    rawtext.push({ text: hint });
  }
  form.body({ rawtext });

  form.button("§w钱包", "textures/icons/rewards");
  form.button("§w商店", "textures/icons/shop");
  form.button("§w拍卖行", "textures/icons/sandik");
  form.button("§w出售物品", "textures/icons/coins");
  form.button("§w转账", "textures/icons/trade");
  form.button("§w红包", "textures/icons/gift");
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
        openRedPacketMenu(player);
        break;
      case 6:
        openStatsHubForm(player, { focus: "wealth", back: () => openEconomyMenuForm(player) });
        break;
      case 7:
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
      const date = formatDateTime(tx.timestamp);
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

