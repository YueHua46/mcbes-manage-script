import { ActionFormData } from "@minecraft/server-ui";
import { openServerMenuForm } from "../Forms/Forms";
import enconomic from "./Economic";
import ahf from "./AuctionHouse/AuctionHouseForm";
import { officeShopForm } from "./OfficeShop/OfficeShopForm";
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
    form.button("§w我的钱包", "textures/packs/13107521");
    form.button("§w官方商店", "textures/icons/loot");
    form.button("§w玩家商店", "textures/packs/15360196");
    form.button("§w玩家经济排行", "textures/packs/004-trophy");
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
// 玩家经济排行界面（暂未实现）
function openEconomyRankingForm(player) {
    const form = new ActionFormData();
    form.title("§w玩家经济排行");
    form.body({ rawtext: [{ text: "§a该功能尚未实现，敬请期待！" }] });
    form.button("§w返回", "textures/icons/back");
    form.show(player).then((response) => {
        if (response.canceled)
            return;
        openEconomyMenuForm(player);
    });
}
//# sourceMappingURL=Forms.js.map