import { world, Entity, Player, RawMessage } from "@minecraft/server"; // Bedrock 脚本 API :contentReference[oaicite:0]{index=0}
import economic from "./Economic"; // 你已封装的经济系统单例
import { monsterByGold } from "./data/monsterByGold";
import { colorCodes } from "../../utils/color";

// 订阅"实体死亡后"事件信号（AfterEvent，不可取消）:contentReference[oaicite:1]{index=1}
world.afterEvents.entityDie.subscribe((event) => {
  const { deadEntity, damageSource } = event;

  // 检查是否是玩家击杀
  if (damageSource.damagingEntity?.typeId === "minecraft:player") {
    const player = damageSource.damagingEntity as Player;
    const entityType = deadEntity.typeId;
    console.warn(`击杀怪物 ${entityType}`);
    const fullType = deadEntity.typeId;
    const monsterName = fullType.includes(":") ? fullType.split(":")[1] : fullType;

    // 检查是否有对应的金币奖励
    const reward = monsterByGold[monsterName];
    if (reward) {
      // 随机生成奖励金额
      const min = reward[0] || 0;
      const max = reward[1] || min;
      const amount = Math.floor(Math.random() * (max - min + 1)) + min;
      console.warn(`amount -> ${amount}`);
      if (amount > 0) {
        // 添加金币（应用每日限制）
        const actualEarned = economic.addGold(player.name, amount, `击杀怪物 ${monsterName}`);

        // 如果实际获得的金币少于预期，说明达到了每日上限
        if (actualEarned < amount) {
          player.runCommand(
            `title @s actionbar ${colorCodes.yellow}击杀 ${colorCodes.materialRedstone}${monsterName} ${colorCodes.yellow}获得了 ${colorCodes.materialGold}${reward} ${colorCodes.yellow}金币`
          );
        } else {
          player.runCommand(
            `title @s actionbar ${colorCodes.yellow}击杀了 ${colorCodes.materialRedstone}${monsterName} ${colorCodes.yellow}获得了 ${colorCodes.materialGold}${reward} ${colorCodes.yellow}金币`
          );
        }
      }
    }
  }
});
