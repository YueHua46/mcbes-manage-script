/**
 * 黑名单事件处理器
 *
 * asyncPlayerJoin 来自 @minecraft/server-admin（BDS 增强版专用）。
 *
 * 关键机制（来自官方文档）：
 *   "If the promise is rejected, the client is rejected."
 *   → 必须让 event.disallowJoin() 的抛出自然传播，以 reject Promise 来拦截玩家。
 *   → disallowJoin() 内部会抛出 DisconnectedError，这是 reject 的信号，不能被 catch 吞掉。
 *   → 因此 disallowJoin() 调用必须放在 try-catch 之外。
 *
 * 拦截优先级（由快到慢）：
 * 1. 按玩家名匹配       —— 同步，无网络请求，最快
 * 2. 按 persistentId 匹配 —— 同步，无网络请求，应对玩家改名场景
 * 3. 按 xuid 匹配        —— 异步 HTTP，应对改名 + 重装游戏场景
 *
 * 运行时映射表 playerPersistentIdMap：
 *   在每次 asyncPlayerJoin 触发时写入，供封禁 UI 读取在线玩家的 persistentId。
 */

import { beforeEvents } from "@minecraft/server-admin";
import { AsyncPlayerJoinBeforeEvent } from "@minecraft/server-admin";
import { system } from "@minecraft/server";
import { IBlacklistEntry } from "../../core/types";
import { eventRegistry } from "../registry";
import blacklistService from "../../features/blacklist/services/blacklist";
import { playerPersistentIdMap } from "../../features/blacklist/services/persistent-id-map";
import setting from "../../features/system/services/setting";
import { SystemLog } from "../../shared/utils/common";

const DEFAULT_BAN_REASON = "您已被该服务器封禁，如有疑问请联系管理员";

export function registerBlacklistEvents(): void {
  system.run(() => {
    beforeEvents.asyncPlayerJoin.subscribe(async (event: AsyncPlayerJoinBeforeEvent) => {
      const { name, persistentId } = event;

      if (persistentId) {
        playerPersistentIdMap.set(name, persistentId);
      }

      let hitEntry: IBlacklistEntry | undefined;
      let hitBy = "";
      let resolvedXuid: string | null = null;

      try {
        const enabled = setting.getState("blacklistEnabled") as boolean;
        if (!enabled) return;

        hitEntry = blacklistService.isBlacklistedByName(name);
        if (hitEntry) {
          hitBy = "名字";
        }

        if (!hitEntry && persistentId) {
          hitEntry = blacklistService.isBlacklistedByPersistentId(persistentId);
          if (hitEntry) {
            hitBy = "persistentId";
            blacklistService.syncEntry(hitEntry.xuid, name, persistentId);
          }
        }

        if (!hitEntry && typeof __BDS_BUILD__ !== "undefined" && __BDS_BUILD__) {
          try {
            const { resolveXuid } = await import("../../features/blacklist/services/xuid-resolver");
            resolvedXuid = await resolveXuid(name);
          } catch (e) {
            SystemLog.info(`[Blacklist] xuid 查询不可用（server-net 未配置或接口异常）: ${e}`);
          }
        }

        if (resolvedXuid) {
          hitEntry = blacklistService.isBlacklistedByXuid(resolvedXuid);
          if (hitEntry) {
            hitBy = "xuid";
            blacklistService.syncEntry(hitEntry.xuid, name, persistentId ?? null);
          }
        }
      } catch (checkError) {
        SystemLog.error(`[Blacklist] 黑名单检查异常，玩家 ${name} 被放行: ${checkError}`);
        return;
      }

      if (hitEntry) {
        const reason = hitEntry.reason || DEFAULT_BAN_REASON;
        SystemLog.info(`[Blacklist] 玩家 ${name} 被拦截（${hitBy} 匹配，原名: ${hitEntry.name}），理由: ${reason}`);
        event.disallowJoin(reason);
      }
    });

    SystemLog.info("[Blacklist] asyncPlayerJoin 黑名单校验已注册（三步拦截：名字 → persistentId → xuid）");
  });
}

eventRegistry.register("blacklist", registerBlacklistEvents);
