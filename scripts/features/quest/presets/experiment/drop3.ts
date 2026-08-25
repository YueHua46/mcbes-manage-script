import type { QuestChapterDefinition, QuestDefinitionV2, QuestPackDefinition } from "../../domain";
import { experimentChapter, experimentPresetQuest, inventoryGoal, milestoneGoal } from "../builders";

const PACK_ID = "preset.experiment.drop3" as const;
const CONTENT_CAP = "cap.content.minecraft.drop3_experiment.v1";
const GAMEPLAY_EXPERIMENT = "minecraft:drop_3";

export const experimentDrop3Chapter: QuestChapterDefinition = experimentChapter({
  id: "experiment.drop3",
  title: "26.40 试验田，先戴护目镜",
  description: "斑驳森林、废弃营地和实验家具都在这里；只有服务器可靠确认玩法实验后才会开放。",
  order: 1,
  unlockRule: { type: "capability", capabilityId: CONTENT_CAP },
  questIds: [
    "preset.experiment.drop3.dappled_forest",
    "preset.experiment.drop3.poplar",
    "preset.experiment.drop3.shelf_mushroom",
    "preset.experiment.drop3.red_shrub",
    "preset.experiment.drop3.camp",
    "preset.experiment.drop3.straw_bed",
    "preset.experiment.drop3.cushion",
  ],
});

const experimentRequirements = {
  requiredGameplayExperiments: [GAMEPLAY_EXPERIMENT],
};

export const experimentDrop3Quests: QuestDefinitionV2[] = [
  experimentPresetQuest({
    id: "preset.experiment.drop3.dappled_forest",
    title: "斑驳森林，颜色开始串台",
    description: "真正进入一次斑驳森林生物群系。站在相似树色旁边不算，必须由 biome Adapter 确认当前区域 identifier。",
    completionMessage: "斑驳森林已抵达，实验世界的调色盘正式上线。",
    chapterId: "experiment.drop3",
    order: 1,
    rarity: "rare",
    reliability: "B",
    goals: [
      milestoneGoal("goal.enter_dappled_forest", "player.biome_enter", "进入一次斑驳森林生物群系", {
        filters: { biome: { op: "eq", value: "minecraft:dappled_forest" } },
        backfillPolicy: "current_state",
        evidenceProviderId: "evidence.player.current_biome",
      }),
    ],
    gold: 150,
    experience: 50,
    requiredCapabilities: [CONTENT_CAP, "cap.event.player.biome_enter.v1"],
    ...experimentRequirements,
  }),
  experimentPresetQuest({
    id: "preset.experiment.drop3.poplar",
    title: "杨木到手，新树种报到",
    description: "让背包里出现至少一块杨木原木。必须匹配正式 Poplar log identifier，改名后的普通原木不算新品种。",
    completionMessage: "杨木原木已收好，木材收藏册又多了一页。",
    chapterId: "experiment.drop3",
    order: 2,
    rarity: "common",
    reliability: "A",
    goals: [inventoryGoal("goal.possess_poplar_log", "selector.item.poplar_log", 1, "背包中拥有至少一块杨木原木")],
    gold: 100,
    experience: 35,
    requiredCapabilities: [CONTENT_CAP, "cap.snapshot.inventory.v1"],
    ...experimentRequirements,
  }),
  experimentPresetQuest({
    id: "preset.experiment.drop3.shelf_mushroom",
    title: "蘑菇上树，常识下班",
    description: "让背包里出现至少一个架生蘑菇。任务检查实际实验物品 identifier，不接受任何名称看起来相近的替代品。",
    completionMessage: "架生蘑菇入袋，树干也有了自己的小阳台。",
    chapterId: "experiment.drop3",
    order: 3,
    rarity: "common",
    reliability: "A",
    goals: [
      inventoryGoal("goal.possess_shelf_mushroom", "selector.item.shelf_mushroom", 1, "背包中拥有至少一个架生蘑菇"),
    ],
    gold: 120,
    experience: 40,
    requiredCapabilities: [CONTENT_CAP, "cap.snapshot.inventory.v1"],
    ...experimentRequirements,
  }),
  experimentPresetQuest({
    id: "preset.experiment.drop3.red_shrub",
    title: "红色灌木，低调失败",
    description:
      "让背包里出现至少一个红色灌木。系统会读取正式 Red Shrub identifier，染红或改名的普通植物不能蒙混过关。",
    completionMessage: "红色灌木已收藏，它确实一点都不擅长隐身。",
    chapterId: "experiment.drop3",
    order: 4,
    rarity: "common",
    reliability: "A",
    goals: [inventoryGoal("goal.possess_red_shrub", "selector.item.red_shrub", 1, "背包中拥有至少一个红色灌木")],
    gold: 120,
    experience: 40,
    requiredCapabilities: [CONTENT_CAP, "cap.snapshot.inventory.v1"],
    ...experimentRequirements,
  }),
  experimentPresetQuest({
    id: "preset.experiment.drop3.camp",
    title: "营地还在，人先撤了",
    description: "真正进入一次废弃营地结构边界。营火、帐篷或几块木板都不是可靠代理，必须等待结构定位事件直接确认。",
    completionMessage: "废弃营地已发现，留下的人显然不打算回来解释。",
    chapterId: "experiment.drop3",
    order: 5,
    rarity: "epic",
    reliability: "C",
    goals: [
      milestoneGoal("goal.enter_abandoned_camp", "structure.enter", "进入一次废弃营地结构边界", {
        filters: { structure: { op: "eq", value: "minecraft:abandoned_camp" } },
        backfillPolicy: "historical",
        evidenceProviderId: "evidence.structure.discovery_history",
      }),
    ],
    gold: 300,
    experience: 100,
    requiredCapabilities: [CONTENT_CAP, "cap.event.structure.enter.v1"],
    ...experimentRequirements,
  }),
  experimentPresetQuest({
    id: "preset.experiment.drop3.straw_bed",
    title: "草床一晚，主打能睡",
    description: "成功使用草床完成一次对应睡眠行为。仅与草床互动、因危险或时间不对而失败，都不能算睡过这一晚。",
    completionMessage: "草床睡眠成功，舒适度先不谈，确实休息到了。",
    chapterId: "experiment.drop3",
    order: 6,
    rarity: "rare",
    reliability: "B",
    goals: [
      milestoneGoal("goal.use_straw_bed_successfully", "straw_bed.used_successfully", "使用草床成功完成一次睡眠"),
    ],
    gold: 180,
    experience: 60,
    requiredCapabilities: [CONTENT_CAP, "cap.event.straw_bed.used_successfully.v1"],
    ...experimentRequirements,
  }),
  experimentPresetQuest({
    id: "preset.experiment.drop3.cushion",
    title: "坐垫就位，先歇会儿",
    description: "成功坐上一次实验坐垫。把坐垫拿在手里或站在旁边不算，必须由 Cushion Adapter 确认有效乘坐关系。",
    completionMessage: "坐垫乘坐成功，冒险暂停片刻也算合理安排。",
    chapterId: "experiment.drop3",
    order: 7,
    rarity: "rare",
    reliability: "B",
    goals: [milestoneGoal("goal.ride_cushion", "cushion.ride_successfully", "成功坐上一次实验坐垫")],
    gold: 150,
    experience: 50,
    requiredCapabilities: [CONTENT_CAP, "cap.event.cushion.ride_successfully.v1"],
    ...experimentRequirements,
  }),
];

export const experimentDrop3Pack: QuestPackDefinition = {
  id: PACK_ID,
  version: 1,
  title: "26.40 后续玩法实验",
  description: "仅在 Drop 3 玩法实验和对应内容能力均被可靠确认时开放；默认关闭，不凭 Beta APIs 状态猜测。",
  category: "experiment",
  defaultEnabled: false,
  releaseState: "experimental",
  requiredCapabilities: [CONTENT_CAP],
  requiredGameplayExperiments: [GAMEPLAY_EXPERIMENT],
  chapterIds: [experimentDrop3Chapter.id],
};
