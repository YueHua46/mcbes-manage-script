/**
 * 玩家设置服务
 * 完整迁移自 Modules/Player/PlayerSetting.ts (145行)
 */

import { Player } from '@minecraft/server';
import { namePrefixMap } from '../../../assets/glyph-map';

export enum EFunNames {
  TPA = 'TPA',
  Chat = 'Chat',
}

// 支持的颜色列表
export const nameColors: Record<string, string> = {
  '§0': '黑色',
  '§1': '深蓝色',
  '§2': '深绿色',
  '§3': '深青色',
  '§4': '深红色',
  '§5': '深紫色',
  '§6': '金色',
  '§7': '灰色',
  '§8': '深灰色',
  '§9': '蓝色',
  '§a': '绿色',
  '§b': '青色',
  '§c': '红色',
  '§d': '紫色',
  '§e': '黄色',
  '§f': '白色',
  '§g': '暗黄色',
  '§h': '彩色',
  '§r': '重置',
};

export type TNameColor = keyof typeof nameColors;

export interface IPlayerDisplaySettings {
  nameColor: string;
  alias: string;
  avatar: string;
}

class PlayerSetting {
  /**
   * 功能开关（玩家传送和聊天功能开关）
   */
  turnPlayerFunction(funName: EFunNames, player: Player, value?: boolean): void {
    switch (funName) {
      case EFunNames.TPA:
        player.setDynamicProperty('TPA', value);
        break;
      case EFunNames.Chat:
        player.setDynamicProperty('Chat', value);
        break;
    }
  }

  /**
   * 设置玩家名字显示颜色
   */
  setPlayerNameColor(player: Player, colorCode: string): boolean {
    if (!nameColors.hasOwnProperty(colorCode)) {
      return false;
    }

    player.setDynamicProperty('nameColor', colorCode);
    return true;
  }

  /**
   * 获取玩家名字显示颜色
   */
  getPlayerNameColor(player: Player): string {
    return (player.getDynamicProperty('nameColor') as string) || '§f';
  }

  /**
   * 设置玩家别名
   */
  setPlayerAlias(player: Player, alias: string): boolean {
    if (alias.length > 20) {
      return false;
    }

    const cleanAlias = alias.replace(/[§]/g, '').trim();
    if (cleanAlias.length === 0) {
      player.setDynamicProperty('alias', '');
    } else {
      player.setDynamicProperty('alias', cleanAlias);
    }

    return true;
  }

  /**
   * 获取玩家别名
   */
  getPlayerAlias(player: Player): string {
    return (player.getDynamicProperty('alias') as string) || '';
  }

  /**
   * 获取玩家显示名称（包含颜色和别名）
   */
  getPlayerDisplayName(player: Player): string {
    const nameColor = this.getPlayerNameColor(player);
    const alias = this.getPlayerAlias(player);

    if (alias) {
      return `${nameColor}[${alias}] ${player.name}`;
    } else {
      return `${nameColor}${player.name}`;
    }
  }

  /**
   * 获取玩家的显示设置
   */
  getPlayerDisplaySettings(player: Player): IPlayerDisplaySettings {
    return {
      nameColor: this.getPlayerNameColor(player),
      alias: this.getPlayerAlias(player),
      avatar: '',
    };
  }

  /**
   * 重置玩家显示设置
   */
  resetPlayerDisplaySettings(player: Player): void {
    player.setDynamicProperty('nameColor', '§f');
    player.setDynamicProperty('alias', '');
    player.setDynamicProperty('avatar', '0');
  }
}

export default new PlayerSetting();


