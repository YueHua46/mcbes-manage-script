import { Player, world } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { color } from "../../utils/color";
import { openServerMenuForm } from "../Forms/Forms";
import { openDialogForm } from "../Forms/Dialog";
import enconomic from "./Economic";
import ChestFormData from "../ChestUI/ChestForms";
import { openCategoryListForm } from "./CategoryForms";

// 经济系统主菜单
export function openEconomyMenuForm(player: Player) {
  const form = new ActionFormData();
  form.title("§w经济系统");
  form.body({
    rawtext: [
      { text: "§a- 请选择你要进行的操作。\n" },
      { text: "§a- 当前余额: §e" + enconomic.getWallet(player.name).gold + " 金币" },
    ],
  });

  form.button("§w我的钱包", "textures/icons/more2");
  form.button("§w官方商店", "textures/icons/loot");
  form.button("§w玩家商店", "textures/icons/friends");
  form.button("§w玩家经济排行", "textures/icons/more");
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((response) => {
    if (response.canceled) return;

    switch (response.selection) {
      case 0:
        openMyWalletForm(player);
        break;
      case 1:
        openCategoryListForm(player);
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
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((response) => {
    if (response.canceled) return;
    openEconomyMenuForm(player);
  });
}

// 官方商店界面（使用ChestUI）
// function openOfficialShopForm(player: Player, page: number = 0) {
//   const chestForm = new ChestFormData("shop");
//   chestForm.title("官方商店");

//   // 根据页码显示不同的商品
//   if (page === 0) {
//     // 第一页商品
//     // 第一行：基础方块
//     chestForm.button(0, "石头", ["价格: 5 金币/个", "点击购买"], "minecraft:stone", 64);
//     chestForm.button(1, "泥土", ["价格: 2 金币/个", "点击购买"], "minecraft:dirt", 64);
//     chestForm.button(2, "沙子", ["价格: 3 金币/个", "点击购买"], "minecraft:sand", 64);
//     chestForm.button(3, "砂砾", ["价格: 3 金币/个", "点击购买"], "minecraft:gravel", 64);
//     chestForm.button(4, "木头", ["价格: 8 金币/个", "点击购买"], "minecraft:log", 64);
//     chestForm.button(5, "玻璃", ["价格: 10 金币/个", "点击购买"], "minecraft:glass", 64);
//     chestForm.button(6, "石砖", ["价格: 15 金币/个", "点击购买"], "minecraft:stonebrick", 64);
//     chestForm.button(7, "书架", ["价格: 30 金币/个", "点击购买"], "minecraft:bookshelf", 16);
//     chestForm.button(8, "工作台", ["价格: 20 金币/个", "点击购买"], "minecraft:crafting_table", 1);

//     // 第二行：矿物
//     chestForm.button(9, "煤炭", ["价格: 15 金币/个", "点击购买"], "minecraft:coal", 64);
//     chestForm.button(10, "铁锭", ["价格: 30 金币/个", "点击购买"], "minecraft:iron_ingot", 16);
//     chestForm.button(11, "金锭", ["价格: 50 金币/个", "点击购买"], "minecraft:gold_ingot", 16);
//     chestForm.button(12, "钻石", ["价格: 100 金币/个", "点击购买"], "minecraft:diamond", 8);
//     chestForm.button(13, "绿宝石", ["价格: 120 金币/个", "点击购买"], "minecraft:emerald", 8);
//     chestForm.button(14, "青金石", ["价格: 40 金币/个", "点击购买"], "minecraft:lapis_lazuli", 16);
//     chestForm.button(15, "红石", ["价格: 25 金币/个", "点击购买"], "minecraft:redstone", 64);
//     chestForm.button(16, "下界石英", ["价格: 35 金币/个", "点击购买"], "minecraft:quartz", 16);
//     chestForm.button(17, "黑曜石", ["价格: 80 金币/个", "点击购买"], "minecraft:obsidian", 16);

//     // 第三行：工具和武器
//     chestForm.button(18, "钻石剑", ["价格: 300 金币/个", "点击购买"], "minecraft:diamond_sword", 1);
//     chestForm.button(19, "钻石镐", ["价格: 350 金币/个", "点击购买"], "minecraft:diamond_pickaxe", 1);
//     chestForm.button(20, "钻石斧", ["价格: 320 金币/个", "点击购买"], "minecraft:diamond_axe", 1);
//     chestForm.button(21, "钻石锄", ["价格: 250 金币/个", "点击购买"], "minecraft:diamond_hoe", 1);
//     chestForm.button(22, "弓", ["价格: 200 金币/个", "点击购买"], "minecraft:bow", 1);
//     chestForm.button(23, "箭", ["价格: 5 金币/个", "点击购买"], "minecraft:arrow", 64);
//     chestForm.button(24, "钻石铲", ["价格: 280 金币/个", "点击购买"], "minecraft:diamond_shovel", 1);
//     chestForm.button(25, "盾牌", ["价格: 150 金币/个", "点击购买"], "minecraft:shield", 1);
//     chestForm.button(26, "鞘翅", ["价格: 1000 金币/个", "点击购买"], "minecraft:elytra", 1);

//     // 第四行：食物和药水
//     chestForm.button(27, "面包", ["价格: 10 金币/个", "点击购买"], "minecraft:bread", 16);
//     chestForm.button(28, "金苹果", ["价格: 150 金币/个", "点击购买"], "minecraft:golden_apple", 8);
//     chestForm.button(29, "附魔金苹果", ["价格: 500 金币/个", "点击购买"], "minecraft:enchanted_golden_apple", 1);
//     chestForm.button(30, "胡萝卜", ["价格: 5 金币/个", "点击购买"], "minecraft:carrot", 16);
//     chestForm.button(31, "马铃薯", ["价格: 5 金币/个", "点击购买"], "minecraft:potato", 16);
//     chestForm.button(32, "牛排", ["价格: 15 金币/个", "点击购买"], "minecraft:cooked_beef", 16);
//     chestForm.button(33, "力量药水", ["价格: 200 金币/个", "点击购买"], "minecraft:potion", 1);
//     chestForm.button(34, "速度药水", ["价格: 200 金币/个", "点击购买"], "minecraft:potion", 1);
//     chestForm.button(35, "治疗药水", ["价格: 200 金币/个", "点击购买"], "minecraft:potion", 1);

//     // 第五行：杂项
//     chestForm.button(36, "末影珍珠", ["价格: 50 金币/个", "点击购买"], "minecraft:ender_pearl", 16);
//     chestForm.button(37, "经验瓶", ["价格: 30 金币/个", "点击购买"], "minecraft:experience_bottle", 16);
//     chestForm.button(38, "海绵", ["价格: 100 金币/个", "点击购买"], "minecraft:sponge", 4);
//     chestForm.button(39, "海晶灯", ["价格: 80 金币/个", "点击购买"], "minecraft:sea_lantern", 16);
//     chestForm.button(40, "信标", ["价格: 2000 金币/个", "点击购买"], "minecraft:beacon", 1);
//     chestForm.button(41, "龙蛋", ["价格: 5000 金币/个", "点击购买"], "minecraft:dragon_egg", 1);
//     chestForm.button(42, "下界之星", ["价格: 1500 金币/个", "点击购买"], "minecraft:nether_star", 1);
//     chestForm.button(43, "音乐唱片", ["价格: 300 金币/个", "点击购买"], "minecraft:record_13", 1);
//     chestForm.button(44, "命令方块", ["价格: 10000 金币/个", "仅管理员可购买"], "minecraft:command_block", 1);

//     // 第六行：导航按钮
//     chestForm.button(47, "上一页", ["返回上一页"], "textures/icons/left_default", 1);
//     chestForm.button(49, "返回", ["返回经济菜单"], "textures/icons/back", 1);
//     chestForm.button(51, "下一页", ["前往下一页"], "textures/icons/right_default", 1);
//   } else if (page === 1) {
//     // 第二页商品 - 可以添加更多不同的物品
//     chestForm.button(0, "钻石块", ["价格: 900 金币/个", "点击购买"], "minecraft:diamond_block", 16);
//     chestForm.button(1, "绿宝石块", ["价格: 1080 金币/个", "点击购买"], "minecraft:emerald_block", 16);
//     // 可以继续添加更多物品...

//     // 导航按钮
//     chestForm.button(47, "上一页", ["返回上一页"], "textures/icons/left_default", 1);
//     chestForm.button(49, "返回", ["返回经济菜单"], "textures/icons/back", 1);
//     chestForm.button(51, "下一页", ["前往下一页"], "textures/icons/right_default", 1);
//   }

//   // 商品价格映射表
//   const itemPrices: Record<number, { price: number; name: string; amount: number; itemId: string }> = {
//     0: { price: 5, name: "石头", amount: 64, itemId: "minecraft:stone" },
//     1: { price: 2, name: "泥土", amount: 64, itemId: "minecraft:dirt" },
//     2: { price: 3, name: "沙子", amount: 64, itemId: "minecraft:sand" },
//     3: { price: 3, name: "砂砾", amount: 64, itemId: "minecraft:gravel" },
//     4: { price: 8, name: "木头", amount: 64, itemId: "minecraft:log" },
//     5: { price: 10, name: "玻璃", amount: 64, itemId: "minecraft:glass" },
//     6: { price: 15, name: "石砖", amount: 64, itemId: "minecraft:stonebrick" },
//     7: { price: 30, name: "书架", amount: 16, itemId: "minecraft:bookshelf" },
//     8: { price: 20, name: "工作台", amount: 1, itemId: "minecraft:crafting_table" },
//     9: { price: 15, name: "煤炭", amount: 64, itemId: "minecraft:coal" },
//     10: { price: 30, name: "铁锭", amount: 16, itemId: "minecraft:iron_ingot" },
//     11: { price: 50, name: "金锭", amount: 16, itemId: "minecraft:gold_ingot" },
//     12: { price: 100, name: "钻石", amount: 8, itemId: "minecraft:diamond" },
//     13: { price: 120, name: "绿宝石", amount: 8, itemId: "minecraft:emerald" },
//     14: { price: 40, name: "青金石", amount: 16, itemId: "minecraft:lapis_lazuli" },
//     15: { price: 25, name: "红石", amount: 64, itemId: "minecraft:redstone" },
//     16: { price: 35, name: "下界石英", amount: 16, itemId: "minecraft:quartz" },
//     17: { price: 80, name: "黑曜石", amount: 16, itemId: "minecraft:obsidian" },
//     18: { price: 300, name: "钻石剑", amount: 1, itemId: "minecraft:diamond_sword" },
//     19: { price: 350, name: "钻石镐", amount: 1, itemId: "minecraft:diamond_pickaxe" },
//     20: { price: 320, name: "钻石斧", amount: 1, itemId: "minecraft:diamond_axe" },
//     21: { price: 250, name: "钻石锄", amount: 1, itemId: "minecraft:diamond_hoe" },
//     22: { price: 200, name: "弓", amount: 1, itemId: "minecraft:bow" },
//     23: { price: 5, name: "箭", amount: 64, itemId: "minecraft:arrow" },
//     24: { price: 280, name: "钻石铲", amount: 1, itemId: "minecraft:diamond_shovel" },
//     25: { price: 150, name: "盾牌", amount: 1, itemId: "minecraft:shield" },
//     26: { price: 1000, name: "鞘翅", amount: 1, itemId: "minecraft:elytra" },
//     27: { price: 10, name: "面包", amount: 16, itemId: "minecraft:bread" },
//     28: { price: 150, name: "金苹果", amount: 8, itemId: "minecraft:golden_apple" },
//     29: { price: 500, name: "附魔金苹果", amount: 1, itemId: "minecraft:enchanted_golden_apple" },
//     30: { price: 5, name: "胡萝卜", amount: 16, itemId: "minecraft:carrot" },
//     31: { price: 5, name: "马铃薯", amount: 16, itemId: "minecraft:potato" },
//     32: { price: 15, name: "牛排", amount: 16, itemId: "minecraft:cooked_beef" },
//     33: { price: 200, name: "力量药水", amount: 1, itemId: "minecraft:potion" },
//     34: { price: 200, name: "速度药水", amount: 1, itemId: "minecraft:potion" },
//     35: { price: 200, name: "治疗药水", amount: 1, itemId: "minecraft:potion" },
//     36: { price: 50, name: "末影珍珠", amount: 16, itemId: "minecraft:ender_pearl" },
//     37: { price: 30, name: "经验瓶", amount: 16, itemId: "minecraft:experience_bottle" },
//     38: { price: 100, name: "海绵", amount: 4, itemId: "minecraft:sponge" },
//     39: { price: 80, name: "海晶灯", amount: 16, itemId: "minecraft:sea_lantern" },
//     40: { price: 2000, name: "信标", amount: 1, itemId: "minecraft:beacon" },
//     41: { price: 5000, name: "龙蛋", amount: 1, itemId: "minecraft:dragon_egg" },
//     42: { price: 1500, name: "下界之星", amount: 1, itemId: "minecraft:nether_star" },
//     43: { price: 300, name: "音乐唱片", amount: 1, itemId: "minecraft:record_13" },
//     44: { price: 10000, name: "命令方块", amount: 1, itemId: "minecraft:command_block" },
//   };

//   // 第二页的物品价格
//   if (page === 1) {
//     itemPrices[0] = { price: 900, name: "钻石块", amount: 16, itemId: "minecraft:diamond_block" };
//     itemPrices[1] = { price: 1080, name: "绿宝石块", amount: 16, itemId: "minecraft:emerald_block" };
//     // 可以继续添加更多物品的价格...
//   }

//   chestForm.show(player).then((response) => {
//     if (response.canceled) {
//       openEconomyMenuForm(player);
//       return;
//     }

//     const selection = response.selection;

//     // 处理特殊按钮事件
//     if (selection === 47) {
//       // 上一页
//       const prevPage = Math.max(0, page - 1);
//       openOfficialShopForm(player, prevPage);
//       return;
//     } else if (selection === 51) {
//       // 下一页
//       const nextPage = page + 1;
//       const maxPage = 1; // 设置最大页数
//       if (nextPage <= maxPage) {
//         openOfficialShopForm(player, nextPage);
//       } else {
//         openOfficialShopForm(player, 0); // 循环回第一页
//       }
//       return;
//     } else if (selection === 49) {
//       // 返回按钮
//       openEconomyMenuForm(player);
//       return;
//     }

//     // 处理商品购买
//     if (selection !== undefined && itemPrices[selection]) {
//       const item = itemPrices[selection];

//       // 检查是否是命令方块且玩家不是管理员
//       if (item.itemId === "minecraft:command_block" && !player.hasTag("admin")) {
//         openDialogForm(
//           player,
//           {
//             title: "购买失败",
//             desc: color.red("只有管理员才能购买命令方块！"),
//           },
//           () => openOfficialShopForm(player, page)
//         );
//         return;
//       }

//       // 检查玩家余额是否足够
//       if (!enconomic.hasEnoughGold(player.name, item.price)) {
//         openDialogForm(
//           player,
//           {
//             title: "购买失败",
//             desc: color.red(
//               `你的金币不足！需要 ${item.price} 金币，但你只有 ${enconomic.getWallet(player.name).gold} 金币。`
//             ),
//           },
//           () => openOfficialShopForm(player, page)
//         );
//         return;
//       }

//       // 扣除金币
//       const success = enconomic.removeGold(player.name, item.price, `购买 ${item.name}`);

//       if (success) {
//         // 给予物品
//         try {
//           const inventory = player.getComponent("inventory");
//           if (inventory) {
//             player.runCommand(`give @s ${item.itemId} ${item.amount}`);

//             openDialogForm(
//               player,
//               {
//                 title: "购买成功",
//                 desc: color.green(`你成功购买了 ${item.amount} 个 ${item.name}，花费了 ${item.price} 金币！`),
//               },
//               () => openOfficialShopForm(player, page)
//             );
//           }
//         } catch (error) {
//           // 如果给予物品失败，退还金币
//           enconomic.addGold(player.name, item.price, `购买 ${item.name} 失败退款`);

//           openDialogForm(
//             player,
//             {
//               title: "购买失败",
//               desc: color.red(`给予物品失败，已退还金币。错误: ${error}`),
//             },
//             () => openOfficialShopForm(player, page)
//           );
//         }
//       } else {
//         openDialogForm(
//           player,
//           {
//             title: "购买失败",
//             desc: color.red("交易处理失败，请稍后再试。"),
//           },
//           () => openOfficialShopForm(player, page)
//         );
//       }
//     }
//   });
// }

// 玩家商店界面（暂未实现）
function openPlayerShopForm(player: Player) {
  const form = new ActionFormData();
  form.title("§w玩家商店");
  form.body({ rawtext: [{ text: "§a该功能尚未实现，敬请期待！" }] });
  form.button("§w返回", "textures/icons/back");

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
  form.button("§w返回", "textures/icons/back");

  form.show(player).then((response) => {
    if (response.canceled) return;
    openEconomyMenuForm(player);
  });
}
