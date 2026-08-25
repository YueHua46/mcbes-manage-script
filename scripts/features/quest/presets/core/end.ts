import type { QuestChapterDefinition, QuestDefinitionV2 } from "../../domain";
import { coreChapter, corePresetQuest, inventoryGoal, milestoneGoal } from "../builders";

export const coreEndChapter: QuestChapterDefinition = coreChapter({
  id: "core.end",
  title: "终末之战，不许眨眼",
  description: "水晶、龙息和那条盘旋的巨龙都在等你。这里任务不多，每一步都得有仪式感。",
  order: 6,
  unlockRule: { type: "quest", questId: "preset.core.eye.enter_end", status: "completed" },
  questIds: ["preset.core.end.kill_dragon", "preset.core.end.dragon_breath", "preset.core.end.gateway"],
});

export const coreEndQuests: QuestDefinitionV2[] = [
  corePresetQuest({
    id: "preset.core.end.kill_dragon",
    title: "这次轮到龙看字幕了",
    description: "由你参与并被系统可靠归因地击败末影龙。必须是真正的巨龙死亡事件，捡到龙息或经验不能冒领战绩。",
    completionMessage: "末影龙倒下，终末诗篇为你翻开。",
    chapterId: "core.end",
    order: 1,
    rarity: "legendary",
    reliability: "A",
    goals: [
      milestoneGoal("goal.kill_ender_dragon", "entity.kill", "击败末影龙", {
        filters: { entity: { op: "eq", value: "minecraft:ender_dragon" } },
        evidenceProviderId: "evidence.boss.ender_dragon.kill",
      }),
    ],
    gold: 3000,
    experience: 2000,
    requiredCapabilities: ["cap.event.entity.kill.v1"],
  }),
  corePresetQuest({
    id: "preset.core.end.dragon_breath",
    title: "巨龙吐息，装瓶带走",
    description: "让背包里出现至少一瓶龙息。靠近紫色吐息云时记得手快，玻璃瓶能装走它，护甲可装不走伤害。",
    completionMessage: "龙息封进瓶中，危险气氛成功打包。",
    chapterId: "core.end",
    order: 2,
    rarity: "rare",
    reliability: "A",
    goals: [inventoryGoal("goal.possess_dragon_breath", "selector.item.dragon_breath", 1, "背包中拥有一瓶龙息")],
    gold: 300,
    experience: 120,
    requiredCapabilities: ["cap.snapshot.inventory.v1"],
  }),
  corePresetQuest({
    id: "preset.core.end.gateway",
    title: "小黑洞，大远征",
    description: "击败末影龙后，亲自穿过末地折跃门抵达外岛区域。只有可靠的折跃或区域证据才算，扔珍珠摆拍不算。",
    completionMessage: "折跃完成，末地外岛向你展开。",
    chapterId: "core.end",
    order: 3,
    rarity: "epic",
    reliability: "B",
    goals: [
      milestoneGoal("goal.travel_end_gateway", "player.end_gateway_travel", "通过末地折跃门前往外岛", {
        backfillPolicy: "current_state",
        evidenceProviderId: "evidence.region.end_outer_islands",
      }),
    ],
    gold: 500,
    experience: 180,
    requiredCapabilities: ["cap.event.player.end_gateway_travel.v1"],
    unlockRule: { type: "quest", questId: "preset.core.end.kill_dragon", status: "completed" },
  }),
];
