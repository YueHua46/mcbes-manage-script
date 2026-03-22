/**
 * 领地内飞行：通过 /ability mayfly 授予与收回；经济开启时按周期扣费（依赖教育版世界选项等）
 * 离开领地 AABB 时可配置宽限秒数，宽限内用 ActionBar 倒计时（避免 Title/Subtitle 大块背景），到期后再收回；其它收回路径仍立即收回。
 */

import { GameMode, InputPermissionCategory, Player, system, world } from "@minecraft/server";
import landManager from "./land-manager";
import setting from "../../system/services/setting";
import economic from "../../economic/services/economic";
import { isAdmin } from "../../../shared/utils/common";
import { color } from "../../../shared/utils/color";

const TICK_INTERVAL = 5;
/** 与基岩逻辑 tick 对齐，宽限结束用 currentTick 计算，避免与 Date.now 不同步 */
const TPS = 20;

interface LandFlightSession {
  dimensionId: string;
  /** 下次周期扣费时间（仅普通玩家且开启周期扣费时存在） */
  nextBillingAtMs?: number;
  phase: "normal" | "graceOutside";
  /** 宽限结束 tick（仅 phase === graceOutside；system.currentTick >= 此值时到期） */
  graceEndTick?: number;
  /** 上次已刷新的剩余秒数，用于每秒最多刷新一次 ActionBar */
  lastGraceRemainingSec?: number;
}

const sessions = new Map<string, LandFlightSession>();

/** 防止同一玩家并发多套「强制结束飞行」循环 */
const flightBreakRuns = new Set<string>();

const EDU_FAIL_MESSAGE =
  "§c当前存档未开启「Minecraft 教育版」相关功能，领地飞行无法使用。\n" +
  "§7请服主将服务器存档导出并导入到本地客户端，在编辑该世界时开启作弊，\n" +
  "§7在「无敌模式」或世界选项相关设置中，找到并打开「Minecraft Education 功能」\n" +
  "§7（部分版本在「教育」分类下，文案可能略有差异），保存世界后再将存档导回服务器端使用。";

function clampBillingIntervalSec(raw: number): number {
  if (!Number.isFinite(raw) || raw < 10) return 10;
  return Math.min(86400, Math.floor(raw));
}

function clampGold(raw: number): number {
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return Math.floor(raw);
}

/** 离开领地宽限：0～30 秒，0 表示立即收回 */
function clampLeaveGraceSec(raw: number): number {
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return Math.min(30, Math.floor(raw));
}

function getLandProbeLocation(player: Player) {
  return player.dimension.getBlock(player.location)?.location ?? player.location;
}

/**
 * 创造/旁观使用原版飞行，不依赖脚本授予的 mayfly。
 * 基岩版上对创造玩家执行 `ability mayfly false` 会关闭 mayfly，导致创造模式也无法飞行，故收回会话时跳过。
 */
function isCreativeOrSpectator(player: Player): boolean {
  try {
    const gm = player.getGameMode();
    return gm === GameMode.Creative || gm === GameMode.Spectator;
  } catch {
    return false;
  }
}

function setMayfly(player: Player, enabled: boolean): boolean {
  const cmd = enabled ? "ability @s mayfly true" : "ability @s mayfly false";
  try {
    const r = player.runCommand(cmd);
    const ok = r.successCount > 0;
    if (!ok) {
      console.warn(`[landFlight] ${cmd} 失败 (successCount=${r.successCount})`);
    }
    return ok;
  } catch (e) {
    console.warn(`[landFlight] ${cmd} 异常`, e);
    return false;
  }
}

/** 清掉领地飞行相关的 Title 与 ActionBar（宽限提示用 ActionBar，不用 Title/Subtitle，避免大块半透明底） */
function clearLandFlightHud(player: Player): void {
  try {
    player.onScreenDisplay.setTitle("", {
      fadeInDuration: 0,
      fadeOutDuration: 0,
      stayDuration: 0,
    });
  } catch {
    /* ignore */
  }
  try {
    player.onScreenDisplay.setActionBar("");
  } catch {
    /* ignore */
  }
}

/** 同列向下找地，贴地极短 teleport（仅兜底；mayfly 已 false 后仍卡飞时再用） */
function forceTeleportToGroundBelow(player: Player): void {
  try {
    const loc = player.location;
    const dim = player.dimension;
    const gx = Math.floor(loc.x);
    const gz = Math.floor(loc.z);
    let minY = -64;
    let maxY = 319;
    try {
      const hr = dim.heightRange;
      minY = hr.min;
      maxY = hr.max;
    } catch {
      /* ignore */
    }
    const startY = Math.min(Math.floor(loc.y), maxY - 1);
    for (let y = startY; y >= minY; y--) {
      const block = dim.getBlock({ x: gx, y, z: gz });
      if (block?.isSolid) {
        player.teleport({ x: loc.x, y: y + 1, z: loc.z }, { dimension: dim });
        return;
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * SAPI 无「取消飞行」写入接口；文档中 isFlying 只读。
 * 基岩版上 mayfly false 后客户端仍可能保持飞行态；通过短时关闭 Movement/Jump 输入
 *（文档：Jump 亦影响向上飞）打断滞空，生存/冒险间极短切换以刷新状态。
 * 注意：循环内不要重复 runCommand mayfly false，否则会多次弹出「已从你身上撤销 mayfly」；
 * mayfly 仅在 revoke 入口调用一次，此处只清速度 + 脉冲 + 兜底传送。
 */
function pulseMovementAndJumpOneTick(player: Player): void {
  const ip = player.inputPermissions;
  let movement = true;
  let jump = true;
  try {
    movement = ip.isPermissionCategoryEnabled(InputPermissionCategory.Movement);
    jump = ip.isPermissionCategoryEnabled(InputPermissionCategory.Jump);
  } catch {
    return;
  }
  try {
    ip.setPermissionCategory(InputPermissionCategory.Movement, false);
    ip.setPermissionCategory(InputPermissionCategory.Jump, false);
  } catch {
    return;
  }
  system.runTimeout(() => {
    try {
      if (!player.isValid) return;
      ip.setPermissionCategory(InputPermissionCategory.Movement, movement);
      ip.setPermissionCategory(InputPermissionCategory.Jump, jump);
    } catch {
      /* ignore */
    }
  }, 1);
}

/** 创造/旁观不处理，避免干扰原生飞行；生存↔冒险各 1 tick 再还原，促使服务端结束滞空飞 */
function pulseGameModeToBreakFlight(player: Player): void {
  let gm: GameMode;
  try {
    gm = player.getGameMode();
  } catch {
    return;
  }
  if (gm === GameMode.Creative || gm === GameMode.Spectator) {
    return;
  }
  const bridge = gm === GameMode.Survival ? GameMode.Adventure : GameMode.Survival;
  try {
    player.setGameMode(bridge);
    system.runTimeout(() => {
      try {
        if (player.isValid) {
          player.setGameMode(gm);
        }
      } catch {
        /* ignore */
      }
    }, 1);
  } catch {
    /* ignore */
  }
}

/**
 * 在若干 tick 内清速度；穿插输入脉冲与模式脉冲；仍卡飞再贴地传送。
 * mayfly 已在 revoke 入口执行过一次，此处不再重复 /ability，避免聊天刷屏「撤销 mayfly」。
 */
function scheduleForceExitLandFlight(player: Player): void {
  if (isCreativeOrSpectator(player)) {
    return;
  }
  const pid = player.id;
  if (flightBreakRuns.has(pid)) {
    return;
  }
  flightBreakRuns.add(pid);

  const MAX_TICKS = 40;
  let tick = 0;
  const runId = system.runInterval(() => {
    tick += 1;
    if (!player.isValid) {
      system.clearRun(runId);
      flightBreakRuns.delete(pid);
      return;
    }

    try {
      player.clearVelocity();
    } catch {
      /* ignore */
    }

    let still = false;
    try {
      still = player.isFlying || player.isGliding;
    } catch {
      system.clearRun(runId);
      flightBreakRuns.delete(pid);
      return;
    }

    if (!still) {
      system.clearRun(runId);
      flightBreakRuns.delete(pid);
      return;
    }

    if (tick === 2 || tick === 6 || tick === 14) {
      pulseMovementAndJumpOneTick(player);
    }
    if (tick === 4 || tick === 10) {
      pulseGameModeToBreakFlight(player);
    }
    if (tick === 20) {
      forceTeleportToGroundBelow(player);
    }
    if (tick >= MAX_TICKS) {
      forceTeleportToGroundBelow(player);
      try {
        player.clearVelocity();
      } catch {
        /* ignore */
      }
      system.clearRun(runId);
      flightBreakRuns.delete(pid);
    }
  }, 1);
}

/** 立即收回（换维、信任失效、金币不足、关功能、下线、死亡等） */
function revokeLandFlightImmediate(player: Player): void {
  sessions.delete(player.id);
  clearLandFlightHud(player);
  if (!isCreativeOrSpectator(player)) {
    setMayfly(player, false);
  }
  try {
    player.clearVelocity();
  } catch {
    /* ignore */
  }
  scheduleForceExitLandFlight(player);
}

/** 宽限到期：离开领地后的收回 */
function revokeLandFlightAfterGrace(player: Player): void {
  sessions.delete(player.id);
  clearLandFlightHud(player);
  if (!isCreativeOrSpectator(player)) {
    setMayfly(player, false);
  }
  try {
    player.clearVelocity();
  } catch {
    /* ignore */
  }
  player.sendMessage(color.green("领地飞行已结束。") + color.gray("（已离开领地范围）"));
  scheduleForceExitLandFlight(player);
}

/** 宽限倒计时每秒一响：滴答感，剩余秒数越少 pitch 略高 */
function playGraceCountdownTickSound(player: Player, remainingSec: number): void {
  try {
    const s = Math.max(1, Math.min(30, remainingSec));
    const pitch = 0.88 + (1 / s) * 0.85;
    player.playSound("random.click", { volume: 0.42, pitch: Math.min(pitch, 1.85) });
  } catch {
    /* ignore */
  }
}

/** 基岩 Title+Subtitle 共用大块背景；宽限提示用 ActionBar，配色偏警示 */
function showGraceCountdown(player: Player, remainingSec: number): void {
  try {
    const line =
      color.gold.bold("⚠ ") +
      color.yellow("已离开领地范围") +
      color.gray("  │  ") +
      color.white("飞行将在 ") +
      color.red.bold(String(remainingSec)) +
      color.white(" 秒后 ") +
      color.red("关闭");
    player.onScreenDisplay.setActionBar(line);
    playGraceCountdownTickSound(player, remainingSec);
  } catch {
    /* ignore */
  }
}

/** 距离下次周期扣费约多少秒；无会话、不扣费、宽限外或未到计时返回 null */
export function getSecondsUntilNextLandFlightBilling(player: Player): number | null {
  const s = sessions.get(player.id);
  if (!s || s.nextBillingAtMs === undefined) return null;
  if (s.phase === "graceOutside") return null;
  const left = Math.ceil((s.nextBillingAtMs - Date.now()) / 1000);
  return left > 0 ? left : 0;
}

/** 是否应在领地菜单展示「领地飞行」入口（地理 + 信任/管理员） */
export function canShowLandFlightEntry(player: Player): boolean {
  if (setting.getState("land") !== true) return false;
  if (setting.getState("landFlightEnabled") !== true) return false;
  const loc = getLandProbeLocation(player);
  const { isInside, insideLand } = landManager.testLand(loc, player.dimension.id);
  if (!isInside || !insideLand) return false;
  if (isAdmin(player)) return true;
  return landManager.isPlayerTrustedOnLand(insideLand, player.name);
}

/** 当前玩家是否站在指定领地内（与详情页领地一致） */
export function isPlayerStandingOnLand(player: Player, landName: string): boolean {
  const loc = getLandProbeLocation(player);
  const { isInside, insideLand } = landManager.testLand(loc, player.dimension.id);
  return Boolean(isInside && insideLand && insideLand.name === landName);
}

function endSessionForPlayer(player: Player, revokeAbility: boolean): void {
  if (!revokeAbility) {
    sessions.delete(player.id);
    return;
  }
  revokeLandFlightImmediate(player);
}

/**
 * 尝试开启领地飞行。
 * @returns 成功返回 undefined；失败返回可展示给玩家的错误文案（含颜色）
 */
export function tryStartLandFlightSession(player: Player): string | void {
  if (setting.getState("land") !== true) {
    return color.red("领地功能已关闭。");
  }
  if (setting.getState("landFlightEnabled") !== true) {
    return color.red("领地内飞行已关闭。");
  }

  const loc = getLandProbeLocation(player);
  const { isInside, insideLand } = landManager.testLand(loc, player.dimension.id);
  if (!isInside || !insideLand) {
    return color.red("你不在任何领地内，无法开启领地飞行。");
  }

  const admin = isAdmin(player);
  const trusted = admin || landManager.isPlayerTrustedOnLand(insideLand, player.name);
  if (!trusted) {
    return color.red("你没有权限在此领地使用飞行。");
  }

  if (sessions.has(player.id)) {
    return color.yellow("你已经在领地飞行中。离开领地或手动结束条件满足后会关闭。");
  }

  const useEconomy = setting.getState("landFlightUseEconomy") === true;
  const economyOn = setting.getState("economy") === true;
  if (useEconomy && !economyOn && !admin) {
    return color.red("已开启「飞行扣费」，但经济系统未启用。请管理员打开经济模块或关闭「领地飞行绑定经济」。");
  }

  const intervalSec = clampBillingIntervalSec(Number(setting.getState("landFlightBillingIntervalSec")));
  const goldPerInterval = clampGold(Number(setting.getState("landFlightGoldPerInterval")));
  const periodicCharge = useEconomy && economyOn && !admin && goldPerInterval > 0;

  if (periodicCharge) {
    if (!economic.hasEnoughGold(player.name, goldPerInterval)) {
      return color.red(
        `金币不足，至少需要 ${goldPerInterval} 金币才能开启（每个扣费周期都会扣这么多）。`
      );
    }
  }

  const probeOn = setMayfly(player, true);
  if (!probeOn) {
    player.sendMessage(EDU_FAIL_MESSAGE);
    if (admin) {
      player.sendMessage(color.gray("（管理员）亦请确认服务器已允许作弊，且脚本日志中无 ability 相关错误。"));
    }
    return color.red("领地飞行不可用：/ability 失败（详见聊天说明）");
  }
  // 创造/旁观勿执行 mayfly false：会撤销能力并导致创造模式也无法飞行
  if (!isCreativeOrSpectator(player)) {
    setMayfly(player, false);
    const finalOk = setMayfly(player, true);
    if (!finalOk) {
      player.sendMessage(EDU_FAIL_MESSAGE);
      return color.red("领地飞行开启失败（详见聊天说明）");
    }
  }

  const session: LandFlightSession = {
    dimensionId: player.dimension.id,
    phase: "normal",
  };
  if (periodicCharge) {
    session.nextBillingAtMs = Date.now() + intervalSec * 1000;
  }
  sessions.set(player.id, session);

  if (periodicCharge) {
    player.sendMessage(
      color.green("§a领地飞行已开启。") +
        `\n§7之后每 ${color.yellow(String(intervalSec))} §7秒扣除 ${color.gold(String(goldPerInterval))} §7金币；` +
        `§7余额不足以支付下一笔时，飞行将自动关闭并会提示你。` +
        `\n§7离开领地、换维度或死亡等也会结束飞行。`
    );
  } else if (admin) {
    player.sendMessage(
      color.green("§a领地飞行已开启。") +
        `\n§7管理员不扣金币。离开领地、换维度或死亡等会结束飞行。`
    );
  } else {
    player.sendMessage(
      color.green("§a领地飞行已开启。") +
        `\n§7当前为免费飞行（未开启扣费或每周期为 0）。离开领地、换维度或死亡等会结束飞行。`
    );
  }
}

export function initLandFlight(): void {
  system.runInterval(() => {
    const landOn = setting.getState("land") === true;
    const flightOn = setting.getState("landFlightEnabled") === true;

    if (!landOn || !flightOn) {
      if (sessions.size > 0) {
        for (const id of [...sessions.keys()]) {
          const p = world.getPlayers().find((pl) => pl.id === id);
          if (p) {
            revokeLandFlightImmediate(p);
          } else {
            sessions.delete(id);
          }
        }
      }
      return;
    }

    const now = Date.now();
    const intervalSec = clampBillingIntervalSec(Number(setting.getState("landFlightBillingIntervalSec")));
    const goldPerInterval = clampGold(Number(setting.getState("landFlightGoldPerInterval")));
    const useEconomy = setting.getState("landFlightUseEconomy") === true;
    const economyOn = setting.getState("economy") === true;
    const leaveGraceSec = clampLeaveGraceSec(Number(setting.getState("landFlightLeaveGraceSec")));

    for (const [playerId, sess] of [...sessions.entries()]) {
      const player = world.getPlayers().find((pl) => pl.id === playerId);
      if (!player) {
        sessions.delete(playerId);
        continue;
      }

      if (player.dimension.id !== sess.dimensionId) {
        revokeLandFlightImmediate(player);
        continue;
      }

      const loc = getLandProbeLocation(player);
      const { isInside, insideLand } = landManager.testLand(loc, player.dimension.id);
      const adm = isAdmin(player);

      const onTrustedLand =
        Boolean(isInside && insideLand) &&
        (adm || landManager.isPlayerTrustedOnLand(insideLand!, player.name));

      if (onTrustedLand) {
        if (sess.phase === "graceOutside") {
          sess.phase = "normal";
          sess.graceEndTick = undefined;
          sess.lastGraceRemainingSec = undefined;
          clearLandFlightHud(player);
        }

        const shouldBill = useEconomy && economyOn && !adm && goldPerInterval > 0;
        if (shouldBill && sess.nextBillingAtMs !== undefined && now >= sess.nextBillingAtMs) {
          const ok = economic.removeGold(player.name, goldPerInterval, "landFlight:billing");
          if (!ok) {
            revokeLandFlightImmediate(player);
            player.sendMessage(color.red("§c金币不足，领地飞行已关闭。请补充金币后再开启。"));
            continue;
          }
          sess.nextBillingAtMs = now + intervalSec * 1000;
        }
        continue;
      }

      if (isInside && insideLand && !adm && !landManager.isPlayerTrustedOnLand(insideLand, player.name)) {
        const inLeaveGrace =
          sess.phase === "graceOutside" &&
          sess.graceEndTick !== undefined &&
          system.currentTick < sess.graceEndTick;
        if (!inLeaveGrace) {
          revokeLandFlightImmediate(player);
          continue;
        }
      }

      if (leaveGraceSec === 0) {
        revokeLandFlightImmediate(player);
        continue;
      }

      if (sess.phase === "normal") {
        sess.phase = "graceOutside";
        sess.graceEndTick = system.currentTick + leaveGraceSec * TPS;
        sess.lastGraceRemainingSec = undefined;
      }

      if (sess.graceEndTick === undefined) {
        revokeLandFlightImmediate(player);
        continue;
      }

      if (system.currentTick >= sess.graceEndTick) {
        revokeLandFlightAfterGrace(player);
        continue;
      }

      const remaining = Math.max(0, Math.ceil((sess.graceEndTick - system.currentTick) / TPS));
      if (sess.lastGraceRemainingSec !== remaining) {
        sess.lastGraceRemainingSec = remaining;
        showGraceCountdown(player, remaining);
      }
    }
  }, TICK_INTERVAL);

  world.beforeEvents.playerLeave.subscribe((event) => {
    const { player } = event;
    if (sessions.has(player.id)) {
      endSessionForPlayer(player, true);
    }
  });

  /**
   * 生存/冒险下收回领地飞行会执行 mayfly false；若玩家之后用 /gamemode 等切到创造/旁观，
   * mayfly 仍为 false 会导致无法正常飞。切到创/旁观后补一次 mayfly true。
   */
  world.afterEvents.playerGameModeChange.subscribe((event) => {
    const { player, toGameMode } = event;
    if (toGameMode !== GameMode.Creative && toGameMode !== GameMode.Spectator) {
      return;
    }
    system.runTimeout(() => {
      try {
        if (!player.isValid) return;
        if (!isCreativeOrSpectator(player)) return;
        setMayfly(player, true);
      } catch {
        /* ignore */
      }
    }, 1);
  });

  world.afterEvents.entityDie.subscribe((event) => {
    const { deadEntity } = event;
    if (deadEntity.typeId === "minecraft:player") {
      const p = deadEntity as Player;
      if (sessions.has(p.id)) {
        endSessionForPlayer(p, true);
      }
    }
  });
}
