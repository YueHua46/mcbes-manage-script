import { system } from "@minecraft/server";
import { Database } from "../../../shared/database/database";

export type QuestScope = "once" | "daily" | "weekly" | "repeatable";
export type QuestCompleteWhen = "all" | "any";
export type QuestFilterOperator = "eq" | "in" | "gte" | "lte" | "contains";
export type QuestProgressMode = "count" | "sum";

export interface QuestFilter {
  op: QuestFilterOperator;
  value: string | number | boolean | string[];
}

export interface QuestGoalDefinition {
  id: string;
  event: string;
  filters: Record<string, QuestFilter>;
  progress: {
    mode: QuestProgressMode;
    target: number;
    field?: string;
  };
}

export interface QuestRewardDefinition {
  id: string;
  action: string;
  params: Record<string, string | number | boolean | Record<string, unknown> | unknown[]>;
}

export interface QuestDefinition {
  id: string;
  title: string;
  description: string;
  scope: QuestScope;
  autoAccept: boolean;
  enabled: boolean;
  completeWhen: QuestCompleteWhen;
  goals: QuestGoalDefinition[];
  rewards: QuestRewardDefinition[];
  createdAt: number;
  updatedAt: number;
}

export interface QuestFieldSchema {
  key: string;
  label: string;
  hint: string;
  operators: QuestFilterOperator[];
  defaultOperator: QuestFilterOperator;
}

export interface QuestEventSchema {
  key: string;
  label: string;
  icon: string;
  fields: QuestFieldSchema[];
  progressModes: QuestProgressMode[];
  sumFields?: { key: string; label: string }[];
}

export interface QuestRewardFieldSchema {
  key: string;
  label: string;
  hint: string;
  type: "string" | "number" | "boolean";
  required?: boolean;
}

export interface QuestRewardSchema {
  key: string;
  label: string;
  icon: string;
  permissionLevel: "normal" | "advanced";
  fields: QuestRewardFieldSchema[];
}

export type QuestMobCategory = "hostile" | "neutral" | "passive";

export interface QuestMobOption {
  id: string;
  label: string;
  category: QuestMobCategory;
}

export const questScopeOptions: { value: QuestScope; label: string }[] = [
  { value: "once", label: "一次性" },
  { value: "daily", label: "每日" },
  { value: "weekly", label: "每周" },
  { value: "repeatable", label: "可重复" },
];

export const questCompleteWhenOptions: { value: QuestCompleteWhen; label: string }[] = [
  { value: "all", label: "全部目标完成" },
  { value: "any", label: "任意目标完成" },
];

export const questOperatorOptions: { value: QuestFilterOperator; label: string }[] = [
  { value: "eq", label: "等于" },
  { value: "in", label: "属于列表" },
  { value: "gte", label: "大于等于" },
  { value: "lte", label: "小于等于" },
  { value: "contains", label: "包含" },
];

export const questProgressModeOptions: { value: QuestProgressMode; label: string }[] = [
  { value: "count", label: "次数累计" },
  { value: "sum", label: "数值累加" },
];

export const questMobCategoryOptions: { value: QuestMobCategory; label: string }[] = [
  { value: "hostile", label: "敌对生物" },
  { value: "neutral", label: "中立生物" },
  { value: "passive", label: "友好生物" },
];

export const questMobCatalog: QuestMobOption[] = [
  { id: "minecraft:zombie", label: "僵尸", category: "hostile" },
  { id: "minecraft:husk", label: "尸壳", category: "hostile" },
  { id: "minecraft:drowned", label: "溺尸", category: "hostile" },
  { id: "minecraft:zombie_villager", label: "僵尸村民", category: "hostile" },
  { id: "minecraft:zombie_villager_v2", label: "僵尸村民", category: "hostile" },
  { id: "minecraft:skeleton", label: "骷髅", category: "hostile" },
  { id: "minecraft:stray", label: "流浪者", category: "hostile" },
  { id: "minecraft:wither_skeleton", label: "凋零骷髅", category: "hostile" },
  { id: "minecraft:bogged", label: "沼骸", category: "hostile" },
  { id: "minecraft:creeper", label: "苦力怕", category: "hostile" },
  { id: "minecraft:spider", label: "蜘蛛", category: "hostile" },
  { id: "minecraft:cave_spider", label: "洞穴蜘蛛", category: "hostile" },
  { id: "minecraft:slime", label: "史莱姆", category: "hostile" },
  { id: "minecraft:magma_cube", label: "岩浆怪", category: "hostile" },
  { id: "minecraft:witch", label: "女巫", category: "hostile" },
  { id: "minecraft:phantom", label: "幻翼", category: "hostile" },
  { id: "minecraft:silverfish", label: "蠹虫", category: "hostile" },
  { id: "minecraft:endermite", label: "末影螨", category: "hostile" },
  { id: "minecraft:guardian", label: "守卫者", category: "hostile" },
  { id: "minecraft:elder_guardian", label: "远古守卫者", category: "hostile" },
  { id: "minecraft:shulker", label: "潜影贝", category: "hostile" },
  { id: "minecraft:blaze", label: "烈焰人", category: "hostile" },
  { id: "minecraft:ghast", label: "恶魂", category: "hostile" },
  { id: "minecraft:piglin_brute", label: "猪灵蛮兵", category: "hostile" },
  { id: "minecraft:zoglin", label: "僵尸疣猪兽", category: "hostile" },
  { id: "minecraft:pillager", label: "掠夺者", category: "hostile" },
  { id: "minecraft:vindicator", label: "卫道士", category: "hostile" },
  { id: "minecraft:evocation_illager", label: "唤魔者", category: "hostile" },
  { id: "minecraft:vex", label: "恼鬼", category: "hostile" },
  { id: "minecraft:ravager", label: "劫掠兽", category: "hostile" },
  { id: "minecraft:breeze", label: "旋风人", category: "hostile" },
  { id: "minecraft:warden", label: "监守者", category: "hostile" },
  { id: "minecraft:wither", label: "凋零", category: "hostile" },
  { id: "minecraft:ender_dragon", label: "末影龙", category: "hostile" },
  { id: "minecraft:creaking", label: "嘎枝", category: "hostile" },
  { id: "minecraft:parched", label: "干尸", category: "hostile" },
  { id: "minecraft:camel_husk", label: "骆驼尸壳", category: "hostile" },
  { id: "minecraft:zombie_nautilus", label: "僵尸鹦鹉螺", category: "hostile" },
  { id: "minecraft:bee", label: "蜜蜂", category: "neutral" },
  { id: "minecraft:wolf", label: "狼", category: "neutral" },
  { id: "minecraft:polar_bear", label: "北极熊", category: "neutral" },
  { id: "minecraft:panda", label: "熊猫", category: "neutral" },
  { id: "minecraft:goat", label: "山羊", category: "neutral" },
  { id: "minecraft:dolphin", label: "海豚", category: "neutral" },
  { id: "minecraft:pufferfish", label: "河豚", category: "neutral" },
  { id: "minecraft:llama", label: "羊驼", category: "neutral" },
  { id: "minecraft:trader_llama", label: "行商羊驼", category: "neutral" },
  { id: "minecraft:iron_golem", label: "铁傀儡", category: "neutral" },
  { id: "minecraft:enderman", label: "末影人", category: "neutral" },
  { id: "minecraft:piglin", label: "猪灵", category: "neutral" },
  { id: "minecraft:zombie_pigman", label: "僵尸猪灵", category: "neutral" },
  { id: "minecraft:hoglin", label: "疣猪兽", category: "neutral" },
  { id: "minecraft:happy_ghast", label: "快乐恶魂", category: "neutral" },
  { id: "minecraft:cow", label: "牛", category: "passive" },
  { id: "minecraft:pig", label: "猪", category: "passive" },
  { id: "minecraft:sheep", label: "羊", category: "passive" },
  { id: "minecraft:chicken", label: "鸡", category: "passive" },
  { id: "minecraft:rabbit", label: "兔子", category: "passive" },
  { id: "minecraft:horse", label: "马", category: "passive" },
  { id: "minecraft:donkey", label: "驴", category: "passive" },
  { id: "minecraft:mule", label: "骡", category: "passive" },
  { id: "minecraft:camel", label: "骆驼", category: "passive" },
  { id: "minecraft:mooshroom", label: "哞菇", category: "passive" },
  { id: "minecraft:cat", label: "猫", category: "passive" },
  { id: "minecraft:ocelot", label: "豹猫", category: "passive" },
  { id: "minecraft:fox", label: "狐狸", category: "passive" },
  { id: "minecraft:parrot", label: "鹦鹉", category: "passive" },
  { id: "minecraft:turtle", label: "海龟", category: "passive" },
  { id: "minecraft:frog", label: "青蛙", category: "passive" },
  { id: "minecraft:tadpole", label: "蝌蚪", category: "passive" },
  { id: "minecraft:axolotl", label: "美西螈", category: "passive" },
  { id: "minecraft:sniffer", label: "嗅探兽", category: "passive" },
  { id: "minecraft:armadillo", label: "犰狳", category: "passive" },
  { id: "minecraft:allay", label: "悦灵", category: "passive" },
  { id: "minecraft:bat", label: "蝙蝠", category: "passive" },
  { id: "minecraft:squid", label: "鱿鱼", category: "passive" },
  { id: "minecraft:glow_squid", label: "发光鱿鱼", category: "passive" },
  { id: "minecraft:cod", label: "鳕鱼", category: "passive" },
  { id: "minecraft:salmon", label: "鲑鱼", category: "passive" },
  { id: "minecraft:tropicalfish", label: "热带鱼", category: "passive" },
  { id: "minecraft:strider", label: "炽足兽", category: "passive" },
  { id: "minecraft:villager_v2", label: "村民", category: "passive" },
  { id: "minecraft:villager", label: "村民", category: "passive" },
  { id: "minecraft:wandering_trader", label: "流浪商人", category: "passive" },
  { id: "minecraft:snow_golem", label: "雪傀儡", category: "passive" },
  { id: "minecraft:zombie_horse", label: "僵尸马", category: "passive" },
  { id: "minecraft:skeleton_horse", label: "骷髅马", category: "passive" },
  { id: "minecraft:copper_golem", label: "铜傀儡", category: "passive" },
];

export const questEventSchemas: QuestEventSchema[] = [
  {
    key: "entity.kill",
    label: "击杀实体",
    icon: "textures/icons/sword",
    fields: [
      {
        key: "entity",
        label: "生物/实体",
        hint: "例如 minecraft:zombie；多个值用英文逗号分隔",
        operators: ["eq", "in"],
        defaultOperator: "eq",
      },
      {
        key: "dimension",
        label: "维度",
        hint: "主世界填 overworld，下界填 nether，末地填 the_end；可留空",
        operators: ["eq", "in"],
        defaultOperator: "eq",
      },
    ],
    progressModes: ["count"],
  },
  {
    key: "block.break",
    label: "破坏方块",
    icon: "textures/icons/pickaxe",
    fields: [
      {
        key: "block",
        label: "方块",
        hint: "例如 minecraft:diamond_ore",
        operators: ["eq", "in"],
        defaultOperator: "eq",
      },
      {
        key: "dimension",
        label: "维度",
        hint: "主世界填 overworld，下界填 nether，末地填 the_end；可留空",
        operators: ["eq", "in"],
        defaultOperator: "eq",
      },
    ],
    progressModes: ["count"],
  },
  {
    key: "item.obtain",
    label: "获得物品",
    icon: "textures/icons/gift",
    fields: [
      {
        key: "item",
        label: "物品",
        hint: "例如 minecraft:diamond",
        operators: ["eq", "in"],
        defaultOperator: "eq",
      },
      {
        key: "amount",
        label: "单次数量",
        hint: "限制一次获得的数量，可留空",
        operators: ["gte", "lte"],
        defaultOperator: "gte",
      },
    ],
    progressModes: ["count", "sum"],
    sumFields: [{ key: "amount", label: "获得数量" }],
  },
  {
    key: "player.online_time",
    label: "在线时长",
    icon: "textures/icons/clock",
    fields: [
      {
        key: "dimension",
        label: "维度",
        hint: "只统计某个维度时填写，可留空",
        operators: ["eq", "in"],
        defaultOperator: "eq",
      },
    ],
    progressModes: ["sum"],
    sumFields: [{ key: "seconds", label: "在线秒数" }],
  },
];

export const questRewardSchemas: QuestRewardSchema[] = [
  {
    key: "give_item",
    label: "给予物品",
    icon: "textures/icons/gift",
    permissionLevel: "normal",
    fields: [
      { key: "item", label: "物品", hint: "例如 minecraft:diamond", type: "string", required: true },
      { key: "amount", label: "数量", hint: "正整数", type: "number", required: true },
    ],
  },
  {
    key: "add_money",
    label: "增加金币",
    icon: "textures/icons/coins",
    permissionLevel: "normal",
    fields: [{ key: "amount", label: "金币数量", hint: "正整数", type: "number", required: true }],
  },
  {
    key: "add_exp",
    label: "增加经验",
    icon: "textures/icons/star",
    permissionLevel: "normal",
    fields: [{ key: "amount", label: "经验数量", hint: "正整数", type: "number", required: true }],
  },
  {
    key: "send_message",
    label: "发送消息",
    icon: "textures/icons/chat_bubble_white",
    permissionLevel: "normal",
    fields: [{ key: "message", label: "消息内容", hint: "完成任务后提示给玩家看的文字", type: "string", required: true }],
  },
  {
    key: "run_command",
    label: "执行服务器命令",
    icon: "textures/icons/terminal",
    permissionLevel: "advanced",
    fields: [{ key: "command", label: "命令", hint: "高级用法：不要带 /，可使用 {player}", type: "string", required: true }],
  },
];

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 10000).toString(36)}`;
}

function slugify(input: string): string {
  const normalized = input.trim().toLowerCase().replace(/[^a-z0-9_\-]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || createId("quest");
}

class QuestDefinitionService {
  private db?: Database<QuestDefinition>;

  constructor() {
    system.run(() => {
      this.db = new Database<QuestDefinition>("quest_definitions");
    });
  }

  getAll(): QuestDefinition[] {
    return Object.values(this.db?.getAll() ?? {}).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  isReady(): boolean {
    return this.db !== undefined;
  }

  get(id: string): QuestDefinition | undefined {
    return this.db?.get(id);
  }

  save(definition: QuestDefinition): boolean {
    if (!this.db) return false;
    try {
      this.db.set(definition.id, { ...definition, updatedAt: Date.now() });
      this.db.save(true);
      return true;
    } catch (error) {
      console.error("[QuestDefinitionService] 保存任务定义失败:", error);
      return false;
    }
  }

  delete(id: string): boolean {
    if (!this.db) return false;
    const deleted = this.db.delete(id);
    if (deleted) {
      try {
        this.db.save(true);
      } catch (error) {
        console.error("[QuestDefinitionService] 删除任务定义后保存失败:", error);
      }
    }
    return deleted;
  }

  createDraft(title = "新任务"): QuestDefinition {
    const now = Date.now();
    return {
      id: slugify(title),
      title,
      description: "",
      scope: "once",
      autoAccept: false,
      enabled: true,
      completeWhen: "all",
      goals: [],
      rewards: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  createGoal(eventKey: string): QuestGoalDefinition {
    const schema = getQuestEventSchema(eventKey) ?? questEventSchemas[0];
    const mode = schema.progressModes[0] ?? "count";
    const field = mode === "sum" ? schema.sumFields?.[0]?.key : undefined;
    return {
      id: createId("goal"),
      event: schema.key,
      filters: {},
      progress: {
        mode,
        target: mode === "sum" && schema.key === "player.online_time" ? 3600 : 1,
        field,
      },
    };
  }

  createReward(actionKey: string): QuestRewardDefinition {
    const schema = getQuestRewardSchema(actionKey) ?? questRewardSchemas[0];
    const params: Record<string, string | number | boolean> = {};
    schema.fields.forEach((field) => {
      params[field.key] = field.type === "number" ? 1 : field.type === "boolean" ? false : "";
    });
    return {
      id: createId("reward"),
      action: schema.key,
      params,
    };
  }
}

export function getQuestEventSchema(eventKey: string): QuestEventSchema | undefined {
  return questEventSchemas.find((schema) => schema.key === eventKey);
}

export function getQuestRewardSchema(actionKey: string): QuestRewardSchema | undefined {
  return questRewardSchemas.find((schema) => schema.key === actionKey);
}

export function getQuestMobById(id: string): QuestMobOption | undefined {
  return questMobCatalog.find((mob) => mob.id === id);
}

export function getQuestMobsByCategory(category: QuestMobCategory): QuestMobOption[] {
  return questMobCatalog.filter((mob) => mob.category === category);
}

export function getQuestMobCategoryLabel(category: QuestMobCategory): string {
  return questMobCategoryOptions.find((option) => option.value === category)?.label ?? category;
}

export function getOptionIndex<T extends string>(options: { value: T }[], value: T): number {
  return Math.max(0, options.findIndex((option) => option.value === value));
}

export function parseFilterValue(operator: QuestFilterOperator, rawValue: string): string | number | boolean | string[] {
  const trimmed = rawValue.trim();
  if (operator === "in") {
    return trimmed
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  const numeric = Number(trimmed);
  if (trimmed !== "" && Number.isFinite(numeric)) return numeric;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return trimmed;
}

export function formatFilterValue(value: string | number | boolean | string[]): string {
  return Array.isArray(value) ? value.join(",") : String(value);
}

export default new QuestDefinitionService();
