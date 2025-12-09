/**
 * 实体视角观察系统服务
 * 允许玩家以其他实体的视角进行观察（类似附身但没有控制权）
 */

import { Player, Entity, system, world, GameMode, EasingType } from "@minecraft/server";
import { color } from "../../../shared/utils/color";
import { useNotify } from "../../../shared/hooks/use-notify";

/**
 * 视角类型
 */
type PerspectiveType = "first_person" | "third_person";

/**
 * 观察者状态信息
 */
interface ObserverState {
  player: Player;
  targetEntity: Entity;
  originalGameMode: GameMode;
  originalLocation: { x: number; y: number; z: number };
  originalDimension: string;
  intervalId: number;
  lastTargetLocation?: { x: number; y: number; z: number }; // 缓存上次目标位置
  lastTargetRotation?: { x: number; y: number }; // 缓存上次目标旋转
  cameraApiEnabled: boolean; // Camera API 是否启用（必须启用才能观察）
  perspectiveType: PerspectiveType; // 当前视角类型
}

/**
 * 视角类型到相机预设的映射
 * 注意：由于 Minecraft Bedrock API 的限制，我们使用 minecraft:free 预设
 * 并通过调整位置来实现不同的视角效果
 */
const PERSPECTIVE_PRESETS: Record<PerspectiveType, string[]> = {
  first_person: ["minecraft:free"], // 使用 free 预设，位置在实体头部
  third_person: ["minecraft:free"], // 使用 free 预设，位置在实体后方
};

/**
 * 存储所有正在观察的玩家状态
 */
const observerStates = new Map<string, ObserverState>();

/**
 * 将方向向量转换为旋转角度（pitch和yaw）
 * @param direction 归一化的方向向量
 * @returns 旋转角度，x为pitch（上下），y为yaw（左右），单位为度
 */
function directionToRotation(direction: { x: number; y: number; z: number }): { x: number; y: number } {
  // 计算 yaw（左右旋转）：从正Z轴开始逆时针
  const yawRad = Math.atan2(-direction.x, direction.z);
  const yaw = (yawRad * 180) / Math.PI;

  // 计算 pitch（上下旋转）：向上为正
  const pitchRad = -Math.asin(direction.y);
  const pitch = (pitchRad * 180) / Math.PI;

  return { x: pitch, y: yaw };
}

class CameraService {
  /**
   * 开始观察实体
   * @param player 观察者玩家
   * @param targetEntity 目标实体
   */
  startObserving(player: Player, targetEntity: Entity): string | void {
    // 检查玩家是否已经在观察
    if (observerStates.has(player.id)) {
      return "您已经在观察其他实体，请先退出当前观察模式";
    }

    // 检查目标实体是否有效
    try {
      if (!targetEntity || !targetEntity.id) {
        return "目标实体无效或已不存在";
      }
    } catch (error) {
      return "目标实体无效或已不存在";
    }

    // 检查目标实体是否是玩家自己
    if (targetEntity instanceof Player && targetEntity.id === player.id) {
      return "不能观察自己";
    }

    try {
      // 保存玩家原始状态
      const originalGameMode = player.getGameMode();
      const originalLocation = {
        x: player.location.x,
        y: player.location.y,
        z: player.location.z,
      };
      const originalDimension = player.dimension.id;

      // 设置玩家黑屏效果
      player.runCommand(`camera @s fade`);

      // 将玩家设置为旁观者模式
      player.setGameMode(GameMode.Spectator);

      // 延迟一小段时间确保游戏模式切换完成
      system.runTimeout(() => {
        try {
          // 检查玩家和目标实体是否有效
          try {
            if (!player.id || !targetEntity.id) {
              this.stopObserving(player);
              return;
            }
          } catch (error) {
            this.stopObserving(player);
            return;
          }

          // 传送到目标实体的视角位置（头部位置减去玩家眼睛高度）
          // 玩家的视角高度是在传送位置基础上加上约1.6格（玩家眼睛高度）
          // 所以需要将玩家传送到头部位置减去1.6格的位置，这样视角才会在头部位置
          const targetDimension = targetEntity.dimension;
          let targetHeadLocation: { x: number; y: number; z: number };

          try {
            // 获取实体的头部位置
            const headLocation = targetEntity.getHeadLocation();
            targetHeadLocation = {
              x: headLocation.x,
              y: headLocation.y,
              z: headLocation.z,
            };
          } catch (error) {
            // 如果获取头部位置失败，使用实体位置（脚部位置）
            const targetLocation = targetEntity.location;
            targetHeadLocation = {
              x: targetLocation.x,
              y: targetLocation.y,
              z: targetLocation.z,
            };
          }

          // 玩家的眼睛高度约为1.6格（在传送位置基础上）
          // 所以需要将玩家传送到头部位置减去1.6格的位置
          const playerEyeHeight = 0;
          const observerBaseLocation = {
            x: targetHeadLocation.x,
            y: targetHeadLocation.y - playerEyeHeight,
            z: targetHeadLocation.z,
          };

          // 获取实体的视角方向，将观察者位置稍微往前移动
          // 默认使用第一人称视角位置
          let observerLocation: { x: number; y: number; z: number };
          let targetLookLocation: { x: number; y: number; z: number };

          try {
            // 使用 getViewDirection() 直接获取实体眼睛看向的方向向量
            // 这样可以准确同步实体的视角方向
            const targetViewDirection = targetEntity.getViewDirection();

            // 第一人称：稍微往前移动0.3格，避免看到实体的脸
            const offsetDistance = 0.3;
            observerLocation = {
              x: observerBaseLocation.x + targetViewDirection.x * offsetDistance,
              y: observerBaseLocation.y + targetViewDirection.y * offsetDistance,
              z: observerBaseLocation.z + targetViewDirection.z * offsetDistance,
            };

            // 计算目标实体正在看的位置
            const lookDistance = 10;
            targetLookLocation = {
              x: targetHeadLocation.x + targetViewDirection.x * lookDistance,
              y: targetHeadLocation.y + targetViewDirection.y * lookDistance,
              z: targetHeadLocation.z + targetViewDirection.z * lookDistance,
            };
          } catch (error) {
            // 如果获取视角方向失败，使用基础位置
            observerLocation = observerBaseLocation;
            targetLookLocation = {
              x: targetHeadLocation.x,
              y: targetHeadLocation.y,
              z: targetHeadLocation.z + 10,
            };
          }

          // 使用 Camera API 实现平滑过渡
          // 默认使用第一人称视角
          const defaultPerspective: PerspectiveType = "first_person";
          let cameraApiAvailable = false;

          try {
            // 尝试使用第一人称视角预设
            const presets = PERSPECTIVE_PRESETS[defaultPerspective];
            for (const preset of presets) {
              try {
                // 使用 getViewDirection() 获取实体眼睛看向的方向，然后转换为旋转角度
                // 这样可以准确同步实体的头部视角旋转（包括左右和上下），而不是身体旋转
                const targetViewDirection = targetEntity.getViewDirection();
                const targetRotation = directionToRotation(targetViewDirection);
                player.camera.setCamera(preset, {
                  location: observerLocation,
                  rotation: targetRotation, // 使用从视角方向推导的旋转角度
                  easeOptions: {
                    easeTime: 0.05, // 极短的过渡时间（约1 tick），实现平滑但及时的更新
                    easeType: EasingType.Linear, // 使用线性过渡，最自然
                  },
                });
                cameraApiAvailable = true;
                break; // 成功设置，退出循环
              } catch (presetError) {
                // 当前预设不可用，尝试下一个
                console.error(`相机预设 ${preset} 不可用:`, presetError);
                continue;
              }
            }
          } catch (cameraError) {
            // Camera API 完全不可用
            console.error("Camera API 初始化失败:", cameraError);
            cameraApiAvailable = false;
          }

          if (!cameraApiAvailable) {
            // Camera API 不可用，无法继续
            console.error("Camera API 不可用，无法开始观察");
            this.stopObserving(player);
            return "Camera API 不可用，无法开始观察。请检查是否启用了实验性功能。";
          }

          // 创建持续同步的定时器
          // 每1 tick执行一次，使用 Camera API 实现平滑的跟随效果
          const intervalId = system.runInterval(() => {
            try {
              // 检查玩家和目标实体是否仍然有效
              try {
                if (!player.id || !targetEntity.id) {
                  this.stopObserving(player);
                  return;
                }
              } catch (error) {
                this.stopObserving(player);
                return;
              }

              // 持续同步位置和视角
              // 使用 getHeadLocation() 获取头部位置，适配不同高度的实体
              let currentTargetHeadLocation: { x: number; y: number; z: number };
              try {
                const headLocation = targetEntity.getHeadLocation();
                currentTargetHeadLocation = {
                  x: headLocation.x,
                  y: headLocation.y,
                  z: headLocation.z,
                };
              } catch (error) {
                // 如果获取头部位置失败，使用实体位置（脚部位置）
                const targetLocation = targetEntity.location;
                currentTargetHeadLocation = {
                  x: targetLocation.x,
                  y: targetLocation.y,
                  z: targetLocation.z,
                };
              }

              const currentTargetDimension = targetEntity.dimension;
              const state = observerStates.get(player.id);

              // 玩家的眼睛高度约为1.6格（在传送位置基础上）
              // 所以需要将玩家传送到头部位置减去1.6格的位置
              const playerEyeHeight = 0;
              const observerBaseLocation = {
                x: currentTargetHeadLocation.x,
                y: currentTargetHeadLocation.y - playerEyeHeight,
                z: currentTargetHeadLocation.z,
              };

              // 计算观察者位置和目标朝向
              // 根据视角类型调整位置偏移
              let observerLocation: { x: number; y: number; z: number };
              let targetLookLocation: { x: number; y: number; z: number };

              // 检查 Camera API 是否启用（必须启用）
              if (!state || !state.cameraApiEnabled) {
                // Camera API 未启用，停止观察
                this.stopObserving(player);
                return;
              }

              try {
                // 使用 getViewDirection() 直接获取实体眼睛看向的方向向量
                // 这样可以准确同步实体的视角方向
                const targetViewDirection = targetEntity.getViewDirection();

                // 根据视角类型计算不同的位置偏移
                let offsetDistance = 0.3; // 默认偏移距离
                let heightOffset = 0; // 高度偏移
                if (state.perspectiveType === "first_person") {
                  // 第一人称：位置在实体头部，稍微往前
                  offsetDistance = 0.3;
                  heightOffset = 0;
                } else if (state.perspectiveType === "third_person") {
                  // 第三人称（背后）：位置在实体后方，更远且稍高
                  offsetDistance = -4.0; // 负值表示后方，距离更远
                  heightOffset = 1.0; // 高度偏移，让视角稍高
                }

                observerLocation = {
                  x: observerBaseLocation.x + targetViewDirection.x * offsetDistance,
                  y: observerBaseLocation.y + targetViewDirection.y * offsetDistance + heightOffset,
                  z: observerBaseLocation.z + targetViewDirection.z * offsetDistance,
                };

                // 计算目标实体正在看的位置
                const lookDistance = 10;
                targetLookLocation = {
                  x: currentTargetHeadLocation.x + targetViewDirection.x * lookDistance,
                  y: currentTargetHeadLocation.y + targetViewDirection.y * lookDistance,
                  z: currentTargetHeadLocation.z + targetViewDirection.z * lookDistance,
                };
              } catch (error) {
                // 如果获取视角方向失败，使用基础位置
                observerLocation = observerBaseLocation;
                targetLookLocation = {
                  x: currentTargetHeadLocation.x,
                  y: currentTargetHeadLocation.y,
                  z: currentTargetHeadLocation.z + 10,
                };
              }

              // 如果维度不同，需要先切换到新维度
              if (player.dimension.id !== currentTargetDimension.id) {
                // 维度切换时需要传送玩家，但视角仍由 Camera API 控制
                try {
                  player.teleport(observerLocation, {
                    dimension: currentTargetDimension,
                  });
                } catch (teleportError) {
                  // 忽略错误，继续尝试设置相机
                }
              }

              // 使用 Camera API 实现平滑位置和旋转更新
              // 根据当前视角类型使用对应的相机预设
              // 每 tick 都平滑更新，确保最流畅的跟随效果
              try {
                const presets = PERSPECTIVE_PRESETS[state.perspectiveType];
                let cameraSet = false;

                for (const preset of presets) {
                  try {
                    // 使用 getViewDirection() 获取实体眼睛看向的方向，然后转换为旋转角度
                    // 这样可以准确同步实体的头部视角旋转（包括左右和上下），而不是身体旋转
                    const targetViewDirection = targetEntity.getViewDirection();
                    const targetRotation = directionToRotation(targetViewDirection);
                    player.camera.setCamera(preset, {
                      location: observerLocation,
                      rotation: targetRotation, // 使用从视角方向推导的旋转角度
                      easeOptions: {
                        easeTime: 0.05, // 极短的过渡时间（约等于 1 tick），实现平滑但及时的更新
                        easeType: EasingType.Linear, // 使用线性过渡，最自然
                      },
                    });
                    cameraSet = true;
                    break; // 成功设置，退出循环
                  } catch (presetError) {
                    // 当前预设不可用，尝试下一个
                    continue;
                  }
                }

                if (!cameraSet) {
                  // 所有预设都失败，停止观察
                  console.error("Camera API 更新失败: 所有预设都不可用");
                  this.stopObserving(player);
                  return;
                }
              } catch (cameraError) {
                // Camera API 失败，停止观察
                console.error("Camera API 更新失败:", cameraError);
                this.stopObserving(player);
                return;
              }

              // 更新缓存
              if (state) {
                const targetLocation = targetEntity.location;
                state.lastTargetLocation = {
                  x: targetLocation.x,
                  y: targetLocation.y,
                  z: targetLocation.z,
                };
              }

              // 持续显示观察信息（每tick都更新，确保一直显示）
              try {
                // 获取实体的显示名称
                let targetDisplayName: string;
                if (targetEntity instanceof Player) {
                  // 如果是玩家，使用玩家名称
                  targetDisplayName = targetEntity.name;
                } else {
                  // 如果是其他实体，尝试使用本地化密钥获取名称
                  try {
                    const localizationKey = targetEntity.localizationKey;
                    // localizationKey 格式通常是 "entity.minecraft.zombie" 或类似
                    // 我们可以提取实体类型，或者直接使用 typeId
                    // 为了更好的显示，我们使用 typeId 作为后备
                    targetDisplayName = targetEntity.typeId || localizationKey || "未知实体";
                    // 如果 typeId 包含 "minecraft:"，去掉前缀
                    if (targetDisplayName.startsWith("minecraft:")) {
                      targetDisplayName = targetDisplayName.replace("minecraft:", "");
                    }
                  } catch (error) {
                    // 如果获取失败，使用 typeId
                    targetDisplayName = targetEntity.typeId || "未知实体";
                    if (targetDisplayName.startsWith("minecraft:")) {
                      targetDisplayName = targetDisplayName.replace("minecraft:", "");
                    }
                  }
                }

                // 每tick都更新 actionBar，确保一直显示
                player.onScreenDisplay.setActionBar(
                  color.aqua(`正在观察: ${color.yellow(targetDisplayName)}`) +
                    color.gray(" | 输入 ") +
                    color.yellow("/yuehua:camera stop") +
                    color.gray(" 退出")
                );
              } catch (error) {
                // 如果显示失败，忽略错误
              }

              // 视角旋转的同步由 Camera API 的 rotation 参数处理，直接使用实体的旋转角度
              // 更新旋转缓存（使用视角方向推导的角度，保持与相机同步）
              if (state) {
                try {
                  const targetViewDirection = targetEntity.getViewDirection();
                  const targetRotation = directionToRotation(targetViewDirection);
                  state.lastTargetRotation = {
                    x: targetRotation.x,
                    y: targetRotation.y,
                  };
                } catch (error) {
                  // 忽略错误
                }
              }
            } catch (error) {
              // 如果同步过程中出错，停止观察
              console.error("观察同步错误:", error);
              this.stopObserving(player);
            }
          }, 1); // 每1 tick执行一次，确保流畅

          // 保存观察状态
          observerStates.set(player.id, {
            player,
            targetEntity,
            originalGameMode,
            originalLocation,
            originalDimension,
            intervalId,
            cameraApiEnabled: cameraApiAvailable,
            perspectiveType: defaultPerspective,
          });

          // 显示提示信息
          let targetDisplayName: string;
          if (targetEntity instanceof Player) {
            targetDisplayName = targetEntity.name;
          } else {
            try {
              const localizationKey = targetEntity.localizationKey;
              targetDisplayName = targetEntity.typeId || localizationKey || "未知实体";
              if (targetDisplayName.startsWith("minecraft:")) {
                targetDisplayName = targetDisplayName.replace("minecraft:", "");
              }
            } catch (error) {
              targetDisplayName = targetEntity.typeId || "未知实体";
              if (targetDisplayName.startsWith("minecraft:")) {
                targetDisplayName = targetDisplayName.replace("minecraft:", "");
              }
            }
          }
          player.onScreenDisplay.setActionBar(
            color.aqua(`正在观察: ${color.yellow(targetDisplayName)}`) +
              color.gray(" | 输入 ") +
              color.yellow("/yuehua:camera stop") +
              color.gray(" 退出")
          );
          useNotify("chat", player, color.green(`已开始观察 ${color.yellow(targetDisplayName)}`));
        } catch (error) {
          // 如果初始化失败，恢复玩家状态
          try {
            player.setGameMode(originalGameMode);
            player.teleport(originalLocation, {
              dimension: world.getDimension(originalDimension),
            });
          } catch (restoreError) {
            console.error("恢复玩家状态失败:", restoreError);
          }
          return "开始观察失败: " + (error as Error).message;
        }
      }, 20); // 延迟20 ticks确保游戏模式切换完成
    } catch (error) {
      return "开始观察失败: " + (error as Error).message;
    }

    return undefined; // 成功
  }

  /**
   * 停止观察
   * @param player 观察者玩家
   */
  stopObserving(player: Player): string | void {
    const state = observerStates.get(player.id);
    if (!state) {
      return "您当前没有在观察任何实体";
    }

    try {
      // 清除定时器
      system.clearRun(state.intervalId);

      // 先恢复玩家原始游戏模式（退出旁观者模式）
      // 这很重要，因为 Camera API 在旁观者模式下可能行为不同
      try {
        player.setGameMode(state.originalGameMode);
      } catch (error) {
        // 如果恢复游戏模式失败，尝试设置为生存模式
        try {
          player.setGameMode(GameMode.Survival);
        } catch (fallbackError) {
          console.error("恢复游戏模式失败:", fallbackError);
        }
      }

      // 然后清除相机设置，恢复到默认视角
      // 在恢复游戏模式后清除相机，确保视角恢复正常
      // 无论是否使用了 Camera API，都尝试清除相机
      try {
        player.camera.clear();
      } catch (error) {
        // 如果清除相机失败，尝试恢复默认第一人称相机
        try {
          player.camera.setDefaultCamera("minecraft:first_person");
        } catch (defaultCameraError) {
          // 如果都失败，记录错误但不阻止流程
          console.error("清除相机失败:", error, "恢复默认相机也失败:", defaultCameraError);
        }
      }

      // 恢复玩家原始位置（延迟一小段时间确保游戏模式切换完成）
      system.runTimeout(() => {
        try {
          // 检查玩家是否有效
          try {
            if (player.id) {
              // 再次确保相机已清除（在恢复位置后）
              // 这很重要，因为在恢复位置时相机可能又被激活了
              try {
                player.camera.clear();
              } catch (error) {
                // 如果清除失败，尝试恢复默认相机
                try {
                  player.camera.setDefaultCamera("minecraft:first_person");
                } catch (defaultError) {
                  // 忽略错误，继续执行
                }
              }

              player.teleport(state.originalLocation, {
                dimension: world.getDimension(state.originalDimension),
              });

              // 确保 actionBar 被清除
              player.onScreenDisplay.setActionBar("");

              useNotify("chat", player, color.green("已退出观察模式"));
            }
          } catch (error) {
            // 玩家可能已离线
          }
        } catch (error) {
          console.error("恢复玩家位置失败:", error);
        }
      }, 5);

      // 额外延迟确保相机完全清除
      // 这对于确保视角完全恢复很重要
      system.runTimeout(() => {
        try {
          if (player.id) {
            // 最后一次清除相机，确保视角恢复正常
            try {
              player.camera.clear();
            } catch (error) {
              // 如果清除失败，尝试恢复默认相机
              try {
                player.camera.setDefaultCamera("minecraft:first_person");
              } catch (defaultError) {
                // 忽略所有错误
              }
            }
          }
        } catch (error) {
          // 忽略错误
        }
      }, 10);

      // 移除观察状态
      observerStates.delete(player.id);
    } catch (error) {
      return "停止观察失败: " + (error as Error).message;
    }

    return undefined; // 成功
  }

  /**
   * 检查玩家是否正在观察
   * @param player 玩家
   */
  isObserving(player: Player): boolean {
    return observerStates.has(player.id);
  }

  /**
   * 获取玩家正在观察的实体
   * @param player 玩家
   */
  getObservingTarget(player: Player): Entity | undefined {
    const state = observerStates.get(player.id);
    return state?.targetEntity;
  }

  /**
   * 切换观察视角
   * @param player 玩家
   * @param perspectiveType 视角类型
   */
  switchPerspective(player: Player, perspectiveType: PerspectiveType): string | void {
    const state = observerStates.get(player.id);
    if (!state) {
      return "您当前没有在观察任何实体";
    }

    if (!state.cameraApiEnabled) {
      return "Camera API 未启用，无法切换视角";
    }

    // 更新视角类型
    state.perspectiveType = perspectiveType;

    // 立即应用新的视角设置
    try {
      // 获取当前目标位置和朝向
      let currentTargetHeadLocation: { x: number; y: number; z: number };
      try {
        const headLocation = state.targetEntity.getHeadLocation();
        currentTargetHeadLocation = {
          x: headLocation.x,
          y: headLocation.y,
          z: headLocation.z,
        };
      } catch (error) {
        const targetLocation = state.targetEntity.location;
        currentTargetHeadLocation = {
          x: targetLocation.x,
          y: targetLocation.y,
          z: targetLocation.z,
        };
      }

      const playerEyeHeight = 0;
      const observerBaseLocation = {
        x: currentTargetHeadLocation.x,
        y: currentTargetHeadLocation.y - playerEyeHeight,
        z: currentTargetHeadLocation.z,
      };

      let observerLocation: { x: number; y: number; z: number };
      let targetLookLocation: { x: number; y: number; z: number };

      try {
        // 使用 getViewDirection() 直接获取实体眼睛看向的方向向量
        // 这样可以准确同步实体的视角方向
        const targetViewDirection = state.targetEntity.getViewDirection();

        // 根据视角类型计算不同的位置偏移
        let offsetDistance = 0.3; // 默认偏移距离
        let heightOffset = 0; // 高度偏移
        if (perspectiveType === "first_person") {
          // 第一人称：位置在实体头部，稍微往前
          offsetDistance = 0.3;
          heightOffset = 0;
        } else if (perspectiveType === "third_person") {
          // 第三人称（背后）：位置在实体后方，更远且稍高
          offsetDistance = -4.0; // 负值表示后方，距离更远
          heightOffset = 1.0; // 高度偏移，让视角稍高
        }

        observerLocation = {
          x: observerBaseLocation.x + targetViewDirection.x * offsetDistance,
          y: observerBaseLocation.y + targetViewDirection.y * offsetDistance + heightOffset,
          z: observerBaseLocation.z + targetViewDirection.z * offsetDistance,
        };

        const lookDistance = 10;
        targetLookLocation = {
          x: currentTargetHeadLocation.x + targetViewDirection.x * lookDistance,
          y: currentTargetHeadLocation.y + targetViewDirection.y * lookDistance,
          z: currentTargetHeadLocation.z + targetViewDirection.z * lookDistance,
        };
      } catch (error) {
        observerLocation = observerBaseLocation;
        targetLookLocation = {
          x: currentTargetHeadLocation.x,
          y: currentTargetHeadLocation.y,
          z: currentTargetHeadLocation.z + 10,
        };
      }

      // 应用新的相机预设
      const presets = PERSPECTIVE_PRESETS[perspectiveType];
      let cameraSet = false;

      for (const preset of presets) {
        try {
          // 使用 getViewDirection() 获取实体眼睛看向的方向，然后转换为旋转角度
          // 这样可以准确同步实体的头部视角旋转（包括左右和上下），而不是身体旋转
          const targetViewDirection = state.targetEntity.getViewDirection();
          const targetRotation = directionToRotation(targetViewDirection);
          player.camera.setCamera(preset, {
            location: observerLocation,
            rotation: targetRotation, // 使用从视角方向推导的旋转角度
            easeOptions: {
              easeTime: 0.1, // 稍长的过渡时间，让切换更平滑
              easeType: EasingType.Linear,
            },
          });
          cameraSet = true;
          break;
        } catch (presetError) {
          continue;
        }
      }

      if (!cameraSet) {
        return `无法切换到 ${perspectiveType} 视角：相机预设不可用`;
      }
    } catch (error) {
      return "切换视角失败: " + (error as Error).message;
    }

    return undefined; // 成功
  }

  /**
   * 切换到下一个视角（循环切换）
   * @param player 玩家
   */
  switchToNextPerspective(player: Player): string | void {
    const state = observerStates.get(player.id);
    if (!state) {
      return "您当前没有在观察任何实体";
    }

    const perspectives: PerspectiveType[] = ["first_person", "third_person"];
    const currentIndex = perspectives.indexOf(state.perspectiveType);
    const nextIndex = (currentIndex + 1) % perspectives.length;
    const nextPerspective = perspectives[nextIndex];

    return this.switchPerspective(player, nextPerspective);
  }

  /**
   * 通过选择器或名称查找实体
   * @param selector 选择器（如 @p, @e[type=zombie]）或实体名称
   * @param player 执行命令的玩家（用于 @p, @s 等选择器）
   */
  findEntityBySelector(selector: string, player: Player): Entity | string {
    try {
      // 如果是选择器
      if (selector.startsWith("@")) {
        // 替换 @s 为玩家名称
        let processedSelector = selector;
        if (selector.includes("@s")) {
          processedSelector = selector.replace("@s", player.name);
        }
        if (selector.includes("@p")) {
          processedSelector = selector.replace("@p", player.name);
        }

        // 尝试通过命令查找实体
        // 注意：这里我们使用一个变通方法，通过获取附近实体来匹配
        const dimension = player.dimension;
        const nearbyEntities = dimension.getEntities({
          location: player.location,
          maxDistance: 50, // 最大50格范围内
        });

        // 解析选择器
        if (selector.startsWith("@e")) {
          // 处理 @e[type=xxx] 格式
          const typeMatch = selector.match(/type=([^\]]+)/);
          if (typeMatch) {
            const entityType = typeMatch[1];
            const filtered = nearbyEntities.filter((e) => e.typeId === entityType);
            if (filtered.length > 0) {
              // 返回最近的实体
              filtered.sort((a, b) => {
                const distA = Math.sqrt(
                  Math.pow(a.location.x - player.location.x, 2) +
                    Math.pow(a.location.y - player.location.y, 2) +
                    Math.pow(a.location.z - player.location.z, 2)
                );
                const distB = Math.sqrt(
                  Math.pow(b.location.x - player.location.x, 2) +
                    Math.pow(b.location.y - player.location.y, 2) +
                    Math.pow(b.location.z - player.location.z, 2)
                );
                return distA - distB;
              });
              return filtered[0];
            }
          } else {
            // @e 没有类型限制，返回最近的实体（排除玩家自己）
            const filtered = nearbyEntities.filter((e) => e.id !== player.id);
            if (filtered.length > 0) {
              filtered.sort((a, b) => {
                const distA = Math.sqrt(
                  Math.pow(a.location.x - player.location.x, 2) +
                    Math.pow(a.location.y - player.location.y, 2) +
                    Math.pow(a.location.z - player.location.z, 2)
                );
                const distB = Math.sqrt(
                  Math.pow(b.location.x - player.location.x, 2) +
                    Math.pow(b.location.y - player.location.y, 2) +
                    Math.pow(b.location.z - player.location.z, 2)
                );
                return distA - distB;
              });
              return filtered[0];
            }
          }
        } else if (selector.startsWith("@p")) {
          // @p 选择最近的玩家（排除自己）
          const nearbyPlayers = nearbyEntities.filter((e) => e instanceof Player && e.id !== player.id) as Player[];
          if (nearbyPlayers.length > 0) {
            nearbyPlayers.sort((a, b) => {
              const distA = Math.sqrt(
                Math.pow(a.location.x - player.location.x, 2) +
                  Math.pow(a.location.y - player.location.y, 2) +
                  Math.pow(a.location.z - player.location.z, 2)
              );
              const distB = Math.sqrt(
                Math.pow(b.location.x - player.location.x, 2) +
                  Math.pow(b.location.y - player.location.y, 2) +
                  Math.pow(b.location.z - player.location.z, 2)
              );
              return distA - distB;
            });
            return nearbyPlayers[0];
          }
        }
      } else {
        // 如果是玩家名称
        const targetPlayer = world.getAllPlayers().find((p) => p.name === selector);
        if (targetPlayer) {
          return targetPlayer;
        }

        // 尝试在附近查找同名实体（通过nameTag）
        const dimension = player.dimension;
        const nearbyEntities = dimension.getEntities({
          location: player.location,
          maxDistance: 50,
        });
        const namedEntity = nearbyEntities.find((e) => e.nameTag === selector);
        if (namedEntity) {
          return namedEntity;
        }
      }

      return "找不到目标实体，请确保实体在您附近50格范围内";
    } catch (error) {
      return "查找实体时出错: " + (error as Error).message;
    }
  }

  /**
   * 清理所有观察状态（用于玩家离线等情况）
   */
  cleanup(): void {
    for (const [playerId, state] of observerStates.entries()) {
      try {
        // 检查玩家是否有效
        try {
          if (!state.player.id) {
            observerStates.delete(playerId);
            continue;
          }
        } catch (error) {
          observerStates.delete(playerId);
          continue;
        }

        // 检查目标实体是否有效
        try {
          if (!state.targetEntity.id) {
            this.stopObserving(state.player);
          }
        } catch (error) {
          this.stopObserving(state.player);
        }
      } catch (error) {
        // 如果清理失败，直接删除状态
        observerStates.delete(playerId);
      }
    }
  }
}

// 定期清理无效的观察状态
system.runInterval(() => {
  const cameraService = new CameraService();
  cameraService.cleanup();
}, 100); // 每5秒清理一次

export default new CameraService();
