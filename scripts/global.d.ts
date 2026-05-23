/**
 * 构建时由 just.config 注入（define）。
 * 标准兼容版为 false，BDS 增强版为 true；用于条件加载 @minecraft/server-net 相关代码。
 */
declare const __BDS_BUILD__: boolean | undefined;
declare const __SERVER_ADMIN_BUILD__: boolean | undefined;
