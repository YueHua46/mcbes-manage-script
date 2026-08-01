/**
 * 全局配置管理
 */

import { APP_VERSION } from "../build-metadata";

export interface IConfig {
  debug: boolean;
  version: string;
  serverName: string;
}

class ConfigManager {
  private _config: IConfig = {
    debug: false,
    version: APP_VERSION,
    serverName: "杜绝熊孩服务器",
  };

  get config(): Readonly<IConfig> {
    return this._config;
  }

  set<K extends keyof IConfig>(key: K, value: IConfig[K]): void {
    this._config[key] = value;
  }

  get<K extends keyof IConfig>(key: K): IConfig[K] {
    return this._config[key];
  }
}

export const configManager = new ConfigManager();
