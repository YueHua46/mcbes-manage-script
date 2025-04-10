import { system, world } from "@minecraft/server";
import setting from "./Setting";
import { useItems } from "../../hooks/hooks";
let isRunning = false;
system.runInterval(() => __awaiter(void 0, void 0, void 0, function* () {
    const killItemAmount = setting.getState("killItemAmount");
    if (isRunning)
        return;
    if (!killItemAmount)
        return;
    const items = useItems();
    if (items.length > Number(killItemAmount)) {
        isRunning = true;
        world.sendMessage(" §e服务器掉落物过多，即将在30秒后清理掉落物！");
        yield system.waitTicks(20 * 25);
        world.sendMessage(" §e即将在5秒后清理掉落物！");
        yield system.waitTicks(20 * 2);
        world.sendMessage(" §e3...");
        yield system.waitTicks(20 * 1);
        world.sendMessage(" §e2...");
        yield system.waitTicks(20 * 1);
        world.sendMessage(" §e1...");
        useItems().forEach((i) => i.kill());
        yield system.waitTicks(20 * 1);
        world.sendMessage(" §a掉落物清理完成");
        isRunning = false;
    }
}), 20);
//# sourceMappingURL=Events.js.map