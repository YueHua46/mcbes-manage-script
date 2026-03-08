import { system, world } from "@minecraft/server";
import { openServerMenuForm } from "../ui/forms/server";
import * as tpaRequest from "../features/player/services/tpa-request";
import { teleportPlayer as tpaTeleport, notifyReject as tpaNotifyReject } from "../features/player/services/tpa-logic";
import { usePlayerByName } from "../shared/hooks/use-player";
import { color } from "../shared/utils/color";

world.beforeEvents.chatSend.subscribe((event) => {
  const { sender, message } = event;
  const trimmed = message.trim().toLowerCase();

  if (message === "服务器菜单") {
    system.run(() => {
      event.cancel = true;
      openServerMenuForm(sender);
    });
    return;
  }

  if (trimmed === "tpaccept" || trimmed === "tpreject") {
    event.cancel = true;
    system.run(() => {
      const pending = tpaRequest.takePendingRequest(sender.name);
      if (!pending) {
        sender.sendMessage(color.red("没有待处理的传送请求。"));
        return;
      }
      const requestPlayer = usePlayerByName(pending.requestPlayerName);
      if (trimmed === "tpaccept") {
        if (!requestPlayer) {
          sender.sendMessage(color.red("请求方已离线，无法完成传送。"));
          return;
        }
        tpaTeleport(requestPlayer, sender, pending.type);
      } else {
        if (requestPlayer) tpaNotifyReject(requestPlayer, sender);
        else sender.sendMessage(color.gray("已拒绝该传送请求。（请求方已离线）"));
      }
    });
  }
});
