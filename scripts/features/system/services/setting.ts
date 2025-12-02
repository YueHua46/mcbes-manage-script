/**
 * 系统设置服务
 * 完整迁移自 Modules/System/Setting.ts (120行)
 */

import { system } from '@minecraft/server';
import { SystemLog } from '../../../shared/utils/common';
import { Database } from '../../../shared/database/database';

// 导入试玩模式（自动注册事件）
import './trial-mode';

export type IModules =
  | 'player'
  | 'land'
  | 'wayPoint'
  | 'economy'
  | 'other'
  | 'help'
  | 'sm'
  | 'setting'
  | 'killItem'
  | 'killItemAmount'
  | 'randomTpRange'
  | 'maxLandPerPlayer'
  | 'maxLandBlocks'
  | 'maxPointsPerPlayer'
  | 'playerNameColor'
  | 'playerChatColor'
  | 'trialMode'
  | 'trialModeDuration'
  | 'randomTeleport'
  | 'backToDeath'
  | 'enableTreeCutOneClick'
  | 'enableDigOreOneClick'
  | 'land1BlockPerPrice'
  | 'daily_gold_limit'
  | 'startingGold';

export type IValueType = boolean | string;

export const defaultSetting = {
  player: true,
  land: true,
  wayPoint: true,
  economy: true,
  other: true,
  help: true,
  sm: true,
  setting: true,
  killItem: true,
  killItemAmount: '1500',
  randomTpRange: '50000',
  maxLandPerPlayer: '5',
  maxLandBlocks: '30000',
  maxPointsPerPlayer: '20',
  playerNameColor: '§f',
  playerChatColor: '§f',
  trialMode: false,
  trialModeDuration: '3600',
  randomTeleport: true,
  backToDeath: true,
  enableTreeCutOneClick: true,
  enableDigOreOneClick: true,
  land1BlockPerPrice: '2',
  daily_gold_limit: '100000',
  startingGold: '500',
};

export class ServerSetting {
  private db!: Database<IValueType>;

  constructor() {
    system.run(() => {
      this.db = new Database<boolean>('setting');
    });
  }

  turnOn(module: IModules): void {
    console.log(`Turn on ${module}`);
    this.db.set(module, true);
  }

  turnOff(module: IModules): void {
    console.log(`Turn off ${module}`);
    this.db.set(module, false);
  }

  init(): void {
    this.db.set('player', true);
    this.db.set('land', true);
    this.db.set('wayPoint', true);
    this.db.set('other', true);
    this.db.set('help', true);
    this.db.set('sm', true);
    this.db.set('setting', true);
    this.db.set('killItem', true);
    this.db.set('killItemAmount', defaultSetting.killItemAmount);
    this.db.set('randomTpRange', defaultSetting.randomTpRange);
    this.db.set('maxLandPerPlayer', defaultSetting.maxLandPerPlayer);
    this.db.set('maxLandBlocks', defaultSetting.maxLandBlocks);
    this.db.set('maxPointsPerPlayer', '10');
    this.db.set('playerNameColor', defaultSetting.playerNameColor);
    this.db.set('playerChatColor', defaultSetting.playerChatColor);
    this.db.set('trialMode', defaultSetting.trialMode);
    this.db.set('trialModeDuration', defaultSetting.trialModeDuration);
    this.db.set('randomTeleport', defaultSetting.randomTeleport);
    this.db.set('backToDeath', defaultSetting.backToDeath);
    this.db.set('enableTreeCutOneClick', defaultSetting.enableTreeCutOneClick);
    this.db.set('enableDigOreOneClick', defaultSetting.enableDigOreOneClick);
    this.db.set('land1BlockPerPrice', defaultSetting.land1BlockPerPrice);
    this.db.set('daily_gold_limit', defaultSetting.daily_gold_limit);
    this.db.set('startingGold', defaultSetting.startingGold);
  }

  getState(module: IModules): IValueType {
    if (this.db.get(module) === undefined) {
      this.setState(module, defaultSetting[module]);
    }
    return this.db.get(module);
  }

  setState(module: IModules, state: IValueType): void {
    SystemLog.info(`setState: ${module} = ${state}`);
    this.db.set(module, state);
  }
}

export default new ServerSetting();


