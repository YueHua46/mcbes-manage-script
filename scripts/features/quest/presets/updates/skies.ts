import type { QuestChapterDefinition, QuestDefinitionV2, QuestPackDefinition } from "../../domain";
import { inventoryGoal, milestoneGoal, updateChapter, updatePresetQuest } from "../builders";

const PACK_ID = "preset.update.skies" as const;
const CONTENT_CAP = "cap.content.minecraft.chase_the_skies.v1";

export const updateSkiesChapter: QuestChapterDefinition = updateChapter(PACK_ID, {
  id: "update.skies",
  title: "恶魂养成，最后变公交",
  description: "从一块干枯恶魂开始浇水、成长、套上缰绳，直到这个大家伙愿意载你飞过天空。",
  order: 1,
  unlockRule: { type: "always" },
  questIds: [
    "preset.update.skies.dried_ghast",
    "preset.update.skies.revive",
    "preset.update.skies.ghastling",
    "preset.update.skies.happy_ghast",
    "preset.update.skies.harness",
    "preset.update.skies.ride",
  ],
});

export const updateSkiesQuests: QuestDefinitionV2[] = [
  updatePresetQuest(PACK_ID, {
    id: "preset.update.skies.dried_ghast",
    title: "一块恶魂，暂时没气",
    description: "让背包里出现一个干枯恶魂方块。它现在安静得像装饰品，但水和耐心能让这段生命链重新开机。",
    completionMessage: "干枯恶魂已找到，复苏项目可以立项。",
    chapterId: "update.skies",
    order: 1,
    rarity: "rare",
    reliability: "A",
    goals: [inventoryGoal("goal.possess_dried_ghast", "selector.item.dried_ghast", 1, "背包中拥有干枯恶魂方块")],
    gold: 180,
    experience: 60,
    requiredCapabilities: [CONTENT_CAP, "cap.snapshot.inventory.v1"],
  }),
  updatePresetQuest(PACK_ID, {
    id: "preset.update.skies.revive",
    title: "泡进水里，生命读条",
    description: "把干枯恶魂放入正确的水中并成功启动复苏流程。只扔进水里又立刻捞走不算，专用状态必须开始推进。",
    completionMessage: "复苏流程已启动，干枯恶魂开始重新呼吸。",
    chapterId: "update.skies",
    order: 2,
    rarity: "rare",
    reliability: "B",
    goals: [
      milestoneGoal("goal.start_dried_ghast_hydration", "dried_ghast.hydration_started", "启动干枯恶魂水中复苏流程"),
    ],
    gold: 250,
    experience: 90,
    requiredCapabilities: [CONTENT_CAP, "cap.event.dried_ghast.hydration_started.v1"],
    unlockRule: { type: "quest", questId: "preset.update.skies.dried_ghast", status: "completed" },
  }),
  updatePresetQuest(PACK_ID, {
    id: "preset.update.skies.ghastling",
    title: "小恶魂上线，先别害怕",
    description: "让与你的复苏链关联的干枯恶魂成功生成一只小恶魂。必须有可靠归属证据，路边偶遇不算养成成果。",
    completionMessage: "小恶魂成功诞生，天空养成进入幼年阶段。",
    chapterId: "update.skies",
    order: 3,
    rarity: "epic",
    reliability: "B",
    goals: [
      milestoneGoal("goal.spawn_ghastling", "ghastling.spawn_from_dried_ghast", "让复苏链成功生成一只小恶魂", {
        backfillPolicy: "historical",
        evidenceProviderId: "evidence.ghastling.owner",
      }),
    ],
    gold: 300,
    experience: 100,
    requiredCapabilities: [CONTENT_CAP, "cap.event.ghastling.spawn_from_dried_ghast.v1"],
    unlockRule: { type: "quest", questId: "preset.update.skies.revive", status: "completed" },
  }),
  updatePresetQuest(PACK_ID, {
    id: "preset.update.skies.happy_ghast",
    title: "脸在笑，体型在膨胀",
    description: "让与你关联的小恶魂成长为快乐恶魂。必须确认同一条养成归属链，别人家的大家伙不能过来替你毕业。",
    completionMessage: "快乐恶魂长成，空中载具进入成年状态。",
    chapterId: "update.skies",
    order: 4,
    rarity: "epic",
    reliability: "B",
    goals: [
      milestoneGoal("goal.grow_happy_ghast", "happy_ghast.grow", "让关联的小恶魂成长为快乐恶魂", {
        backfillPolicy: "historical",
        evidenceProviderId: "evidence.happy_ghast.owner",
      }),
    ],
    gold: 500,
    experience: 180,
    requiredCapabilities: [CONTENT_CAP, "cap.event.happy_ghast.grow.v1"],
    unlockRule: { type: "quest", questId: "preset.update.skies.ghastling", status: "completed" },
  }),
  updatePresetQuest(PACK_ID, {
    id: "preset.update.skies.harness",
    title: "这么大一只，也得系好",
    description: "让背包里出现一副恶魂缰绳。快乐恶魂负责提供升力，你负责在起飞前把驾乘设备准备完整。",
    completionMessage: "恶魂缰绳到手，起飞手续只差上车。",
    chapterId: "update.skies",
    order: 5,
    rarity: "rare",
    reliability: "A",
    goals: [inventoryGoal("goal.possess_harness", "selector.item.happy_ghast_harness", 1, "背包中拥有恶魂缰绳")],
    gold: 220,
    experience: 80,
    requiredCapabilities: [CONTENT_CAP, "cap.snapshot.inventory.v1"],
  }),
  updatePresetQuest(PACK_ID, {
    id: "preset.update.skies.ride",
    title: "今天的云层，是行车道",
    description: "成功骑乘一只快乐恶魂。靠近、牵引或站在它旁边都不算，系统必须确认玩家已进入有效骑乘关系。",
    completionMessage: "快乐恶魂骑乘成功，天空正式变成道路。",
    chapterId: "update.skies",
    order: 6,
    rarity: "legendary",
    reliability: "B",
    goals: [
      milestoneGoal("goal.ride_happy_ghast", "player.ride", "成功骑乘一只快乐恶魂", {
        filters: { entity: { op: "eq", value: "minecraft:happy_ghast" } },
      }),
    ],
    gold: 700,
    experience: 260,
    requiredCapabilities: [CONTENT_CAP, "cap.event.player.ride.v1"],
    unlockRule: { type: "quest", questId: "preset.update.skies.happy_ghast", status: "completed" },
  }),
];

export const updateSkiesPack: QuestPackDefinition = {
  id: PACK_ID,
  version: 1,
  title: "追逐天空，恶魂当车",
  description: "完整记录干枯恶魂的复苏与骑乘链；默认关闭，内容能力与归属 Adapter 验证后再开放。",
  category: "update",
  defaultEnabled: false,
  releaseState: "active",
  requiredCapabilities: [CONTENT_CAP],
  requiredGameplayExperiments: [],
  chapterIds: [updateSkiesChapter.id],
};
