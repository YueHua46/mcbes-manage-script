import { world, Entity, Player, RawMessage } from "@minecraft/server"; // Bedrock 脚本 API :contentReference[oaicite:0]{index=0}
import economic from "./Economic"; // 你已封装的经济系统单例
import { monsterByGold } from "./data/monsterByGold";
import { colorCodes } from "../../utils/color";
import setting from "../System/Setting";

// 订阅"实体死亡后"事件信号（AfterEvent，不可取消）:contentReference[oaicite:1]{index=1}
world.afterEvents.entityDie.subscribe((event) => {
  // 如果经济系统关闭,直接返回
  if (!setting.getState("economy")) return;

  const { deadEntity, damageSource } = event;

  // 检查是否是玩家击杀
  if (damageSource.damagingEntity?.typeId === "minecraft:player") {
    const player = damageSource.damagingEntity as Player;
    const entityType = deadEntity.typeId;
    // console.warn(`击杀怪物 ${entityType}`);
    const fullType = deadEntity.typeId;
    const monsterName = fullType.includes(":") ? fullType.split(":")[1] : fullType;

    // 检查是否有对应的金币奖励
    const reward = monsterByGold[monsterName];
    if (reward) {
      // 随机生成奖励金额
      const min = reward[0] || 0;
      const max = reward[1] || min;
      const amount = Math.floor(Math.random() * (max - min + 1)) + min;
      // console.warn(`amount -> ${amount}`);
      if (amount > 0) {
        // 添加金币（应用每日限制）
        const actualEarned = economic.addGold(player.name, amount, `击杀怪物 ${monsterName}`);
        const wallet = economic.getWallet(player.name);
        // 今日金币获取未达到上限
        if (!(wallet.dailyEarned >= economic.getDailyGoldLimit())) {
          player.runCommand(
            `title @s actionbar ${colorCodes.yellow}击杀了 ${colorCodes.materialRedstone}${monsterName} ${colorCodes.yellow}获得了 ${colorCodes.materialGold}${amount} ${colorCodes.yellow}金币`
          );
        }
      }
    }
  }
});
