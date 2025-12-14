/**
 * 表单相关钩子
 */

import { Player, RawMessage, system } from '@minecraft/server';
import { ActionFormData, MessageFormData } from '@minecraft/server-ui';
import { color } from '../utils/color';

/**
 * 格式化列表信息
 */
export interface IFormatListInfo {
  title: string;
  desc: string;
  list?: string[];
}

export function useFormatListInfo(infos: IFormatListInfo[]): RawMessage {
  const formatInfo: RawMessage = {
    rawtext: [],
  };

  infos.forEach(info => {
    if (info.title) {
      formatInfo?.rawtext?.push({
        text: `${color.green.bold(info.title)}\n`,
      });
    }
    if (info.desc) {
      formatInfo?.rawtext?.push({
        text: `   ${color.yellow(info.desc)}\n`,
      });
    }
    if (info?.list?.length) {
      info.list.forEach(item => {
        formatInfo?.rawtext?.push({
          text: `   - ${color.green(item)}\n`,
        });
      });
    }
  });

  return formatInfo;
}

/**
 * 格式化信息
 */
export interface IFormatInfo {
  title?: string;
  desc?: string;
}

export function useFormatInfo(info: IFormatInfo): RawMessage {
  const formatInfo: RawMessage = {
    rawtext: [],
  };
  
  if (info.title) {
    formatInfo.rawtext?.push({
      text: color.green.bold(info.title) + '\n',
    });
  }
  
  if (info.desc) {
    formatInfo.rawtext?.push({
      text: color.yellow(info.desc) + '\n',
    });
  }
  
  return formatInfo;
}

/**
 * 强制打开表单（重试机制）
 */
export async function useForceOpen(
  player: Player,
  form: ActionFormData | MessageFormData,
  timeout = 1200
) {
  let startTick = system.currentTick;
  
  while (system.currentTick - startTick < timeout) {
    const response = await form.show(player);
    if (response.cancelationReason !== 'UserBusy') return response;
  }
  
  return undefined;
}


