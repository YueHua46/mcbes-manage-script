export { default as blacklistService } from "./blacklist";
// resolveXuid 不在此导出，避免被静态引用并拉入 xuid-resolver（依赖 @minecraft/server-net，仅 BDS 可用）
