/**
 * 构建时由 just.config 注入（define）。
 * 标准版为 false，BDS 版为 true；用于条件加载 @minecraft/server-net 相关代码。
 */
declare const __BDS_BUILD__: boolean | undefined;
