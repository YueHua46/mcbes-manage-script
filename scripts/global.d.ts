/**
 * 构建时由 just.config 注入（define）。
 * 业务/UI 层应通过 features/platform/sapi-capabilities/build-flags 读取，避免直接引用。
 */
declare const __BDS_BUILD__: boolean | undefined;
declare const __SERVER_ADMIN_BUILD__: boolean | undefined;
