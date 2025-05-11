import { world, Player } from "@minecraft/server"; // Bedrock 脚本 API :contentReference[oaicite:0]{index=0}
import economic from "./Economic"; // 你已封装的经济系统单例
import { monsterByGold } from "./data/monsterByGold";
import { colorCodes } from "../../utils/color";
// 订阅“实体死亡后”事件信号（AfterEvent，不可取消）:contentReference[oaicite:1]{index=1}
world.afterEvents.entityDie.subscribe((event) => {
    const dead = event.deadEntity; // 死去的实体对象 :contentReference[oaicite:2]{index=2}
    const dmgSrc = event.damageSource; // 导致其死亡的伤害来源 :contentReference[oaicite:3]{index=3}
    // 只有玩家直接击杀才发放金币
    const killer = dmgSrc === null || dmgSrc === void 0 ? void 0 : dmgSrc.damagingEntity;
    if (!(killer instanceof Player))
        return; // 不是玩家，忽略
    // 取得实体的短 ID，比如 "zombie"、"endermite" 等（去除命名空间前缀）
    const fullType = dead.typeId;
    const typeKey = fullType.includes(":") ? fullType.split(":")[1] : fullType;
    // 从配置表获取该怪物的金币掉落范围
    const range = monsterByGold[typeKey];
    if (!range)
        return; // 配表未定义则不发放
    const [minGold, maxGold] = range;
    if (maxGold <= 0)
        return; // 范围非正数则视为不掉落
    // 随机计算掉落金币数：floor(random * (max-min+1)) + min :contentReference[oaicite:4]{index=4}
    const reward = Math.floor(Math.random() * (maxGold - minGold + 1)) + minGold;
    // 添加金币到玩家钱包，并记录原因
    economic.addGold(killer.name, reward, `击杀 ${typeKey}`);
    // 向玩家发送反馈消息
    const message = {
        rawtext: [
            { text: `${colorCodes.materialDiamond}击杀了 ${colorCodes.materialRedstone}` },
            { translate: dead.localizationKey },
            {
                text: ` ${colorCodes.materialDiamond}获得了 ${colorCodes.materialGold}${reward} ${colorCodes.materialDiamond}金币`,
            },
        ],
    };
    // killer.runCommand(`title @s title ${colorCodes.aqua}`); // 发送消息 :contentReference[oaicite:5]{index=5}
    killer.runCommand(`title @s actionbar ${colorCodes.yellow}击杀了 ${colorCodes.materialRedstone}${typeKey} ${colorCodes.yellow}获得了 ${colorCodes.materialGold}${reward} ${colorCodes.yellow}金币`);
});
//# sourceMappingURL=MonsterKillReward.js.map