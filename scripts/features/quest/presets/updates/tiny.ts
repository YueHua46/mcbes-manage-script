import type { QuestChapterDefinition, QuestDefinitionV2, QuestPackDefinition } from "../../domain";
import { distinctCounterGoal, inventoryGoal, milestoneGoal, updateChapter, updatePresetQuest } from "../builders";

const PACK_ID = "preset.update.tiny" as const;
const CONTENT_CAP = "cap.content.minecraft.tiny_takeover.v1";

export const updateTinyChapter: QuestChapterDefinition = updateChapter(PACK_ID, {
  id: "update.tiny",
  title: "小家伙接管，先从名字开始",
  description: "给幼崽命名、保持幼年、认识更多小动物，最后让铜制音符盒吹出一声像样的小号。",
  order: 1,
  unlockRule: { type: "always" },
  questIds: [
    "preset.update.tiny.name_tag",
    "preset.update.tiny.name_baby",
    "preset.update.tiny.golden_dandelion",
    "preset.update.tiny.baby_collection",
    "preset.update.tiny.trumpet",
  ],
});

export const updateTinyQuests: QuestDefinitionV2[] = [
  updatePresetQuest(PACK_ID, {
    id: "preset.update.tiny.name_tag",
    title: "这张牌，等一个名字",
    description: "让背包里出现一张命名牌。它现在只是空白物品，经过铁砧和一次认真命名后，就能让某个小家伙正式拥有身份。",
    completionMessage: "命名牌已准备，名字只差写上去。",
    chapterId: "update.tiny",
    order: 1,
    rarity: "common",
    reliability: "A",
    goals: [inventoryGoal("goal.possess_name_tag", "selector.item.name_tag", 1, "背包中拥有一张命名牌")],
    gold: 100,
    experience: 35,
    requiredCapabilities: [CONTENT_CAP, "cap.snapshot.inventory.v1"],
  }),
  updatePresetQuest(PACK_ID, {
    id: "preset.update.tiny.name_baby",
    title: "小家伙，从此不是路人甲",
    description: "成功给一只幼年生物使用命名牌。必须确认目标仍处于幼年并真正获得名字，给成年生物改名不计入本任务。",
    completionMessage: "幼崽命名成功，服务器多了一位有名有姓的小居民。",
    chapterId: "update.tiny",
    order: 2,
    rarity: "rare",
    reliability: "B",
    goals: [milestoneGoal("goal.name_baby_mob", "baby_mob.name_tagged", "成功给一只幼年生物命名")],
    gold: 180,
    experience: 60,
    requiredCapabilities: [CONTENT_CAP, "cap.event.baby_mob.name_tagged.v1"],
    unlockRule: { type: "quest", questId: "preset.update.tiny.name_tag", status: "completed" },
  }),
  updatePresetQuest(PACK_ID, {
    id: "preset.update.tiny.golden_dandelion",
    title: "长大这事，今天先暂停",
    description: "对受支持的幼年生物成功使用一次金色蒲公英。必须确认特殊效果真正应用，拿着花对空气挥舞不算青春永驻。",
    completionMessage: "金色蒲公英生效，小家伙决定继续当小家伙。",
    chapterId: "update.tiny",
    order: 3,
    rarity: "epic",
    reliability: "B",
    goals: [
      milestoneGoal("goal.use_golden_dandelion", "golden_dandelion.used_on_baby", "对幼年生物成功使用金色蒲公英"),
    ],
    gold: 300,
    experience: 100,
    requiredCapabilities: [CONTENT_CAP, "cap.event.golden_dandelion.used_on_baby.v1"],
  }),
  updatePresetQuest(PACK_ID, {
    id: "preset.update.tiny.baby_collection",
    title: "五种幼崽，幼儿园开班",
    description: "任务开启后记录 5 种不同幼年生物的有效接触。相同物种反复见面只算一种，系统会保存稳定物种集合。",
    completionMessage: "五种幼崽完成登记，方块幼儿园正式开班。",
    chapterId: "update.tiny",
    order: 4,
    rarity: "epic",
    reliability: "B",
    goals: [
      distinctCounterGoal("goal.encounter_baby_species", "baby_mob.encounter", "species", 5, "接触 5 种不同幼年生物"),
    ],
    gold: 350,
    experience: 120,
    requiredCapabilities: [CONTENT_CAP, "cap.event.baby_mob.encounter.v1"],
  }),
  updatePresetQuest(PACK_ID, {
    id: "preset.update.tiny.trumpet",
    title: "音符盒突然学会吹号",
    description: "让放在铜类方块上的音符盒成功发出一次小号音色。必须确认正确底座和实际播放结果，摆好不响不算演出。",
    completionMessage: "小号音色成功响起，铜块完成一次跨界演奏。",
    chapterId: "update.tiny",
    order: 5,
    rarity: "rare",
    reliability: "B",
    goals: [milestoneGoal("goal.play_trumpet_note", "note_block.trumpet_played", "让音符盒成功发出一次小号音色")],
    gold: 220,
    experience: 80,
    requiredCapabilities: [CONTENT_CAP, "cap.event.note_block.trumpet_played.v1"],
  }),
];

export const updateTinyPack: QuestPackDefinition = {
  id: PACK_ID,
  version: 1,
  title: "小家伙接管，大人靠边",
  description: "幼年生物与铜制小号组成轻量更新包；默认关闭，内容和交互 Adapter 验证后再启用。",
  category: "update",
  defaultEnabled: false,
  releaseState: "active",
  requiredCapabilities: [CONTENT_CAP],
  requiredGameplayExperiments: [],
  chapterIds: [updateTinyChapter.id],
};
