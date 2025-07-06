import { Player } from "@minecraft/server";
import { namePrefixMap } from "../../glyphMap";

export enum EFunNames {
  TPA = "TPA",
  Chat = "Chat",
}

// 支持的颜色列表
export const nameColors: Record<string, string> = {
  "§0": "黑色",
  "§1": "深蓝色",
  "§2": "深绿色",
  "§3": "深青色",
  "§4": "深红色",
  "§5": "深紫色",
  "§6": "金色",
  "§7": "灰色",
  "§8": "深灰色",
  "§9": "蓝色",
  "§a": "绿色",
  "§b": "青色",
  "§c": "红色",
  "§d": "紫色",
  "§e": "黄色",
  "§f": "白色",
  "§g": "暗黄色",
  "§h": "彩色",
  "§r": "重置",
};

export type TNameColor = keyof typeof nameColors;

export interface IPlayerDisplaySettings {
  nameColor: string;
  alias: string;
  avatar: string; // 新增头像字段
}

class PlayerSetting {
  // 功能开关
  // 玩家传送和聊天功能开关
  turnPlayerFunction(funName: EFunNames, player: Player, value?: boolean) {
    switch (funName) {
      case EFunNames.TPA:
        player.setDynamicProperty("TPA", value);
        break;
      case EFunNames.Chat:
        player.setDynamicProperty("Chat", value);
        break;
    }
  }

  // 设置玩家名字显示颜色
  setPlayerNameColor(player: Player, colorCode: string): boolean {
    if (!nameColors.hasOwnProperty(colorCode)) {
      return false;
    }

    player.setDynamicProperty("nameColor", colorCode);
    return true;
  }

  // 获取玩家名字显示颜色
  getPlayerNameColor(player: Player): string {
    return (player.getDynamicProperty("nameColor") as string) || "§f"; // 默认白色
  }

  // 设置玩家别名
  setPlayerAlias(player: Player, alias: string): boolean {
    // 限制别名长度
    if (alias.length > 20) {
      return false;
    }

    // 过滤掉一些不合适的字符
    const cleanAlias = alias.replace(/[§]/g, "").trim();
    if (cleanAlias.length === 0) {
      // 如果别名为空，则清除别名
      player.setDynamicProperty("alias", "");
    } else {
      player.setDynamicProperty("alias", cleanAlias);
    }

    return true;
  }

  // 获取玩家别名
  getPlayerAlias(player: Player): string {
    return (player.getDynamicProperty("alias") as string) || "";
  }

  // 设置玩家头像
  setPlayerAvatar(player: Player, avatarIndex: number): boolean {
    if (avatarIndex < 0 || avatarIndex >= namePrefixMap.length) {
      return false;
    }
    player.setDynamicProperty("avatar", avatarIndex.toString());
    return true;
  }

  // 获取玩家头像
  getPlayerAvatar(player: Player): string {
    const avatarIndex = parseInt(player.getDynamicProperty("avatar") as string) || 0;
    return namePrefixMap[avatarIndex] || namePrefixMap[0];
  }

  // 获取玩家头像索引
  getPlayerAvatarIndex(player: Player): number {
    return parseInt(player.getDynamicProperty("avatar") as string) || 0;
  }

  // 获取玩家显示名称（包含颜色、头像和别名）
  getPlayerDisplayName(player: Player): string {
    const nameColor = this.getPlayerNameColor(player);
    const alias = this.getPlayerAlias(player);
    const avatar = this.getPlayerAvatar(player);

    if (alias) {
      // 如果有别名，显示格式：头像+名字，下方显示别名
      return `${avatar} ${nameColor}${player.name}\n§8${alias}`;
    } else {
      // 如果没有别名，只显示头像+游戏名
      return `${avatar} ${nameColor}${player.name}`;
    }
  }

  // 获取玩家的显示设置
  getPlayerDisplaySettings(player: Player): IPlayerDisplaySettings {
    return {
      nameColor: this.getPlayerNameColor(player),
      alias: this.getPlayerAlias(player),
      avatar: this.getPlayerAvatar(player),
    };
  }

  // 重置玩家显示设置
  resetPlayerDisplaySettings(player: Player): void {
    player.setDynamicProperty("nameColor", "§f");
    player.setDynamicProperty("alias", "");
    player.setDynamicProperty("avatar", "0");
  }
}

export default new PlayerSetting();
