import { Player, system } from "@minecraft/server";
import { color } from "../../../shared/utils/color";
import { isAdmin, SystemLog } from "../../../shared/utils/common";

const COMPONENT_ID = "yuehua:log_inspector";

system.beforeEvents.startup.subscribe((init) => {
  try {
    init.itemComponentRegistry.registerCustomComponent(COMPONENT_ID, {
      onUseOn: (event) => {
        const player = event.source as Player;
        if (!player || player.typeId !== "minecraft:player") return;

        system.run(async () => {
          if (!isAdmin(player)) {
            player.sendMessage(color.red("只有管理员可以使用行为日志查询器。"));
            return;
          }

          const { openBehaviorLogBlockInspectorForm } = await import("../../../ui/forms/behavior-log");
          await openBehaviorLogBlockInspectorForm(player, event.block.dimension.id, event.block.location);
        });
      },
    });
  } catch (error) {
    SystemLog.warn(`[BehaviorLog] 行为日志查询器组件注册失败: ${error}`);
  }
});
