/**
 * 事件注册中心
 */

import { SystemLog } from '../shared/utils/common';

type EventHandlerFunction = () => void;

interface IEventRegistry {
  name: string;
  handler: EventHandlerFunction;
  enabled: boolean;
}

class EventRegistry {
  private _events: Map<string, IEventRegistry> = new Map();

  /**
   * 注册事件处理器
   */
  register(name: string, handler: EventHandlerFunction): void {
    if (this._events.has(name)) {
      SystemLog.warn(`事件 ${name} 已经注册，将被覆盖`);
    }

    this._events.set(name, {
      name,
      handler,
      enabled: true,
    });

    SystemLog.info(`注册事件: ${name}`);
  }

  /**
   * 启用事件
   */
  enable(name: string): void {
    const event = this._events.get(name);
    if (event) {
      event.enabled = true;
      SystemLog.info(`启用事件: ${name}`);
    }
  }

  /**
   * 禁用事件
   */
  disable(name: string): void {
    const event = this._events.get(name);
    if (event) {
      event.enabled = false;
      SystemLog.info(`禁用事件: ${name}`);
    }
  }

  /**
   * 初始化所有已注册的事件
   */
  initializeAll(): void {
    SystemLog.info('开始初始化所有事件处理器');
    
    this._events.forEach((event) => {
      if (event.enabled) {
        try {
          event.handler();
          SystemLog.info(`事件处理器 ${event.name} 初始化成功`);
        } catch (error) {
          SystemLog.error(`事件处理器 ${event.name} 初始化失败`, error);
        }
      }
    });

    SystemLog.info(`事件注册完成，共注册 ${this._events.size} 个事件处理器`);
  }

  /**
   * 获取所有已注册的事件
   */
  getAll(): IEventRegistry[] {
    return Array.from(this._events.values());
  }
}

export const eventRegistry = new EventRegistry();


