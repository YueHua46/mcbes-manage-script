/**
 * 黑名单事件处理器
 *
 * asyncPlayerJoin 来自 @minecraft/server-admin（BDS 专用）。
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
 * 3. 按 xuid 匹配        —— 异步 HTTP，应对改名 + 重装游戏场景（仅 BDS 版）
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
import setting from "../../features/system/services/setting";
import { SystemLog } from "../../shared/utils/common";

const DEFAULT_BAN_REASON = "您已被该服务器封禁，如有疑问请联系管理员";

/**
 * 运行时映射：玩家名 → persistentId
 * 每次 asyncPlayerJoin 触发时写入，供封禁 UI 获取在线玩家的 persistentId。
 */
export const playerPersistentIdMap = new Map<string, string>();

export function registerBlacklistEvents(): void {
  // asyncPlayerJoin.subscribe() 不能在 early execution 阶段调用，
  // 用 system.run() 延迟到第一个游戏 tick 之后再订阅。
  system.run(() => {
    beforeEvents.asyncPlayerJoin.subscribe(async (event: AsyncPlayerJoinBeforeEvent) => {
    const { name, persistentId } = event;

    // 记录 persistentId，供封禁 UI 读取（放在最前，与黑名单开关无关）
    if (persistentId) {
      playerPersistentIdMap.set(name, persistentId);
    }

    // ── 检查阶段：用 try-catch 包裹，出错则 fail-open（放行）──
    // 注意：不在此处调用 disallowJoin，避免 catch 吞掉 DisconnectedError
    let hitEntry: IBlacklistEntry | undefined;
    let hitBy = "";
    let resolvedXuid: string | null = null;

    try {
      const enabled = setting.getState("blacklistEnabled") as boolean;
      if (!enabled) return;

      // 步骤 1：按名字查（同步）
      hitEntry = blacklistService.isBlacklistedByName(name);
      if (hitEntry) {
        hitBy = "名字";
      }

      // 步骤 2：按 persistentId 查（同步，应对改名）
      if (!hitEntry && persistentId) {
        hitEntry = blacklistService.isBlacklistedByPersistentId(persistentId);
        if (hitEntry) {
          hitBy = "persistentId";
          blacklistService.syncEntry(hitEntry.xuid, name, persistentId);
        }
      }

      // 步骤 3：按 xuid 查（异步 HTTP，仅 BDS 版；标准版不加载 xuid-resolver，避免单人/Realms 报 server-net 未识别）
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
      // 检查逻辑本身出错（DB 未初始化等），fail-open 放行，避免误封
      SystemLog.error(`[Blacklist] 黑名单检查异常，玩家 ${name} 被放行: ${checkError}`);
      return;
    }

    // ── 拦截阶段：disallowJoin 必须在 try-catch 之外 ──
    // disallowJoin() 会抛出 DisconnectedError 来 reject Promise，
    // 这是拦截玩家的信号，不能被 catch 吞掉。
    if (hitEntry) {
      const reason = hitEntry.reason || DEFAULT_BAN_REASON;
      SystemLog.info(`[Blacklist] 玩家 ${name} 被拦截（${hitBy} 匹配，原名: ${hitEntry.name}），理由: ${reason}`);
      event.disallowJoin(reason); // 抛出 DisconnectedError → reject Promise → 玩家被拒绝
    }
    });

    SystemLog.info("[Blacklist] asyncPlayerJoin 黑名单校验已注册（三步拦截：名字 → persistentId → xuid）");
  });
}

// 注册到事件中心
eventRegistry.register("blacklist", registerBlacklistEvents);
