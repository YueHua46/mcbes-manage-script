import type { QuestChapterDefinition, QuestDefinitionV2, QuestPackDefinition } from "../../domain";
import { counterGoal, hiddenChapter, hiddenPresetQuest, milestoneGoal } from "../builders";

export const hiddenChallengesChapter: QuestChapterDefinition = hiddenChapter({
  id: "hidden.challenges",
  title: "没写在封面上的事",
  description: "这些挑战会在后台静默追踪，完成前不剧透，也不会挤进核心主线完成度。",
  order: 1,
  unlockRule: { type: "always" },
  questIds: [
    "preset.hidden.warden",
    "preset.hidden.dragon_again",
    "preset.hidden.mace_smash",
    "preset.hidden.happy_ghast_party",
    "preset.hidden.elytra_distance",
  ],
});

export const hiddenChallengeQuests: QuestDefinitionV2[] = [
  hiddenPresetQuest({
    id: "preset.hidden.warden",
    title: "直面黑暗，还赢了",
    description: "亲手击败一只监守者。这是一项隐藏挑战，成功击杀后才会揭晓，别让黑暗先发现你。",
    completionMessage: "监守者倒下，黑暗第一次主动给你让了路。",
    chapterId: "hidden.challenges",
    order: 1,
    rarity: "legendary",
    reliability: "A",
    goals: [
      milestoneGoal("goal.kill_warden", "entity.kill", "亲手击败一只监守者", {
        filters: { entity: { op: "eq", value: "minecraft:warden" } },
      }),
    ],
    gold: 1500,
    experience: 800,
    requiredCapabilities: ["cap.event.entity.kill.v1"],
  }),
  hiddenPresetQuest({
    id: "preset.hidden.dragon_again",
    title: "终末返场，龙也加班",
    description: "亲手击败末影龙两次。只有真正完成的击杀才会计数，重复播放动画不算。",
    completionMessage: "末影龙第二次落幕，终末世界确认你是来返场的。",
    chapterId: "hidden.challenges",
    order: 2,
    rarity: "legendary",
    reliability: "B",
    goals: [
      counterGoal("goal.kill_ender_dragon_twice", "entity.kill", 2, "累计击败末影龙两次", {
        filters: { entity: { op: "eq", value: "minecraft:ender_dragon" } },
        selectorId: "selector.counter.boss_kill_count",
        backfillPolicy: "historical",
      }),
    ],
    gold: 1200,
    experience: 600,
    requiredCapabilities: ["cap.event.entity.kill.v1", "cap.aggregate.boss_kill_count.v1"],
    unlockRule: { type: "quest", questId: "preset.core.end.kill_dragon", status: "completed" },
  }),
  hiddenPresetQuest({
    id: "preset.hidden.mace_smash",
    title: "从天而降，落点很疼",
    description: "使用重锤完成一次达到服务器配置阈值的高坠落攻击。普通重锤命中或自己摔伤都不能冒充完整挑战。",
    completionMessage: "高坠重锤命中，地面和目标都收到了你的通知。",
    chapterId: "hidden.challenges",
    order: 3,
    rarity: "epic",
    reliability: "C",
    goals: [milestoneGoal("goal.complete_mace_high_fall_hit", "mace.high_fall_hit", "完成一次达标的重锤高坠攻击")],
    gold: 800,
    experience: 300,
    requiredCapabilities: ["cap.challenge.mace.high_fall_hit.v1"],
    unlockRule: { type: "quest", questId: "preset.world.trials.mace", status: "completed" },
  }),
  hiddenPresetQuest({
    id: "preset.hidden.happy_ghast_party",
    title: "恶魂公交，满载发车",
    description: "让同一只快乐恶魂同时承载四名玩家。必须由乘客关系 Adapter 在同一时刻确认，轮流上车不能拼成合照。",
    completionMessage: "快乐恶魂四人满载，天空派对正式发车。",
    chapterId: "hidden.challenges",
    order: 4,
    rarity: "epic",
    reliability: "B",
    goals: [
      milestoneGoal("goal.fill_happy_ghast_passengers", "happy_ghast.passenger_count", "让快乐恶魂同时承载四名玩家", {
        filters: { passengerCount: { op: "gte", value: 4 } },
      }),
    ],
    gold: 800,
    experience: 300,
    requiredCapabilities: ["cap.content.minecraft.chase_the_skies.v1", "cap.challenge.happy_ghast.passenger_count.v1"],
    unlockRule: { type: "quest", questId: "preset.update.skies.ride", status: "completed" },
  }),
  hiddenPresetQuest({
    id: "preset.hidden.elytra_distance",
    title: "一万格后，风都认识你",
    description: "从解锁任务以后累计使用鞘翅飞行一万格。步行、骑乘和解锁前的旧里程都不计入，只累计可靠滑翔距离。",
    completionMessage: "鞘翅里程突破一万格，远方已经变成日常通勤。",
    chapterId: "hidden.challenges",
    order: 5,
    rarity: "legendary",
    reliability: "B",
    goals: [
      counterGoal("goal.glide_ten_thousand_blocks", "elytra.distance", 10000, "解锁后累计鞘翅飞行一万格", {
        aggregation: "sum",
        field: "distance",
      }),
    ],
    gold: 1000,
    experience: 400,
    requiredCapabilities: ["cap.event.elytra.distance.v1"],
    unlockRule: { type: "quest", questId: "preset.core.endcity.elytra", status: "completed" },
  }),
];

export const hiddenChallengesPack: QuestPackDefinition = {
  id: "preset.hidden",
  version: 1,
  title: "隐藏挑战，完成时再剧透",
  description: "默认允许后台静默追踪；所有任务在完成前隐藏，且不计入核心主线完成度。",
  category: "hidden",
  defaultEnabled: true,
  releaseState: "active",
  requiredCapabilities: [],
  requiredGameplayExperiments: [],
  chapterIds: [hiddenChallengesChapter.id],
};
