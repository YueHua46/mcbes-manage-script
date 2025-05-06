import { system, world } from "@minecraft/server";
import { welcomeFoxGlyphs, welcomeGlyphs } from "../glyphMap";
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
        const left = `${welcomeGlyphs[1]}${welcomeGlyphs[8]}${welcomeGlyphs[6]}${welcomeGlyphs[7]}${welcomeGlyphs[4]}${welcomeGlyphs[2]}`;
        const right = `${welcomeGlyphs[3]}${welcomeGlyphs[4]}${welcomeGlyphs[7]}${welcomeGlyphs[6]}${welcomeGlyphs[8]}${welcomeGlyphs[0]}`;
        const fox = `${welcomeFoxGlyphs[0]}`;
        player.runCommand(`titleraw @s subtitle {"rawtext":[{"text":"${fox}\n\n${left} §d欢迎来到 ${right}\n§s${serverName !== null && serverName !== void 0 ? serverName : "服务器"}"}]}`);
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