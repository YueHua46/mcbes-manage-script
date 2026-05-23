/**
 * 运行时映射：玩家名 → persistentId
 *
 * 由 BDS 增强版的 asyncPlayerJoin 事件写入，
 * 黑名单 UI 在封禁在线玩家时可读取该映射并一并保存。
 */
export const playerPersistentIdMap = new Map<string, string>();
