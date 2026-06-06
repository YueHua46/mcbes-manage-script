/**
 * SAPI 能力边界层：集中封装 BDS 专属模块、preview API 与 runCommand 检测。
 * UI 与业务服务应通过此层判断/调用平台能力，避免散落 __BDS_BUILD__ 与动态 import。
 */

export {
  type BuildVariant,
  isBdsBuild,
  isServerAdminBuild,
  getBuildVariant,
  getBuildVariantLabel,
  STANDARD_BUILD_LIMITATION_HINT,
  BDS_ONLY_FEATURE_HINT,
} from "./build-flags";

export { isServerNetAvailable, httpGet, type HttpGetResponse } from "./server-net";

export { isServerAdminAvailable, subscribeAsyncPlayerJoin, type AsyncPlayerJoinHandler } from "./server-admin";

export {
  getLiveFormCapabilities,
  isLiveFormAvailable,
  type LiveFormCapabilities,
  type CustomFormHandle,
  type ObservableHandle,
} from "./server-ui";

export { isRunCommandAvailable, runPlayerCommand, runDimensionCommand, type RunCommandResult } from "./run-command";

export { subscribePreviewEvent, isPreviewEventAvailable } from "./preview-events";
