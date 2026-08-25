import type {
  QuestChapterDefinition,
  QuestDefinitionV2,
  QuestFilter,
  QuestGoalDefinitionV2,
  QuestPackDefinition,
  QuestRewardDefinitionV2,
  QuestRule,
} from "../../domain";
import { QuestPresetRegistry } from "../../catalog/preset-registry";

const DEFINITION_TIMESTAMP = Date.UTC(2026, 7, 24);
const ALWAYS: QuestRule = { type: "always" };

function rewards(gold: number, experience: number): QuestRewardDefinitionV2[] {
  return [
    { id: "reward.gold", action: "add_money", params: { amount: gold } },
    { id: "reward.exp", action: "add_exp", params: { amount: experience } },
  ];
}

function counterGoal(
  id: string,
  eventType: string,
  target: number,
  options: {
    filters?: Record<string, QuestFilter>;
    selectorId?: string;
    aggregation?: "count" | "sum";
    field?: string;
    displayText?: string;
  } = {}
): QuestGoalDefinitionV2 {
  return {
    id,
    displayText: options.displayText,
    semantics: "counter",
    eventType,
    filters: options.filters ?? {},
    selectorId: options.selectorId,
    aggregation: options.aggregation ?? "count",
    field: options.field,
    target,
    backfillPolicy: "none",
  };
}

function snapshotGoal(
  id: string,
  provider: "inventory" | "equipment",
  selectorId: string,
  query?: Record<string, unknown>,
  displayText?: string
): QuestGoalDefinitionV2 {
  return {
    id,
    displayText,
    semantics: "snapshot",
    provider,
    selectorId,
    query,
    target: 1,
    snapshotMode: "current",
  };
}

interface PresetQuestInput {
  id: string;
  title: string;
  description: string;
  chapterId: string;
  order: number;
  rarity: QuestDefinitionV2["rarity"];
  goals: QuestGoalDefinitionV2[];
  rewards: QuestRewardDefinitionV2[];
  unlockRule?: QuestRule;
  unlockEventPolicy?: QuestDefinitionV2["unlockEventPolicy"];
  requiredCapabilities: string[];
}

function quest(input: PresetQuestInput): QuestDefinitionV2 {
  return {
    id: input.id,
    source: "preset",
    definitionVersion: 1,
    title: input.title,
    description: input.description,
    packId: "preset.core",
    chapterId: input.chapterId,
    category: "core",
    order: input.order,
    rarity: input.rarity,
    reliability: "A",
    releaseState: "active",
    scope: "once",
    completeWhen: "all",
    acceptMode: "auto",
    claimMode: "manual",
    enabled: true,
    hidden: false,
    trackWhileHidden: false,
    contributesToProgress: true,
    unlockRule: input.unlockRule ?? ALWAYS,
    unlockEventPolicy: input.unlockEventPolicy ?? "exclude",
    requiredCapabilities: input.requiredCapabilities,
    requiredGameplayExperiments: [],
    goals: input.goals,
    rewards: input.rewards,
    createdAt: DEFINITION_TIMESTAMP,
    updatedAt: DEFINITION_TIMESTAMP,
  };
}

export const coreFirstSlicePack: QuestPackDefinition = {
  id: "preset.core",
  version: 1,
  title: "方块世界，先活下来再说",
  description: "从第一块木头到下界火海，一本不太正经、但确实管用的生存手册。",
  category: "core",
  defaultEnabled: true,
  releaseState: "active",
  requiredCapabilities: [],
  requiredGameplayExperiments: [],
  chapterIds: ["core.survival", "core.mining", "core.nether"],
};

export const coreFirstSliceChapters: QuestChapterDefinition[] = [
  {
    id: "core.survival",
    packId: "preset.core",
    title: "先别急着打末影龙",
    description: "第一天的目标很朴素：有工具、有炉子，天黑以后尽量别露宿。",
    order: 1,
    releaseState: "active",
    unlockRule: ALWAYS,
    questIds: [
      "preset.core.survival.first_log",
      "preset.core.survival.crafting_table",
      "preset.core.survival.stone_pickaxe",
      "preset.core.survival.furnace",
    ],
    progressPolicy: { includeHidden: false, includeUnavailable: false },
  },
  {
    id: "core.mining",
    packId: "preset.core",
    title: "往下挖，总会有好东西",
    description: "铁可以没有排面，钻石必须有；顺便把装备也卷起来。",
    order: 2,
    releaseState: "active",
    unlockRule: {
      type: "any",
      rules: [
        { type: "quest", questId: "preset.core.survival.stone_pickaxe", status: "completed" },
        { type: "fact", factId: "fact.item.iron_ingot", operator: "gte", value: 1 },
      ],
    },
    questIds: [
      "preset.core.mining.iron_ingots",
      "preset.core.mining.iron_pickaxe",
      "preset.core.mining.full_iron_armor",
      "preset.core.mining.first_diamond",
      "preset.core.mining.diamond_pickaxe",
      "preset.core.mining.obsidian",
    ],
    progressPolicy: { includeHidden: false, includeUnavailable: false },
  },
  {
    id: "core.nether",
    packId: "preset.core",
    title: "下界欢迎你（大概）",
    description: "门那边很热，原住民脾气也不太好，记得带把趁手的家伙。",
    order: 4,
    releaseState: "active",
    unlockRule: {
      type: "any",
      rules: [
        { type: "quest", questId: "preset.core.mining.obsidian", status: "completed" },
        { type: "fact", factId: "fact.dimension.nether.entered", operator: "eq", value: true },
      ],
    },
    questIds: ["preset.core.nether.enter", "preset.core.nether.blaze_hunter"],
    progressPolicy: { includeHidden: false, includeUnavailable: false },
  },
];

export const coreFirstSliceQuests: QuestDefinitionV2[] = [
  quest({
    id: "preset.core.survival.first_log",
    title: "要致富，先撸树",
    description: "先收好 4 块任意原木。别问为什么，所有宏伟工程都从对树下手开始。",
    chapterId: "core.survival",
    order: 1,
    rarity: "common",
    goals: [
      counterGoal("goal.obtain_logs", "item.obtain", 4, {
        selectorId: "selector.item.logs",
        aggregation: "sum",
        field: "amount",
        displayText: "收集任意原木",
      }),
    ],
    rewards: rewards(40, 10),
    requiredCapabilities: ["cap.event.item.obtain.v1"],
  }),
  quest({
    id: "preset.core.survival.crafting_table",
    title: "四格小桌，手搓万物",
    description: "让背包里出现一个工作台。四块木板放下去，生产力这不就来了吗。",
    chapterId: "core.survival",
    order: 2,
    rarity: "common",
    goals: [
      snapshotGoal(
        "goal.possess_crafting_table",
        "inventory",
        "selector.item.crafting_table",
        undefined,
        "背包中拥有工作台"
      ),
    ],
    rewards: rewards(30, 10),
    requiredCapabilities: ["cap.snapshot.inventory.v1"],
  }),
  quest({
    id: "preset.core.survival.stone_pickaxe",
    title: "木镐：你的班就上到这儿",
    description: "准备一把石镐。木镐可以退休了，真正的矿工现在才打卡。",
    chapterId: "core.survival",
    order: 3,
    rarity: "common",
    goals: [
      snapshotGoal(
        "goal.possess_stone_pickaxe",
        "inventory",
        "selector.item.stone_pickaxe",
        undefined,
        "背包中拥有石镐"
      ),
    ],
    rewards: rewards(50, 15),
    requiredCapabilities: ["cap.snapshot.inventory.v1"],
  }),
  quest({
    id: "preset.core.survival.furnace",
    title: "炉子一摆，家业就来",
    description: "把熔炉揣进背包。会烤肉只是副业，炼矿才是正经事。",
    chapterId: "core.survival",
    order: 4,
    rarity: "common",
    goals: [snapshotGoal("goal.possess_furnace", "inventory", "selector.item.furnace", undefined, "背包中拥有熔炉")],
    rewards: rewards(50, 15),
    requiredCapabilities: ["cap.snapshot.inventory.v1"],
  }),
  quest({
    id: "preset.core.mining.iron_ingots",
    title: "铁饭碗，自己打",
    description: "累计获得 16 个铁锭。先别全做桶，咱们还有一身家当要置办。",
    chapterId: "core.mining",
    order: 1,
    rarity: "common",
    goals: [
      {
        id: "goal.obtain_iron_ingots",
        displayText: "累计获得铁锭",
        semantics: "counter",
        eventType: "item.obtain",
        filters: { item: { op: "eq", value: "minecraft:iron_ingot" } },
        aggregation: "sum",
        field: "amount",
        target: 16,
        backfillPolicy: "none",
      },
    ],
    rewards: rewards(80, 25),
    unlockEventPolicy: "include_once",
    requiredCapabilities: ["cap.event.item.obtain.v1"],
  }),
  quest({
    id: "preset.core.mining.iron_pickaxe",
    title: "铁镐一响，矿洞开场",
    description: "准备一把铁镐。石头挖得动，钻石也终于轮得到你惦记了。",
    chapterId: "core.mining",
    order: 2,
    rarity: "common",
    goals: [
      snapshotGoal("goal.possess_iron_pickaxe", "inventory", "selector.item.iron_pickaxe", undefined, "背包中拥有铁镐"),
    ],
    rewards: rewards(70, 20),
    requiredCapabilities: ["cap.snapshot.inventory.v1"],
  }),
  quest({
    id: "preset.core.mining.full_iron_armor",
    title: "铁皮罐头，堂堂登场",
    description: "把铁头盔、胸甲、护腿和靴子全部穿好。少一件，都不算全副武装。",
    chapterId: "core.mining",
    order: 3,
    rarity: "rare",
    goals: [
      snapshotGoal(
        "goal.equip_iron_helmet",
        "equipment",
        "selector.equipment.iron_helmet",
        { slot: "Head" },
        "穿上铁头盔"
      ),
      snapshotGoal(
        "goal.equip_iron_chestplate",
        "equipment",
        "selector.equipment.iron_chestplate",
        {
          slot: "Chest",
        },
        "穿上铁胸甲"
      ),
      snapshotGoal(
        "goal.equip_iron_leggings",
        "equipment",
        "selector.equipment.iron_leggings",
        { slot: "Legs" },
        "穿上铁护腿"
      ),
      snapshotGoal(
        "goal.equip_iron_boots",
        "equipment",
        "selector.equipment.iron_boots",
        { slot: "Feet" },
        "穿上铁靴子"
      ),
    ],
    rewards: rewards(180, 60),
    requiredCapabilities: ["cap.snapshot.equipment.v1"],
  }),
  quest({
    id: "preset.core.mining.first_diamond",
    title: "这颗蓝的，含金量很高",
    description: "获得至少 1 颗钻石。蓝光一闪，今天这趟矿洞就算没白下。",
    chapterId: "core.mining",
    order: 4,
    rarity: "rare",
    goals: [
      {
        id: "goal.obtain_first_diamond",
        displayText: "获得钻石",
        semantics: "counter",
        eventType: "item.obtain",
        filters: { item: { op: "eq", value: "minecraft:diamond" } },
        aggregation: "sum",
        field: "amount",
        target: 1,
        backfillPolicy: "none",
      },
    ],
    rewards: rewards(150, 60),
    requiredCapabilities: ["cap.event.item.obtain.v1"],
  }),
  quest({
    id: "preset.core.mining.diamond_pickaxe",
    title: "鸟枪换钻镐",
    description: "让背包里出现一把钻石镐。效率先不谈，气质已经完全不一样了。",
    chapterId: "core.mining",
    order: 5,
    rarity: "rare",
    goals: [
      snapshotGoal(
        "goal.possess_diamond_pickaxe",
        "inventory",
        "selector.item.diamond_pickaxe",
        undefined,
        "背包中拥有钻石镐"
      ),
    ],
    rewards: rewards(180, 70),
    unlockRule: { type: "quest", questId: "preset.core.mining.first_diamond", status: "completed" },
    requiredCapabilities: ["cap.snapshot.inventory.v1"],
  }),
  quest({
    id: "preset.core.mining.obsidian",
    title: "黑得发亮，硬得离谱",
    description: "累计获得 10 块黑曜石。它挖得慢，但通往新世界的门票从不便宜。",
    chapterId: "core.mining",
    order: 6,
    rarity: "rare",
    goals: [
      {
        id: "goal.obtain_obsidian",
        displayText: "累计获得黑曜石",
        semantics: "counter",
        eventType: "item.obtain",
        filters: { item: { op: "eq", value: "minecraft:obsidian" } },
        aggregation: "sum",
        field: "amount",
        target: 10,
        backfillPolicy: "none",
      },
    ],
    rewards: rewards(200, 80),
    unlockRule: { type: "quest", questId: "preset.core.mining.diamond_pickaxe", status: "completed" },
    requiredCapabilities: ["cap.event.item.obtain.v1"],
  }),
  quest({
    id: "preset.core.nether.enter",
    title: "主世界待腻了",
    description: "亲自跨进下界一次。进去可以，记得认路，传送门可不会追着你跑。",
    chapterId: "core.nether",
    order: 1,
    rarity: "rare",
    goals: [
      {
        id: "goal.enter_nether",
        displayText: "进入下界一次",
        semantics: "milestone",
        eventType: "player.dimension_enter",
        filters: { dimension: { op: "eq", value: "nether" } },
        backfillPolicy: "current_state",
      },
    ],
    rewards: rewards(250, 100),
    unlockEventPolicy: "include_once",
    requiredCapabilities: ["cap.event.player.dimension_enter.v1"],
  }),
  quest({
    id: "preset.core.nether.blaze_hunter",
    title: "你火气很大啊",
    description: "击杀 5 只烈焰人。既然它们火气这么大，那就顺手帮忙降降温。",
    chapterId: "core.nether",
    order: 2,
    rarity: "rare",
    goals: [
      {
        id: "goal.kill_blazes",
        displayText: "击杀烈焰人",
        semantics: "counter",
        eventType: "entity.kill",
        filters: { entity: { op: "eq", value: "minecraft:blaze" } },
        aggregation: "count",
        target: 5,
        backfillPolicy: "none",
      },
    ],
    rewards: rewards(200, 80),
    unlockRule: { type: "quest", questId: "preset.core.nether.enter", status: "completed" },
    requiredCapabilities: ["cap.event.entity.kill.v1"],
  }),
];

export function registerCoreFirstSlice(registry: QuestPresetRegistry): void {
  registry.registerPack(coreFirstSlicePack);
  coreFirstSliceChapters.forEach((chapter) => registry.registerChapter(chapter));
  coreFirstSliceQuests.forEach((definition) => registry.registerQuest(definition));
}
