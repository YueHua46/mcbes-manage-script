import { RawMessage, system, world } from "@minecraft/server";
import { welcomeFoxGlyphs, welcomeGlyphs } from "../glyphMap";
let serverName: string = "";

system.run(() => {
  serverName = world.getDynamicProperty("serverName") as string;
});

world.afterEvents.playerSpawn.subscribe(async (event) => {
  const { player } = event;

  const isJoin = player.getDynamicProperty("join") as boolean;
  if (isJoin) return;
  player.setDynamicProperty("join", true);
  await system.waitTicks(70);
  system.run(() => {
    player.onScreenDisplay.setTitle({
      text: "\n\n",
    });

    const left = `${welcomeGlyphs[1]}${welcomeGlyphs[8]}${welcomeGlyphs[6]}${welcomeGlyphs[7]}${welcomeGlyphs[4]}${welcomeGlyphs[2]}`;
    const right = `${welcomeGlyphs[3]}${welcomeGlyphs[4]}${welcomeGlyphs[7]}${welcomeGlyphs[6]}${welcomeGlyphs[8]}${welcomeGlyphs[0]}`;
    const fox = `${welcomeFoxGlyphs[0]}`;
    player.runCommand(
      `titleraw @s subtitle {"rawtext":[{"text":"${fox}\n\n${left} §d欢迎来到 ${right}\n§s${serverName ?? "服务器"}"}]}`
    );
    player.playSound("yuehua.welcome");
    // 发送相应提示
    const sendMessageRaw: RawMessage = {
      rawtext: [
        { text: "§a欢迎使用杜绝熊孩服务器插件~\n" },
        { text: "§a此插件由 §eYuehua §a制作，B站ID： §e月花zzZ\n" },
        { text: "§a管理员请输入命令 §b/tag @s add admin §a来获取服务器菜单管理员权限\n" },
      ],
    };
    player.sendMessage(sendMessageRaw);
  });
});

world.beforeEvents.playerLeave.subscribe((event) => {
  const { player } = event;
  player.setDynamicProperty("join", false);
});
