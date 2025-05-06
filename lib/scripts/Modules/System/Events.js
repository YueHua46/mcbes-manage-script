import { system, world } from "@minecraft/server";
import setting from "./Setting";
import { useItems } from "../../hooks/hooks";
import { otherGlyphMap } from "../../glyphMap";
let isRunning = false;
system.runInterval(() => __awaiter(void 0, void 0, void 0, function* () {
    const killItemAmount = setting.getState("killItemAmount");
    if (isRunning)
        return;
    if (!killItemAmount)
        return;
    const items = useItems();
    const other = otherGlyphMap;
    if (items.length > Number(killItemAmount)) {
        isRunning = true;
        world.sendMessage(`${other.note} §e服务器掉落物过多，即将在30秒后清理掉落物！`);
        yield system.waitTicks(20 * 25);
        world.sendMessage(`${other.note} §e即将在5秒后清理掉落物！`);
        yield system.waitTicks(20 * 2);
        world.sendMessage(`${other.note} §e3...`);
        yield system.waitTicks(20 * 1);
        world.sendMessage(`${other.note} §e2...`);
        yield system.waitTicks(20 * 1);
        world.sendMessage(`${other.note} §e1...`);
        useItems().forEach((i) => i.kill());
        yield system.waitTicks(20 * 1);
        world.sendMessage(`${other.note} §a掉落物清理完成`);
        isRunning = false;
    }
}), 20);
//# sourceMappingURL=Events.js.map