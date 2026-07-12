import { BlockVolume, Player, system, world } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import dimensionRegistry from "../../../features/dimension/services/dimension-registry";
import { CUSTOM_DIMENSION_POOL } from "../../../features/dimension/services/custom-dimension-pool";
import { color } from "../../../shared/utils/color";
import { openConfirmDialogForm, openDialogForm } from "../../../ui/components/dialog";

function locationText(location?: { x: number; y: number; z: number }): string {
  if (!location) return "未设置";
  return `${location.x.toFixed(1)}, ${location.y.toFixed(1)}, ${location.z.toFixed(1)}`;
}

const INITIAL_PLATFORM_LOCATION = { x: 8.5, y: 100, z: 8.5 };

function isLegacyFailedPlatformLocation(location?: { x: number; y: number; z: number }): boolean {
  return !!location && location.x === 0.5 && location.y === 100 && location.z === 0.5;
}

async function initializePlatformAndTeleport(
  player: Player,
  alias: string,
  dimensionId: string,
  displayName: string
): Promise<void> {
  const dimension = world.getDimension(dimensionId);
  const destination = INITIAL_PLATFORM_LOCATION;
  const manager = world.tickingAreaManager;
  const identifier = `cm_dim_${alias}_${Date.now()}`;
  const options = {
    dimension,
    from: { x: 0, y: dimension.heightRange.min, z: 0 },
    to: { x: 15, y: dimension.heightRange.max - 1, z: 15 },
  };

  try {
    if (!manager.hasCapacity(options)) throw new Error("服务器临时常加载区数量已满");
    await manager.createTickingArea(identifier, options);

    let lastError: unknown;
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        dimension.fillBlocks(
          new BlockVolume({ x: 6, y: 99, z: 6 }, { x: 10, y: 99, z: 10 }),
          "minecraft:stone"
        );
        dimensionRegistry.setRegisteredDimensionSpawn(alias, destination, player.getRotation());
        player.teleport(destination, { dimension, keepVelocity: false });
        player.sendMessage(color.green(`已预加载区块、创建安全平台并进入 ${displayName}`));
        return;
      } catch (error) {
        lastError = error;
        await system.waitTicks(1);
      }
    }
    throw lastError ?? new Error("目标区块加载超时");
  } catch (error) {
    player.sendMessage(color.red(`落脚平台创建失败，未执行传送: ${(error as Error).message}`));
  } finally {
    try {
      if (manager.hasTickingArea(identifier)) manager.removeTickingArea(identifier);
    } catch {
      console.warn(`[CustomDimension] 临时常加载区 ${identifier} 清理失败`);
    }
  }
}

export function openCustomDimensionManageForm(player: Player, back: () => void): void {
  const form = new ActionFormData().title("自定义维度管理");
  form.body(
    "插件已预注册 5 个虚空维度。先进入详情设置默认传送点，再使用 /yuehua:dimension_tp 交给命令方块传送玩家。"
  );
  for (const item of CUSTOM_DIMENSION_POOL) {
    const record = dimensionRegistry.getRegisteredDimension(item.alias);
    form.button(
      `${record?.displayName ?? item.displayName}\n${item.alias} · 默认点 ${locationText(record?.spawn)}`,
      "textures/icons/checkpoint"
    );
  }
  form.button("返回", "textures/icons/back");
  form.show(player).then((response) => {
    if (response.canceled) return;
    if (response.selection === CUSTOM_DIMENSION_POOL.length) return back();
    const item = CUSTOM_DIMENSION_POOL[response.selection ?? -1];
    if (item) openCustomDimensionDetailForm(player, item.alias, back);
  });
}

function openCustomDimensionDetailForm(player: Player, alias: string, back: () => void): void {
  const record = dimensionRegistry.getRegisteredDimension(alias);
  const poolItem = CUSTOM_DIMENSION_POOL.find((item) => item.alias === alias);
  if (!record || !poolItem) {
    openDialogForm(player, { title: "维度不可用", desc: color.red("维度登记尚未初始化，请完整重启世界后再试。") }, () =>
      openCustomDimensionManageForm(player, back)
    );
    return;
  }

  const form = new ActionFormData().title(record.displayName);
  form.body(
    `别名：${record.alias}\n真实 ID：${record.dimensionId}\n默认点：${locationText(record.spawn)}\n\n命令方块：/yuehua:dimension_tp @p ${record.alias}`
  );
  form.button("修改显示名称", "textures/icons/gear");
  form.button("将当前位置设为默认点", "textures/icons/checkpoint");
  form.button(
    record.spawn && !isLegacyFailedPlatformLocation(record.spawn) ? "测试传送到默认点" : "初始化落脚点并进入",
    "textures/icons/accept"
  );
  form.button("恢复默认配置", "textures/icons/deny");
  form.button("返回", "textures/icons/back");
  form.show(player).then((response) => {
    if (response.canceled) return;
    switch (response.selection) {
      case 0:
        openRenameDimensionForm(player, alias, back);
        break;
      case 1:
        try {
          dimensionRegistry.setRegisteredDimensionSpawnFromPlayer(alias, player);
          openDialogForm(player, { title: "设置成功", desc: color.green("已保存当前位置和朝向。") }, () =>
            openCustomDimensionDetailForm(player, alias, back)
          );
        } catch (error) {
          openDialogForm(player, { title: "设置失败", desc: color.red((error as Error).message) }, () =>
            openCustomDimensionDetailForm(player, alias, back)
          );
        }
        break;
      case 2:
        try {
          if (!record.spawn || isLegacyFailedPlatformLocation(record.spawn)) {
            void initializePlatformAndTeleport(player, alias, record.dimensionId, record.displayName);
            break;
          }
          const dimension = world.getDimension(record.dimensionId);
          player.teleport(record.spawn, {
            dimension,
            rotation: record.rotation,
            keepVelocity: false,
          });
          player.sendMessage(color.green(`已传送到 ${record.displayName}`));
        } catch (error) {
          openDialogForm(player, { title: "传送失败", desc: color.red((error as Error).message) }, () =>
            openCustomDimensionDetailForm(player, alias, back)
          );
        }
        break;
      case 3:
        openConfirmDialogForm(
          player,
          "恢复默认配置",
          "将恢复默认名称并清除默认传送点，维度内方块不会被清空。",
          () => {
            dimensionRegistry.resetRegisteredDimensionConfiguration(alias, poolItem.displayName);
            openCustomDimensionDetailForm(player, alias, back);
          },
          () => openCustomDimensionDetailForm(player, alias, back)
        );
        break;
      default:
        openCustomDimensionManageForm(player, back);
    }
  });
}

function openRenameDimensionForm(player: Player, alias: string, back: () => void): void {
  const record = dimensionRegistry.getRegisteredDimension(alias);
  if (!record) return openCustomDimensionManageForm(player, back);
  const form = new ModalFormData().title("修改维度名称");
  form.textField("显示名称", "例如：矿界", { defaultValue: record.displayName });
  form.submitButton("保存");
  form.show(player).then((response) => {
    if (response.canceled || !response.formValues) return openCustomDimensionDetailForm(player, alias, back);
    try {
      dimensionRegistry.updateRegisteredDimensionDisplayName(alias, String(response.formValues[0] ?? ""));
      openCustomDimensionDetailForm(player, alias, back);
    } catch (error) {
      openDialogForm(player, { title: "修改失败", desc: color.red((error as Error).message) }, () =>
        openRenameDimensionForm(player, alias, back)
      );
    }
  });
}
