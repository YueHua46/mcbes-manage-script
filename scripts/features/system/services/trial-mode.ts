/**
 * 试玩模式服务
 * 完整迁移自 Modules/System/TrialMode.ts (177行)
 */

import { GameMode, Player, system, world } from '@minecraft/server';
import setting from './setting';
import { color } from '../../../shared/utils/color';
import { isAdmin } from '../../../shared/utils/common';
import { Database } from '../../../shared/database/database';
import { usePlayerByName } from '../../../shared/hooks/use-player';

// 存储玩家计时器ID的Map
const playerTimerIds = new Map<string, number>();

/**
 * 会员管理器
 */
class MemberManager {
  private db!: Database<boolean>;

  constructor() {
    system.run(() => {
      this.db = new Database<boolean>('vip_members');
    });
  }

  addMember(playerName: string): boolean {
    if (!playerName.trim()) return false;

    this.db.set(playerName, true);

    const player = usePlayerByName(playerName);
    if (player) {
      player.addTag('vip');
      const timerId = playerTimerIds.get(player.name);
      if (timerId) {
        system.clearRun(timerId);
        playerTimerIds.delete(player.name);
      }
      player.sendMessage(color.green('恭喜！您已成为正式会员，可以无限制游玩！'));
    }

    return true;
  }

  removeMember(playerName: string): boolean {
    if (!playerName.trim()) return false;

    this.db.delete(playerName);

    const player = usePlayerByName(playerName);
    if (player) {
      player.removeTag('vip');
      player.sendMessage(color.red('您的会员资格已被移除，将受到试玩时间限制。'));
      initPlayerTimer(player);
    }

    return true;
  }

  isMember(playerName: string): boolean {
    return this.db.has(playerName) && this.db.get(playerName) === true;
  }

  getAllMembers(): string[] {
    return Object.keys(this.db.getAll());
  }
}

export const memberManager = new MemberManager();

/**
 * 初始化玩家计时器
 */
export function initPlayerTimer(player: Player): void {
  const isEnabled = setting.getState('trialMode');
  const duration = Number(setting.getState('trialModeDuration') ?? '3600');

  if (!isEnabled) return;

  if (isAdmin(player) || player.hasTag('vip') || memberManager.isMember(player.name)) {
    if (memberManager.isMember(player.name) && !player.hasTag('vip')) {
      player.addTag('vip');
    }
    return;
  }

  if (player.hasTag('trialed')) {
    player.sendMessage(
      `${color.green('你已经使用完所有试玩时间，已自动切换为')} ${color.red('冒险模式')} ${color.green(
        '如需继续游玩，请联系管理员申请正式会员！'
      )}`
    );
    player.setGameMode(GameMode.Adventure);
    return;
  }

  const _playerTrialModeTimer = player.getDynamicProperty('trialModeTimer') as number | undefined;
  const __playerTrialModeTimer = _playerTrialModeTimer ?? 0;
  player.setDynamicProperty('trialModeTimer', __playerTrialModeTimer);

  player.sendMessage(
    `${color.green('本服已经开启试玩模式，您已进入试玩模式，时间达到指定时间后将变为冒险模式')} ${color.red(
      Number(duration) - Number(__playerTrialModeTimer) + ''
    )} ${color.green('秒')}`
  );

  const timerId = system.runInterval(() => {
    const playerTrialModeTimer = player.getDynamicProperty('trialModeTimer') as number;
    const currentTrialModeTimer = playerTrialModeTimer + 1;
    player.setDynamicProperty('trialModeTimer', currentTrialModeTimer);

    if (currentTrialModeTimer >= duration) {
      player.addTag('trialed');
      player.sendMessage(
        `${color.green('你已经使用完所有试玩时间，已自动切换为')} ${color.red('冒险模式')} ${color.green(
          '如需继续游玩，请联系管理员申请正式会员！'
        )}`
      );
      player.setGameMode(GameMode.Adventure);
      system.clearRun(timerId);
      playerTimerIds.delete(player.name);
      return;
    }
  }, 20);

  playerTimerIds.set(player.name, timerId);
}

// 监听玩家加入事件
world.afterEvents.playerSpawn.subscribe((event) => {
  const { player } = event;
  const isJoin = player.getDynamicProperty('join');
  if (isJoin) return;

  if (memberManager.isMember(player.name) && !player.hasTag('vip')) {
    player.addTag('vip');
  }

  initPlayerTimer(player);
});

// 监听玩家离开事件
world.afterEvents.playerLeave.subscribe((event) => {
  const { playerName } = event;
  const timerId = playerTimerIds.get(playerName);
  if (timerId) {
    system.clearRun(timerId);
    playerTimerIds.delete(playerName);
  }
});

