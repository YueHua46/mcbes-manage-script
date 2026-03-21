/**
 * 公会对外薄接口：供聊天、名称显示等模块只读调用，避免循环依赖
 */

import guildService from "./guild-service";

export const guildFacade = {
  isGuildModuleEnabled(): boolean {
    return guildService.isModuleEnabled();
  },

  getGuildIdForPlayerName(name: string): string | undefined {
    return guildService.getGuildIdForPlayerName(name);
  },

  /** @deprecated 使用 getGuildTagPrefixForChat / getGuildTagPrefixForNameTag */
  getDisplayTagForPlayerName(name: string): string | undefined {
    return guildService.getGuildTagPrefixForChat(name) ?? guildService.getGuildTagPrefixForNameTag(name);
  },

  getGuildTagPrefixForChat(name: string): string | undefined {
    return guildService.getGuildTagPrefixForChat(name);
  },

  getGuildTagPrefixForNameTag(name: string): string | undefined {
    return guildService.getGuildTagPrefixForNameTag(name);
  },

  invalidateCacheForPlayerName(name?: string): void {
    guildService.invalidateDisplayCache(name);
  },

  invalidateAllGuildCaches(): void {
    guildService.invalidateDisplayCache();
  },

  /** 领地进出等场景：按公会 ID 取展示用标签与名称（公会不存在则 undefined） */
  getGuildTagAndNameById(guildId: string): { tag: string; name: string } | undefined {
    const g = guildService.getGuildById(guildId);
    if (!g) return undefined;
    return { tag: g.tag, name: g.name };
  },
};
