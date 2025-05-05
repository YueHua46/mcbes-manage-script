import { ActionFormData } from "@minecraft/server-ui";
import { openServerMenuForm } from "../Forms/Forms";
import enconomic from "./Economic";
import ahf from "./AuctionHouse/AuctionHouseForm";
import { officeShopForm } from "./OfficeShop/OfficeShopForm";
import prefix from "../OtherFun/Prefix";
import { usePlayerByName } from "../../hooks/hooks";
// 经济系统主菜单
export function openEconomyMenuForm(player) {
    const form = new ActionFormData();
    form.title("§w经济系统");
    form.body({
        rawtext: [
            { text: "§a- 请选择你要进行的操作。\n" },
            { text: "§a- 当前余额: §e" + enconomic.getWallet(player.name).gold + " 金币" },
        ],
    });
    form.button("§w钱包", "textures/packs/13107521");
    form.button("§w商店", "textures/icons/loot");
    form.button("§w拍卖行", "textures/packs/15360196");
    form.button("§w排行榜", "textures/packs/004-trophy");
    form.button("§w返回", "textures/icons/back");
    form.show(player).then((response) => {
        if (response.canceled)
            return;
        switch (response.selection) {
            case 0:
                openMyWalletForm(player);
                break;
            case 1:
                officeShopForm.openCategoryList(player);
                break;
            case 2:
                // 显示拍卖行主界面
                ahf.openMainMenu(player);
                break;
            case 3:
                openEconomyRankingForm(player);
                break;
            case 4:
                openServerMenuForm(player);
                break;
        }
    });
}
// 我的钱包界面（暂时只显示余额和交易记录）
function openMyWalletForm(player) {
    const wallet = enconomic.getWallet(player.name);
    const transactions = enconomic.getPlayerTransactions(player.name, 5);
    const form = new ActionFormData();
    form.title("§w我的钱包");
    let bodyText = `§a当前余额: §e${wallet.gold} 金币\n\n§a最近交易记录:\n`;
    if (transactions.length === 0) {
        bodyText += "§7暂无交易记录";
    }
    else {
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
        if (response.canceled)
            return;
        openEconomyMenuForm(player);
    });
}
// 玩家经济排行界面
function openEconomyRankingForm(player) {
    // 获取所有钱包数据
    const allWallets = enconomic.getTopWallets();
    // 转换为数组并按金币数量排序（从高到低）
    const sortedWallets = Object.values(allWallets).sort((a, b) => b.gold - a.gold);
    // 查找当前玩家的排名
    const playerRank = sortedWallets.findIndex((wallet) => wallet.name === player.name) + 1;
    const playerWallet = enconomic.getWallet(player.name);
    // 获取前10名
    const top10 = sortedWallets.slice(0, 10);
    // 创建表单
    const form = new ActionFormData();
    form.title("§w玩家经济排行榜");
    // 构建排行榜内容
    let bodyText = "§e========= §6金币排行榜 §e=========\n\n";
    // 添加前10名玩家
    top10.forEach((wallet, index) => {
        // 拿到玩家所设置的头像
        const player = usePlayerByName(wallet.name);
        if (player) {
            const namePrefix = prefix.getPrefix(player);
            const rank = index + 1;
            bodyText += `${namePrefix} <TOP ${rank}> §b${wallet.name}§f: §e${wallet.gold} 金币\n`;
        }
    });
    // 添加分隔线
    bodyText += "\n§e=======================\n\n";
    // 添加玩家自己的排名信息
    bodyText += `§a您的排名: §f${playerRank === 0 ? "未上榜" : playerRank}\n`;
    bodyText += `§a您的余额: §e${playerWallet.gold} 金币`;
    form.body({ rawtext: [{ text: bodyText }] });
    form.button("§w返回", "textures/icons/back");
    form.show(player).then((response) => {
        if (response.canceled)
            return;
        openEconomyMenuForm(player);
    });
}
//# sourceMappingURL=Forms.js.map