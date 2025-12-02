/**
 * 通知钩子
 */

import { Player, world } from '@minecraft/server';
import type { NotifyType } from '../../core/types';

/**
 * 发送通知给玩家
 */
export function useNotify(type: NotifyType, player: Player, message: string): void {
  switch (type) {
    case 'chat':
      player.sendMessage(message);
      break;
    case 'actionbar':
      player.onScreenDisplay.setActionBar(message);
      break;
    case 'title':
      player.onScreenDisplay.setTitle(message);
      break;
  }
}

/**
 * 广播消息给所有玩家
 */
export function useBroadcast(message: string): void {
  world.sendMessage(message);
}


