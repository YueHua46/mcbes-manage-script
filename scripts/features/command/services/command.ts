/**
 * 命令系统服务
 * 完整迁移自 Modules/Command/Command.ts (1095行)
 */

import {
  system,
  world,
  Player,
  Entity,
  CustomCommand,
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandOrigin,
  CustomCommandResult,
  CustomCommandStatus,
  CustomCommandError,
  CustomCommandErrorReason,
  CustomCommandRegistry,
  EntityEquippableComponent,
  EquipmentSlot,
} from "@minecraft/server";
import { color } from "../../../shared/utils/color";
import { isAdmin, SystemLog } from "../../../shared/utils/common";
import { getOnlineRealPlayers } from "../../../shared/utils/online-players";
import { usePlayerByName } from "../../../shared/hooks/use-player";
import wayPoint from "../../waypoint/services/waypoint";
import landManager from "../../land/services/land-manager";
import { tryStartLandFlightSession } from "../../land/services/land-flight";
import fakePlayerService from "../../fake-player/services/fake-player";
import setting, { defaultSetting, type IModules } from "../../system/services/setting";
import serverInfo from "../../system/services/server-info";
import { economic } from "../../economic";
import * as tpaRequest from "../../player/services/tpa-request";
import { teleportPlayer as tpaTeleport, notifyReject as tpaNotifyReject } from "../../player/services/tpa-logic";
import {
  addSubscription,
  clearSubscriptions,
  formatItemWatchSubscriptionLabel,
  listSubscriptions,
  removeSubscription,
} from "../../item-watch/item-watch-subscription";

// 防止重复注册的标志
let commandsRegistered = false;

const WAYPOINT_OPERATION_VALUES = ["list", "add", "del", "tp"];
const WAYPOINT_VISIBILITY_VALUES = ["private", "public"];
const LAND_OPERATION_VALUES = ["list", "query", "remove", "trust", "untrust"];
const MONEY_OPERATION_VALUES = ["top"];
const ONECLICK_FEATURE_VALUES = ["ore", "tree", "harvest", "crop", "plant", "sow"];
const TRIAL_OPERATION_VALUES = ["list", "add", "remove", "check", "reset"];
const MONEY_SETTING_OPERATION_VALUES = ["add", "remove", "set"];
const CAMERA_OPERATION_VALUES = ["start", "stop", "next", "n"];
const CAMERA_PERSPECTIVE_VALUES = ["first", "third", "first_person", "third_person", "front", "third_front"];
const GET_ITEM_TYPE_ID_MODE_VALUES = ["hand", "all", "inventory"];
const SUBSCRIBE_ITEM_HOLD_OPERATION_VALUES = ["add", "remove", "list", "clear"];
const FAKE_PLAYER_OPERATION_VALUES = ["list", "add", "remove", "remove_all"];
const SETTING_KEY_VALUES = ["list", ...Object.keys(defaultSetting)];
const TELEPORT_COST_SETTING_KEYS = new Set([
  "randomTeleportCost",
  "backToDeathCost",
  "tpaTeleportCost",
  "waypointTeleportCost",
  "landTeleportCost",
]);

const settingDescriptions: Record<keyof typeof defaultSetting, string> = {
  player: "玩家功能模块总开关。true 开启玩家相关菜单/逻辑，false 关闭。",
  land: "领地系统总开关。true 开启领地保护和领地菜单，false 关闭领地功能。",
  wayPoint: "坐标点系统总开关。true 允许使用坐标点功能，false 关闭。",
  economy: "经济系统总开关。true 启用金币钱包、商店和转账，false 经济扣费通常会被跳过。",
  other: "其他功能模块总开关。用于控制随机传送等杂项入口。",
  help: "帮助功能入口开关。true 显示帮助菜单，false 隐藏。",
  sm: "苦力怕菜单入口开关。true 允许使用苦力怕菜单物品，false 隐藏或禁用入口。",
  setting: "系统设置入口开关。true 显示设置入口，false 隐藏。",
  killItem: "击杀掉落物品清理/限制相关开关。true 启用，false 关闭。",
  killItemAmount: "掉落物数量阈值。达到该数量后按清理逻辑处理，填写非负整数。",
  randomTpRange: "随机传送范围半径。数值越大随机点越远，填写正整数。",
  maxLandPerPlayer: "每个玩家最多可创建的个人领地数量，不含已登记为公会领地的地块。",
  maxLandBlocks: "单块领地最大方块数。创建领地时超过该值会被拒绝。",
  landSnapshotMaxChunks: "单次领地快照最多处理的区块数量，用于控制性能开销。",
  landSnapshotAutoEnabled: "领地自动快照开关。true 定时创建快照，false 关闭自动快照。",
  landSnapshotAutoIntervalMinutes: "领地自动快照间隔分钟数。填写正整数。",
  landSnapshotAutoMaxPerLand: "每块领地最多保留的自动快照数量，超过后按策略清理旧快照。",
  landSnapshotAutoIncludeEntities: "自动快照是否包含实体。true 包含实体，false 只保存方块等基础信息。",
  maxPrivatePointsPerPlayer: "每个玩家最多保存的私人坐标点数量。",
  maxPublicPointsPerPlayer: "每个玩家最多创建的公开坐标点数量，通常只管理员可创建公开点。",
  playerNameColor: "玩家名称颜色代码，例如 §a。影响名称显示。",
  playerChatColor: "聊天文本颜色代码，例如 §f。影响玩家聊天显示。",
  trialMode: "试玩模式开关。true 未成为正式会员的玩家会受试玩限制，false 不限制。",
  trialModeDuration: "试玩模式时长，单位秒。填写正整数。",
  randomTeleport: "随机传送功能开关。true 允许 /yuehua:rtp，false 关闭相关入口。",
  randomTeleportCost: "随机传送成功时扣除的金币。填写 0 表示免费。",
  backToDeath: "回到死亡地点功能开关。true 开启，false 关闭。",
  backToDeathCost: "回到上次死亡地点成功时扣除的金币。填写 0 表示免费。",
  tpaTeleportCost: "TPA 请求被接受并成功执行时，从请求方扣除的金币。填写 0 表示免费。",
  waypointTeleportCost: "普通坐标点传送成功时扣除的金币。填写 0 表示免费。",
  landTeleportCost: "传送到领地传送点成功时扣除的金币。填写 0 表示免费。",
  enableTreeCutOneClick: "一键砍树开关。true 启用连锁砍树，false 关闭。",
  enableDigOreOneClick: "一键挖矿开关。true 启用连锁挖矿，false 关闭。",
  enableCropHarvestOneClick: "下蹲连锁收割作物开关。true 启用，false 关闭。",
  enableCropPlantOneClick: "下蹲一键连锁播种开关。true 启用，false 关闭。",
  digOreChainObsidian: "一键挖矿是否连锁黑曜石/哭泣黑曜石。true 连锁，false 不连锁。",
  land1BlockPerPrice: "创建领地时每个方块的金币价格。填写非负整数。",
  daily_gold_limit: "玩家每日可获得金币上限。填写非负整数。",
  startingGold: "新玩家首次进入时获得的初始金币。填写非负整数。",
  monsterKillGoldReward: "杀怪掉金币开关。true 启用击杀怪物奖励，false 关闭。",
  monsterKillRewardRanges: "怪物击杀金币自定义范围 JSON；建议通过管理员菜单配置。",
  deathGoldPenaltyEnabled: "死亡扣金币开关。true 死亡时扣款，false 不扣。",
  deathGoldPenaltyAmount: "玩家死亡时扣除的金币数量。余额不足时通常扣到 0。",
  allowPlayerDisplaySettings: "是否允许玩家编辑自己的名称显示设置。true 允许，false 禁止。",
  pvp: "PVP 系统菜单与插件接管总开关。true 启用相关入口，false 关闭。",
  pvpMode: "PVP 模式。vanilla=原版；plugin=个人开关；forced=强制大乱斗；off=禁止。",
  pvpEnabled: "旧版兼容 PVP 开关。保留给旧数据迁移，优先使用 pvpMode。",
  pvpSuspendedMode: "关闭 PVP 功能前暂存的模式。通常由系统维护，不建议手动改。",
  pvpSeizeAmount: "PVP 击杀固定夺取金币数量。填写非负整数。",
  pvpMinProtection: "PVP 最低金币保护。低于该余额不再被夺取。",
  pvpToggleCooldown: "个人 PVP 开关冷却秒数。forced/off 模式下通常不生效。",
  pvpCombatTagDuration: "PVP 战斗标签持续秒数。填写非负整数。",
  pvpForcedIgnoreLandProtection: "强制大乱斗是否无视领地保护。true 无视，false 尊重领地保护。",
  serverName: "服务器名称。用于服务器信息、欢迎语等展示。",
  welcomeMessage: "玩家进服欢迎消息。支持 Minecraft 颜色代码和换行转义。",
  joinPopupAnnouncements: "进服弹窗公告 JSON 字符串数组。用于配置最多若干条弹窗公告。",
  blacklistEnabled: "黑名单进服前拦截开关。BDS 增强版有效，true 启用，false 关闭。",
  behaviorLogEnabled: "玩家行为日志总开关。true 记录行为日志，false 停止记录。",
  behaviorLogMaxEntries: "行为日志最大保留条数。超过后按日志服务策略清理。",
  itemWatchSnapshotMaxEntries: "物品监控背包快照最大保留条数。建议 100 到 1000，最高 5000。",
  behaviorLogLocationIntervalSec: "玩家坐标采样间隔秒数。数值越小日志越密集。",
  behaviorLogInspectorRadius: "日志查询器点击方块时的查询半径。填写非负整数。",
  logPlayerJoin: "是否记录玩家进入服务器事件。",
  logPlayerLeave: "是否记录玩家离开服务器事件。",
  logPlayerChat: "是否记录玩家聊天事件。",
  logPlayerDeath: "是否记录玩家死亡事件。",
  logPvpHit: "是否记录 PVP 命中事件。",
  logPlaceWater: "是否记录放置水事件。",
  logPlaceLava: "是否记录放置岩浆事件。",
  logIgniteFire: "是否记录点火事件。",
  logPlaceTnt: "是否记录放置 TNT 事件。",
  logPlaceEndCrystal: "是否记录放置末地水晶事件。",
  logSummonWither: "是否记录召唤凋灵事件。",
  logEnterLand: "是否记录进入领地事件。",
  logLeaveLand: "是否记录离开领地事件。",
  logLandBreakAttempt: "是否记录领地内破坏尝试事件。",
  logAttackMobInLand: "是否记录领地内攻击生物事件。",
  logOpenChest: "是否记录打开箱子事件。",
  logOpenBarrel: "是否记录打开木桶事件。",
  logOpenShulker: "是否记录打开潜影盒事件。",
  logOpenOtherContainers: "是否记录打开其他容器事件。",
  logLocationSnapshot: "是否按间隔记录玩家位置快照。",
  logItemWatchSnapshot: "是否记录被监控物品相关背包快照。",
  guild: "公会系统总开关。true 开启公会入口与逻辑，false 关闭。",
  guildCreateCost: "创建公会费用。从个人钱包扣除，填写非负整数。",
  guildMaxMembers: "每个公会最大成员数量。填写正整数。",
  guildTagMaxLen: "公会标签最大长度。填写正整数。",
  guildNameMaxLen: "公会名称最大长度。填写正整数。",
  guildShowTagInChat: "聊天中是否显示公会标签。true 显示，false 隐藏。",
  guildShowTagInName: "名称标签中是否显示公会标签。true 显示，false 隐藏。",
  guildInviteExpireSec: "公会邀请有效期秒数。过期后邀请失效。",
  guildLeaveOnBlacklist: "封禁玩家时是否移出或解散其公会关系。true 启用，false 不处理。",
  guildBankOfficerWithdraw: "是否允许副会长从公会金库取款。true 允许，false 仅会长。",
  logGuildEvents: "是否记录公会关键行为日志。",
  guildMaxLandsPerGuild: "每个公会最多登记几块公会领地，与个人领地上限独立。",
  guildMaxWaypointsPerGuild: "每个公会最多保存多少个公会坐标，不占成员私人坐标名额。",
  guildTreasuryCostLandCreate: "新建公会领地时从金库扣费，0 表示不扣。",
  guildTreasuryCostLandBind: "登记已有领地为公会领地时从金库扣费，0 表示不扣。",
  guildTreasuryCostWaypointCreate: "新增公会坐标时从金库扣费，0 表示不扣。",
  guildCreateMinOnlineHours: "创建公会所需累计在线小时数。0 表示不限制。",
  floatingText: "悬浮文字系统总开关。true 开启入口与渲染，false 关闭功能入口。",
  floatingTextAllowMembers: "是否对普通成员开放悬浮文字。false 时只有管理员可创建和管理。",
  floatingTextMaxPerPlayer: "普通玩家最多可创建的悬浮文字数量。填写 0 或正整数。",
  floatingTextCreateCost: "所有玩家每次创建悬浮文字消耗金币。0 表示免费，不扣金币。",
  fakePlayer: "假人模拟玩家系统总开关。true 允许玩家创建假人参与原版模拟，false 关闭入口和自愈。",
  fakePlayerMaxPerPlayer: "普通玩家最多可创建的假人数量。管理员不受此上限限制。",
  fakePlayerCreateCost: "每次创建假人消耗金币。0 表示免费；经济系统关闭时需设为 0 才能创建。",
  onlineTime: "旧版在线时长入口兼容键。在线时长数据入口优先使用 stats。",
  stats: "服务器主菜单数据统计入口。true 显示数据统计，false 隐藏。",
  redPacketExpiryHours: "红包有效时长，单位小时。过期未领会按红包逻辑退回。",
  landFlightEnabled: "领地内飞行总开关。true 可申请领地飞行，false 关闭并回收能力。",
  landFlightUseEconomy: "领地飞行是否按周期扣金币。true 扣费，false 免费但仍受权限限制。",
  landFlightBillingIntervalSec: "领地飞行扣费周期间隔秒数。建议填写 10 到 86400。",
  landFlightGoldPerInterval: "领地飞行每个扣费周期扣除金币数量。0 表示不扣。",
  landFlightLeaveGraceSec: "离开领地后的飞行宽限秒数。0 表示立即收回，建议 0 到 30。",
  landBoundaryParticleLevel: "领地常显粒子档位。可填 off、low、balanced 或 high。",
  antiDupeEnabled: "防刷物品总开关。true 启用防刷逻辑与白名单，false 全部关闭。",
  antiDupeBundleRestrictEnabled: "收纳袋防刷子项。true 禁止放入非常规容器，false 放开。",
  antiDupeTrustedPlacers: '防刷白名单玩家名 JSON 字符串数组，例如 ["Steve","Alex"]。',
};

/**
 * 脚本 /reload 时引擎会锁定已有自定义命令的参数签名，仅允许更新回调；
 * 若重复 registerEnum / registerCommand 触发了 RegistryReadOnly，则静默跳过以免刷屏。
 */
function registerEnumIgnoreReloadLock(registry: CustomCommandRegistry, name: string, values: string[]): void {
  try {
    registry.registerEnum(name, values);
  } catch (e) {
    if (
      e instanceof CustomCommandError &&
      (e.reason === CustomCommandErrorReason.RegistryReadOnly ||
        e.reason === CustomCommandErrorReason.AlreadyRegistered)
    ) {
      return;
    }
    throw e;
  }
}

function registerCommandIgnoreReloadLock(
  registry: CustomCommandRegistry,
  command: CustomCommand,
  handler: (origin: CustomCommandOrigin, ...args: any[]) => CustomCommandResult | undefined
): void {
  try {
    registry.registerCommand(command, handler);
  } catch (e) {
    if (e instanceof CustomCommandError && e.reason === CustomCommandErrorReason.RegistryReadOnly) {
      return;
    }
    throw e;
  }
}

/**
 * 注册所有自定义命令
 */
system.beforeEvents.startup.subscribe((init) => {
  if (commandsRegistered) {
    console.warn("自定义指令已注册，跳过重复注册");
    return;
  }

  const registry = init.customCommandRegistry;

  registerEnumIgnoreReloadLock(registry, "yuehua:WaypointOperationType", WAYPOINT_OPERATION_VALUES);
  registerEnumIgnoreReloadLock(registry, "yuehua:WaypointVisibilityType", WAYPOINT_VISIBILITY_VALUES);
  registerEnumIgnoreReloadLock(registry, "yuehua:LandOperationType", LAND_OPERATION_VALUES);
  registerEnumIgnoreReloadLock(registry, "yuehua:MoneyOperationType", MONEY_OPERATION_VALUES);
  registerEnumIgnoreReloadLock(registry, "yuehua:SettingKeyType", SETTING_KEY_VALUES);
  registerEnumIgnoreReloadLock(registry, "yuehua:OneClickFeatureType", ONECLICK_FEATURE_VALUES);
  registerEnumIgnoreReloadLock(registry, "yuehua:TrialOperationType", TRIAL_OPERATION_VALUES);
  registerEnumIgnoreReloadLock(registry, "yuehua:MoneySettingOperationType", MONEY_SETTING_OPERATION_VALUES);
  registerEnumIgnoreReloadLock(registry, "yuehua:CameraOperationType", CAMERA_OPERATION_VALUES);
  registerEnumIgnoreReloadLock(registry, "yuehua:CameraPerspectiveType", CAMERA_PERSPECTIVE_VALUES);
  registerEnumIgnoreReloadLock(registry, "yuehua:GetItemTypeIdModeType", GET_ITEM_TYPE_ID_MODE_VALUES);
  registerEnumIgnoreReloadLock(registry, "yuehua:SubscribeItemHoldOperationType", SUBSCRIBE_ITEM_HOLD_OPERATION_VALUES);
  registerEnumIgnoreReloadLock(registry, "yuehua:FakePlayerOperationType", FAKE_PLAYER_OPERATION_VALUES);

  // 1. 注册 waypoint 指令
  const waypointCommand: CustomCommand = {
    name: "yuehua:waypoint",
    description: "坐标点管理。list=列出自己的坐标点；add=把当前位置保存为坐标点；del=删除坐标点；tp=传送到坐标点。",
    permissionLevel: CommandPermissionLevel.Any,
    optionalParameters: [
      {
        type: CustomCommandParamType.Enum,
        name: "操作(list列出/add保存当前位置/del删除/tp传送)",
        enumName: "yuehua:WaypointOperationType",
      },
      { type: CustomCommandParamType.String, name: "坐标点名称(add/del/tp时填写)" },
      {
        type: CustomCommandParamType.Enum,
        name: "可见性(private仅自己可用/public公开且仅管理员可创建)",
        enumName: "yuehua:WaypointVisibilityType",
      },
    ],
  };
  registerCommandIgnoreReloadLock(registry, waypointCommand, handleWaypointCommand);

  // 2. 注册 land 指令
  const landCommand: CustomCommand = {
    name: "yuehua:land",
    description:
      "领地管理。list=列出自己的领地；query=查询脚下领地；remove=删除领地；trust/untrust=添加或移除领地成员。",
    permissionLevel: CommandPermissionLevel.Any,
    optionalParameters: [
      {
        type: CustomCommandParamType.Enum,
        name: "操作(list列表/query脚下查询/remove删除/trust添加成员/untrust移除成员)",
        enumName: "yuehua:LandOperationType",
      },
      { type: CustomCommandParamType.String, name: "领地名(remove)或玩家名(trust/untrust)" },
      { type: CustomCommandParamType.String, name: "领地名称(trust/untrust时填写)" },
    ],
  };
  registerCommandIgnoreReloadLock(registry, landCommand, handleLandCommand);

  // 3. 注册 money 指令
  const moneyCommand: CustomCommand = {
    name: "yuehua:money",
    description: "金币查询。不带参数查看自己的余额；top=查看财富排行榜前 20。",
    permissionLevel: CommandPermissionLevel.Any,
    optionalParameters: [
      {
        type: CustomCommandParamType.Enum,
        name: "操作(top查看财富排行榜；留空查看余额)",
        enumName: "yuehua:MoneyOperationType",
      },
    ],
  };
  registerCommandIgnoreReloadLock(registry, moneyCommand, handleMoneyCommand);

  // 4. 注册 pay 指令
  const payCommand: CustomCommand = {
    name: "yuehua:pay",
    description: "玩家转账。目标玩家必须在线；金额必须为大于 0 的整数；不能给自己转账。",
    permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [
      { type: CustomCommandParamType.String, name: "目标在线玩家名(收款人)" },
      { type: CustomCommandParamType.Integer, name: "转账金额(大于0的整数)" },
    ],
  };
  registerCommandIgnoreReloadLock(registry, payCommand, handlePayCommand);

  // 5. 注册 setting 指令 (仅管理员)
  const settingCommand: CustomCommand = {
    name: "yuehua:setting",
    description:
      "系统设置(仅管理员)。不带参数或 list=列出所有设置及说明；填写设置项和值=修改配置。布尔值填 true/false，数字项填数字字符串。",
    permissionLevel: CommandPermissionLevel.Admin,
    optionalParameters: [
      { type: CustomCommandParamType.Enum, name: "设置项(留空或list查看完整说明)", enumName: "yuehua:SettingKeyType" },
      { type: CustomCommandParamType.String, name: "设置值(true/false/数字/文本；list时不填)" },
    ],
  };
  registerCommandIgnoreReloadLock(registry, settingCommand, handleSettingCommand);

  // 6. 注册 rtp 指令
  const rtpCommand: CustomCommand = {
    name: "yuehua:rtp",
    description: "随机传送。按服务器 randomTpRange 配置在当前世界寻找不在领地内的位置并传送。",
    permissionLevel: CommandPermissionLevel.Any,
  };
  registerCommandIgnoreReloadLock(registry, rtpCommand, handleRtpCommand);

  // 6.1 领地内飞行（与领地菜单权限一致）
  const landFlightCommand: CustomCommand = {
    name: "yuehua:landflight",
    description: "领地内飞行。站在有权限的领地内使用；领主、信任成员或同公会成员可开启；可能按服务器配置周期扣金币。",
    permissionLevel: CommandPermissionLevel.Any,
  };
  registerCommandIgnoreReloadLock(registry, landFlightCommand, handleLandFlightCommand);

  const fakePlayerCommand: CustomCommand = {
    name: "yuehua:fakeplayer",
    description: "假人模拟玩家。list=列出假人；add=在当前位置创建假人；remove=按名称删除假人；remove_all=管理员删除全部假人。",
    permissionLevel: CommandPermissionLevel.Any,
    optionalParameters: [
      {
        type: CustomCommandParamType.Enum,
        name: "操作(list列表/add创建/remove删除/remove_all管理员清空)",
        enumName: "yuehua:FakePlayerOperationType",
      },
      { type: CustomCommandParamType.String, name: "假人名称(add/remove时填写)" },
    ],
  };
  registerCommandIgnoreReloadLock(registry, fakePlayerCommand, handleFakePlayerCommand);

  // 7. 注册 oneclick 指令
  const oneclickCommand: CustomCommand = {
    name: "yuehua:oneclick",
    description:
      "一键功能开关(仅管理员)。ore=切换一键挖矿；tree=切换一键砍树；harvest/crop=切换连锁收割；plant/sow=切换连锁播种。",
    permissionLevel: CommandPermissionLevel.Admin,
    mandatoryParameters: [
      {
        type: CustomCommandParamType.Enum,
        name: "功能(ore挖矿/tree砍树/harvest或crop收割/plant或sow播种)",
        enumName: "yuehua:OneClickFeatureType",
      },
    ],
  };
  registerCommandIgnoreReloadLock(registry, oneclickCommand, handleOneClickCommand);

  // 8. 注册 trial 指令 (试玩模式管理)
  const trialCommand: CustomCommand = {
    name: "yuehua:trial",
    description:
      "试玩模式会员管理(仅管理员)。list=列出正式会员；add/remove=批量增删会员；check=查询试玩/会员状态；reset=重置在线玩家试玩时间。",
    permissionLevel: CommandPermissionLevel.Admin,
    optionalParameters: [
      {
        type: CustomCommandParamType.Enum,
        name: "操作(list列表/add添加会员/remove移除会员/check查询/reset重置试玩时间)",
        enumName: "yuehua:TrialOperationType",
      },
      {
        type: CustomCommandParamType.String,
        name: `玩家名(add/remove/check/reset时填写；多个用逗号分隔，含空格请用英文引号包裹)`,
      },
    ],
  };
  registerCommandIgnoreReloadLock(registry, trialCommand, handleTrialCommand);

  // 9. 注册 serverinfo 指令 (查看服务器信息)
  const serverinfoCommand: CustomCommand = {
    name: "yuehua:serverinfo",
    description: "查看服务器信息。显示 TPS、世界时间、在线玩家、实体/掉落物数量和关键功能开关状态。",
    permissionLevel: CommandPermissionLevel.Any,
  };
  registerCommandIgnoreReloadLock(registry, serverinfoCommand, handleServerInfoCommand);

  // 10. 注册 money_setting 指令 (在线金币管理) - 使用玩家选择器
  const moneySettingCommand: CustomCommand = {
    name: "yuehua:money_setting",
    description:
      "在线玩家金币管理(管理员/命令方块)。add=增加金币；remove=扣除金币且余额不足会失败；set=直接设置余额。支持玩家选择器批量操作。",
    permissionLevel: CommandPermissionLevel.GameDirectors,
    mandatoryParameters: [
      {
        type: CustomCommandParamType.Enum,
        name: "操作(add增加/remove扣除/set设为)",
        enumName: "yuehua:MoneySettingOperationType",
      },
      { type: CustomCommandParamType.PlayerSelector, name: "在线玩家选择器(如@p/@a/玩家名)" },
      { type: CustomCommandParamType.Integer, name: "金额(add/remove必须大于0；set可为0)" },
    ],
  };
  registerCommandIgnoreReloadLock(registry, moneySettingCommand, handleMoneySettingCommand);

  // 10.1 注册 money_setting_offline 指令 (离线金币管理)
  const moneySettingOfflineCommand: CustomCommand = {
    name: "yuehua:money_setting_offline",
    description:
      "离线玩家金币管理(管理员/命令方块)。add=增加金币；remove=扣除金币且余额不足会失败；set=直接设置余额。目标必须曾进入过服务器。",
    permissionLevel: CommandPermissionLevel.GameDirectors,
    mandatoryParameters: [
      {
        type: CustomCommandParamType.Enum,
        name: "操作(add增加/remove扣除/set设为)",
        enumName: "yuehua:MoneySettingOperationType",
      },
      { type: CustomCommandParamType.String, name: "玩家名(必须已有钱包数据)" },
      { type: CustomCommandParamType.Integer, name: "金额(add/remove必须大于0；set可为0)" },
    ],
  };
  registerCommandIgnoreReloadLock(registry, moneySettingOfflineCommand, handleMoneySettingOfflineCommand);

  // 11. 注册 give_me_menu 指令
  const giveMenuCommand: CustomCommand = {
    name: "yuehua:give_me_menu",
    description: "获取苦力怕菜单物品。给自己发放 yuehua:sm，用于打开服务器功能菜单。",
    permissionLevel: CommandPermissionLevel.Any,
  };
  registerCommandIgnoreReloadLock(registry, giveMenuCommand, handleGiveMenuCommand);

  // 12. 注册 camera 指令 (实体视角观察)
  const cameraCommand: CustomCommand = {
    name: "yuehua:camera",
    description:
      "实体视角观察(仅管理员)。start=开始观察选择器匹配的第一个实体；stop=退出观察并恢复位置/模式；next=在第一/第三人称观察视角间循环切换。",
    permissionLevel: CommandPermissionLevel.Any,
    optionalParameters: [
      {
        type: CustomCommandParamType.Enum,
        name: "操作(start开始/stop退出/next切换下一视角)",
        enumName: "yuehua:CameraOperationType",
      },
      { type: CustomCommandParamType.EntitySelector, name: "目标实体选择器(start时填写，如@p或@e[type=zombie])" },
    ],
  };
  registerCommandIgnoreReloadLock(registry, cameraCommand, handleCameraCommand);

  const cameraPerspectiveCommand: CustomCommand = {
    name: "yuehua:camera_perspective",
    description:
      "实体观察视角切换(仅管理员)。first/first_person=贴近目标头部的第一人称观察；third/third_person=目标后方第三人称观察。",
    permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [
      {
        type: CustomCommandParamType.Enum,
        name: "视角(first第一人称/third第三人称)",
        enumName: "yuehua:CameraPerspectiveType",
      },
    ],
  };
  registerCommandIgnoreReloadLock(registry, cameraPerspectiveCommand, handleCameraPerspectiveCommand);

  // 13. 注册 get_item_typeid 指令 (获取手持或背包物品ID)
  const getItemTypeIdCommand: CustomCommand = {
    name: "yuehua:get_item_typeid",
    description: "获取物品 typeId。留空或 hand=显示手持物品 typeId；all/inventory=统计背包内全部物品 typeId 和数量。",
    permissionLevel: CommandPermissionLevel.Any,
    optionalParameters: [
      {
        type: CustomCommandParamType.Enum,
        name: "模式(hand手持/all或inventory背包全部；留空等于hand)",
        enumName: "yuehua:GetItemTypeIdModeType",
      },
    ],
  };
  registerCommandIgnoreReloadLock(registry, getItemTypeIdCommand, handleGetItemTypeIdCommand);

  // 13.1 登记「玩家获得指定物品时要记录背包」（写入行为日志）
  const subscribeItemHoldCommand: CustomCommand = {
    name: "yuehua:subscribe_item_hold",
    description:
      "登记要监控的物品(管理员)。add=新增物品 typeId；remove=取消监控；list=查看列表；clear=清空。玩家拿到登记物品时会记录背包快照。",
    permissionLevel: CommandPermissionLevel.Admin,
    optionalParameters: [
      {
        type: CustomCommandParamType.Enum,
        name: "操作(add新增/remove移除/list查看/clear清空)",
        enumName: "yuehua:SubscribeItemHoldOperationType",
      },
      {
        type: CustomCommandParamType.String,
        name: "物品typeId(add/remove时填写，如minecraft:diamond；生成蛋族群用spawn_egg_group)",
      },
    ],
  };
  registerCommandIgnoreReloadLock(registry, subscribeItemHoldCommand, handleSubscribeItemHoldCommand);

  // 14. TPA 接受/拒绝（勿扰模式下通过聊天处理请求时使用）
  const tpacceptCommand: CustomCommand = {
    name: "yuehua:tpaccept",
    description: "接受当前待处理的 TPA 传送请求。通常用于勿扰模式下通过聊天命令处理请求。",
    permissionLevel: CommandPermissionLevel.Any,
  };
  registerCommandIgnoreReloadLock(registry, tpacceptCommand, handleTpacceptCommand);

  const tprejectCommand: CustomCommand = {
    name: "yuehua:tpreject",
    description: "拒绝当前待处理的 TPA 传送请求。请求方在线时会收到拒绝提示。",
    permissionLevel: CommandPermissionLevel.Any,
  };
  registerCommandIgnoreReloadLock(registry, tprejectCommand, handleTprejectCommand);

  commandsRegistered = true;
  console.warn("所有自定义指令已通过官方 API 注册完成");
});

// =====================
// 指令处理函数
// =====================

function handleWaypointCommand(
  origin: CustomCommandOrigin,
  subCommand?: string,
  arg1?: string,
  arg2?: string
): CustomCommandResult {
  const player = origin.sourceEntity as Player;
  if (!player) return { status: CustomCommandStatus.Failure };

  if (!subCommand) {
    player.sendMessage(color.yellow("使用方法: /yuehua:waypoint <list|add|del|tp> [名称] [private/public]"));
    player.sendMessage(color.gray("list=列出；add=保存当前位置；del=删除；tp=传送。public 公开点仅管理员可创建。"));
    return { status: CustomCommandStatus.Success };
  }

  system.run(() => {
    try {
      switch (subCommand.toLowerCase()) {
        case "list":
          const points = wayPoint.getPlayerPoints(player);
          if (points.length === 0) {
            player.sendMessage(color.yellow("你还没有创建任何坐标点。"));
          } else {
            player.sendMessage(color.green("=== 我的坐标点列表 ==="));
            points.forEach((p) => {
              player.sendMessage(
                `${color.aqua(p.name)} - ${color.gray(`${p.location.x}, ${p.location.y}, ${p.location.z} (${p.dimension})`)}`
              );
            });
          }
          break;

        case "add":
          if (!arg1) {
            player.sendMessage(color.red("用法: /yuehua:waypoint add <名称> [private/public]"));
            return;
          }
          const name = arg1;
          const type = (arg2?.toLowerCase() === "public" ? "public" : "private") as "public" | "private";

          if (type === "public" && !isAdmin(player)) {
            player.sendMessage(color.red("只有管理员可以创建公开坐标点。"));
            return;
          }

          const result = wayPoint.createPoint({
            pointName: name,
            location: player.location,
            player: player,
            type: type,
          });

          if (typeof result === "string") {
            player.sendMessage(color.red(result));
          } else {
            player.sendMessage(color.green(`成功创建${type === "public" ? "公开" : "私有"}坐标点: ${name}`));
          }
          break;

        case "del":
          if (!arg1) {
            player.sendMessage(color.red("用法: /yuehua:waypoint del <名称>"));
            return;
          }
          const delName = arg1;
          if (!isAdmin(player) && !wayPoint.checkOwner(player, delName)) {
            player.sendMessage(color.red("你没有权限删除该坐标点或该点不存在。"));
            return;
          }

          const delResult = wayPoint.deletePoint(delName, player.name);
          if (typeof delResult === "string") {
            player.sendMessage(color.red(delResult));
          } else {
            player.sendMessage(color.green(`成功删除坐标点: ${delName}`));
          }
          break;

        case "tp":
          if (!arg1) {
            player.sendMessage(color.red("用法: /yuehua:waypoint tp <名称>"));
            return;
          }
          const tpName = arg1;
          // 优先查找该玩家的坐标点
          let point = wayPoint.getPoint(tpName, player.name);
          // 如果没找到，尝试查找公开坐标点
          if (!point) {
            point = wayPoint.getPoint(tpName);
          }
          if (!point) {
            player.sendMessage(color.red("坐标点不存在。"));
            return;
          }

          if (point.type === "private" && point.playerName !== player.name && !isAdmin(player)) {
            player.sendMessage(color.red("你没有权限传送到该私有坐标点。"));
            return;
          }

          wayPoint.teleport(player, tpName);
          break;

        default:
          player.sendMessage(color.yellow("未知子指令。可用: list, add, del, tp"));
          break;
      }
    } catch (error) {
      player.sendMessage(color.red(`指令执行错误: ${(error as Error).message}`));
    }
  });

  return { status: CustomCommandStatus.Success };
}

function handleLandCommand(
  origin: CustomCommandOrigin,
  subCommand?: string,
  arg1?: string,
  arg2?: string
): CustomCommandResult {
  const player = origin.sourceEntity as Player;
  if (!player) return { status: CustomCommandStatus.Failure };

  if (!subCommand) {
    player.sendMessage(color.yellow("使用方法: /yuehua:land <list|query|remove|trust|untrust> [参数]"));
    player.sendMessage(color.gray("list=我的领地；query=脚下领地；remove <领地名>；trust/untrust <玩家名> <领地名>。"));
    return { status: CustomCommandStatus.Success };
  }

  system.run(() => {
    try {
      switch (subCommand.toLowerCase()) {
        case "list":
          const lands = landManager.getPlayerLands(player.name);
          if (lands.length === 0) {
            player.sendMessage(color.yellow("你还没有创建任何领地。"));
          } else {
            player.sendMessage(color.green("=== 我的领地列表 ==="));
            lands.forEach((l) => {
              player.sendMessage(`${color.aqua(l.name)} (${l.dimension}) - 成员: ${l.members.length}人`);
            });
          }
          break;

        case "query":
          const test = landManager.testLand(player.location, player.dimension.id);
          if (test.isInside && test.insideLand) {
            player.sendMessage(color.green(`你当前位于领地: ${color.yellow(test.insideLand.name)}`));
            player.sendMessage(color.green(`拥有者: ${color.yellow(test.insideLand.owner)}`));
          } else {
            player.sendMessage(color.yellow("你当前不在任何领地内。"));
          }
          break;

        case "remove":
          if (!arg1) {
            player.sendMessage(color.red("用法: /yuehua:land remove <领地名称>"));
            return;
          }
          const removeName = arg1;
          const landToRemove = landManager.getLand(removeName);
          if (typeof landToRemove === "string") {
            player.sendMessage(color.red(landToRemove));
            return;
          }

          if (landToRemove.owner !== player.name && !isAdmin(player)) {
            player.sendMessage(color.red("你没有权限删除该领地。"));
            return;
          }

          landManager.removeLand(removeName);
          player.sendMessage(color.green(`成功删除领地: ${removeName}`));
          break;

        case "trust":
          if (!arg1 || !arg2) {
            player.sendMessage(color.red("用法: /yuehua:land trust <玩家名> <领地名称>"));
            return;
          }
          const trustPlayer = arg1;
          const trustLandName = arg2;

          const trustLandInfo = landManager.getLand(trustLandName);
          if (typeof trustLandInfo === "string") {
            player.sendMessage(color.red(trustLandInfo));
            return;
          }

          if (trustLandInfo.owner !== player.name && !isAdmin(player)) {
            player.sendMessage(color.red("你没有权限管理该领地。"));
            return;
          }

          const addResult = landManager.addMember(trustLandName, trustPlayer);
          if (addResult === "成员已存在") {
            player.sendMessage(color.red("该玩家已经是成员了。"));
          } else {
            player.sendMessage(color.green(`成功将玩家 ${trustPlayer} 添加到领地 ${trustLandName}。`));
          }
          break;

        case "untrust":
          if (!arg1 || !arg2) {
            player.sendMessage(color.red("用法: /yuehua:land untrust <玩家名> <领地名称>"));
            return;
          }
          const untrustPlayer = arg1;
          const untrustLandName = arg2;

          const untrustLandInfo = landManager.getLand(untrustLandName);
          if (typeof untrustLandInfo === "string") {
            player.sendMessage(color.red(untrustLandInfo));
            return;
          }

          if (untrustLandInfo.owner !== player.name && !isAdmin(player)) {
            player.sendMessage(color.red("你没有权限管理该领地。"));
            return;
          }

          const removeResult = landManager.removeMember(untrustLandName, untrustPlayer);
          if (removeResult === "成员不存在") {
            player.sendMessage(color.red("该玩家不是领地成员。"));
          } else {
            player.sendMessage(color.green(`成功将玩家 ${untrustPlayer} 从领地 ${untrustLandName} 移除。`));
          }
          break;

        default:
          player.sendMessage(color.yellow("未知子指令。可用: list, query, remove, trust, untrust"));
          break;
      }
    } catch (error) {
      player.sendMessage(color.red(`指令执行错误: ${(error as Error).message}`));
    }
  });

  return { status: CustomCommandStatus.Success };
}

function handleMoneyCommand(origin: CustomCommandOrigin, subCommand?: string): CustomCommandResult {
  const player = origin.sourceEntity as Player;
  if (!player) return { status: CustomCommandStatus.Failure };

  system.run(async () => {
    try {
      const economic = (await import("../../economic/services/economic")).default;

      if (!subCommand) {
        const wallet = economic.getWallet(player.name);
        player.sendMessage(color.green(`当前余额: ${color.gold(wallet.gold.toString())}`));
        return;
      }

      switch (subCommand.toLowerCase()) {
        case "top":
          const topWallets = economic.getTopWallets(20);
          player.sendMessage(color.green("=== 数据统计 · 财富 TOP 20 ==="));
          topWallets.forEach((w, index) => {
            player.sendMessage(`${index + 1}. ${w.name}: ${color.gold(w.gold.toString())}`);
          });
          break;
        default:
          player.sendMessage(color.yellow("用法: /yuehua:money [top]"));
          player.sendMessage(color.gray("留空查看自己的余额；top 查看财富排行榜前 20。"));
          break;
      }
    } catch (error) {
      player.sendMessage(color.red(`指令执行错误: ${(error as Error).message}`));
    }
  });

  return { status: CustomCommandStatus.Success };
}

function handlePayCommand(origin: CustomCommandOrigin, targetName: string, amount: number): CustomCommandResult {
  const player = origin.sourceEntity as Player;
  if (!player) return { status: CustomCommandStatus.Failure };

  system.run(async () => {
    try {
      const economic = (await import("../../economic/services/economic")).default;

      if (isNaN(amount) || amount <= 0) {
        player.sendMessage(color.red("请输入有效的金额。"));
        return;
      }

      const targetPlayer = usePlayerByName(targetName);
      if (!targetPlayer) {
        player.sendMessage(color.red("找不到目标玩家 (玩家必须在线)。"));
      }

      const result = economic.transfer(player.name, targetName, amount, "指令转账");
      if (result === true) {
        player.sendMessage(color.green(`成功向 ${targetName} 转账 ${amount} 金币。`));
        if (targetPlayer) {
          targetPlayer.sendMessage(color.green(`收到来自 ${player.name} 的转账 ${amount} 金币。`));
        }
      } else {
        player.sendMessage(color.red(`转账失败: ${result}`));
      }
    } catch (error) {
      player.sendMessage(color.red(`指令执行错误: ${(error as Error).message}`));
    }
  });

  return { status: CustomCommandStatus.Success };
}

function handleSettingCommand(origin: CustomCommandOrigin, key?: string, value?: string): CustomCommandResult {
  const player = origin.sourceEntity as Player;
  if (!player) return { status: CustomCommandStatus.Failure };

  system.run(() => {
    try {
      if (!isAdmin(player)) {
        player.sendMessage(color.red("只有管理员可以使用此指令。"));
        return;
      }

      if (!key || key.toLowerCase() === "list") {
        player.sendMessage(color.green("=== 系统设置列表 ==="));
        player.sendMessage(color.yellow("使用方法: /yuehua:setting <设置项> <值>\n"));

        for (const [settingKey, description] of Object.entries(settingDescriptions)) {
          const currentValue = setting.getState(settingKey as IModules);
          player.sendMessage(`${color.aqua(settingKey)}: ${description}`);
          player.sendMessage(`  ${color.gray(`当前值: ${color.yellow(String(currentValue))}\n`)}`);
        }
        return;
      }

      if (!value) {
        player.sendMessage(color.red("用法: /yuehua:setting <设置项> <值>"));
        player.sendMessage(color.yellow("或使用 /yuehua:setting list 查看所有可配置项"));
        return;
      }

      let finalValue: boolean | string = value;
      if (value === "true") finalValue = true;
      if (value === "false") finalValue = false;
      if (TELEPORT_COST_SETTING_KEYS.has(key)) {
        const cost = Math.floor(Number(value));
        if (!Number.isFinite(cost) || cost < 0) {
          player.sendMessage(color.red("传送费用须为 0 或正整数。"));
          return;
        }
        finalValue = String(cost);
      }

      setting.setState(key as any, finalValue);
      player.sendMessage(color.green(`已将设置 ${key} 更新为 ${finalValue}`));
    } catch (error) {
      player.sendMessage(color.red(`设置失败: ${(error as Error).message}`));
    }
  });

  return { status: CustomCommandStatus.Success };
}

function handleRtpCommand(origin: CustomCommandOrigin): CustomCommandResult {
  const player = origin.sourceEntity as Player;
  if (!player) return { status: CustomCommandStatus.Failure };
  system.run(async () => {
    try {
      const { RandomTp } = await import("../../other/services/random-tp");
      await RandomTp(player);
    } catch (error) {
      player.sendMessage(color.red(`传送失败: ${(error as Error).message}`));
    }
  });

  return { status: CustomCommandStatus.Success };
}

function handleLandFlightCommand(origin: CustomCommandOrigin): CustomCommandResult {
  const player = origin.sourceEntity as Player;
  if (!player) return { status: CustomCommandStatus.Failure };

  system.run(() => {
    try {
      const err = tryStartLandFlightSession(player);
      if (typeof err === "string") {
        player.sendMessage(err);
      }
    } catch (e) {
      player.sendMessage(color.red(`领地飞行失败: ${(e as Error).message}`));
    }
  });

  return { status: CustomCommandStatus.Success };
}

function handleFakePlayerCommand(origin: CustomCommandOrigin, operation?: string, name?: string): CustomCommandResult {
  const player = origin.sourceEntity as Player;
  if (!player) return { status: CustomCommandStatus.Failure };

  system.run(() => {
    const op = (operation ?? "list").toLowerCase();

    if (op === "list") {
      const admin = isAdmin(player);
      const list = admin ? fakePlayerService.listAllForAdmin() : fakePlayerService.listForPlayer(player.name);
      if (list.length === 0) {
        player.sendMessage(color.yellow(admin ? "全服暂无假人。" : "你还没有创建任何假人。"));
        player.sendMessage(color.gray("用法: /yuehua:fakeplayer add <名称>"));
        return;
      }
      player.sendMessage(
        color.green(admin ? `=== 全服假人 (${list.length}) ===` : `=== 我的假人 (${list.length}) ===`)
      );
      for (const item of list) {
        player.sendMessage(
          `${color.aqua(item.name)} ${color.gray(`${item.dimension} ${item.location.x}, ${item.location.y}, ${item.location.z}`)}`
        );
      }
      return;
    }

    if (op === "add") {
      const result = fakePlayerService.create({ player, name: name ?? `${player.name}的假人` });
      if (typeof result === "string") {
        player.sendMessage(color.red(result));
        return;
      }
      player.sendMessage(color.green(`已创建模拟玩家 ${color.yellow(result.name)}。`));
      return;
    }

    if (op === "remove") {
      if (!name?.trim()) {
        player.sendMessage(color.yellow("用法: /yuehua:fakeplayer remove <假人名称>"));
        return;
      }

      const list = isAdmin(player) ? fakePlayerService.listAllForAdmin() : fakePlayerService.listForPlayer(player.name);
      const item = list.find((fakePlayer) => fakePlayer.name === name.trim());
      if (!item) {
        player.sendMessage(color.red("没有找到这个名称的假人。"));
        return;
      }

      const result = fakePlayerService.delete(player, item.id);
      player.sendMessage(result === true ? color.green("假人已删除。") : color.red(String(result)));
      return;
    }

    if (op === "remove_all") {
      if (!isAdmin(player)) {
        player.sendMessage(color.red("只有管理员可以删除全服假人。"));
        return;
      }

      const result = fakePlayerService.deleteAll(player);
      if (typeof result === "string") {
        player.sendMessage(color.red(result));
        return;
      }

      player.sendMessage(color.green(`已删除 ${result.deleted} 条假人数据，并踢出/移除 ${result.kicked} 个在线假人。`));
      return;
    }

    player.sendMessage(color.yellow("用法: /yuehua:fakeplayer <list|add|remove|remove_all> [名称]"));
  });

  return { status: CustomCommandStatus.Success };
}

function handleOneClickCommand(origin: CustomCommandOrigin, feature: string): CustomCommandResult {
  const player = origin.sourceEntity as Player;
  if (!player) return { status: CustomCommandStatus.Failure };

  system.run(() => {
    try {
      if (!isAdmin(player)) {
        player.sendMessage(color.red("只有管理员可以更改此设置。"));
        return;
      }

      const featureLower = feature.toLowerCase();
      if (featureLower === "ore") {
        const current = setting.getState("enableDigOreOneClick");
        setting.setState("enableDigOreOneClick", !current);
        player.sendMessage(color.green(`一键挖矿已${!current ? "开启" : "关闭"}`));
      } else if (featureLower === "tree") {
        const current = setting.getState("enableTreeCutOneClick");
        setting.setState("enableTreeCutOneClick", !current);
        player.sendMessage(color.green(`一键砍树已${!current ? "开启" : "关闭"}`));
      } else if (featureLower === "crop" || featureLower === "harvest") {
        const current = setting.getState("enableCropHarvestOneClick");
        setting.setState("enableCropHarvestOneClick", !current);
        player.sendMessage(color.green(`下蹲连锁收割作物已${!current ? "开启" : "关闭"}`));
      } else if (featureLower === "plant" || featureLower === "sow") {
        const current = setting.getState("enableCropPlantOneClick");
        setting.setState("enableCropPlantOneClick", !current);
        player.sendMessage(color.green(`下蹲一键连锁播种已${!current ? "开启" : "关闭"}`));
      } else {
        player.sendMessage(color.yellow("用法: /yuehua:oneclick <ore|tree|harvest|crop|plant|sow>"));
        player.sendMessage(color.gray("ore=挖矿；tree=砍树；harvest/crop=收割；plant/sow=播种。"));
      }
    } catch (error) {
      player.sendMessage(color.red(`设置失败: ${(error as Error).message}`));
    }
  });

  return { status: CustomCommandStatus.Success };
}

function handleTrialCommand(origin: CustomCommandOrigin, operation?: string, targetName?: string): CustomCommandResult {
  const player = origin.sourceEntity as Player;
  if (!player) return { status: CustomCommandStatus.Failure };

  system.run(async () => {
    try {
      if (!isAdmin(player)) {
        player.sendMessage(color.red("只有管理员可以使用此指令。"));
        return;
      }

      const { memberManager } = await import("../../system/services/trial-mode");

      if (!operation || operation.toLowerCase() === "list") {
        const members = memberManager.getAllMembers();
        if (members.length === 0) {
          player.sendMessage(color.yellow("当前没有正式会员。"));
        } else {
          player.sendMessage(color.green("=== 正式会员列表 ==="));
          members.forEach((memberName, index) => {
            player.sendMessage(`${index + 1}. ${color.aqua(memberName)}`);
          });
        }
        return;
      }

      const op = operation.toLowerCase();

      switch (op) {
        case "add":
          if (!targetName) {
            player.sendMessage(color.red("用法: /yuehua:trial add <玩家名>"));
            player.sendMessage(color.gray("支持批量: /yuehua:trial add 玩家1,玩家2,玩家3"));
            return;
          }

          const playersToAdd = targetName
            .split(",")
            .map((name) => name.trim())
            .filter((name) => name.length > 0);

          if (playersToAdd.length === 0) {
            player.sendMessage(color.red("请输入有效的玩家名。"));
            return;
          }

          let addedCount = 0;
          let skippedCount = 0;
          const results: string[] = [];

          for (const playerName of playersToAdd) {
            if (memberManager.isMember(playerName)) {
              results.push(`${color.yellow(playerName)}: 已是会员`);
              skippedCount++;
              continue;
            }

            const addSuccess = memberManager.addMember(playerName);
            if (addSuccess) {
              results.push(`${color.green(playerName)}: 添加成功`);
              addedCount++;
              const targetPlayer = usePlayerByName(playerName);
              if (targetPlayer) {
                targetPlayer.sendMessage(color.green("恭喜！您已成为正式会员，可以无限制游玩！"));
              }
            } else {
              results.push(`${color.red(playerName)}: 添加失败`);
            }
          }

          player.sendMessage(color.green(`=== 批量添加会员结果 ===`));
          results.forEach((result) => player.sendMessage(result));
          player.sendMessage(color.aqua(`成功: ${addedCount}, 跳过: ${skippedCount}, 总计: ${playersToAdd.length}`));
          break;

        case "remove":
          if (!targetName) {
            player.sendMessage(color.red("用法: /yuehua:trial remove <玩家名>"));
            return;
          }

          const playersToRemove = targetName
            .split(",")
            .map((name) => name.trim())
            .filter((name) => name.length > 0);

          let removedCount = 0;
          let notFoundCount = 0;
          const removeResults: string[] = [];

          for (const playerName of playersToRemove) {
            if (!memberManager.isMember(playerName)) {
              removeResults.push(`${color.yellow(playerName)}: 不是会员`);
              notFoundCount++;
              continue;
            }

            const removeSuccess = memberManager.removeMember(playerName);
            if (removeSuccess) {
              removeResults.push(`${color.green(playerName)}: 移除成功`);
              removedCount++;
              const targetPlayer = usePlayerByName(playerName);
              if (targetPlayer) {
                targetPlayer.sendMessage(color.red("您的会员资格已被移除，将受到试玩时间限制。"));
              }
            } else {
              removeResults.push(`${color.red(playerName)}: 移除失败`);
            }
          }

          player.sendMessage(color.green(`=== 批量移除会员结果 ===`));
          removeResults.forEach((result) => player.sendMessage(result));
          player.sendMessage(
            color.aqua(`成功: ${removedCount}, 未找到: ${notFoundCount}, 总计: ${playersToRemove.length}`)
          );
          break;

        case "check":
          if (!targetName) {
            player.sendMessage(color.red("用法: /yuehua:trial check <玩家名>"));
            return;
          }

          const playersToCheck = targetName
            .split(",")
            .map((name) => name.trim())
            .filter((name) => name.length > 0);

          player.sendMessage(color.green(`=== 玩家状态查询 ===`));

          for (const playerName of playersToCheck) {
            const isMember = memberManager.isMember(playerName);
            const targetPlayer = usePlayerByName(playerName);

            player.sendMessage(color.aqua(`\n玩家: ${playerName}`));

            if (isMember) {
              player.sendMessage(color.green(`  状态: 正式会员`));
            } else {
              player.sendMessage(color.yellow(`  状态: 试玩玩家`));

              if (targetPlayer) {
                const trialTime = (targetPlayer.getDynamicProperty("trialModeTimer") as number) || 0;
                const duration = Number(setting.getState("trialModeDuration") || "3600");
                const remainingTime = Math.max(0, duration - trialTime);
                const hasTrialed = targetPlayer.hasTag("trialed");

                if (hasTrialed) {
                  player.sendMessage(color.red(`  试玩状态: 时间已用完`));
                } else {
                  player.sendMessage(color.gray(`  已使用: ${trialTime} 秒`));
                  player.sendMessage(color.gray(`  剩余: ${remainingTime} 秒`));
                }
              } else {
                player.sendMessage(color.gray(`  (玩家不在线)`));
              }
            }
          }
          break;

        case "reset":
          if (!targetName) {
            player.sendMessage(color.red("用法: /yuehua:trial reset <玩家名>"));
            return;
          }

          const playersToReset = targetName
            .split(",")
            .map((name) => name.trim())
            .filter((name) => name.length > 0);

          let resetCount = 0;
          let offlineCount = 0;
          const resetResults: string[] = [];

          for (const playerName of playersToReset) {
            const resetPlayer = usePlayerByName(playerName);
            if (!resetPlayer) {
              resetResults.push(`${color.yellow(playerName)}: 不在线`);
              offlineCount++;
              continue;
            }

            resetPlayer.setDynamicProperty("trialModeTimer", 0);
            resetPlayer.removeTag("trialed");
            resetResults.push(`${color.green(playerName)}: 重置成功`);
            resetCount++;
            resetPlayer.sendMessage(color.green("您的试玩时间已被管理员重置。"));
          }

          player.sendMessage(color.green(`=== 批量重置试玩时间结果 ===`));
          resetResults.forEach((result) => player.sendMessage(result));
          player.sendMessage(
            color.aqua(`成功: ${resetCount}, 不在线: ${offlineCount}, 总计: ${playersToReset.length}`)
          );
          break;

        default:
          player.sendMessage(color.yellow("未知操作。可用操作: list, add, remove, check, reset"));
          break;
      }
    } catch (error) {
      player.sendMessage(color.red(`操作失败: ${(error as Error).message}`));
    }
  });

  return { status: CustomCommandStatus.Success };
}

function handleServerInfoCommand(origin: CustomCommandOrigin): CustomCommandResult {
  const player = origin.sourceEntity as Player;
  if (!player) return { status: CustomCommandStatus.Failure };

  system.run(() => {
    try {
      const allPlayers = getOnlineRealPlayers();
      const playerCount = allPlayers.length;
      const playerNames = allPlayers.map((p) => p.name).join(", ");

      const overworldEntities = world.getDimension("overworld").getEntities({ excludeTypes: ["minecraft:item"] }).length;
      const netherEntities = world.getDimension("nether").getEntities({ excludeTypes: ["minecraft:item"] }).length;
      const endEntities = world.getDimension("the_end").getEntities({ excludeTypes: ["minecraft:item"] }).length;

      const overworldItems = world.getDimension("overworld").getEntities({ type: "minecraft:item" }).length;
      const netherItems = world.getDimension("nether").getEntities({ type: "minecraft:item" }).length;
      const endItems = world.getDimension("the_end").getEntities({ type: "minecraft:item" }).length;

      const serverName = (setting.getState("serverName") as string) || "未设置";
      const timeOfDay = world.getTimeOfDay();
      const day = Math.floor(world.getDay());

      player.sendMessage(color.green("=== 服务器信息 ===\n"));
      player.sendMessage(color.aqua("【基本信息】"));
      player.sendMessage(`${color.gray("服务器名称:")} ${color.yellow(serverName)}`);
      player.sendMessage(`${color.gray("TPS:")} ${color.yellow(serverInfo.TPS.toFixed(2))}`);
      player.sendMessage(`${color.gray("世界时间:")} ${color.yellow(`第${day}天 ${timeOfDay}刻`)}\n`);

      player.sendMessage(color.aqua("【在线玩家】"));
      player.sendMessage(`${color.gray("在线人数:")} ${color.yellow(playerCount.toString())}`);
      if (playerCount > 0) {
        player.sendMessage(`${color.gray("玩家列表:")} ${color.yellow(playerNames)}\n`);
      }

      player.sendMessage(color.aqua("【实体统计】"));
      player.sendMessage(`${color.gray("主世界实体:")} ${color.yellow(overworldEntities.toString())}`);
      player.sendMessage(`${color.gray("下界实体:")} ${color.yellow(netherEntities.toString())}`);
      player.sendMessage(`${color.gray("末地实体:")} ${color.yellow(endEntities.toString())}`);
      player.sendMessage(`${color.gray("总实体数:")} ${color.yellow(serverInfo.organismLength.toString())}\n`);

      player.sendMessage(color.aqua("【掉落物统计】"));
      player.sendMessage(`${color.gray("主世界掉落物:")} ${color.yellow(overworldItems.toString())}`);
      player.sendMessage(`${color.gray("下界掉落物:")} ${color.yellow(netherItems.toString())}`);
      player.sendMessage(`${color.gray("末地掉落物:")} ${color.yellow(endItems.toString())}`);
      player.sendMessage(`${color.gray("总掉落物:")} ${color.yellow(serverInfo.itemsLength.toString())}\n`);

      player.sendMessage(color.aqua("【功能状态】"));
      player.sendMessage(
        `${color.gray("经济系统:")} ${setting.getState("economy") ? color.green("开启") : color.red("关闭")}`
      );
      player.sendMessage(
        `${color.gray("试玩模式:")} ${setting.getState("trialMode") ? color.green("开启") : color.red("关闭")}`
      );
      player.sendMessage(
        `${color.gray("一键砍树:")} ${setting.getState("enableTreeCutOneClick") ? color.green("开启") : color.red("关闭")}`
      );
      player.sendMessage(
        `${color.gray("一键挖矿:")} ${setting.getState("enableDigOreOneClick") ? color.green("开启") : color.red("关闭")}`
      );
      player.sendMessage(
        `${color.gray("连锁收割作物:")} ${setting.getState("enableCropHarvestOneClick") ? color.green("开启") : color.red("关闭")}`
      );
      player.sendMessage(
        `${color.gray("连锁播种作物:")} ${setting.getState("enableCropPlantOneClick") ? color.green("开启") : color.red("关闭")}`
      );
      {
        const v = setting.getState("digOreChainObsidian");
        const on = v !== false && v !== "false";
        player.sendMessage(`${color.gray("一键挖矿连锁黑曜石:")} ${on ? color.green("开启") : color.red("关闭")}`);
      }
    } catch (error) {
      player.sendMessage(color.red(`获取服务器信息失败: ${(error as Error).message}`));
    }
  });

  return { status: CustomCommandStatus.Success };
}

function handleMoneySettingCommand(
  origin: CustomCommandOrigin,
  operation: string,
  targetPlayers: Player[],
  amount: number
): CustomCommandResult {
  const entity = origin.sourceEntity;
  // 如果是玩家
  if (entity instanceof Player) {
    const player = entity;
    system.run(async () => {
      try {
        if (!isAdmin(player)) {
          player.sendMessage(color.red("只有管理员可以使用此指令。"));
          return;
        }

        if (!Array.isArray(targetPlayers) || targetPlayers.length === 0) {
          player.sendMessage(color.red("没有指定目标玩家。"));
          return;
        }

        if (isNaN(amount) || amount < 0) {
          player.sendMessage(color.red("请输入有效的金额 (必须大于等于0；add/remove 必须大于0)。"));
          return;
        }

        const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
        if (amount > MAX_SAFE_INTEGER) {
          player.sendMessage(color.red(`金额过大，最大值为 ${MAX_SAFE_INTEGER}`));
          return;
        }

        const op = operation.toLowerCase();
        let successCount = 0;
        let failCount = 0;
        let msgList: string[] = [];

        for (const targetPlayer of targetPlayers) {
          const wallet = economic.getWallet(targetPlayer.name);

          switch (op) {
            case "add": {
              if (amount <= 0) {
                player.sendMessage(color.red("添加金币数量必须大于0。"));
                failCount++;
                break;
              }
              const oldBalance = wallet.gold;
              const addedAmount = economic.addGold(targetPlayer.name, amount, "管理员添加", true);
              if (addedAmount > 0) {
                const currentBalance = economic.getWallet(targetPlayer.name).gold;
                player.sendMessage(
                  color.green(
                    `成功为玩家 ${color.yellow(targetPlayer.name)} 添加 ${color.gold(amount.toString())} 金币。`
                  )
                );
                player.sendMessage(
                  color.gray(
                    `余额变化: ${color.gold(oldBalance.toString())} 到 ${color.gold(currentBalance.toString())}`
                  )
                );
                targetPlayer.sendMessage(color.green(`管理员为您添加了 ${amount} 金币，当前余额: ${currentBalance}`));
                successCount++;
              } else {
                player.sendMessage(color.red(`为玩家 ${color.yellow(targetPlayer.name)} 添加金币失败。`));
                failCount++;
              }
              break;
            }
            case "remove": {
              if (amount <= 0) {
                player.sendMessage(color.red("扣除金币数量必须大于0。"));
                failCount++;
                break;
              }
              const currentBalance = wallet.gold;
              if (currentBalance < amount) {
                player.sendMessage(
                  color.red(
                    `玩家 ${color.yellow(targetPlayer.name)} 的余额不足。当前余额: ${color.gold(currentBalance.toString())}，需要扣除: ${color.gold(amount.toString())}`
                  )
                );
                failCount++;
                break;
              }

              const removeSuccess = economic.removeGold(targetPlayer.name, amount, "管理员扣除");
              if (removeSuccess) {
                const currentBalanceAfterRemove = economic.getWallet(targetPlayer.name).gold;
                player.sendMessage(
                  color.green(
                    `成功为玩家 ${color.yellow(targetPlayer.name)} 扣除 ${color.gold(amount.toString())} 金币。`
                  )
                );

                targetPlayer.sendMessage(
                  color.red(
                    `管理员扣除了您 ${color.gold(amount.toString())} 金币，当前余额: ${color.gold(currentBalanceAfterRemove.toString())}`
                  )
                );
                successCount++;
              } else {
                player.sendMessage(color.red(`为玩家 ${color.yellow(targetPlayer.name)} 扣除金币失败。`));
                failCount++;
              }
              break;
            }
            case "set": {
              const oldBalance = wallet.gold;
              const setSuccess = economic.setPlayerGold(targetPlayer.name, amount);
              if (setSuccess) {
                player.sendMessage(
                  color.green(
                    `成功将玩家 ${color.yellow(targetPlayer.name)} 的金币设置为 ${color.gold(amount.toString())}。`
                  )
                );
                targetPlayer.sendMessage(color.yellow(`管理员将您的金币设置为 ${color.gold(amount.toString())}`));
                successCount++;
              } else {
                player.sendMessage(color.red(`为玩家 ${color.yellow(targetPlayer.name)} 设置金币失败。`));
                failCount++;
              }
              break;
            }
            default:
              msgList.push("未知操作。可用操作: add, remove, set");
              break;
          }
        }
        if (msgList.length > 0) {
          player.sendMessage(color.yellow(msgList.join("；")));
        }
        // 如果全部失败，可以考虑返回失败
      } catch (error) {
        player.sendMessage(color.red(`操作失败: ${(error as Error).message}`));
      }
    });
  } else if (origin.sourceBlock) {
    // 如果是命令方块
    const block = origin.sourceBlock;
    try {
      if (!Array.isArray(targetPlayers) || targetPlayers.length === 0) {
        // SystemLog.error("命令方块执行金币管理指令时未指定目标玩家。");
        return { status: CustomCommandStatus.Failure, message: "未指定目标玩家" };
      }
      // SystemLog.info(
      //   `命令方块 ${block.location.x},${block.location.y},${block.location.z} 执行了金币管理指令: ${operation} 目标玩家: ${targetPlayers.map((p) => p.name).join(", ")} 金额: ${amount}`
      // );
      if (isNaN(amount) || amount < 0) {
        // SystemLog.error("请输入有效的金额 (必须大于0)。");
        return {
          status: CustomCommandStatus.Failure,
          message: "请输入有效的金额 (必须大于等于0；add/remove 必须大于0)",
        };
      }

      const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
      if (amount > MAX_SAFE_INTEGER) {
        // SystemLog.error(`金额过大，最大值为 ${MAX_SAFE_INTEGER}`);
        return { status: CustomCommandStatus.Failure, message: `金额过大，最大值为 ${MAX_SAFE_INTEGER}` };
      }

      const op = operation.toLowerCase();
      let successCount = 0,
        failCount = 0;
      for (const targetPlayer of targetPlayers) {
        const wallet = economic.getWallet(targetPlayer.name);

        switch (op) {
          case "add": {
            if (amount <= 0) {
              return { status: CustomCommandStatus.Failure, message: "添加金币数量必须大于0" };
            }
            const oldBalance = wallet.gold;
            const addedAmount = economic.addGold(targetPlayer.name, amount, "管理员添加", true);
            if (addedAmount > 0) {
              const currentBalance = economic.getWallet(targetPlayer.name).gold;
              // SystemLog.info(
              //   `成功为玩家 ${color.yellow(targetPlayer.name)} 添加 ${color.gold(amount.toString())} 金币。`
              // );
              // SystemLog.info(`余额变化: ${oldBalance} 到 ${currentBalance}`);

              targetPlayer.sendMessage(color.green(`管理员为您添加了 ${amount} 金币，当前余额: ${currentBalance}`));
              successCount++;
            } else {
              // SystemLog.error(`为玩家 ${color.yellow(targetPlayer.name)} 添加金币失败。`);
              failCount++;
            }
            break;
          }
          case "remove": {
            if (amount <= 0) {
              return { status: CustomCommandStatus.Failure, message: "扣除金币数量必须大于0" };
            }
            const currentBalance = wallet.gold;
            if (currentBalance < amount) {
              // SystemLog.error(`玩家 ${targetPlayer.name} 的余额不足。当前余额: ${currentBalance}，需要扣除: ${amount}`);
              failCount++;
              break;
            }

            const removeSuccess = economic.removeGold(targetPlayer.name, amount, "管理员扣除");
            if (removeSuccess) {
              const currentBalanceAfterRemove = economic.getWallet(targetPlayer.name).gold;
              // SystemLog.info(
              //   `成功为玩家 ${color.yellow(targetPlayer.name)} 扣除 ${color.gold(amount.toString())} 金币。`
              // );
              // SystemLog.info(`余额变化: ${wallet.gold} 到 ${currentBalanceAfterRemove}`);

              targetPlayer.sendMessage(
                color.red(`管理员扣除了您 ${amount} 金币，当前余额: ${currentBalanceAfterRemove}`)
              );
              successCount++;
            } else {
              // SystemLog.error(`为玩家 ${color.yellow(targetPlayer.name)} 扣除金币失败。`);
              failCount++;
            }
            break;
          }
          case "set": {
            const oldBalance = wallet.gold;
            const setSuccess = economic.setPlayerGold(targetPlayer.name, amount);
            if (setSuccess) {
              // SystemLog.info(`成功将玩家 ${color.yellow(targetPlayer.name)} 的金币设置为 ${amount}。`);
              // SystemLog.info(`当前余额: ${wallet.gold} → ${amount}`);

              targetPlayer.sendMessage(color.yellow(`管理员将您的金币设置为 ${amount}`));
              successCount++;
            } else {
              // SystemLog.error(`为玩家 ${color.yellow(targetPlayer.name)} 设置金币失败。`);
              failCount++;
            }
            break;
          }
          default:
            // SystemLog.error("未知操作。可用操作: add, remove, set");
            return { status: CustomCommandStatus.Failure, message: "未知操作。可用操作: add, remove, set" };
        }
      }
      // 可以输出批量结果，如果需要
    } catch (error) {
      // SystemLog.error(`金币管理指令执行失败: ${(error as Error).message}`);
      return { status: CustomCommandStatus.Failure, message: `金币管理指令执行失败: ${(error as Error).message}` };
    }
  } else {
    // SystemLog.error("金币管理指令执行失败: 未知来源");
    return { status: CustomCommandStatus.Failure, message: "金币管理指令执行失败: 未知来源" };
  }
  return { status: CustomCommandStatus.Success };
}

function handleMoneySettingOfflineCommand(
  origin: CustomCommandOrigin,
  operation: string,
  targetPlayerName: string,
  amount: number
): CustomCommandResult {
  const entity = origin.sourceEntity;

  // 如果是玩家
  if (entity instanceof Player) {
    const player = entity;
    system.run(async () => {
      try {
        if (!isAdmin(player)) {
          player.sendMessage(color.red("只有管理员可以使用此指令。"));
          return;
        }

        if (!targetPlayerName || targetPlayerName.trim() === "") {
          player.sendMessage(color.red("请指定目标玩家名称。"));
          return;
        }

        if (isNaN(amount) || amount < 0) {
          player.sendMessage(color.red("请输入有效的金额 (必须大于等于0)。"));
          return;
        }

        const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
        if (amount > MAX_SAFE_INTEGER) {
          player.sendMessage(color.red(`金额过大，最大值为 ${MAX_SAFE_INTEGER}`));
          return;
        }

        // 检查玩家是否有钱包数据（是否进过服务器）
        if (!economic.hasWallet(targetPlayerName)) {
          player.sendMessage(color.red(`玩家 ${color.yellow(targetPlayerName)} 从未进入过服务器，无法操作金币！`));
          player.sendMessage(color.gray("提示：只能为进入过服务器的玩家操作金币。"));
          return;
        }

        const op = operation.toLowerCase();

        // 尝试查找在线玩家以发送通知
        const targetPlayer = usePlayerByName(targetPlayerName);
        const wallet = economic.getWallet(targetPlayerName);

        switch (op) {
          case "add": {
            if (amount <= 0) {
              player.sendMessage(color.red("添加金币数量必须大于0。"));
              return;
            }
            const oldBalance = wallet.gold;
            const addedAmount = economic.addGold(targetPlayerName, amount, "管理员添加", true);
            if (addedAmount > 0) {
              const currentBalance = economic.getWallet(targetPlayerName).gold;
              player.sendMessage(
                color.green(`成功为玩家 ${color.yellow(targetPlayerName)} 添加 ${color.gold(amount.toString())} 金币。`)
              );
              player.sendMessage(
                color.gray(`余额变化: ${color.gold(oldBalance.toString())} 到 ${color.gold(currentBalance.toString())}`)
              );
              if (targetPlayer) {
                targetPlayer.sendMessage(color.green(`管理员为您添加了 ${amount} 金币，当前余额: ${currentBalance}`));
              }
            } else {
              player.sendMessage(color.red(`为玩家 ${color.yellow(targetPlayerName)} 添加金币失败。`));
            }
            break;
          }
          case "remove": {
            if (amount <= 0) {
              player.sendMessage(color.red("扣除金币数量必须大于0。"));
              return;
            }
            const currentBalance = wallet.gold;
            if (currentBalance < amount) {
              player.sendMessage(
                color.red(
                  `玩家 ${color.yellow(targetPlayerName)} 的余额不足。当前余额: ${color.gold(currentBalance.toString())}，需要扣除: ${color.gold(amount.toString())}`
                )
              );
              break;
            }

            const removeSuccess = economic.removeGold(targetPlayerName, amount, "管理员扣除");
            if (removeSuccess) {
              const currentBalanceAfterRemove = economic.getWallet(targetPlayerName).gold;
              player.sendMessage(
                color.green(`成功为玩家 ${color.yellow(targetPlayerName)} 扣除 ${color.gold(amount.toString())} 金币。`)
              );

              if (targetPlayer) {
                targetPlayer.sendMessage(
                  color.red(
                    `管理员扣除了您 ${color.gold(amount.toString())} 金币，当前余额: ${color.gold(currentBalanceAfterRemove.toString())}`
                  )
                );
              }
            } else {
              player.sendMessage(color.red(`为玩家 ${color.yellow(targetPlayerName)} 扣除金币失败。`));
            }
            break;
          }
          case "set": {
            const oldBalance = wallet.gold;
            const setSuccess = economic.setPlayerGold(targetPlayerName, amount);
            if (setSuccess) {
              player.sendMessage(
                color.green(
                  `成功将玩家 ${color.yellow(targetPlayerName)} 的金币设置为 ${color.gold(amount.toString())}。`
                )
              );
              if (targetPlayer) {
                targetPlayer.sendMessage(color.yellow(`管理员将您的金币设置为 ${color.gold(amount.toString())}`));
              }
            } else {
              player.sendMessage(color.red(`为玩家 ${color.yellow(targetPlayerName)} 设置金币失败。`));
            }
            break;
          }
          default:
            player.sendMessage(color.yellow("未知操作。可用操作: add, remove, set"));
            break;
        }
      } catch (error) {
        player.sendMessage(color.red(`操作失败: ${(error as Error).message}`));
      }
    });
  } else if (origin.sourceBlock) {
    // 命令方块执行
    const block = origin.sourceBlock;
    try {
      if (!targetPlayerName || targetPlayerName.trim() === "") {
        // SystemLog.error("命令方块执行金币管理指令时未指定目标玩家。");
        return { status: CustomCommandStatus.Failure, message: "未指定目标玩家" };
      }

      // SystemLog.info(
      //   `命令方块 ${block.location.x},${block.location.y},${block.location.z} 执行了金币管理指令: ${operation} 目标玩家: ${targetPlayerName} 金额: ${amount}`
      // );

      if (isNaN(amount) || amount < 0) {
        // SystemLog.error("请输入有效的金额 (必须大于等于0)。");
        return { status: CustomCommandStatus.Failure, message: "请输入有效的金额 (必须大于等于0)" };
      }

      const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
      if (amount > MAX_SAFE_INTEGER) {
        // SystemLog.error(`金额过大，最大值为 ${MAX_SAFE_INTEGER}`);
        return { status: CustomCommandStatus.Failure, message: `金额过大，最大值为 ${MAX_SAFE_INTEGER}` };
      }

      // 检查玩家是否有钱包数据（是否进过服务器）
      if (!economic.hasWallet(targetPlayerName)) {
        // SystemLog.error(`玩家 ${targetPlayerName} 从未进入过服务器，无法操作金币`);
        return { status: CustomCommandStatus.Failure, message: "玩家从未进入过服务器" };
      }

      const op = operation.toLowerCase();
      const targetPlayer = usePlayerByName(targetPlayerName);
      const wallet = economic.getWallet(targetPlayerName);

      switch (op) {
        case "add": {
          if (amount <= 0) {
            // SystemLog.error("添加金币数量必须大于0。");
            return { status: CustomCommandStatus.Failure, message: "添加金币数量必须大于0" };
          }
          const oldBalance = wallet.gold;
          const addedAmount = economic.addGold(targetPlayerName, amount, "管理员添加", true);
          if (addedAmount > 0) {
            const currentBalance = economic.getWallet(targetPlayerName).gold;
            // SystemLog.info(
            //   `成功为玩家 ${color.yellow(targetPlayerName)} 添加 ${color.gold(amount.toString())} 金币。`
            // );
            // SystemLog.info(`余额变化: ${oldBalance} 到 ${currentBalance}`);

            if (targetPlayer) {
              targetPlayer.sendMessage(color.green(`管理员为您添加了 ${amount} 金币，当前余额: ${currentBalance}`));
            }
          } else {
            // SystemLog.error(`为玩家 ${color.yellow(targetPlayerName)} 添加金币失败。`);
            return { status: CustomCommandStatus.Failure, message: "添加金币失败" };
          }
          break;
        }
        case "remove": {
          if (amount <= 0) {
            // SystemLog.error("扣除金币数量必须大于0。");
            return { status: CustomCommandStatus.Failure, message: "扣除金币数量必须大于0" };
          }
          const currentBalance = wallet.gold;
          if (currentBalance < amount) {
            // SystemLog.error(`玩家 ${targetPlayerName} 的余额不足。当前余额: ${currentBalance}，需要扣除: ${amount}`);
            return { status: CustomCommandStatus.Failure, message: "玩家余额不足" };
          }

          const removeSuccess = economic.removeGold(targetPlayerName, amount, "管理员扣除");
          if (removeSuccess) {
            const currentBalanceAfterRemove = economic.getWallet(targetPlayerName).gold;
            // SystemLog.info(
            //   `成功为玩家 ${color.yellow(targetPlayerName)} 扣除 ${color.gold(amount.toString())} 金币。`
            // );
            // SystemLog.info(`余额变化: ${wallet.gold} 到 ${currentBalanceAfterRemove}`);

            if (targetPlayer) {
              targetPlayer.sendMessage(
                color.red(`管理员扣除了您 ${amount} 金币，当前余额: ${currentBalanceAfterRemove}`)
              );
            }
          } else {
            // SystemLog.error(`为玩家 ${color.yellow(targetPlayerName)} 扣除金币失败。`);
            return { status: CustomCommandStatus.Failure, message: "扣除金币失败" };
          }
          break;
        }
        case "set": {
          const oldBalance = wallet.gold;
          const setSuccess = economic.setPlayerGold(targetPlayerName, amount);
          if (setSuccess) {
            // SystemLog.info(`成功将玩家 ${color.yellow(targetPlayerName)} 的金币设置为 ${amount}。`);
            // SystemLog.info(`当前余额: ${wallet.gold} → ${amount}`);

            if (targetPlayer) {
              targetPlayer.sendMessage(color.yellow(`管理员将您的金币设置为 ${amount}`));
            }
          } else {
            // SystemLog.error(`为玩家 ${color.yellow(targetPlayerName)} 设置金币失败。`);
            return { status: CustomCommandStatus.Failure, message: "设置金币失败" };
          }
          break;
        }
        default:
          // SystemLog.error("未知操作。可用操作: add, remove, set");
          return { status: CustomCommandStatus.Failure, message: "未知操作。可用操作: add, remove, set" };
      }
    } catch (error) {
      // SystemLog.error(`金币管理指令执行失败: ${(error as Error).message}`);
      return { status: CustomCommandStatus.Failure, message: `金币管理指令执行失败: ${(error as Error).message}` };
    }
  } else {
    // SystemLog.error("金币管理指令执行失败: 未知来源");
    return { status: CustomCommandStatus.Failure, message: "金币管理指令执行失败: 未知来源" };
  }
  return { status: CustomCommandStatus.Success };
}

function handleGiveMenuCommand(origin: CustomCommandOrigin): CustomCommandResult {
  const player = origin.sourceEntity as Player;
  if (!player) return { status: CustomCommandStatus.Failure };

  system.run(() => {
    try {
      player.runCommand("give @s yuehua:sm");
      player.sendMessage(color.green("已为您发放苦力怕菜单！"));
    } catch (error) {
      player.sendMessage(color.red(`获取菜单失败: ${(error as Error).message}`));
    }
  });

  return { status: CustomCommandStatus.Success };
}

function handleGetItemTypeIdCommand(origin: CustomCommandOrigin, mode?: string): CustomCommandResult {
  const player = origin.sourceEntity as Player;
  if (!player) return { status: CustomCommandStatus.Failure };

  system.run(() => {
    try {
      const showAll = mode?.toLowerCase() === "all" || mode?.toLowerCase() === "inventory";

      if (showAll) {
        // 获取背包所有物品
        const container = player.getComponent("inventory")?.container;
        if (!container) {
          player.sendMessage(color.red("无法获取背包容器。"));
          return;
        }

        const itemMap = new Map<string, number>();
        for (let i = 0; i < container.size; i++) {
          const item = container.getItem(i);
          if (item && item.typeId) {
            const count = itemMap.get(item.typeId) ?? 0;
            itemMap.set(item.typeId, count + item.amount);
          }
        }

        if (itemMap.size === 0) {
          player.sendMessage(color.yellow("背包为空，没有任何物品。"));
          return;
        }

        player.sendMessage(color.green("=== 背包物品 typeId 列表 ==="));
        for (const [typeId, amount] of itemMap.entries()) {
          player.sendMessage(`${color.aqua(typeId)} ${color.gray(`x${amount}`)}`);
        }
      } else {
        // 获取手持物品
        const equippable = player.getComponent(EntityEquippableComponent.componentId) as EntityEquippableComponent;
        if (!equippable) {
          player.sendMessage(color.red("无法获取装备组件。"));
          return;
        }

        const mainHand = equippable.getEquipmentSlot(EquipmentSlot.Mainhand);
        const item = mainHand?.getItem();

        if (!item || !item.typeId) {
          player.sendMessage(color.yellow("当前手中没有物品。"));
          return;
        }

        player.sendMessage(color.green(`手持物品 typeId: ${color.aqua(item.typeId)}`));
      }
    } catch (error) {
      player.sendMessage(color.red(`获取物品ID失败: ${(error as Error).message}`));
    }
  });

  return { status: CustomCommandStatus.Success };
}

function handleSubscribeItemHoldCommand(
  origin: CustomCommandOrigin,
  action?: string,
  typeId?: string
): CustomCommandResult {
  const player = origin.sourceEntity as Player;
  if (!player) return { status: CustomCommandStatus.Failure };
  if (!isAdmin(player)) {
    system.run(() => player.sendMessage(color.red("此功能仅管理员可用。")));
    return { status: CustomCommandStatus.Failure };
  }

  system.run(() => {
    const act = (action ?? "list").toLowerCase().trim();
    if (!act || act === "list") {
      const list = listSubscriptions(player);
      if (list.length === 0) {
        player.sendMessage(color.yellow("当前没有登记任何要监控的物品。"));
        player.sendMessage(
          color.gray(
            "手拿物品后输入 /yuehua:get_item_typeid 可复制编号；看背包全部用 all。示例：add minecraft:diamond；全部生成蛋（后缀 _spawn_egg）：add spawn_egg_group"
          )
        );
        return;
      }
      player.sendMessage(color.green(`已登记 ${list.length} 种物品（任意玩家拿到时会记背包）：`));
      for (const id of list) {
        const line = formatItemWatchSubscriptionLabel(id);
        player.sendMessage(color.aqua(`  · ${line}`));
      }
      return;
    }
    if (act === "clear") {
      clearSubscriptions(player);
      player.sendMessage(color.green("已清空全部登记。"));
      return;
    }
    if (act === "add") {
      if (!typeId?.trim()) {
        player.sendMessage(
          color.red(
            "请写上物品类型编号，例如：add minecraft:diamond；监控全部生成蛋：add spawn_egg_group（或 __spawn_egg_group__）"
          )
        );
        return;
      }
      const r = addSubscription(player, typeId);
      player.sendMessage(r.ok ? color.green(r.message) : color.red(r.message));
      return;
    }
    if (act === "remove") {
      if (!typeId?.trim()) {
        player.sendMessage(color.red("请写上要取消监控的物品类型编号。"));
        return;
      }
      const r = removeSubscription(player, typeId);
      player.sendMessage(r.ok ? color.green(r.message) : color.red(r.message));
      return;
    }
    player.sendMessage(color.red("未知操作。支持：add、remove、list、clear"));
  });

  return { status: CustomCommandStatus.Success };
}

function handleTpacceptCommand(origin: CustomCommandOrigin): CustomCommandResult {
  const player = origin.sourceEntity as Player;
  if (!player) return { status: CustomCommandStatus.Failure };

  system.run(() => {
    const pending = tpaRequest.takePendingRequest(player.name);
    if (!pending) {
      player.sendMessage(color.red("没有待处理的传送请求。"));
      return;
    }
    const requestPlayer = usePlayerByName(pending.requestPlayerName);
    if (!requestPlayer) {
      player.sendMessage(color.red("请求方已离线，无法完成传送。"));
      return;
    }
    tpaTeleport(requestPlayer, player, pending.type);
  });

  return { status: CustomCommandStatus.Success };
}

function handleTprejectCommand(origin: CustomCommandOrigin): CustomCommandResult {
  const player = origin.sourceEntity as Player;
  if (!player) return { status: CustomCommandStatus.Failure };

  system.run(() => {
    const pending = tpaRequest.takePendingRequest(player.name);
    if (!pending) {
      player.sendMessage(color.red("没有待处理的传送请求。"));
      return;
    }
    const requestPlayer = usePlayerByName(pending.requestPlayerName);
    if (requestPlayer) {
      tpaNotifyReject(requestPlayer, player);
    } else {
      player.sendMessage(color.gray("已拒绝该传送请求。（请求方已离线）"));
    }
  });

  return { status: CustomCommandStatus.Success };
}

function normalizeCameraPerspective(perspective: string): "first_person" | "third_person" | undefined {
  const normalized = perspective.toLowerCase();
  if (normalized === "first" || normalized === "1" || normalized === "first_person") return "first_person";
  if (
    normalized === "third" ||
    normalized === "3" ||
    normalized === "third_person" ||
    normalized === "front" ||
    normalized === "third_front"
  ) {
    return "third_person";
  }
  return undefined;
}

function handleCameraPerspectiveCommand(origin: CustomCommandOrigin, perspective: string): CustomCommandResult {
  const player = origin.sourceEntity as Player;
  if (!player) return { status: CustomCommandStatus.Failure };
  if (!isAdmin(player)) {
    player.sendMessage(color.red("只有管理员可以使用实体视角观察指令"));
    return { status: CustomCommandStatus.Failure, message: "权限不足" };
  }

  system.run(async () => {
    try {
      const cameraService = (await import("../../camera/services/camera")).default;
      const perspectiveType = normalizeCameraPerspective(perspective);
      if (!perspectiveType) {
        player.sendMessage(color.yellow("用法: /yuehua:camera_perspective <first|third>"));
        player.sendMessage(color.gray("first=第一人称观察；third=第三人称观察。"));
        return;
      }

      const result = cameraService.switchPerspective(player, perspectiveType);
      if (typeof result === "string") {
        player.sendMessage(color.red(result));
      } else {
        player.sendMessage(
          color.green(`已切换到${perspectiveType === "first_person" ? "第一人称" : "第三人称"}观察视角`)
        );
      }
    } catch (error) {
      player.sendMessage(color.red(`指令执行错误: ${(error as Error).message}`));
    }
  });

  return { status: CustomCommandStatus.Success };
}

function handleCameraCommand(
  origin: CustomCommandOrigin,
  operation?: string,
  targetEntitiesOrPerspective?: Entity[] | string
): CustomCommandResult {
  const player = origin.sourceEntity as Player;
  if (!player) return { status: CustomCommandStatus.Failure };
  if (!isAdmin(player)) {
    player.sendMessage(color.red("只有管理员可以使用实体视角观察指令"));
    return { status: CustomCommandStatus.Failure, message: "权限不足" };
  }

  system.run(async () => {
    try {
      const cameraService = (await import("../../camera/services/camera")).default;

      if (!operation || operation.toLowerCase() === "stop") {
        // 停止观察
        const result = cameraService.stopObserving(player);
        if (typeof result === "string") {
          player.sendMessage(color.red(result));
        }
        return;
      }

      if (operation.toLowerCase() === "start") {
        // 开始观察
        if (
          !targetEntitiesOrPerspective ||
          !Array.isArray(targetEntitiesOrPerspective) ||
          targetEntitiesOrPerspective.length === 0
        ) {
          player.sendMessage(color.yellow("用法: /yuehua:camera start <实体选择器>"));
          player.sendMessage(color.gray("示例: /yuehua:camera start @p"));
          player.sendMessage(color.gray("示例: /yuehua:camera start @e[type=zombie]"));
          player.sendMessage(color.gray("示例: /yuehua:camera start @e[type=!player]"));
          return;
        }

        // 获取第一个目标实体（如果选择器返回多个实体，使用第一个）
        const targetEntity = targetEntitiesOrPerspective[0];

        // 检查实体是否有效
        try {
          if (!targetEntity || !targetEntity.id) {
            player.sendMessage(color.red("目标实体无效或已不存在"));
            return;
          }
        } catch (error) {
          player.sendMessage(color.red("目标实体无效或已不存在"));
          return;
        }

        // 开始观察
        const result = cameraService.startObserving(player, targetEntity);
        if (typeof result === "string") {
          player.sendMessage(color.red(result));
        } else if (targetEntitiesOrPerspective.length > 1) {
          player.sendMessage(
            color.yellow(`选择器匹配到 ${targetEntitiesOrPerspective.length} 个实体，已选择第一个实体进行观察`)
          );
        }
      } else if (operation.toLowerCase() === "next" || operation.toLowerCase() === "n") {
        // 切换到下一个视角
        const result = cameraService.switchToNextPerspective(player);
        if (typeof result === "string") {
          player.sendMessage(color.red(result));
        } else {
          const cameraServiceInternal = cameraService as any;
          const state = (cameraServiceInternal as any).observerStates?.get(player.id);
          if (state) {
            const perspectiveNames: Record<string, string> = {
              first_person: "第一人称",
              third_person: "第三人称（背后）",
            };
            player.sendMessage(
              color.green(`已切换到: ${perspectiveNames[state.perspectiveType] || state.perspectiveType}`)
            );
          } else {
            player.sendMessage(color.green("已切换到下一个视角"));
          }
        }
      } else {
        player.sendMessage(color.yellow("用法: /yuehua:camera <start|stop|next> [实体选择器]"));
        player.sendMessage(color.gray("start - 开始观察实体"));
        player.sendMessage(color.gray("stop - 停止观察"));
        player.sendMessage(color.gray("next - 切换到下一个视角（循环）"));
        player.sendMessage(color.gray("指定视角请使用: /yuehua:camera_perspective <first|third>"));
      }
    } catch (error) {
      player.sendMessage(color.red(`指令执行错误: ${(error as Error).message}`));
    }
  });

  return { status: CustomCommandStatus.Success };
}

export {};
