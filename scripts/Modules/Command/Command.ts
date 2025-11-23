import {
  system,
  world,
  Player,
  CustomCommand,
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandOrigin,
  CustomCommandResult,
  CustomCommandStatus,
} from "@minecraft/server";
import { color } from "../../utils/color";
import { isAdmin } from "../../utils/utils";
import { usePlayerByName } from "../../hooks/hooks";
import wayPoint from "../WayPoint/WayPoint";
import land from "../Land/Land";
import economic from "../Economic/Economic";
import setting, { IModules } from "../System/Setting";
import { RandomTp } from "../OtherFun/RandomTp";
import { memberManager } from "../System/TrialMode";
import server from "../Server";

// 使用官方的 CustomCommandRegistry API
// 参考: https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/customcommandregistry

// 防止重复注册的标志
let commandsRegistered = false;

system.beforeEvents.startup.subscribe((init) => {
  // 如果已经注册过，跳过
  if (commandsRegistered) {
    console.warn("自定义指令已注册，跳过重复注册");
    return;
  }

  const registry = init.customCommandRegistry;

  // 1. 注册 waypoint 指令
  const waypointCommand: CustomCommand = {
    name: "yuehua:waypoint",
    description: "坐标点管理系统 - 用法: list(列表)|add(添加)|del(删除)|tp(传送)",
    permissionLevel: CommandPermissionLevel.Any,
    optionalParameters: [
      { type: CustomCommandParamType.String, name: "操作类型(list/add/del/tp)" },
      { type: CustomCommandParamType.String, name: "坐标点名称" },
      {
        type: CustomCommandParamType.String,
        name: "坐标点类型(public/private)，public为公开坐标点, private为私人坐标点",
      },
    ],
  };
  registry.registerCommand(waypointCommand, handleWaypointCommand);

  // 2. 注册 land 指令
  const landCommand: CustomCommand = {
    name: "yuehua:land",
    description: "领地管理系统 - 用法: list(列表)|query(查询)|remove(删除)|trust(信任)|untrust(取消信任)",
    permissionLevel: CommandPermissionLevel.Any,
    optionalParameters: [
      { type: CustomCommandParamType.String, name: "操作类型(list/query/remove/trust/untrust)" },
      { type: CustomCommandParamType.String, name: "玩家名或领地名" },
      { type: CustomCommandParamType.String, name: "领地名称" },
    ],
  };
  registry.registerCommand(landCommand, handleLandCommand);

  // 3. 注册 money 指令
  const moneyCommand: CustomCommand = {
    name: "yuehua:money",
    description: "查看金币余额和排行榜 - 用法: 不带参数查看余额, 带top参数查看排行榜",
    permissionLevel: CommandPermissionLevel.Any,
    optionalParameters: [{ type: CustomCommandParamType.String, name: "操作(top=排行榜)" }],
  };
  registry.registerCommand(moneyCommand, handleMoneyCommand);

  // 4. 注册 pay 指令
  const payCommand: CustomCommand = {
    name: "yuehua:pay",
    description: "转账给其他玩家 - 用法: /yuehua:pay <玩家名> <金额>",
    permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [
      { type: CustomCommandParamType.String, name: "目标玩家名" },
      { type: CustomCommandParamType.Integer, name: "转账金额" },
    ],
  };
  registry.registerCommand(payCommand, handlePayCommand);

  // 5. 注册 setting 指令 (仅管理员)
  const settingCommand: CustomCommand = {
    name: "yuehua:setting",
    description: "系统设置(仅管理员) - 用法: list列出所有设置 或 /yuehua:setting <设置项> <值>",
    permissionLevel: CommandPermissionLevel.Admin,
    optionalParameters: [
      { type: CustomCommandParamType.String, name: "设置项(list查看列表)" },
      { type: CustomCommandParamType.String, name: "设置值(true/false或数字)" },
    ],
  };
  registry.registerCommand(settingCommand, handleSettingCommand);

  // 6. 注册 rtp 指令
  const rtpCommand: CustomCommand = {
    name: "yuehua:rtp",
    description: "随机传送到世界中的随机位置",
    permissionLevel: CommandPermissionLevel.Any,
  };
  registry.registerCommand(rtpCommand, handleRtpCommand);

  // 7. 注册 oneclick 指令
  const oneclickCommand: CustomCommand = {
    name: "yuehua:oneclick",
    description: "一键功能开关(仅管理员) - 用法: /yuehua:oneclick <ore|tree>",
    permissionLevel: CommandPermissionLevel.Admin,
    mandatoryParameters: [{ type: CustomCommandParamType.String, name: "功能类型(ore=挖矿/tree=砍树)" }],
  };
  registry.registerCommand(oneclickCommand, handleOneClickCommand);

  // 8. 注册 trial 指令 (试玩模式管理)
  const trialCommand: CustomCommand = {
    name: "yuehua:trial",
    description: "试玩模式管理(仅管理员) - 用法: list|add|remove|check|reset 支持批量操作",
    permissionLevel: CommandPermissionLevel.Admin,
    optionalParameters: [
      { type: CustomCommandParamType.String, name: "操作(list/add/remove/check/reset)" },
      {
        type: CustomCommandParamType.String,
        name: `玩家名(多个用逗号分隔，且用英文引号包裹，注意，是英文引号！)，例如：/yuehua:trial add "玩家1,玩家2,玩家3"`,
      },
    ],
  };
  registry.registerCommand(trialCommand, handleTrialCommand);

  // 9. 注册 serverinfo 指令 (查看服务器信息)
  const serverinfoCommand: CustomCommand = {
    name: "yuehua:serverinfo",
    description: "查看服务器信息 - TPS、在线玩家、实体数量等",
    permissionLevel: CommandPermissionLevel.Any,
  };
  registry.registerCommand(serverinfoCommand, handleServerInfoCommand);

  // 10. 注册 money_setting 指令 (金币管理)
  const moneySettingCommand: CustomCommand = {
    name: "yuehua:money_setting",
    description: "金币管理(仅管理员) - 用法: add|remove|set <玩家名> <金额>",
    permissionLevel: CommandPermissionLevel.Admin,
    mandatoryParameters: [
      { type: CustomCommandParamType.String, name: "操作(add/remove/set)" },
      { type: CustomCommandParamType.String, name: "玩家名" },
      { type: CustomCommandParamType.Integer, name: "金额" },
    ],
  };
  registry.registerCommand(moneySettingCommand, handleMoneySettingCommand);

  // 11. 注册 give_me_menu 指令 (获取服务器菜单)
  const giveMenuCommand: CustomCommand = {
    name: "yuehua:give_me_menu",
    description: "获取服务器菜单物品",
    permissionLevel: CommandPermissionLevel.Any,
  };
  registry.registerCommand(giveMenuCommand, handleGiveMenuCommand);

  // 标记为已注册
  commandsRegistered = true;
  console.warn("所有自定义指令已通过官方 API 注册完成");
});

// =====================
// 指令处理函数
// =====================

function handleWaypointCommand(
  origin: CustomCommandOrigin,
  subCommand?: string,
  arg1?: string,
  arg2?: string
): CustomCommandResult {
  const player = origin.sourceEntity as Player;

  if (!player) {
    return { status: CustomCommandStatus.Failure };
  }

  if (!subCommand) {
    player.sendMessage(color.yellow("使用方法: /waypoint <list|add|del|tp> [参数]"));
    return { status: CustomCommandStatus.Success };
  }

  system.run(() => {
    try {
      switch (subCommand.toLowerCase()) {
        case "list":
          const points = wayPoint.getPlayerPoints(player);
          if (points.length === 0) {
            player.sendMessage(color.yellow("你还没有创建任何坐标点。"));
          } else {
            player.sendMessage(color.green("=== 我的坐标点列表 ==="));
            points.forEach((p) => {
              player.sendMessage(
                `${color.aqua(p.name)} - ${color.gray(`${p.location.x}, ${p.location.y}, ${p.location.z} (${p.dimension})`)}`
              );
            });
          }
          break;

        case "add":
          if (!arg1) {
            player.sendMessage(color.red("用法: /waypoint add <名称> [public/private]"));
            return;
          }
          const name = arg1;
          const type = (arg2?.toLowerCase() === "public" ? "public" : "private") as "public" | "private";

          if (type === "public" && !isAdmin(player)) {
            player.sendMessage(color.red("只有管理员可以创建公开坐标点。"));
            return;
          }

          const result = wayPoint.createPoint({
            pointName: name,
            location: player.location,
            player: player,
            type: type,
          });

          if (typeof result === "string") {
            player.sendMessage(color.red(result));
          } else {
            player.sendMessage(color.green(`成功创建${type === "public" ? "公开" : "私有"}坐标点: ${name}`));
          }
          break;

        case "del":
          if (!arg1) {
            player.sendMessage(color.red("用法: /waypoint del <名称>"));
            return;
          }
          const delName = arg1;
          if (!isAdmin(player) && !wayPoint.checkOwner(player, delName)) {
            player.sendMessage(color.red("你没有权限删除该坐标点或该点不存在。"));
            return;
          }

          const delResult = wayPoint.deletePoint(delName);
          if (typeof delResult === "string") {
            player.sendMessage(color.red(delResult));
          } else {
            player.sendMessage(color.green(`成功删除坐标点: ${delName}`));
          }
          break;

        case "tp":
          if (!arg1) {
            player.sendMessage(color.red("用法: /waypoint tp <名称>"));
            return;
          }
          const tpName = arg1;
          const point = wayPoint.getPoint(tpName);
          if (!point) {
            player.sendMessage(color.red("坐标点不存在。"));
            return;
          }

          if (point.type === "private" && point.playerName !== player.name && !isAdmin(player)) {
            player.sendMessage(color.red("你没有权限传送到该私有坐标点。"));
            return;
          }

          wayPoint.teleport(player, tpName);
          break;

        default:
          player.sendMessage(color.yellow("未知子指令。可用: list, add, del, tp"));
          break;
      }
    } catch (error) {
      player.sendMessage(color.red(`指令执行错误: ${(error as Error).message}`));
    }
  });

  return { status: CustomCommandStatus.Success };
}

function handleLandCommand(
  origin: CustomCommandOrigin,
  subCommand?: string,
  arg1?: string,
  arg2?: string
): CustomCommandResult {
  const player = origin.sourceEntity as Player;

  if (!player) {
    return { status: CustomCommandStatus.Failure };
  }

  if (!subCommand) {
    player.sendMessage(color.yellow("使用方法: /land <list|query|remove|trust|untrust> [参数]"));
    return { status: CustomCommandStatus.Success };
  }

  system.run(() => {
    try {
      switch (subCommand.toLowerCase()) {
        case "list":
          const lands = land.getPlayerLands(player.name);
          if (lands.length === 0) {
            player.sendMessage(color.yellow("你还没有创建任何领地。"));
          } else {
            player.sendMessage(color.green("=== 我的领地列表 ==="));
            lands.forEach((l) => {
              player.sendMessage(`${color.aqua(l.name)} (${l.dimension}) - 成员: ${l.members.length}人`);
            });
          }
          break;

        case "query":
          const test = land.testLand(player.location, player.dimension.id);
          if (test.isInside && test.insideLand) {
            player.sendMessage(color.green(`你当前位于领地: ${color.yellow(test.insideLand.name)}`));
            player.sendMessage(color.green(`拥有者: ${color.yellow(test.insideLand.owner)}`));
          } else {
            player.sendMessage(color.yellow("你当前不在任何领地内。"));
          }
          break;

        case "remove":
          if (!arg1) {
            player.sendMessage(color.red("用法: /land remove <领地名称>"));
            return;
          }
          const removeName = arg1;
          const landToRemove = land.getLand(removeName);
          if (typeof landToRemove === "string") {
            player.sendMessage(color.red(landToRemove));
            return;
          }

          if (landToRemove.owner !== player.name && !isAdmin(player)) {
            player.sendMessage(color.red("你没有权限删除该领地。"));
            return;
          }

          land.removeLand(removeName);
          player.sendMessage(color.green(`成功删除领地: ${removeName}`));
          break;

        case "trust":
          if (!arg1 || !arg2) {
            player.sendMessage(color.red("用法: /land trust <玩家名> <领地名称>"));
            return;
          }
          const trustPlayer = arg1;
          const trustLandName = arg2;

          const trustLandInfo = land.getLand(trustLandName);
          if (typeof trustLandInfo === "string") {
            player.sendMessage(color.red(trustLandInfo));
            return;
          }

          if (trustLandInfo.owner !== player.name && !isAdmin(player)) {
            player.sendMessage(color.red("你没有权限管理该领地。"));
            return;
          }

          const addResult = land.addMember(trustLandName, trustPlayer);
          if (addResult === "成员已存在") {
            player.sendMessage(color.red("该玩家已经是成员了。"));
          } else {
            player.sendMessage(color.green(`成功将玩家 ${trustPlayer} 添加到领地 ${trustLandName}。`));
          }
          break;

        case "untrust":
          if (!arg1 || !arg2) {
            player.sendMessage(color.red("用法: /land untrust <玩家名> <领地名称>"));
            return;
          }
          const untrustPlayer = arg1;
          const untrustLandName = arg2;

          const untrustLandInfo = land.getLand(untrustLandName);
          if (typeof untrustLandInfo === "string") {
            player.sendMessage(color.red(untrustLandInfo));
            return;
          }

          if (untrustLandInfo.owner !== player.name && !isAdmin(player)) {
            player.sendMessage(color.red("你没有权限管理该领地。"));
            return;
          }

          const removeResult = land.removeMember(untrustLandName, untrustPlayer);
          if (removeResult === "成员不存在") {
            player.sendMessage(color.red("该玩家不是领地成员。"));
          } else {
            player.sendMessage(color.green(`成功将玩家 ${untrustPlayer} 从领地 ${untrustLandName} 移除。`));
          }
          break;

        default:
          player.sendMessage(color.yellow("未知子指令。可用: list, query, remove, trust, untrust"));
          break;
      }
    } catch (error) {
      player.sendMessage(color.red(`指令执行错误: ${(error as Error).message}`));
    }
  });

  return { status: CustomCommandStatus.Success };
}

function handleMoneyCommand(origin: CustomCommandOrigin, subCommand?: string): CustomCommandResult {
  const player = origin.sourceEntity as Player;

  if (!player) {
    return { status: CustomCommandStatus.Failure };
  }

  system.run(() => {
    try {
      if (!subCommand) {
        const wallet = economic.getWallet(player.name);
        player.sendMessage(color.green(`当前余额: ${color.gold(wallet.gold.toString())}`));
        return;
      }

      switch (subCommand.toLowerCase()) {
        case "top":
          const topWallets = economic.getTopWallets(10);
          player.sendMessage(color.green("=== 财富排行榜 ==="));
          topWallets.forEach((w, index) => {
            player.sendMessage(`${index + 1}. ${w.name}: ${color.gold(w.gold.toString())}`);
          });
          break;
        default:
          player.sendMessage(color.yellow("用法: /money [top]"));
          break;
      }
    } catch (error) {
      player.sendMessage(color.red(`指令执行错误: ${(error as Error).message}`));
    }
  });

  return { status: CustomCommandStatus.Success };
}

function handlePayCommand(origin: CustomCommandOrigin, targetName: string, amount: number): CustomCommandResult {
  const player = origin.sourceEntity as Player;

  if (!player) {
    return { status: CustomCommandStatus.Failure };
  }

  system.run(() => {
    try {
      if (isNaN(amount) || amount <= 0) {
        player.sendMessage(color.red("请输入有效的金额。"));
        return;
      }

      const targetPlayer = usePlayerByName(targetName);
      if (!targetPlayer) {
        player.sendMessage(color.red("找不到目标玩家 (玩家必须在线)。"));
      }

      const result = economic.transfer(player.name, targetName, amount, "指令转账");
      if (result === true) {
        player.sendMessage(color.green(`成功向 ${targetName} 转账 ${amount} 金币。`));
        if (targetPlayer) {
          targetPlayer.sendMessage(color.green(`收到来自 ${player.name} 的转账 ${amount} 金币。`));
        }
      } else {
        player.sendMessage(color.red(`转账失败: ${result}`));
      }
    } catch (error) {
      player.sendMessage(color.red(`指令执行错误: ${(error as Error).message}`));
    }
  });

  return { status: CustomCommandStatus.Success };
}

function handleSettingCommand(origin: CustomCommandOrigin, key?: string, value?: string): CustomCommandResult {
  const player = origin.sourceEntity as Player;

  if (!player) {
    return { status: CustomCommandStatus.Failure };
  }

  system.run(() => {
    try {
      if (!isAdmin(player)) {
        player.sendMessage(color.red("只有管理员可以使用此指令。"));
        return;
      }

      // 如果没有参数或参数是 list，显示所有可配置项
      if (!key || key.toLowerCase() === "list") {
        player.sendMessage(color.green("=== 系统设置列表 ==="));
        player.sendMessage(color.yellow("使用方法: /yuehua:setting <设置项> <值>\n"));

        // 定义所有设置项及其说明
        const settingDescriptions: { [key: string]: string } = {
          player: "玩家功能模块 (true/false)",
          land: "领地功能模块 (true/false)",
          wayPoint: "坐标点功能模块 (true/false)",
          economy: "经济系统 (true/false)",
          other: "其他功能模块 (true/false)",
          help: "帮助功能 (true/false)",
          sm: "服务器菜单 (true/false)",
          setting: "设置功能 (true/false)",
          killItem: "击杀掉落物品 (true/false)",
          killItemAmount: "击杀掉落物品数量 (数字)",
          randomTpRange: "随机传送范围 (数字)",
          maxLandPerPlayer: "每个玩家最大领地数量 (数字)",
          maxLandBlocks: "领地最大方块数 (数字)",
          maxPointsPerPlayer: "每个玩家最大坐标点数量 (数字)",
          playerNameColor: "玩家名称颜色 (颜色代码如§a)",
          playerChatColor: "聊天颜色 (颜色代码如§f)",
          trialMode: "试玩模式 (true/false)",
          trialModeDuration: "试玩模式时长(秒) (数字)",
          randomTeleport: "随机传送功能 (true/false)",
          backToDeath: "回到死亡地点功能 (true/false)",
          enableTreeCutOneClick: "一键砍树 (true/false)",
          enableDigOreOneClick: "一键挖矿 (true/false)",
          land1BlockPerPrice: "领地每方块价格 (数字)",
          daily_gold_limit: "每日金币获取上限 (数字)",
          startingGold: "新玩家初始金币 (数字)",
        };

        // 显示所有设置项
        for (const [settingKey, description] of Object.entries(settingDescriptions)) {
          const currentValue = setting.getState(settingKey as IModules);
          player.sendMessage(`${color.aqua(settingKey)}: ${description}`);
          player.sendMessage(`  ${color.gray(`当前值: ${color.yellow(String(currentValue))}\n`)}`);
        }
        return;
      }

      // 修改设置
      if (!value) {
        player.sendMessage(color.red("用法: /yuehua:setting <设置项> <值>"));
        player.sendMessage(color.yellow("或使用 /yuehua:setting list 查看所有可配置项"));
        return;
      }

      let finalValue: boolean | string = value;

      if (value === "true") finalValue = true;
      if (value === "false") finalValue = false;

      setting.setState(key as IModules, finalValue);
      player.sendMessage(color.green(`已将设置 ${key} 更新为 ${finalValue}`));
    } catch (error) {
      player.sendMessage(color.red(`设置失败: ${(error as Error).message}`));
    }
  });

  return { status: CustomCommandStatus.Success };
}

function handleRtpCommand(origin: CustomCommandOrigin): CustomCommandResult {
  const player = origin.sourceEntity as Player;

  if (!player) {
    return { status: CustomCommandStatus.Failure };
  }

  system.run(() => {
    try {
      RandomTp(player);
    } catch (error) {
      player.sendMessage(color.red(`传送失败: ${(error as Error).message}`));
    }
  });

  return { status: CustomCommandStatus.Success };
}

function handleOneClickCommand(origin: CustomCommandOrigin, feature: string): CustomCommandResult {
  const player = origin.sourceEntity as Player;

  if (!player) {
    return { status: CustomCommandStatus.Failure };
  }

  system.run(() => {
    try {
      if (!isAdmin(player)) {
        player.sendMessage(color.red("只有管理员可以更改此设置。"));
        return;
      }

      const featureLower = feature.toLowerCase();
      if (featureLower === "ore") {
        const current = setting.getState("enableDigOreOneClick");
        setting.setState("enableDigOreOneClick", !current);
        player.sendMessage(color.green(`一键挖矿已${!current ? "开启" : "关闭"}`));
      } else if (featureLower === "tree") {
        const current = setting.getState("enableTreeCutOneClick");
        setting.setState("enableTreeCutOneClick", !current);
        player.sendMessage(color.green(`一键砍树已${!current ? "开启" : "关闭"}`));
      } else {
        player.sendMessage(color.yellow("用法: /oneclick <ore|tree>"));
      }
    } catch (error) {
      player.sendMessage(color.red(`设置失败: ${(error as Error).message}`));
    }
  });

  return { status: CustomCommandStatus.Success };
}

function handleTrialCommand(origin: CustomCommandOrigin, operation?: string, targetName?: string): CustomCommandResult {
  const player = origin.sourceEntity as Player;

  if (!player) {
    return { status: CustomCommandStatus.Failure };
  }

  system.run(() => {
    try {
      if (!isAdmin(player)) {
        player.sendMessage(color.red("只有管理员可以使用此指令。"));
        return;
      }

      // 如果没有参数或参数是 list，显示所有会员
      if (!operation || operation.toLowerCase() === "list") {
        const members = memberManager.getAllMembers();
        if (members.length === 0) {
          player.sendMessage(color.yellow("当前没有正式会员。"));
        } else {
          player.sendMessage(color.green("=== 正式会员列表 ==="));
          members.forEach((memberName, index) => {
            player.sendMessage(`${index + 1}. ${color.aqua(memberName)}`);
          });
        }
        return;
      }

      const op = operation.toLowerCase();

      switch (op) {
        case "add":
          if (!targetName) {
            player.sendMessage(color.red("用法: /yuehua:trial add <玩家名>"));
            player.sendMessage(color.gray("支持批量: /yuehua:trial add 玩家1,玩家2,玩家3"));
            return;
          }

          // 支持批量操作：用逗号分隔多个玩家名
          const playersToAdd = targetName
            .split(",")
            .map((name) => name.trim())
            .filter((name) => name.length > 0);

          if (playersToAdd.length === 0) {
            player.sendMessage(color.red("请输入有效的玩家名。"));
            return;
          }

          let addedCount = 0;
          let skippedCount = 0;
          const results: string[] = [];

          for (const playerName of playersToAdd) {
            if (memberManager.isMember(playerName)) {
              results.push(`${color.yellow(playerName)}: 已是会员`);
              skippedCount++;
              continue;
            }

            const addSuccess = memberManager.addMember(playerName);
            if (addSuccess) {
              results.push(`${color.green(playerName)}: 添加成功`);
              addedCount++;
              const targetPlayer = usePlayerByName(playerName);
              if (targetPlayer) {
                targetPlayer.sendMessage(color.green("恭喜！您已成为正式会员，可以无限制游玩！"));
              }
            } else {
              results.push(`${color.red(playerName)}: 添加失败`);
            }
          }

          player.sendMessage(color.green(`=== 批量添加会员结果 ===`));
          results.forEach((result) => player.sendMessage(result));
          player.sendMessage(color.aqua(`成功: ${addedCount}, 跳过: ${skippedCount}, 总计: ${playersToAdd.length}`));
          break;

        case "remove":
          if (!targetName) {
            player.sendMessage(color.red("用法: /yuehua:trial remove <玩家名>"));
            player.sendMessage(color.gray("支持批量: /yuehua:trial remove 玩家1,玩家2,玩家3"));
            return;
          }

          // 支持批量操作：用逗号分隔多个玩家名
          const playersToRemove = targetName
            .split(",")
            .map((name) => name.trim())
            .filter((name) => name.length > 0);

          if (playersToRemove.length === 0) {
            player.sendMessage(color.red("请输入有效的玩家名。"));
            return;
          }

          let removedCount = 0;
          let notFoundCount = 0;
          const removeResults: string[] = [];

          for (const playerName of playersToRemove) {
            if (!memberManager.isMember(playerName)) {
              removeResults.push(`${color.yellow(playerName)}: 不是会员`);
              notFoundCount++;
              continue;
            }

            const removeSuccess = memberManager.removeMember(playerName);
            if (removeSuccess) {
              removeResults.push(`${color.green(playerName)}: 移除成功`);
              removedCount++;
              const targetPlayer = usePlayerByName(playerName);
              if (targetPlayer) {
                targetPlayer.sendMessage(color.red("您的会员资格已被移除，将受到试玩时间限制。"));
              }
            } else {
              removeResults.push(`${color.red(playerName)}: 移除失败`);
            }
          }

          player.sendMessage(color.green(`=== 批量移除会员结果 ===`));
          removeResults.forEach((result) => player.sendMessage(result));
          player.sendMessage(
            color.aqua(`成功: ${removedCount}, 未找到: ${notFoundCount}, 总计: ${playersToRemove.length}`)
          );
          break;

        case "check":
          if (!targetName) {
            player.sendMessage(color.red("用法: /yuehua:trial check <玩家名>"));
            player.sendMessage(color.gray("支持批量: /yuehua:trial check 玩家1,玩家2,玩家3"));
            return;
          }

          // 支持批量操作：用逗号分隔多个玩家名
          const playersToCheck = targetName
            .split(",")
            .map((name) => name.trim())
            .filter((name) => name.length > 0);

          if (playersToCheck.length === 0) {
            player.sendMessage(color.red("请输入有效的玩家名。"));
            return;
          }

          player.sendMessage(color.green(`=== 玩家状态查询 ===`));

          for (const playerName of playersToCheck) {
            const isMember = memberManager.isMember(playerName);
            const targetPlayer = usePlayerByName(playerName);

            player.sendMessage(color.aqua(`\n玩家: ${playerName}`));

            if (isMember) {
              player.sendMessage(color.green(`  状态: 正式会员`));
            } else {
              player.sendMessage(color.yellow(`  状态: 试玩玩家`));

              if (targetPlayer) {
                const trialTime = (targetPlayer.getDynamicProperty("trialModeTimer") as number) || 0;
                const duration = Number(setting.getState("trialModeDuration") || "3600");
                const remainingTime = Math.max(0, duration - trialTime);
                const hasTrialed = targetPlayer.hasTag("trialed");

                if (hasTrialed) {
                  player.sendMessage(color.red(`  试玩状态: 时间已用完`));
                } else {
                  player.sendMessage(color.gray(`  已使用: ${trialTime} 秒`));
                  player.sendMessage(color.gray(`  剩余: ${remainingTime} 秒`));
                }
              } else {
                player.sendMessage(color.gray(`  (玩家不在线)`));
              }
            }
          }
          break;

        case "reset":
          if (!targetName) {
            player.sendMessage(color.red("用法: /yuehua:trial reset <玩家名>"));
            player.sendMessage(color.gray("支持批量: /yuehua:trial reset 玩家1,玩家2,玩家3"));
            return;
          }

          // 支持批量操作：用逗号分隔多个玩家名
          const playersToReset = targetName
            .split(",")
            .map((name) => name.trim())
            .filter((name) => name.length > 0);

          if (playersToReset.length === 0) {
            player.sendMessage(color.red("请输入有效的玩家名。"));
            return;
          }

          let resetCount = 0;
          let offlineCount = 0;
          const resetResults: string[] = [];

          for (const playerName of playersToReset) {
            const resetPlayer = usePlayerByName(playerName);
            if (!resetPlayer) {
              resetResults.push(`${color.yellow(playerName)}: 不在线`);
              offlineCount++;
              continue;
            }

            // 重置试玩时间
            resetPlayer.setDynamicProperty("trialModeTimer", 0);
            resetPlayer.removeTag("trialed");
            resetResults.push(`${color.green(playerName)}: 重置成功`);
            resetCount++;
            resetPlayer.sendMessage(color.green("您的试玩时间已被管理员重置。"));
          }

          player.sendMessage(color.green(`=== 批量重置试玩时间结果 ===`));
          resetResults.forEach((result) => player.sendMessage(result));
          player.sendMessage(
            color.aqua(`成功: ${resetCount}, 不在线: ${offlineCount}, 总计: ${playersToReset.length}`)
          );
          break;

        default:
          player.sendMessage(color.yellow("未知操作。可用操作:"));
          player.sendMessage(color.gray("  list - 查看所有正式会员"));
          player.sendMessage(color.gray("  add <玩家名> - 添加正式会员"));
          player.sendMessage(color.gray("  remove <玩家名> - 移除正式会员"));
          player.sendMessage(color.gray("  check <玩家名> - 查看玩家试玩状态"));
          player.sendMessage(color.gray("  reset <玩家名> - 重置玩家试玩时间"));
          player.sendMessage(color.yellow("\n支持批量操作(用逗号分隔):"));
          player.sendMessage(color.gray("  /yuehua:trial add 玩家1,玩家2,玩家3"));
          player.sendMessage(color.gray("  /yuehua:trial remove 玩家1,玩家2"));
          break;
      }
    } catch (error) {
      player.sendMessage(color.red(`操作失败: ${(error as Error).message}`));
    }
  });

  return { status: CustomCommandStatus.Success };
}

function handleServerInfoCommand(origin: CustomCommandOrigin): CustomCommandResult {
  const player = origin.sourceEntity as Player;

  if (!player) {
    return { status: CustomCommandStatus.Failure };
  }

  system.run(() => {
    try {
      // 获取在线玩家信息
      const allPlayers = world.getAllPlayers();
      const playerCount = allPlayers.length;
      const playerNames = allPlayers.map((p) => p.name).join(", ");

      // 获取各维度实体数量
      const overworldEntities = world.getDimension("overworld").getEntities({ excludeTypes: ["item"] }).length;
      const netherEntities = world.getDimension("nether").getEntities({ excludeTypes: ["item"] }).length;
      const endEntities = world.getDimension("the_end").getEntities({ excludeTypes: ["item"] }).length;

      // 获取各维度掉落物数量
      const overworldItems = world.getDimension("overworld").getEntities({ type: "item" }).length;
      const netherItems = world.getDimension("nether").getEntities({ type: "item" }).length;
      const endItems = world.getDimension("the_end").getEntities({ type: "item" }).length;

      // 获取服务器名称
      const serverName = (world.getDynamicProperty("serverName") as string) || "未设置";

      // 获取世界时间
      const timeOfDay = world.getTimeOfDay();
      const day = Math.floor(world.getDay());

      // 显示服务器信息
      player.sendMessage(color.green("=== 服务器信息 ===\n"));

      player.sendMessage(color.aqua("【基本信息】"));
      player.sendMessage(`${color.gray("服务器名称:")} ${color.yellow(serverName)}`);
      player.sendMessage(`${color.gray("TPS:")} ${color.yellow(server.TPS.toFixed(2))}`);
      player.sendMessage(`${color.gray("世界时间:")} ${color.yellow(`第${day}天 ${timeOfDay}刻`)}\n`);

      player.sendMessage(color.aqua("【在线玩家】"));
      player.sendMessage(`${color.gray("在线人数:")} ${color.yellow(playerCount.toString())}`);
      if (playerCount > 0) {
        player.sendMessage(`${color.gray("玩家列表:")} ${color.yellow(playerNames)}\n`);
      }

      player.sendMessage(color.aqua("【实体统计】"));
      player.sendMessage(`${color.gray("主世界实体:")} ${color.yellow(overworldEntities.toString())}`);
      player.sendMessage(`${color.gray("下界实体:")} ${color.yellow(netherEntities.toString())}`);
      player.sendMessage(`${color.gray("末地实体:")} ${color.yellow(endEntities.toString())}`);
      player.sendMessage(`${color.gray("总实体数:")} ${color.yellow(server.organismLength.toString())}\n`);

      player.sendMessage(color.aqua("【掉落物统计】"));
      player.sendMessage(`${color.gray("主世界掉落物:")} ${color.yellow(overworldItems.toString())}`);
      player.sendMessage(`${color.gray("下界掉落物:")} ${color.yellow(netherItems.toString())}`);
      player.sendMessage(`${color.gray("末地掉落物:")} ${color.yellow(endItems.toString())}`);
      player.sendMessage(`${color.gray("总掉落物:")} ${color.yellow(server.itemsLength.toString())}\n`);

      player.sendMessage(color.aqua("【功能状态】"));
      player.sendMessage(
        `${color.gray("经济系统:")} ${setting.getState("economy") ? color.green("开启") : color.red("关闭")}`
      );
      player.sendMessage(
        `${color.gray("试玩模式:")} ${setting.getState("trialMode") ? color.green("开启") : color.red("关闭")}`
      );
      player.sendMessage(
        `${color.gray("一键砍树:")} ${setting.getState("enableTreeCutOneClick") ? color.green("开启") : color.red("关闭")}`
      );
      player.sendMessage(
        `${color.gray("一键挖矿:")} ${setting.getState("enableDigOreOneClick") ? color.green("开启") : color.red("关闭")}`
      );
    } catch (error) {
      player.sendMessage(color.red(`获取服务器信息失败: ${(error as Error).message}`));
    }
  });

  return { status: CustomCommandStatus.Success };
}

function handleMoneySettingCommand(
  origin: CustomCommandOrigin,
  operation: string,
  targetName: string,
  amount: number
): CustomCommandResult {
  const player = origin.sourceEntity as Player;

  if (!player) {
    return { status: CustomCommandStatus.Failure };
  }

  system.run(() => {
    try {
      if (!isAdmin(player)) {
        player.sendMessage(color.red("只有管理员可以使用此指令。"));
        return;
      }

      // 验证金额
      if (isNaN(amount) || amount <= 0) {
        player.sendMessage(color.red("请输入有效的金额 (必须大于0)。"));
        return;
      }

      // 检查金额是否超过安全整数范围
      const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
      if (amount > MAX_SAFE_INTEGER) {
        player.sendMessage(color.red(`金额过大，最大值为 ${MAX_SAFE_INTEGER}`));
        return;
      }

      const op = operation.toLowerCase();

      // 获取目标玩家的钱包
      const wallet = economic.getWallet(targetName);

      switch (op) {
        case "add":
          // 添加金币 (忽略每日限制)
          const addedAmount = economic.addGold(targetName, amount, "管理员添加", true);
          if (addedAmount > 0) {
            player.sendMessage(
              color.green(`成功为玩家 ${color.yellow(targetName)} 添加 ${color.gold(amount.toString())} 金币。`)
            );
            player.sendMessage(
              color.gray(
                `当前余额: ${color.gold(wallet.gold.toString())} → ${color.gold((wallet.gold + amount).toString())}`
              )
            );

            // 通知目标玩家
            const targetPlayer = usePlayerByName(targetName);
            if (targetPlayer) {
              targetPlayer.sendMessage(
                color.green(
                  `管理员为您添加了 ${color.gold(amount.toString())} 金币，当前余额: ${color.gold((wallet.gold + amount).toString())}`
                )
              );
            }
          } else {
            player.sendMessage(color.red("添加金币失败。"));
          }
          break;

        case "remove":
          // 扣除金币
          const currentBalance = wallet.gold;
          if (currentBalance < amount) {
            player.sendMessage(
              color.red(
                `玩家 ${targetName} 的余额不足。当前余额: ${color.gold(currentBalance.toString())}，需要扣除: ${color.gold(amount.toString())}`
              )
            );
            return;
          }

          const removeSuccess = economic.removeGold(targetName, amount, "管理员扣除");
          if (removeSuccess) {
            player.sendMessage(
              color.green(`成功为玩家 ${color.yellow(targetName)} 扣除 ${color.gold(amount.toString())} 金币。`)
            );
            player.sendMessage(
              color.gray(
                `当前余额: ${color.gold(currentBalance.toString())} → ${color.gold((currentBalance - amount).toString())}`
              )
            );

            // 通知目标玩家
            const targetPlayer = usePlayerByName(targetName);
            if (targetPlayer) {
              targetPlayer.sendMessage(
                color.red(
                  `管理员扣除了您 ${color.gold(amount.toString())} 金币，当前余额: ${color.gold((currentBalance - amount).toString())}`
                )
              );
            }
          } else {
            player.sendMessage(color.red("扣除金币失败。"));
          }
          break;

        case "set":
          // 设置金币
          const oldBalance = wallet.gold;
          const setSuccess = economic.setPlayerGold(targetName, amount);
          if (setSuccess) {
            player.sendMessage(
              color.green(`成功将玩家 ${color.yellow(targetName)} 的金币设置为 ${color.gold(amount.toString())}。`)
            );
            player.sendMessage(
              color.gray(`原余额: ${color.gold(oldBalance.toString())} → 新余额: ${color.gold(amount.toString())}`)
            );

            // 通知目标玩家
            const targetPlayer = usePlayerByName(targetName);
            if (targetPlayer) {
              targetPlayer.sendMessage(color.yellow(`管理员将您的金币设置为 ${color.gold(amount.toString())}`));
            }
          } else {
            player.sendMessage(color.red("设置金币失败。"));
          }
          break;

        default:
          player.sendMessage(color.yellow("未知操作。可用操作:"));
          player.sendMessage(color.gray("  add <玩家名> <金额> - 为玩家添加金币"));
          player.sendMessage(color.gray("  remove <玩家名> <金额> - 扣除玩家金币"));
          player.sendMessage(color.gray("  set <玩家名> <金额> - 设置玩家金币"));
          player.sendMessage(color.yellow("\n示例:"));
          player.sendMessage(color.gray("  /yuehua:money_setting add Steve 1000"));
          player.sendMessage(color.gray("  /yuehua:money_setting remove Alex 500"));
          player.sendMessage(color.gray("  /yuehua:money_setting set Notch 99999"));
          break;
      }
    } catch (error) {
      player.sendMessage(color.red(`操作失败: ${(error as Error).message}`));
    }
  });

  return { status: CustomCommandStatus.Success };
}

function handleGiveMenuCommand(origin: CustomCommandOrigin): CustomCommandResult {
  const player = origin.sourceEntity as Player;

  if (!player) {
    return { status: CustomCommandStatus.Failure };
  }

  system.run(() => {
    try {
      // 执行 give 命令给予服务器菜单
      player.runCommand("give @s yuehua:sm");
      player.sendMessage(color.green("已为您发放服务器菜单！"));
    } catch (error) {
      player.sendMessage(color.red(`获取菜单失败: ${(error as Error).message}`));
    }
  });

  return { status: CustomCommandStatus.Success };
}
