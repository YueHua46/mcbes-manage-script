/**
 * 命令系统服务
 * 完整迁移自 Modules/Command/Command.ts (1095行)
 */

import {
  system,
  world,
  Player,
  Entity,
  CustomCommand,
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandOrigin,
  CustomCommandResult,
  CustomCommandStatus,
} from "@minecraft/server";
import { color } from "../../../shared/utils/color";
import { isAdmin, SystemLog } from "../../../shared/utils/common";
import { usePlayerByName } from "../../../shared/hooks/use-player";
import wayPoint from "../../waypoint/services/waypoint";
import landManager from "../../land/services/land-manager";
import setting from "../../system/services/setting";
import serverInfo from "../../system/services/server-info";
import { economic } from "../../economic";

// 防止重复注册的标志
let commandsRegistered = false;

/**
 * 注册所有自定义命令
 */
system.beforeEvents.startup.subscribe((init) => {
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
        name: `玩家名(多个用逗号分隔，且用英文引号包裹)`,
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
    description: "金币管理(仅管理员或命令方块) - 用法: add|remove|set <玩家名> <金额>",
    permissionLevel: CommandPermissionLevel.GameDirectors,
    mandatoryParameters: [
      { type: CustomCommandParamType.String, name: "操作(add/remove/set)" },
      { type: CustomCommandParamType.PlayerSelector, name: "玩家选择器(player)" },
      { type: CustomCommandParamType.Integer, name: "金额" },
    ],
  };
  registry.registerCommand(moneySettingCommand, handleMoneySettingCommand);

  // 11. 注册 give_me_menu 指令
  const giveMenuCommand: CustomCommand = {
    name: "yuehua:give_me_menu",
    description: "获取服务器菜单物品",
    permissionLevel: CommandPermissionLevel.Any,
  };
  registry.registerCommand(giveMenuCommand, handleGiveMenuCommand);

  // 12. 注册 camera 指令 (实体视角观察)
  registry.registerEnum("yuehua:CameraOperationType", ["start", "stop", "perspective", "next"]);
  const cameraCommand: CustomCommand = {
    name: "yuehua:camera",
    description: "实体视角观察系统 - 用法: /yuehua:camera <操作> [参数]",
    permissionLevel: CommandPermissionLevel.Admin,
    optionalParameters: [
      { type: CustomCommandParamType.Enum, name: "操作", enumName: "yuehua:CameraOperationType" },
      { type: CustomCommandParamType.EntitySelector, name: "目标实体选择器或视角类型" },
    ],
  };
  registry.registerCommand(cameraCommand, handleCameraCommand);

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
  if (!player) return { status: CustomCommandStatus.Failure };

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
  if (!player) return { status: CustomCommandStatus.Failure };

  if (!subCommand) {
    player.sendMessage(color.yellow("使用方法: /land <list|query|remove|trust|untrust> [参数]"));
    return { status: CustomCommandStatus.Success };
  }

  system.run(() => {
    try {
      switch (subCommand.toLowerCase()) {
        case "list":
          const lands = landManager.getPlayerLands(player.name);
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
          const test = landManager.testLand(player.location, player.dimension.id);
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
          const landToRemove = landManager.getLand(removeName);
          if (typeof landToRemove === "string") {
            player.sendMessage(color.red(landToRemove));
            return;
          }

          if (landToRemove.owner !== player.name && !isAdmin(player)) {
            player.sendMessage(color.red("你没有权限删除该领地。"));
            return;
          }

          landManager.removeLand(removeName);
          player.sendMessage(color.green(`成功删除领地: ${removeName}`));
          break;

        case "trust":
          if (!arg1 || !arg2) {
            player.sendMessage(color.red("用法: /land trust <玩家名> <领地名称>"));
            return;
          }
          const trustPlayer = arg1;
          const trustLandName = arg2;

          const trustLandInfo = landManager.getLand(trustLandName);
          if (typeof trustLandInfo === "string") {
            player.sendMessage(color.red(trustLandInfo));
            return;
          }

          if (trustLandInfo.owner !== player.name && !isAdmin(player)) {
            player.sendMessage(color.red("你没有权限管理该领地。"));
            return;
          }

          const addResult = landManager.addMember(trustLandName, trustPlayer);
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

          const untrustLandInfo = landManager.getLand(untrustLandName);
          if (typeof untrustLandInfo === "string") {
            player.sendMessage(color.red(untrustLandInfo));
            return;
          }

          if (untrustLandInfo.owner !== player.name && !isAdmin(player)) {
            player.sendMessage(color.red("你没有权限管理该领地。"));
            return;
          }

          const removeResult = landManager.removeMember(untrustLandName, untrustPlayer);
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
  if (!player) return { status: CustomCommandStatus.Failure };

  system.run(async () => {
    try {
      const economic = (await import("../../economic/services/economic")).default;

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
  if (!player) return { status: CustomCommandStatus.Failure };

  system.run(async () => {
    try {
      const economic = (await import("../../economic/services/economic")).default;

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
  if (!player) return { status: CustomCommandStatus.Failure };

  system.run(() => {
    try {
      if (!isAdmin(player)) {
        player.sendMessage(color.red("只有管理员可以使用此指令。"));
        return;
      }

      if (!key || key.toLowerCase() === "list") {
        player.sendMessage(color.green("=== 系统设置列表 ==="));
        player.sendMessage(color.yellow("使用方法: /yuehua:setting <设置项> <值>\n"));

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
          maxPrivatePointsPerPlayer: "每个玩家最大私人坐标点数量 (数字)",
          maxPublicPointsPerPlayer: "每个玩家最大公开坐标点数量 (数字)",
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
          monsterKillGoldReward: "杀怪掉金币功能 (true/false)",
        };

        for (const [settingKey, description] of Object.entries(settingDescriptions)) {
          const currentValue = setting.getState(settingKey as any);
          player.sendMessage(`${color.aqua(settingKey)}: ${description}`);
          player.sendMessage(`  ${color.gray(`当前值: ${color.yellow(String(currentValue))}\n`)}`);
        }
        return;
      }

      if (!value) {
        player.sendMessage(color.red("用法: /yuehua:setting <设置项> <值>"));
        player.sendMessage(color.yellow("或使用 /yuehua:setting list 查看所有可配置项"));
        return;
      }

      let finalValue: boolean | string = value;
      if (value === "true") finalValue = true;
      if (value === "false") finalValue = false;

      setting.setState(key as any, finalValue);
      player.sendMessage(color.green(`已将设置 ${key} 更新为 ${finalValue}`));
    } catch (error) {
      player.sendMessage(color.red(`设置失败: ${(error as Error).message}`));
    }
  });

  return { status: CustomCommandStatus.Success };
}

function handleRtpCommand(origin: CustomCommandOrigin): CustomCommandResult {
  const player = origin.sourceEntity as Player;
  if (!player) return { status: CustomCommandStatus.Failure };

  system.run(async () => {
    try {
      const { RandomTp } = await import("../../other/services/random-tp");
      RandomTp(player);
    } catch (error) {
      player.sendMessage(color.red(`传送失败: ${(error as Error).message}`));
    }
  });

  return { status: CustomCommandStatus.Success };
}

function handleOneClickCommand(origin: CustomCommandOrigin, feature: string): CustomCommandResult {
  const player = origin.sourceEntity as Player;
  if (!player) return { status: CustomCommandStatus.Failure };

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
  if (!player) return { status: CustomCommandStatus.Failure };

  system.run(async () => {
    try {
      if (!isAdmin(player)) {
        player.sendMessage(color.red("只有管理员可以使用此指令。"));
        return;
      }

      const { memberManager } = await import("../../system/services/trial-mode");

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
            return;
          }

          const playersToRemove = targetName
            .split(",")
            .map((name) => name.trim())
            .filter((name) => name.length > 0);

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
            return;
          }

          const playersToCheck = targetName
            .split(",")
            .map((name) => name.trim())
            .filter((name) => name.length > 0);

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
            return;
          }

          const playersToReset = targetName
            .split(",")
            .map((name) => name.trim())
            .filter((name) => name.length > 0);

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
          player.sendMessage(color.yellow("未知操作。可用操作: list, add, remove, check, reset"));
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
  if (!player) return { status: CustomCommandStatus.Failure };

  system.run(() => {
    try {
      const allPlayers = world.getAllPlayers();
      const playerCount = allPlayers.length;
      const playerNames = allPlayers.map((p) => p.name).join(", ");

      const overworldEntities = world.getDimension("overworld").getEntities({ excludeTypes: ["item"] }).length;
      const netherEntities = world.getDimension("nether").getEntities({ excludeTypes: ["item"] }).length;
      const endEntities = world.getDimension("the_end").getEntities({ excludeTypes: ["item"] }).length;

      const overworldItems = world.getDimension("overworld").getEntities({ type: "item" }).length;
      const netherItems = world.getDimension("nether").getEntities({ type: "item" }).length;
      const endItems = world.getDimension("the_end").getEntities({ type: "item" }).length;

      const serverName = (world.getDynamicProperty("serverName") as string) || "未设置";
      const timeOfDay = world.getTimeOfDay();
      const day = Math.floor(world.getDay());

      player.sendMessage(color.green("=== 服务器信息 ===\n"));
      player.sendMessage(color.aqua("【基本信息】"));
      player.sendMessage(`${color.gray("服务器名称:")} ${color.yellow(serverName)}`);
      player.sendMessage(`${color.gray("TPS:")} ${color.yellow(serverInfo.TPS.toFixed(2))}`);
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
      player.sendMessage(`${color.gray("总实体数:")} ${color.yellow(serverInfo.organismLength.toString())}\n`);

      player.sendMessage(color.aqua("【掉落物统计】"));
      player.sendMessage(`${color.gray("主世界掉落物:")} ${color.yellow(overworldItems.toString())}`);
      player.sendMessage(`${color.gray("下界掉落物:")} ${color.yellow(netherItems.toString())}`);
      player.sendMessage(`${color.gray("末地掉落物:")} ${color.yellow(endItems.toString())}`);
      player.sendMessage(`${color.gray("总掉落物:")} ${color.yellow(serverInfo.itemsLength.toString())}\n`);

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
  targetPlayers: Player[],
  amount: number
): CustomCommandResult {
  SystemLog.info(`targetPlayers: ${JSON.stringify(targetPlayers.map((p) => p.name))}`);
  const entity = origin.sourceEntity;
  // 如果是玩家
  if (entity instanceof Player) {
    const player = entity;
    system.run(async () => {
      try {
        if (!isAdmin(player)) {
          player.sendMessage(color.red("只有管理员可以使用此指令。"));
          return;
        }

        if (!Array.isArray(targetPlayers) || targetPlayers.length === 0) {
          player.sendMessage(color.red("没有指定目标玩家。"));
          return;
        }

        if (isNaN(amount) || amount <= 0) {
          player.sendMessage(color.red("请输入有效的金额 (必须大于0)。"));
          return;
        }

        const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
        if (amount > MAX_SAFE_INTEGER) {
          player.sendMessage(color.red(`金额过大，最大值为 ${MAX_SAFE_INTEGER}`));
          return;
        }

        const op = operation.toLowerCase();
        let successCount = 0;
        let failCount = 0;
        let msgList: string[] = [];

        for (const targetPlayer of targetPlayers) {
          const wallet = economic.getWallet(targetPlayer.name);

          switch (op) {
            case "add": {
              const addedAmount = economic.addGold(targetPlayer.name, amount, "管理员添加", true);
              if (addedAmount > 0) {
                player.sendMessage(
                  color.green(
                    `成功为玩家 ${color.yellow(targetPlayer.name)} 添加 ${color.gold(amount.toString())} 金币。`
                  )
                );
                player.sendMessage(
                  color.gray(
                    `当前余额: ${color.gold(wallet.gold.toString())} → ${color.gold((wallet.gold + amount).toString())}`
                  )
                );
                targetPlayer.sendMessage(
                  color.green(`管理员为您添加了 ${amount} 金币，当前余额: ${wallet.gold + amount}`)
                );
                successCount++;
              } else {
                player.sendMessage(color.red(`为玩家 ${color.yellow(targetPlayer.name)} 添加金币失败。`));
                failCount++;
              }
              break;
            }
            case "remove": {
              const currentBalance = wallet.gold;
              if (currentBalance < amount) {
                player.sendMessage(
                  color.red(
                    `玩家 ${color.yellow(targetPlayer.name)} 的余额不足。当前余额: ${color.gold(currentBalance.toString())}，需要扣除: ${color.gold(amount.toString())}`
                  )
                );
                failCount++;
                break;
              }

              const removeSuccess = economic.removeGold(targetPlayer.name, amount, "管理员扣除");
              if (removeSuccess) {
                player.sendMessage(
                  color.green(
                    `成功为玩家 ${color.yellow(targetPlayer.name)} 扣除 ${color.gold(amount.toString())} 金币。`
                  )
                );

                targetPlayer.sendMessage(
                  color.red(
                    `管理员扣除了您 ${color.gold(amount.toString())} 金币，当前余额: ${color.gold((currentBalance - amount).toString())}`
                  )
                );
                successCount++;
              } else {
                player.sendMessage(color.red(`为玩家 ${color.yellow(targetPlayer.name)} 扣除金币失败。`));
                failCount++;
              }
              break;
            }
            case "set": {
              const oldBalance = wallet.gold;
              const setSuccess = economic.setPlayerGold(targetPlayer.name, amount);
              if (setSuccess) {
                player.sendMessage(
                  color.green(
                    `成功将玩家 ${color.yellow(targetPlayer.name)} 的金币设置为 ${color.gold(amount.toString())}。`
                  )
                );
                targetPlayer.sendMessage(color.yellow(`管理员将您的金币设置为 ${color.gold(amount.toString())}`));
                successCount++;
              } else {
                player.sendMessage(color.red(`为玩家 ${color.yellow(targetPlayer.name)} 设置金币失败。`));
                failCount++;
              }
              break;
            }
            default:
              msgList.push("未知操作。可用操作: add, remove, set");
              break;
          }
        }
        if (msgList.length > 0) {
          player.sendMessage(color.yellow(msgList.join("；")));
        }
        // 如果全部失败，可以考虑返回失败
      } catch (error) {
        player.sendMessage(color.red(`操作失败: ${(error as Error).message}`));
      }
    });
  } else if (origin.sourceBlock) {
    // 如果是命令方块
    const block = origin.sourceBlock;
    try {
      if (!Array.isArray(targetPlayers) || targetPlayers.length === 0) {
        SystemLog.error("命令方块执行金币管理指令时未指定目标玩家。");
        return { status: CustomCommandStatus.Failure, message: "未指定目标玩家" };
      }
      SystemLog.info(
        `命令方块 ${block.location.x},${block.location.y},${block.location.z} 执行了金币管理指令: ${operation} 目标玩家: ${targetPlayers.map((p) => p.name).join(", ")} 金额: ${amount}`
      );
      if (isNaN(amount) || amount <= 0) {
        SystemLog.error("请输入有效的金额 (必须大于0)。");
        return { status: CustomCommandStatus.Failure, message: "请输入有效的金额 (必须大于0)" };
      }

      const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
      if (amount > MAX_SAFE_INTEGER) {
        SystemLog.error(`金额过大，最大值为 ${MAX_SAFE_INTEGER}`);
        return { status: CustomCommandStatus.Failure, message: `金额过大，最大值为 ${MAX_SAFE_INTEGER}` };
      }

      const op = operation.toLowerCase();
      let successCount = 0,
        failCount = 0;
      for (const targetPlayer of targetPlayers) {
        const wallet = economic.getWallet(targetPlayer.name);

        switch (op) {
          case "add": {
            const addedAmount = economic.addGold(targetPlayer.name, amount, "管理员添加", true);
            if (addedAmount > 0) {
              SystemLog.info(
                `成功为玩家 ${color.yellow(targetPlayer.name)} 添加 ${color.gold(amount.toString())} 金币。`
              );
              SystemLog.info(`当前余额: ${wallet.gold} → ${wallet.gold + amount}`);

              targetPlayer.sendMessage(
                color.green(`管理员为您添加了 ${amount} 金币，当前余额: ${wallet.gold + amount}`)
              );
              successCount++;
            } else {
              SystemLog.error(`为玩家 ${color.yellow(targetPlayer.name)} 添加金币失败。`);
              failCount++;
            }
            break;
          }
          case "remove": {
            const currentBalance = wallet.gold;
            if (currentBalance < amount) {
              SystemLog.error(`玩家 ${targetPlayer.name} 的余额不足。当前余额: ${currentBalance}，需要扣除: ${amount}`);
              failCount++;
              break;
            }

            const removeSuccess = economic.removeGold(targetPlayer.name, amount, "管理员扣除");
            if (removeSuccess) {
              SystemLog.info(
                `成功为玩家 ${color.yellow(targetPlayer.name)} 扣除 ${color.gold(amount.toString())} 金币。`
              );
              SystemLog.info(`当前余额: ${wallet.gold} → ${wallet.gold - amount}`);

              targetPlayer.sendMessage(color.red(`管理员扣除了您 ${amount} 金币，当前余额: ${wallet.gold - amount}`));
              successCount++;
            } else {
              SystemLog.error(`为玩家 ${color.yellow(targetPlayer.name)} 扣除金币失败。`);
              failCount++;
            }
            break;
          }
          case "set": {
            const oldBalance = wallet.gold;
            const setSuccess = economic.setPlayerGold(targetPlayer.name, amount);
            if (setSuccess) {
              SystemLog.info(`成功将玩家 ${color.yellow(targetPlayer.name)} 的金币设置为 ${amount}。`);
              SystemLog.info(`当前余额: ${wallet.gold} → ${amount}`);

              targetPlayer.sendMessage(color.yellow(`管理员将您的金币设置为 ${amount}`));
              successCount++;
            } else {
              SystemLog.error(`为玩家 ${color.yellow(targetPlayer.name)} 设置金币失败。`);
              failCount++;
            }
            break;
          }
          default:
            SystemLog.error("未知操作。可用操作: add, remove, set");
            return { status: CustomCommandStatus.Failure, message: "未知操作。可用操作: add, remove, set" };
        }
      }
      // 可以输出批量结果，如果需要
    } catch (error) {
      SystemLog.error(`金币管理指令执行失败: ${(error as Error).message}`);
      return { status: CustomCommandStatus.Failure, message: `金币管理指令执行失败: ${(error as Error).message}` };
    }
  } else {
    SystemLog.error("金币管理指令执行失败: 未知来源");
    return { status: CustomCommandStatus.Failure, message: "金币管理指令执行失败: 未知来源" };
  }
  return { status: CustomCommandStatus.Success };
}

function handleGiveMenuCommand(origin: CustomCommandOrigin): CustomCommandResult {
  const player = origin.sourceEntity as Player;
  if (!player) return { status: CustomCommandStatus.Failure };

  system.run(() => {
    try {
      player.runCommand("give @s yuehua:sm");
      player.sendMessage(color.green("已为您发放服务器菜单！"));
    } catch (error) {
      player.sendMessage(color.red(`获取菜单失败: ${(error as Error).message}`));
    }
  });

  return { status: CustomCommandStatus.Success };
}

function handleCameraCommand(
  origin: CustomCommandOrigin,
  operation?: string,
  targetEntitiesOrPerspective?: Entity[] | string
): CustomCommandResult {
  const player = origin.sourceEntity as Player;
  if (!player) return { status: CustomCommandStatus.Failure };

  system.run(async () => {
    try {
      const cameraService = (await import("../../camera/services/camera")).default;

      if (!operation || operation.toLowerCase() === "stop") {
        // 停止观察
        const result = cameraService.stopObserving(player);
        if (typeof result === "string") {
          player.sendMessage(color.red(result));
        }
        return;
      }

      if (operation.toLowerCase() === "start") {
        // 开始观察
        if (
          !targetEntitiesOrPerspective ||
          !Array.isArray(targetEntitiesOrPerspective) ||
          targetEntitiesOrPerspective.length === 0
        ) {
          player.sendMessage(color.yellow("用法: /yuehua:camera start <实体选择器>"));
          player.sendMessage(color.gray("示例: /yuehua:camera start @p"));
          player.sendMessage(color.gray("示例: /yuehua:camera start @e[type=zombie]"));
          player.sendMessage(color.gray("示例: /yuehua:camera start @e[type=!player]"));
          return;
        }

        // 获取第一个目标实体（如果选择器返回多个实体，使用第一个）
        const targetEntity = targetEntitiesOrPerspective[0];

        // 检查实体是否有效
        try {
          if (!targetEntity || !targetEntity.id) {
            player.sendMessage(color.red("目标实体无效或已不存在"));
            return;
          }
        } catch (error) {
          player.sendMessage(color.red("目标实体无效或已不存在"));
          return;
        }

        // 开始观察
        const result = cameraService.startObserving(player, targetEntity);
        if (typeof result === "string") {
          player.sendMessage(color.red(result));
        } else if (targetEntitiesOrPerspective.length > 1) {
          player.sendMessage(
            color.yellow(`选择器匹配到 ${targetEntitiesOrPerspective.length} 个实体，已选择第一个实体进行观察`)
          );
        }
      } else if (operation.toLowerCase() === "perspective" || operation.toLowerCase() === "p") {
        // 切换视角
        if (typeof targetEntitiesOrPerspective === "string") {
          const perspectiveType = targetEntitiesOrPerspective.toLowerCase();
          if (perspectiveType === "first" || perspectiveType === "1" || perspectiveType === "first_person") {
            const result = cameraService.switchPerspective(player, "first_person");
            if (typeof result === "string") {
              player.sendMessage(color.red(result));
            } else {
              player.sendMessage(color.green("已切换到第一人称视角"));
            }
          } else if (perspectiveType === "third" || perspectiveType === "3" || perspectiveType === "third_person") {
            const result = cameraService.switchPerspective(player, "third_person");
            if (typeof result === "string") {
              player.sendMessage(color.red(result));
            } else {
              player.sendMessage(color.green("已切换到第三人称视角（背后）"));
            }
          } else if (perspectiveType === "front" || perspectiveType === "third_front") {
            const result = cameraService.switchPerspective(player, "third_person");
            if (typeof result === "string") {
              player.sendMessage(color.red(result));
            } else {
              player.sendMessage(color.green("已切换到第三人称视角（前方）"));
            }
          } else {
            player.sendMessage(color.yellow("用法: /yuehua:camera perspective <first|third>"));
            player.sendMessage(color.gray("first - 第一人称视角"));
            player.sendMessage(color.gray("third - 第三人称视角（背后）"));
          }
        } else {
          player.sendMessage(color.yellow("用法: /yuehua:camera perspective <first|third>"));
          player.sendMessage(color.gray("first - 第一人称视角"));
          player.sendMessage(color.gray("third - 第三人称视角（背后）"));
        }
      } else if (operation.toLowerCase() === "next" || operation.toLowerCase() === "n") {
        // 切换到下一个视角
        const result = cameraService.switchToNextPerspective(player);
        if (typeof result === "string") {
          player.sendMessage(color.red(result));
        } else {
          const cameraServiceInternal = cameraService as any;
          const state = (cameraServiceInternal as any).observerStates?.get(player.id);
          if (state) {
            const perspectiveNames: Record<string, string> = {
              first_person: "第一人称",
              third_person: "第三人称（背后）",
            };
            player.sendMessage(
              color.green(`已切换到: ${perspectiveNames[state.perspectiveType] || state.perspectiveType}`)
            );
          } else {
            player.sendMessage(color.green("已切换到下一个视角"));
          }
        }
      } else {
        player.sendMessage(color.yellow("用法: /yuehua:camera <start|stop|perspective|next> [参数]"));
        player.sendMessage(color.gray("start - 开始观察实体"));
        player.sendMessage(color.gray("stop - 停止观察"));
        player.sendMessage(color.gray("perspective <first|third> - 切换视角"));
        player.sendMessage(color.gray("next - 切换到下一个视角（循环）"));
      }
    } catch (error) {
      player.sendMessage(color.red(`指令执行错误: ${(error as Error).message}`));
    }
  });

  return { status: CustomCommandStatus.Success };
}

export {};
