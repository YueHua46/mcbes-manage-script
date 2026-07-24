/**
 * 随机传送服务
 * 完整迁移自 Modules/OtherFun/RandomTp.ts (36行)
 */

import { Dimension, Player, system, Vector3, world } from "@minecraft/server";
import { useNotify } from "../../../shared/hooks/use-notify";
import { MinecraftEffectTypes } from "@minecraft/vanilla-data";
import setting from "../../system/services/setting";
import landManager from "../../land/services/land-manager";
import { color } from "../../../shared/utils/color";
import { chargeTeleportCost, refundTeleportCost } from "../../economic/services/teleport-cost";

/**
 * 生成指定范围的随机数
 */
export const RandomNumber = (min: number, max: number): number => {
  return Math.floor(Math.random() * (max - min + 1) + min);
};

const MAX_RANDOM_TP_ATTEMPTS = 48;
const TEMP_TICKING_AREA_PREFIX = "cm_rtp";
const PARTICLE_TYPES = ["minecraft:mob_portal"];
const activeRandomTeleportPlayers = new Set<string>();

interface RandomLocationResult {
  target: Vector3;
  dimension: Dimension;
  tickingAreaId: string;
}

function getChunkStart(value: number): number {
  return Math.floor(value / 16) * 16;
}

function createTemporaryTickingAreaId(dimension: Dimension, attempt: number): string {
  const dimensionName = dimension.id.replace(/[^a-zA-Z0-9_]/g, "_").slice(-24);
  return `${TEMP_TICKING_AREA_PREFIX}_${dimensionName}_${Date.now()}_${attempt}_${RandomNumber(0, 9999)}`;
}

async function createTemporaryTickingArea(
  dimension: Dimension,
  x: number,
  z: number,
  attempt: number
): Promise<string | undefined> {
  const manager = world.tickingAreaManager;
  const chunkX = getChunkStart(x);
  const chunkZ = getChunkStart(z);
  const options = {
    dimension,
    from: { x: chunkX, y: dimension.heightRange.min, z: chunkZ },
    to: { x: chunkX + 15, y: dimension.heightRange.max - 1, z: chunkZ + 15 },
  };

  if (!manager.hasCapacity(options)) return undefined;

  const identifier = createTemporaryTickingAreaId(dimension, attempt);
  await manager.createTickingArea(identifier, options);
  return identifier;
}

function removeTemporaryTickingArea(identifier: string): void {
  try {
    const manager = world.tickingAreaManager;
    if (manager.hasTickingArea(identifier)) {
      manager.removeTickingArea(identifier);
    }
  } catch {
    // 临时加载区释放失败不应影响玩家传送结果。
  }
}

function findSurfaceTargetOutsideLand(
  dimension: Dimension,
  x: number,
  z: number,
  minY: number,
  maxY: number
): Vector3 | undefined {
  for (let y = maxY - 1; y > minY + 1; y--) {
    const block = dimension.getBlock({ x, y, z });
    if (!block || block.isAir) continue;

    const target = { x: x + 0.5, y: y + 1, z: z + 0.5 };
    const { isInside } = landManager.testLand(target, dimension.id);
    if (isInside) return undefined;

    return target;
  }

  return undefined;
}

function isPlayerAvailable(player: Player): boolean {
  try {
    return !!player.location;
  } catch {
    return false;
  }
}

function hasPlayerMoved(player: Player, startLocation: Vector3, startDimension: Dimension): boolean {
  try {
    if (player.dimension.id !== startDimension.id) return true;

    const currentLocation = player.location;
    return (
      Math.abs(currentLocation.x - startLocation.x) > 0.5 ||
      Math.abs(currentLocation.y - startLocation.y) > 0.5 ||
      Math.abs(currentLocation.z - startLocation.z) > 0.5
    );
  } catch {
    return true;
  }
}

function createProgressiveParticles(
  player: Player,
  location: Vector3,
  intensity: number,
  isPostTeleport: boolean
): void {
  if (!isPlayerAvailable(player)) return;

  if (isPostTeleport) {
    createPostTeleportParticles(player, location, intensity);
  } else {
    createPreTeleportParticles(player, location, intensity);
  }
}

function createPreTeleportParticles(player: Player, location: Vector3, intensity: number): void {
  const particleBaseCount = 10;
  const particleCount = Math.floor(particleBaseCount + particleBaseCount * 10 * intensity);
  const bodyHeight = 1.8;
  const maxRadius = 1.5;

  for (let i = 0; i < particleCount; i++) {
    const u = Math.random() * 2 - 1;
    const v = Math.random() * 2 * Math.PI;
    const radius = Math.cbrt(Math.random()) * maxRadius;
    const horizontalRadius = radius * Math.sqrt(1 - u * u);
    const x = location.x + horizontalRadius * Math.cos(v);
    const z = location.z + horizontalRadius * Math.sin(v);
    const y = location.y + 0.5 + Math.random() * bodyHeight;

    try {
      player.spawnParticle(PARTICLE_TYPES[Math.floor(Math.random() * PARTICLE_TYPES.length)], { x, y, z });
    } catch {
      // 粒子失败不影响传送流程。
    }
  }
}

function createPostTeleportParticles(player: Player, location: Vector3, intensity: number): void {
  const particleBaseCount = 10;
  const particleCount = Math.floor(particleBaseCount + particleBaseCount * 10 * intensity);
  const bodyHeight = 1.8 * intensity;
  const maxRadius = 1.5 * intensity;

  for (let i = 0; i < particleCount; i++) {
    const u = Math.random() * 2 - 1;
    const v = Math.random() * 2 * Math.PI;
    const radius = Math.cbrt(Math.random()) * maxRadius;
    const horizontalRadius = radius * Math.sqrt(1 - u * u);
    const x = location.x + horizontalRadius * Math.cos(v);
    const z = location.z + horizontalRadius * Math.sin(v);
    const y = location.y + 0.5 + Math.random() * bodyHeight;

    try {
      player.spawnParticle(PARTICLE_TYPES[Math.floor(Math.random() * PARTICLE_TYPES.length)], { x, y, z });
    } catch {
      // 粒子失败不影响传送流程。
    }
  }
}

function applyRandomTeleportBuffs(player: Player): void {
  const addEffects: MinecraftEffectTypes[] = [
    MinecraftEffectTypes.FireResistance,
    MinecraftEffectTypes.NightVision,
    MinecraftEffectTypes.Resistance,
  ];

  addEffects.forEach((effect) => {
    player.addEffect(effect, 600, {
      showParticles: false,
      amplifier: 255,
    });
  });
}

function startPostTeleportEffects(player: Player, target: Vector3): void {
  if (!isPlayerAvailable(player)) return;

  createProgressiveParticles(player, target, 1.0, true);

  try {
    player.playSound("mob.endermen.portal");
  } catch {
    try {
      player.playSound("mob.endermen.teleport");
    } catch {
      // 静默处理音效失败。
    }
  }

  try {
    player.onScreenDisplay.setTitle("§a传送成功！", {
      fadeInDuration: 5,
      stayDuration: 40,
      fadeOutDuration: 5,
    });
    player.onScreenDisplay.setActionBar(
      color.green(
        `随机传送成功：${color.yellow(`${Math.floor(target.x)} ${Math.floor(target.y)} ${Math.floor(target.z)}`)}`
      )
    );
    useNotify(
      "chat",
      player,
      color.green(
        `随机传送成功：${color.yellow(`${Math.floor(target.x)} ${Math.floor(target.y)} ${Math.floor(target.z)}`)}`
      )
    );
  } catch {
    // 忽略 UI 更新错误。
  }

  let fadeIntensity = 1.0;
  const fadeInterval = system.runInterval(() => {
    try {
      if (!isPlayerAvailable(player)) {
        system.clearRun(fadeInterval);
        return;
      }

      createProgressiveParticles(player, target, fadeIntensity, true);
      fadeIntensity -= 0.1;

      if (fadeIntensity <= 0) {
        system.clearRun(fadeInterval);
      }
    } catch {
      system.clearRun(fadeInterval);
    }
  }, 10);
}

async function findRandomLocationOutsideLand(player: Player, range: number): Promise<RandomLocationResult | undefined> {
  const dimension = player.dimension as Dimension;
  const minY = dimension.heightRange.min;
  const maxY = dimension.heightRange.max;

  for (let attempt = 0; attempt < MAX_RANDOM_TP_ATTEMPTS; attempt++) {
    const x = RandomNumber(-range, range);
    const z = RandomNumber(-range, range);
    let tickingAreaId: string | undefined;

    try {
      tickingAreaId = await createTemporaryTickingArea(dimension, x, z, attempt);
      if (!tickingAreaId) continue;

      const target = findSurfaceTargetOutsideLand(dimension, x, z, minY, maxY);
      if (target) return { target, dimension, tickingAreaId };
    } catch {
      // 该候选点无法加载或读取，继续尝试下一个随机点。
    }

    if (tickingAreaId) {
      removeTemporaryTickingArea(tickingAreaId);
    }
  }

  return undefined;
}

function startRandomTeleportCountdown(player: Player, result: RandomLocationResult): void {
  const startLocation = player.location;
  const startDimension = player.dimension;
  let cleanedUp = false;
  let countdownInterval: number | undefined;

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    removeTemporaryTickingArea(result.tickingAreaId);
    activeRandomTeleportPlayers.delete(player.name);
  };

  let particleIntensity = 0.0;
  const particleStep = 0.03;
  const particleInterval = system.runInterval(() => {
    try {
      if (!isPlayerAvailable(player)) {
        system.clearRun(particleInterval);
        if (countdownInterval !== undefined) system.clearRun(countdownInterval);
        cleanup();
        return;
      }

      if (hasPlayerMoved(player, startLocation, startDimension) && particleIntensity > 0.1) {
        system.clearRun(particleInterval);
        if (countdownInterval !== undefined) system.clearRun(countdownInterval);
        player.onScreenDisplay.setTitle("");
        player.onScreenDisplay.setActionBar(color.red("传送已取消：检测到移动"));
        player.playSound("random.pop");
        cleanup();
        return;
      }

      const currentPlayerLocation = player.location;
      particleIntensity = Math.min(1.0, particleIntensity + particleStep);
      createProgressiveParticles(player, currentPlayerLocation, particleIntensity, false);
    } catch {
      system.clearRun(particleInterval);
      if (countdownInterval !== undefined) system.clearRun(countdownInterval);
      cleanup();
    }
  }, 2);

  let countdown = 3;
  countdownInterval = system.runInterval(() => {
    try {
      if (!isPlayerAvailable(player)) {
        system.clearRun(countdownInterval!);
        system.clearRun(particleInterval);
        cleanup();
        return;
      }

      if (hasPlayerMoved(player, startLocation, startDimension) && countdown < 3) {
        system.clearRun(countdownInterval!);
        system.clearRun(particleInterval);
        player.onScreenDisplay.setTitle("");
        player.onScreenDisplay.setActionBar(color.red("传送已取消：检测到移动"));
        player.playSound("random.pop");
        cleanup();
        return;
      }

      if (countdown > 0) {
        player.onScreenDisplay.setTitle(`§e${countdown}`, {
          fadeInDuration: 5,
          stayDuration: 20,
          fadeOutDuration: 5,
        });
        player.onScreenDisplay.setActionBar("§b正在随机传送... §7(请不要移动)");
        player.playSound("random.click");
        countdown--;
        return;
      }

      system.clearRun(countdownInterval!);
      system.clearRun(particleInterval);
      createProgressiveParticles(player, startLocation, 1.0, false);

      system.run(() => {
        const chargeError = chargeTeleportCost(player, "randomTeleportCost", "随机传送");
        if (chargeError) {
          player.onScreenDisplay.setTitle("");
          player.onScreenDisplay.setActionBar(color.red(chargeError));
          cleanup();
          return;
        }

        try {
          player.teleport(result.target, {
            dimension: result.dimension,
          });
          applyRandomTeleportBuffs(player);

          system.runTimeout(() => {
            try {
              startPostTeleportEffects(player, result.target);
            } finally {
              cleanup();
            }
          }, 1);
        } catch {
          refundTeleportCost(player, "randomTeleportCost", "随机传送失败退款");
          player.onScreenDisplay.setTitle("");
          player.onScreenDisplay.setActionBar(color.red("随机传送失败：目标区块传送失败，请稍后重试。"));
          try {
            player.playSound("random.break");
          } catch {
            // 忽略音效错误。
          }
          cleanup();
        }
      });
    } catch {
      system.clearRun(countdownInterval!);
      system.clearRun(particleInterval);
      cleanup();
    }
  }, 20);
}

/**
 * 随机传送玩家
 */
export const RandomTp = async (player: Player): Promise<void> => {
  const randomTeleport = setting.getState("randomTeleport");
  if (!randomTeleport) return;
  if (activeRandomTeleportPlayers.has(player.name)) {
    useNotify("actionbar", player, "§e随机传送正在进行中，请稍候。");
    return;
  }

  activeRandomTeleportPlayers.add(player.name);

  const range = setting.getState("randomTpRange");
  const normalizedRange = Math.max(1, Math.floor(Math.abs(Number(range))));
  useNotify("actionbar", player, "§7正在寻找随机传送落点...");

  try {
    const result = await findRandomLocationOutsideLand(player, normalizedRange);
    if (!result) {
      activeRandomTeleportPlayers.delete(player.name);
      useNotify("actionbar", player, "§c随机传送失败：未找到不在领地内的落点，请稍后重试。");
      return;
    }

    startRandomTeleportCountdown(player, result);
  } catch {
    activeRandomTeleportPlayers.delete(player.name);
    useNotify("actionbar", player, "§c随机传送失败：落点加载失败，请稍后重试。");
  }
};
