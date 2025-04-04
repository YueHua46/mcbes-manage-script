import { system, world } from "@minecraft/server";
let serverName = "";
system.run(() => {
    serverName = world.getDynamicProperty("serverName");
});
world.afterEvents.playerSpawn.subscribe((event) => {
    const { player } = event;
    const isJoin = player.getDynamicProperty("join");
    if (isJoin)
        return;
    player.setDynamicProperty("join", true);
    system.waitTicks(120).then((_) => {
        player.runCommand('titleraw @s title {"rawtext":[{"text":"\n\n"}]}');
        player.runCommand(`titleraw @s subtitle {"rawtext":[{"text":"\n\n §d欢迎来到 \n§s${serverName !== null && serverName !== void 0 ? serverName : "服务器"}"}]}`);
        player.playSound("yuehua.welcome", {
            location: player.location,
        });
    });
});
world.beforeEvents.playerLeave.subscribe((event) => {
    const { player } = event;
    player.setDynamicProperty("join", false);
});
//# sourceMappingURL=playerJoin.js.map