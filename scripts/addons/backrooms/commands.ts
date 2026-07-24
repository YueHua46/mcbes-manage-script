import {
  CommandPermissionLevel,
  CustomCommandError,
  CustomCommandErrorReason,
  CustomCommandParamType,
  CustomCommandStatus,
  Player,
  system,
  world,
  type CustomCommand,
  type CustomCommandOrigin,
  type CustomCommandRegistry,
  type CustomCommandResult,
  type Vector3,
} from "@minecraft/server";
import { returnPlayerFromBackrooms } from "./anomalies";
import { BACKROOMS_DIMENSION_ID } from "./constants";
import { ensureBackroomsLocationReady, teleportPlayerToBackrooms } from "./index";

function registerCommand(
  registry: CustomCommandRegistry,
  command: CustomCommand,
  handler: (origin: CustomCommandOrigin, players: Player[], location?: Vector3) => CustomCommandResult,
): void {
  try {
    registry.registerCommand(command, handler);
  } catch (error) {
    if (error instanceof CustomCommandError
      && (error.reason === CustomCommandErrorReason.RegistryReadOnly
        || error.reason === CustomCommandErrorReason.AlreadyRegistered)) return;
    throw error;
  }
}

function sendResult(origin: CustomCommandOrigin, message: string): void {
  const source = origin.sourceEntity;
  if (source instanceof Player) source.sendMessage(message);
  else console.info(`[Backrooms] ${message.replace(/§./g, "")}`);
}

function handleEnter(
  origin: CustomCommandOrigin,
  players: Player[],
  location?: Vector3,
): CustomCommandResult {
  if (!players.length) return { status: CustomCommandStatus.Failure, message: "没有匹配到在线玩家" };
  system.run(async () => {
    let succeeded = 0;
    for (const player of players) {
      try {
        if (location) {
          const destination = await ensureBackroomsLocationReady(location);
          player.teleport(destination, {
            dimension: player.dimension.id === BACKROOMS_DIMENSION_ID
              ? player.dimension
              : world.getDimension(BACKROOMS_DIMENSION_ID),
            keepVelocity: false,
          });
        } else {
          await teleportPlayerToBackrooms(player);
        }
        succeeded += 1;
      } catch (error) {
        console.warn(`[Backrooms] 传送 ${player.name} 失败：${String(error)}`);
      }
    }
    sendResult(origin, `§aBackrooms 传送完成：成功 ${succeeded}，失败 ${players.length - succeeded}`);
  });
  return { status: CustomCommandStatus.Success, message: "Backrooms 传送请求已提交" };
}

function handleExit(origin: CustomCommandOrigin, players: Player[]): CustomCommandResult {
  if (!players.length) return { status: CustomCommandStatus.Failure, message: "没有匹配到在线玩家" };
  system.run(() => {
    let succeeded = 0;
    for (const player of players) {
      try {
        if (returnPlayerFromBackrooms(player)) succeeded += 1;
      } catch (error) {
        console.warn(`[Backrooms] 救援 ${player.name} 失败：${String(error)}`);
      }
    }
    sendResult(origin, `§aBackrooms 救援完成：成功 ${succeeded}，跳过 ${players.length - succeeded}`);
  });
  return { status: CustomCommandStatus.Success, message: "Backrooms 救援请求已提交" };
}

system.beforeEvents.startup.subscribe((event) => {
  registerCommand(event.customCommandRegistry, {
    name: "yuehua:backrooms_tp",
    description: "将玩家送入独立的 Backrooms manifestation；可选坐标会收敛到安全落脚点。",
    permissionLevel: CommandPermissionLevel.GameDirectors,
    mandatoryParameters: [
      { type: CustomCommandParamType.PlayerSelector, name: "玩家选择器" },
    ],
    optionalParameters: [
      { type: CustomCommandParamType.Location, name: "目标坐标" },
    ],
  }, handleEnter);

  registerCommand(event.customCommandRegistry, {
    name: "yuehua:backrooms_exit",
    description: "将玩家从 Backrooms 救援到进入前的位置。",
    permissionLevel: CommandPermissionLevel.GameDirectors,
    mandatoryParameters: [
      { type: CustomCommandParamType.PlayerSelector, name: "玩家选择器" },
    ],
  }, handleExit);
});
