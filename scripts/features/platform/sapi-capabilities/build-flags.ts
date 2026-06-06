/**
 * 构建变体标识（由 just.config esbuild define 注入）。
 * 业务/UI 层应通过此模块判断能力，避免直接读取 __BDS_BUILD__ / __SERVER_ADMIN_BUILD__。
 */

export type BuildVariant = "standard" | "bds-admin";

export function isBdsBuild(): boolean {
  return typeof __BDS_BUILD__ !== "undefined" && __BDS_BUILD__;
}

export function isServerAdminBuild(): boolean {
  return typeof __SERVER_ADMIN_BUILD__ !== "undefined" && __SERVER_ADMIN_BUILD__;
}

export function getBuildVariant(): BuildVariant {
  return isServerAdminBuild() ? "bds-admin" : "standard";
}

export function getBuildVariantLabel(): string {
  return isServerAdminBuild() ? "BDS 增强版" : "普通兼容版";
}

/** 标准版不可用时的统一说明文案 */
export const STANDARD_BUILD_LIMITATION_HINT =
  "当前附加包为普通兼容版（不含 @minecraft/server-admin 与 @minecraft/server-net）。";

/** BDS 增强版不可用时的统一说明文案 */
export const BDS_ONLY_FEATURE_HINT = "如需使用此功能，请改用仅适用于 BDS 服务器的增强版附加包。";
