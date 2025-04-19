import { Player, world } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { color } from "../../utils/color";
import { openServerMenuForm } from "../Forms/Forms";
import { openDialogForm } from "../Forms/Dialog";
import enconomic from "./Economic";
import { ChestFormData, FurnaceFormData } from "../ChestUI/forms";

// 经济系统主菜单
export function openEconomyMenuForm(player: Player) {
  const form = new ActionFormData();
  form.title("§w经济系统");
  form.body({
    rawtext: [
      { text: "§a欢迎使用经济系统，请选择你要进行的操作。\n" },
      { text: "§a当前余额: §e" + enconomic.getWallet(player.name).gold + " 金币" },
    ],
  });

  form.button("§w我的钱包", "textures/ui/MCoin");
  form.button("§w官方商店", "textures/ui/store_icon");
  form.button("§w玩家商店", "textures/ui/icon_sign");
  form.button("§w玩家经济排行", "textures/ui/FriendsIcon");
  form.button("§w返回", "font/images/back");

  form.show(player).then((response) => {
    if (response.canceled) return;

    switch (response.selection) {
      case 0:
        openMyWalletForm(player);
        break;
      case 1:
        openOfficialShopForm(player);
        break;
      case 2:
        openPlayerShopForm(player);
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
function openMyWalletForm(player: Player) {
  const wallet = enconomic.getWallet(player.name);
  const transactions = enconomic.getPlayerTransactions(player.name, 5);

  const form = new ActionFormData();
  form.title("§w我的钱包");

  let bodyText = `§a当前余额: §e${wallet.gold} 金币\n\n§a最近交易记录:\n`;

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
  form.button("§w返回", "font/images/back");

  form.show(player).then((response) => {
    if (response.canceled) return;
    openEconomyMenuForm(player);
  });
}

// 官方商店界面（使用ChestUI）
function openOfficialShopForm(player: Player) {
  const chestForm = new ChestFormData("54");

  chestForm.title("官方商店");

  // 第一行：基础方块
  chestForm.button(0, "石头", ["价格: 5 金币/个", "点击购买"], "minecraft:stone", 64);
  chestForm.button(1, "泥土", ["价格: 2 金币/个", "点击购买"], "minecraft:dirt", 64);
  chestForm.button(2, "沙子", ["价格: 3 金币/个", "点击购买"], "minecraft:sand", 64);
  chestForm.button(3, "砂砾", ["价格: 3 金币/个", "点击购买"], "minecraft:gravel", 64);
  chestForm.button(4, "木头", ["价格: 8 金币/个", "点击购买"], "minecraft:log", 64);
  chestForm.button(5, "玻璃", ["价格: 10 金币/个", "点击购买"], "minecraft:glass", 64);
  chestForm.button(6, "石砖", ["价格: 15 金币/个", "点击购买"], "minecraft:stonebrick", 64);
  chestForm.button(7, "书架", ["价格: 30 金币/个", "点击购买"], "minecraft:bookshelf", 16);
  chestForm.button(8, "工作台", ["价格: 20 金币/个", "点击购买"], "minecraft:crafting_table", 1);

  // 第二行：矿物
  chestForm.button(9, "煤炭", ["价格: 15 金币/个", "点击购买"], "minecraft:coal", 64);
  chestForm.button(10, "铁锭", ["价格: 30 金币/个", "点击购买"], "minecraft:iron_ingot", 16);
  chestForm.button(11, "金锭", ["价格: 50 金币/个", "点击购买"], "minecraft:gold_ingot", 16);
  chestForm.button(12, "钻石", ["价格: 100 金币/个", "点击购买"], "minecraft:diamond", 8);
  chestForm.button(13, "绿宝石", ["价格: 120 金币/个", "点击购买"], "minecraft:emerald", 8);
  chestForm.button(14, "青金石", ["价格: 40 金币/个", "点击购买"], "minecraft:lapis_lazuli", 16);
  chestForm.button(15, "红石", ["价格: 25 金币/个", "点击购买"], "minecraft:redstone", 64);
  chestForm.button(16, "下界石英", ["价格: 35 金币/个", "点击购买"], "minecraft:quartz", 16);
  chestForm.button(17, "黑曜石", ["价格: 80 金币/个", "点击购买"], "minecraft:obsidian", 16);

  // 第三行：工具和武器
  chestForm.button(18, "钻石剑", ["价格: 300 金币/个", "点击购买"], "minecraft:diamond_sword", 1, 0, true);
  chestForm.button(19, "钻石镐", ["价格: 350 金币/个", "点击购买"], "minecraft:diamond_pickaxe", 1, 0, true);
  chestForm.button(20, "钻石斧", ["价格: 320 金币/个", "点击购买"], "minecraft:diamond_axe", 1, 0, true);
  // chestForm.button(22, "钻石锄", ["价格: 250 金币/个", "点击购买"], "minecraft:diamond_hoe", 1, 0, true);
  // chestForm.button(23, "弓", ["价格: 200 金币/个", "点击购买"], "minecraft:bow", 1, 0, true);
  // chestForm.button(24, "箭", ["价格: 5 金币/个", "点击购买"], "minecraft:arrow", 64);
  chestForm.button(21, "上一页", ["点击返回上一页"], "font/images/left");
  chestForm.button(22, "返回", ["点击返回"], "font/images/back");
  chestForm.button(23, "下一页", ["点击返回下一页"], "font/images/arrow_right");
  chestForm.button(24, "钻石铲", ["价格: 280 金币/个", "点击购买"], "minecraft:diamond_shovel", 1, 0, true);
  chestForm.button(25, "盾牌", ["价格: 150 金币/个", "点击购买"], "minecraft:shield", 1);
  chestForm.button(26, "鞘翅", ["价格: 1000 金币/个", "点击购买"], "minecraft:elytra", 1);

  // 第四行：食物和药水
  chestForm.button(27, "面包", ["价格: 10 金币/个", "点击购买"], "minecraft:bread", 16);
  chestForm.button(28, "金苹果", ["价格: 150 金币/个", "点击购买"], "minecraft:golden_apple", 8);
  chestForm.button(29, "附魔金苹果", ["价格: 500 金币/个", "点击购买"], "minecraft:enchanted_golden_apple", 1, 0, true);
  chestForm.button(30, "胡萝卜", ["价格: 5 金币/个", "点击购买"], "minecraft:carrot", 16);
  chestForm.button(31, "马铃薯", ["价格: 5 金币/个", "点击购买"], "minecraft:potato", 16);
  chestForm.button(32, "牛排", ["价格: 15 金币/个", "点击购买"], "minecraft:cooked_beef", 16);
  chestForm.button(33, "力量药水", ["价格: 200 金币/个", "点击购买"], "minecraft:potion", 1);
  chestForm.button(34, "速度药水", ["价格: 200 金币/个", "点击购买"], "minecraft:potion", 1);
  chestForm.button(35, "治疗药水", ["价格: 200 金币/个", "点击购买"], "minecraft:potion", 1);

  // 第五行：杂项
  chestForm.button(36, "末影珍珠", ["价格: 50 金币/个", "点击购买"], "minecraft:ender_pearl", 16);
  chestForm.button(37, "经验瓶", ["价格: 30 金币/个", "点击购买"], "minecraft:experience_bottle", 16);
  chestForm.button(38, "海绵", ["价格: 100 金币/个", "点击购买"], "minecraft:sponge", 4);
  chestForm.button(39, "海晶灯", ["价格: 80 金币/个", "点击购买"], "minecraft:sea_lantern", 16);
  chestForm.button(40, "信标", ["价格: 2000 金币/个", "点击购买"], "minecraft:beacon", 1);
  chestForm.button(41, "龙蛋", ["价格: 5000 金币/个", "点击购买"], "minecraft:dragon_egg", 1);
  chestForm.button(42, "下界之星", ["价格: 1500 金币/个", "点击购买"], "minecraft:nether_star", 1);
  chestForm.button(43, "音乐唱片", ["价格: 300 金币/个", "点击购买"], "minecraft:record_13", 1);
  chestForm.button(44, "命令方块", ["价格: 10000 金币/个", "仅管理员可购买"], "minecraft:command_block", 1);

  // 第六行：

  chestForm.show(player).then((response) => {
    if (response.canceled) {
      openEconomyMenuForm(player);
      return;
    }

    // 处理购买逻辑
    const selection = response.selection;

    // 如果点击的是返回按钮
    if (selection === 53) {
      openEconomyMenuForm(player);
      return;
    }

    // 这里应该有购买物品的逻辑，但目前只是演示
    // 实际应用中需要根据选择的物品扣除金币并给予物品
    openDialogForm(
      player,
      {
        title: "购买提示",
        desc: "§a该功能尚未实现，敬请期待！",
      },
      () => openOfficialShopForm(player)
    );
  });
}

// function openOfficialShopForm(player: Player) {
//   new ChestFormData("large")
//     ?.title("§l§5Primary Menu")
//     ?.button(21, "§l§6Test Item 1", ["", "§r§7A testing item"], "minecraft:magma_cream", 14)
//     ?.button(22, "§l§nTest Item 2", ["", "§r§7Another item"], "textures/items/netherite_axe", 1, 10)
//     ?.button(23, "§l§bTest Item 3", ["", "§r§7A third item"], "minecraft:tnt", 64, 0, true)
//     ?.button(30, "§l§2Test Item 4", ["", "§r§7A fourth item"], "custom:item", 64, 0, true)
//     ?.button(45, "§l§6OPEN FURNACE MENU!", ["", "§r§7Check out the furnace UI!"], "minecraft:furnace", 1, 0, true)
//     ?.pattern(["_________", "__xxxxx__", "__x___x__", "__x___x__", "__xxxxx__"], {
//       x: {
//         itemName: { rawtext: [{ text: "Pattern" }] },
//         itemDesc: ["§7This is a pattern!"],
//         enchanted: false,
//         stackAmount: 1,
//         texture: "minecraft:black_stained_glass_pane",
//       },
//     })
//     .show(player)
//     .then((response) => {
//       if (response.canceled) return;
//       world.sendMessage(`${player.name} has chosen item ${response.selection}`);
//       if (response.selection === 45) return furnaceMenu(player);
//     });
// }
// function furnaceMenu(player: Player) {
//   new FurnaceFormData(false) // true if furnace is lit or false if not
//     ?.title("§l§6Furnace Menu")

//     // 0 is input item, 1 is fuel and 2 is output item.
//     ?.button(0, "Cod", ["", "§7This is a fish"], "minecraft:cod")
//     ?.button(1, "Coal", ["", "§7This is fuel"], "minecraft:coal")
//     ?.button(2, "Stick", ["", "§7...which makes a stick!?"], "textures/items/stick", 64)
//     ?.show(player)
//     .then((response) => {
//       if (response.canceled) return;
//       world.sendMessage(`${player.name} has chosen item ${response.selection}`);
//       return openOfficialShopForm(player);
//     });
// }

// 玩家商店界面（暂未实现）
function openPlayerShopForm(player: Player) {
  const form = new ActionFormData();
  form.title("§w玩家商店");
  form.body({ rawtext: [{ text: "§a该功能尚未实现，敬请期待！" }] });
  form.button("§w返回", "font/images/back");

  form.show(player).then((response) => {
    if (response.canceled) return;
    openEconomyMenuForm(player);
  });
}

// 玩家经济排行界面（暂未实现）
function openEconomyRankingForm(player: Player) {
  const form = new ActionFormData();
  form.title("§w玩家经济排行");
  form.body({ rawtext: [{ text: "§a该功能尚未实现，敬请期待！" }] });
  form.button("§w返回", "font/images/back");

  form.show(player).then((response) => {
    if (response.canceled) return;
    openEconomyMenuForm(player);
  });
}
