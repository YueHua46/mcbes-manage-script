/**
 * 构建变体标识（由 just.config esbuild define 注入）。
 * 业务/UI 层应通过此模块判断能力，避免直接读取 __BDS_BUILD__ / __SERVER_ADMIN_BUILD__。
 */

export type BuildVariant = "standard" | "debug" | "bds-admin";

export function isBdsBuild(): boolean {
  return typeof __BDS_BUILD__ !== "undefined" && __BDS_BUILD__;
}

export function isServerAdminBuild(): boolean {
  return typeof __SERVER_ADMIN_BUILD__ !== "undefined" && __SERVER_ADMIN_BUILD__;
}

export function isDebugUtilitiesBuild(): boolean {
  return typeof __DEBUG_UTILITIES_BUILD__ !== "undefined" && __DEBUG_UTILITIES_BUILD__;
}

export function getBuildVariant(): BuildVariant {
  if (isDebugUtilitiesBuild()) return "debug";
  return isServerAdminBuild() ? "bds-admin" : "standard";
}

export function getBuildVariantLabel(): string {
  if (isDebugUtilitiesBuild()) return "本地/BDS 调试版";
  return isServerAdminBuild() ? "BDS 增强版" : "普通兼容版";
}

/** 标准版不可用时的统一说明文案 */
export const STANDARD_BUILD_LIMITATION_HINT =
  "当前附加包为普通兼容版（不含 @minecraft/server-admin 与 @minecraft/server-net）。";

/** BDS 增强版不可用时的统一说明文案 */
export const BDS_ONLY_FEATURE_HINT = "如需使用此功能，请改用仅适用于 BDS 服务器的增强版附加包。";

/** DebugUtilities 不可用时的统一说明文案 */
export const DEBUG_UTILITIES_ONLY_FEATURE_HINT =
  "如需使用此调试渲染/诊断能力，请改用本地/BDS 调试版附加包（不适用于 Realms 领域服）。";
