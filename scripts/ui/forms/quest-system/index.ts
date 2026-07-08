import { Player, system } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { ChestFormData, ChestFormResponse } from "../../components/chest-ui";
import { color } from "../../../shared/utils/color";
import {
  PersistedItemStack,
  serializeItemStack,
} from "../../../shared/utils/item-stack-persist";
import questPlayerService from "../../../features/quest/services/quest-player";
import questDefinitionService, {
  QuestDefinition,
  QuestFilter,
  QuestGoalDefinition,
  QuestRewardDefinition,
  formatFilterValue,
  getQuestEventSchema,
  getQuestMobById,
  getQuestMobCategoryLabel,
  getQuestMobsByCategory,
  getQuestRewardSchema,
  parseFilterValue,
  questCompleteWhenOptions,
  questEventSchemas,
  questMobCatalog,
  questMobCategoryOptions,
  questOperatorOptions,
  questProgressModeOptions,
  questRewardSchemas,
  questScopeOptions,
} from "../../../features/quest/services/quest-definition";

type DduiObservableBoolean = { getData: () => boolean; setData?: (value: boolean) => void };
type DduiObservableNumber = {
  getData: () => number;
  setData?: (value: number) => void;
  subscribe?: (callback: (value: number) => void) => unknown;
};
type DduiObservableString = { getData: () => string; setData?: (value: string) => void };

type RewardFieldControl =
  | { kind: "boolean"; field: { key: string; label: string; hint: string; type: string }; booleanValue: DduiObservableBoolean }
  | {
      kind: "text";
      field: { key: string; label: string; hint: string; type: string };
      textValue: DduiObservableString;
    };

interface QuestDduiCapabilities {
  CustomForm: any;
  ObservableBoolean: new (value: boolean, options?: { clientWritable: boolean }) => DduiObservableBoolean;
  ObservableNumber: new (value: number, options?: { clientWritable: boolean }) => DduiObservableNumber;
  ObservableString: new (value: string, options?: { clientWritable: boolean }) => DduiObservableString;
}

interface QuestEditorControls {
  title: DduiObservableString;
  description: DduiObservableString;
  scopeIndex: DduiObservableNumber;
  completeWhenIndex: DduiObservableNumber;
  enabled: DduiObservableBoolean;
  autoAccept: DduiObservableBoolean;
}

const playerDrafts = new Map<string, QuestDefinition>();
const CLIENT_WRITABLE = { clientWritable: true };
const FORM_LAYOUT_MARKER_REGEX = /(?:§c§h§e§s§t|§f§u§r§n§a§c§e)(?:§[0-9a-z])*(?:§r)?/gi;

const questDimensionOptions = [
  { label: "不限维度", value: "" },
  { label: "主世界", value: "overworld" },
  { label: "下界", value: "nether" },
  { label: "末地", value: "the_end" },
];

async function getQuestDduiCapabilities(): Promise<QuestDduiCapabilities | null> {
  try {
    const ui = (await import("@minecraft/server-ui")) as Record<string, any>;
    const { CustomForm, ObservableBoolean, ObservableNumber, ObservableString } = ui;
    if (!CustomForm || !ObservableBoolean || !ObservableNumber || !ObservableString) return null;
    return { CustomForm, ObservableBoolean, ObservableNumber, ObservableString };
  } catch {
    return null;
  }
}

function createCustomForm(ddui: QuestDduiCapabilities, player: Player, title: string): any {
  if (typeof ddui.CustomForm.create === "function") return ddui.CustomForm.create(player, title);
  return new ddui.CustomForm(player, title);
}

function writableBoolean(ddui: QuestDduiCapabilities, value: boolean): DduiObservableBoolean {
  return new ddui.ObservableBoolean(value, CLIENT_WRITABLE);
}

function writableNumber(ddui: QuestDduiCapabilities, value: number): DduiObservableNumber {
  return new ddui.ObservableNumber(value, CLIENT_WRITABLE);
}

function writableString(ddui: QuestDduiCapabilities, value: string): DduiObservableString {
  return new ddui.ObservableString(value, CLIENT_WRITABLE);
}

function safeCloseForm(form: { close?: () => void }): void {
  try {
    form.close?.();
  } catch {
    // 表单可能已经关闭。
  }
}

function deferOpen(callback: () => void): void {
  system.run(callback);
}

function cloneDefinition(definition: QuestDefinition): QuestDefinition {
  return JSON.parse(JSON.stringify(definition)) as QuestDefinition;
}

function cloneGoal(goal: QuestGoalDefinition): QuestGoalDefinition {
  return JSON.parse(JSON.stringify(goal)) as QuestGoalDefinition;
}

function cloneReward(reward: QuestRewardDefinition): QuestRewardDefinition {
  return JSON.parse(JSON.stringify(reward)) as QuestRewardDefinition;
}

function stripFormLayoutMarkers(text: string): string {
  return text.replace(FORM_LAYOUT_MARKER_REGEX, "");
}

function stripFormLayoutMarkersFromText(text: string): string {
  return stripFormLayoutMarkers(text);
}

function getQuestDisplayTitle(quest: Pick<QuestDefinition, "title">): string {
  return stripFormLayoutMarkers(quest.title).trim() || "未命名任务";
}

function getDraft(player: Player, fallback?: QuestDefinition): QuestDefinition {
  const existing = playerDrafts.get(player.id);
  if (existing) return existing;
  const draft = cloneDefinition(fallback ?? questDefinitionService.createDraft());
  playerDrafts.set(player.id, draft);
  return draft;
}

function setDraft(player: Player, draft: QuestDefinition): void {
  playerDrafts.set(player.id, draft);
}

function optionIndex<T extends string>(options: { value: T }[], value: T): number {
  return Math.max(0, options.findIndex((option) => option.value === value));
}

function dimensionIndex(value: string | undefined): number {
  return Math.max(0, questDimensionOptions.findIndex((option) => option.value === (value ?? "")));
}

function dropdownItems(options: { label: string }[]): { label: string; value: number }[] {
  return options.map((option, index) => ({ label: option.label, value: index }));
}

function toNumber(raw: string, fallback: number): number {
  const value = Math.floor(Number(raw));
  return Number.isFinite(value) ? value : fallback;
}

function sameStringSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((item) => set.has(item));
}

function getEventLabel(eventKey: string): string {
  return getQuestEventSchema(eventKey)?.label ?? eventKey;
}

function getRewardLabel(actionKey: string): string {
  return getQuestRewardSchema(actionKey)?.label ?? actionKey;
}

function getRewardItemSnapshot(reward: QuestRewardDefinition): PersistedItemStack | undefined {
  const value = reward.params.itemSnapshot;
  if (!value || typeof value !== "object") return undefined;
  const data = value as Partial<PersistedItemStack>;
  if (typeof data.typeId !== "string" || !data.typeId.trim()) return undefined;
  if (!Number.isFinite(Number(data.amount)) || Number(data.amount) <= 0) return undefined;
  return data as PersistedItemStack;
}

function clearStaleRewardItemSnapshot(reward: QuestRewardDefinition): void {
  const snapshot = getRewardItemSnapshot(reward);
  if (!snapshot) return;
  if (snapshot.typeId !== String(reward.params.item ?? "").trim()) {
    delete reward.params.itemSnapshot;
  }
}

function getScopeLabel(scope: QuestDefinition["scope"]): string {
  return questScopeOptions.find((option) => option.value === scope)?.label ?? scope;
}

function getCompleteWhenLabel(value: QuestDefinition["completeWhen"]): string {
  return questCompleteWhenOptions.find((option) => option.value === value)?.label ?? value;
}

function getOperatorLabel(value: string): string {
  return questOperatorOptions.find((option) => option.value === value)?.label ?? value;
}

function formatEntityFilterLabel(filter: QuestFilter | undefined): string {
  if (!filter) return "所有生物";
  const values = Array.isArray(filter.value) ? filter.value.map(String) : [String(filter.value)];
  if (values.length === 0) return "所有生物";

  const allMobIds = questMobCatalog.map((mob) => mob.id);
  if (sameStringSet(values, allMobIds)) return "所有生物";

  for (const option of questMobCategoryOptions) {
    const categoryIds = getQuestMobsByCategory(option.value).map((mob) => mob.id);
    if (sameStringSet(values, categoryIds)) return `全部${option.label}`;
  }

  if (values.length === 1) {
    const mob = getQuestMobById(values[0]);
    return mob ? mob.label : values[0];
  }

  return `${values.length} 种生物`;
}

function getEntityFilterIds(goal: QuestGoalDefinition): string[] {
  const filter = goal.filters.entity;
  if (!filter) return [];
  return Array.isArray(filter.value) ? filter.value.map(String) : [String(filter.value)];
}

function setEntityFilter(goal: QuestGoalDefinition, ids: string[]): void {
  const uniqueIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) {
    delete goal.filters.entity;
    return;
  }
  goal.filters.entity = uniqueIds.length === 1 ? { op: "eq", value: uniqueIds[0] } : { op: "in", value: uniqueIds };
}

function setDimensionFilter(goal: QuestGoalDefinition, dimension: string): void {
  if (!dimension) {
    delete goal.filters.dimension;
    return;
  }
  goal.filters.dimension = { op: "eq", value: dimension };
}

function createKillEntityGoal(entityId: string, target: number, dimension = ""): QuestGoalDefinition {
  const goal = questDefinitionService.createGoal("entity.kill");
  goal.progress.mode = "count";
  goal.progress.target = Math.max(1, Math.floor(target));
  setEntityFilter(goal, [entityId]);
  setDimensionFilter(goal, dimension);
  return goal;
}

function formatGoalSummary(goal: QuestGoalDefinition, index: number): string {
  if (goal.event === "entity.kill") {
    return `${index + 1}. 击杀${formatEntityFilterLabel(goal.filters.entity)}\n数量 ${goal.progress.target}`;
  }

  const schema = getQuestEventSchema(goal.event);
  const filterCount = Object.keys(goal.filters).length;
  const modeLabel = questProgressModeOptions.find((option) => option.value === goal.progress.mode)?.label ?? goal.progress.mode;
  return `${index + 1}. ${schema?.label ?? goal.event}\n${modeLabel} ${goal.progress.target}，条件 ${filterCount}个`;
}

function formatGoalDetail(goal: QuestGoalDefinition): string {
  if (goal.event === "entity.kill") {
    const dimensionFilter = goal.filters.dimension;
    return [
      "触发行为: 击杀生物",
      `击杀对象: ${formatEntityFilterLabel(goal.filters.entity)}`,
      `击杀数量: ${goal.progress.target}`,
      `维度: ${dimensionFilter ? formatFilterValue(dimensionFilter.value) : "不限"}`,
    ].join("\n");
  }

  const schema = getQuestEventSchema(goal.event);
  const modeLabel = questProgressModeOptions.find((option) => option.value === goal.progress.mode)?.label ?? goal.progress.mode;
  const sumFieldLabel = schema?.sumFields?.find((field) => field.key === goal.progress.field)?.label;
  const lines = [
    `触发行为: ${schema?.label ?? goal.event}`,
    `累计方式: ${modeLabel}${sumFieldLabel ? `（${sumFieldLabel}）` : ""}`,
    `目标数值: ${goal.progress.target}`,
    "条件:",
  ];

  const filterLines = Object.entries(goal.filters).map(([key, filter]) => {
    const fieldLabel = schema?.fields.find((field) => field.key === key)?.label ?? key;
    return `${fieldLabel} ${getOperatorLabel(filter.op)} ${formatFilterValue(filter.value)}`;
  });

  lines.push(...(filterLines.length > 0 ? filterLines : ["无额外条件"]));
  return lines.join("\n");
}

function formatRewardSummary(reward: QuestRewardDefinition, index: number): string {
  const schema = getQuestRewardSchema(reward.action);
  const params = Object.entries(reward.params)
    .filter(([key]) => key !== "itemSnapshot")
    .filter(([, value]) => String(value).trim() !== "")
    .map(([key, value]) => {
      const fieldLabel = schema?.fields.find((field) => field.key === key)?.label ?? key;
      return `${fieldLabel}: ${value}`;
    })
    .join(" ");
  const itemSnapshot = getRewardItemSnapshot(reward);
  const snapshotText = itemSnapshot ? `${params ? " " : ""}完整物品模板` : "";
  return `${index + 1}. ${schema?.label ?? reward.action}${params || snapshotText ? `\n${params}${snapshotText}` : ""}`;
}

function formatRewardDetail(reward: QuestRewardDefinition): string {
  const schema = getQuestRewardSchema(reward.action);
  const lines = [`奖励类型: ${schema?.label ?? reward.action}`, "奖励内容:"];
  const paramLines = Object.entries(reward.params)
    .filter(([key]) => key !== "itemSnapshot")
    .map(([key, value]) => {
      const fieldLabel = schema?.fields.find((field) => field.key === key)?.label ?? key;
      return `${fieldLabel}: ${value}`;
    });
  if (getRewardItemSnapshot(reward)) paramLines.push("物品数据: 已保存完整物品模板");
  lines.push(...(paramLines.length > 0 ? paramLines : ["未配置"]));
  return lines.join("\n");
}

function formatQuestPreview(draft: QuestDefinition): string {
  const lines = [
    `任务: ${getQuestDisplayTitle(draft)}`,
    draft.description ? `说明: ${draft.description}` : "说明: 无",
    `周期: ${getScopeLabel(draft.scope)}`,
    `完成条件: ${getCompleteWhenLabel(draft.completeWhen)}`,
    `状态: ${draft.enabled ? "启用" : "停用"}  自动领取: ${draft.autoAccept ? "是" : "否"}`,
    "",
    "目标:",
  ];

  lines.push(...(draft.goals.length > 0 ? draft.goals.map(formatGoalSummary) : ["还没有添加目标"]));
  lines.push("", "奖励:");
  lines.push(...(draft.rewards.length > 0 ? draft.rewards.map(formatRewardSummary) : ["还没有添加奖励"]));
  return lines.join("\n");
}

function validateReward(reward: QuestRewardDefinition): string | undefined {
  const schema = getQuestRewardSchema(reward.action);
  if (!schema) return `奖励动作不存在: ${reward.action}`;

  for (const field of schema.fields) {
    if (field.required && String(reward.params[field.key] ?? "").trim() === "") {
      return `奖励「${schema.label}」缺少字段: ${field.label}`;
    }
    if (field.type === "number") {
      const value = Number(reward.params[field.key]);
      if (!Number.isFinite(value) || value <= 0) return `奖励「${schema.label}」的 ${field.label} 必须是正数`;
    }
  }
  return undefined;
}

function validateDraft(draft: QuestDefinition): string | undefined {
  draft.title = getQuestDisplayTitle(draft);
  if (!draft.title.trim()) return "任务名称不能为空";
  if (!draft.id.trim()) return "任务内部编号生成失败，请重新打开任务系统再试";
  if (draft.goals.length === 0) return "至少需要添加一个任务目标";
  if (draft.rewards.length === 0) return "至少需要添加一个奖励";

  for (const goal of draft.goals) {
    if (!getQuestEventSchema(goal.event)) return `目标事件不存在: ${goal.event}`;
    if (!Number.isFinite(goal.progress.target) || goal.progress.target <= 0) return "目标数值必须是正整数";
  }

  for (const reward of draft.rewards) {
    const error = validateReward(reward);
    if (error) return error;
  }

  return undefined;
}

async function showMessage(player: Player, title: string, body: string, afterClose?: () => void): Promise<void> {
  const ddui = await getQuestDduiCapabilities();
  if (!ddui) {
    player.sendMessage(`${title}: ${body}`);
    afterClose?.();
    return;
  }

  const form = createCustomForm(ddui, player, title);
  form.label(body);
  form.button("确认", () => {
    safeCloseForm(form);
    if (afterClose) deferOpen(afterClose);
  });
  form.closeButton?.();
  await form.show();
}

function showActionMessage(player: Player, title: string, body: string, afterClose?: () => void): void {
  const form = new ActionFormData().title(stripFormLayoutMarkersFromText(title)).body(stripFormLayoutMarkersFromText(body));
  form.button("确认");
  form.show(player).then(() => afterClose?.());
}

function formatPlayerGoalLine(player: Player, quest: QuestDefinition, goal: QuestGoalDefinition, index: number): string {
  const current = questPlayerService.getProgress(player, quest, goal);
  const target = goal.progress.target;
  if (goal.event === "entity.kill") {
    return stripFormLayoutMarkersFromText(`${index + 1}. 击杀${formatEntityFilterLabel(goal.filters.entity)} ${current}/${target}`);
  }
  const schema = getQuestEventSchema(goal.event);
  return stripFormLayoutMarkersFromText(`${index + 1}. ${schema?.label ?? goal.event} ${current}/${target}`);
}

function formatPlayerQuestDetail(player: Player, quest: QuestDefinition): string {
  const state = questPlayerService.getQuestState(player, quest);
  const status = !state
    ? "未接受"
    : state.claimedAt
      ? "已领取"
      : questPlayerService.canClaim(player, quest)
        ? "可领取"
        : questPlayerService.isCompleted(player, quest)
          ? "已完成"
          : "进行中";
  const lines = [
    `§e${getQuestDisplayTitle(quest)}`,
    quest.description ? `§7${stripFormLayoutMarkersFromText(quest.description)}` : "",
    `§f状态: §a${status}`,
    `§f周期: §e${getScopeLabel(quest.scope)}`,
    `§f完成条件: §e${getCompleteWhenLabel(quest.completeWhen)}`,
    "",
    "§f目标:",
    ...quest.goals.map((goal, index) => `§7${formatPlayerGoalLine(player, quest, goal, index)}`),
    "",
    "§f奖励:",
    ...(quest.rewards.length > 0 ? quest.rewards.map((reward, index) => `§7${formatRewardSummary(reward, index)}`) : ["§7无"]),
  ];
  return stripFormLayoutMarkersFromText(lines.filter((line) => line !== "").join("\n"));
}

export function openQuestPlayerForm(player: Player, returnForm?: () => void): void {
  if (!questDefinitionService.isReady() || !questPlayerService.isReady()) {
    showActionMessage(player, "我的任务", "任务系统正在初始化，请稍后再试。", returnForm);
    return;
  }

  const summary = questPlayerService.getSummary(player);
  const form = new ActionFormData()
    .title("我的任务")
    .body(
      [
        `§f已发布任务: §e${summary.total}`,
        `§f已接受: §a${summary.accepted}`,
        `§f可领取: §6${summary.claimable}`,
        `§f可接受: §b${summary.available}`,
      ].join("\n")
    );

  form.button(`已接受任务 (${summary.accepted})`, "textures/icons/quest_log");
  form.button(`可接任务 (${summary.available})`, "textures/icons/marker_quest");
  form.button("返回", "textures/icons/back");

  form.show(player).then((response) => {
    if (response.canceled) return;
    if (response.selection === 0) {
      openQuestAcceptedListForm(player, () => openQuestPlayerForm(player, returnForm));
      return;
    }
    if (response.selection === 1) {
      openQuestAvailableListForm(player, () => openQuestPlayerForm(player, returnForm));
      return;
    }
    if (returnForm) returnForm();
  });
}

function getAcceptedQuestRows(player: Player): QuestDefinition[] {
  return questPlayerService.getEnabledQuests().filter((quest) => questPlayerService.getQuestState(player, quest));
}

function openQuestAcceptedListForm(player: Player, back: () => void): void {
  const quests = getAcceptedQuestRows(player);
  if (quests.length === 0) {
    showActionMessage(player, "已接受任务", "你还没有接受任何任务。", back);
    return;
  }

  const form = new ActionFormData().title("已接受任务").body("选择任务查看进度和领取奖励。");
  quests.forEach((quest) => {
    const canClaim = questPlayerService.canClaim(player, quest);
    const completed = questPlayerService.isCompleted(player, quest);
    const state = questPlayerService.getQuestState(player, quest);
    const status = state?.claimedAt ? "已领取" : canClaim ? "可领取" : completed ? "已完成" : "进行中";
    form.button(`${getQuestDisplayTitle(quest)}\n§0${status}`, canClaim ? "textures/icons/gift" : "textures/icons/quest_log");
  });
  form.button("返回", "textures/icons/back");

  form.show(player).then((response) => {
    if (response.canceled) return;
    if (response.selection === undefined) return;
    if (response.selection >= quests.length) {
      back();
      return;
    }
    openQuestPlayerDetailForm(player, quests[response.selection], () => openQuestAcceptedListForm(player, back));
  });
}

function openQuestAvailableListForm(player: Player, back: () => void): void {
  const quests = questPlayerService.getEnabledQuests().filter((quest) => questPlayerService.canAccept(player, quest));
  if (quests.length === 0) {
    showActionMessage(player, "可接任务", "当前没有可接受的新任务。", back);
    return;
  }

  const form = new ActionFormData().title("可接任务").body("选择任务查看详情。");
  quests.forEach((quest) => {
    form.button(`${getQuestDisplayTitle(quest)}\n§0${quest.goals.length}目标/${quest.rewards.length}奖励`, "textures/icons/marker_quest");
  });
  form.button("返回", "textures/icons/back");

  form.show(player).then((response) => {
    if (response.canceled) return;
    if (response.selection === undefined) return;
    if (response.selection >= quests.length) {
      back();
      return;
    }
    openQuestPlayerDetailForm(player, quests[response.selection], () => openQuestAvailableListForm(player, back));
  });
}

function openQuestPlayerDetailForm(player: Player, quest: QuestDefinition, back: () => void): void {
  const canAccept = questPlayerService.canAccept(player, quest);
  const canClaim = questPlayerService.canClaim(player, quest);
  const questTitle = getQuestDisplayTitle(quest);
  quest.title = questTitle;
  quest.description = stripFormLayoutMarkersFromText(quest.description);
  const form = new ActionFormData().title("任务详情").body(formatPlayerQuestDetail(player, quest));
  const actions: Array<() => void> = [];

  if (canClaim) {
    form.button("领取奖励", "textures/icons/gift");
    actions.push(() => {
      const error = questPlayerService.claimQuest(player, quest.id);
      showActionMessage(
        player,
        error ? "领取失败" : "领取成功",
        error ? color.red(error) : color.green(`任务「${questTitle}」奖励已领取。`),
        () => openQuestPlayerDetailForm(player, quest, back)
      );
    });
  }

  if (canAccept) {
    form.button("接受任务", "textures/icons/marker_quest");
    actions.push(() => {
      const error = questPlayerService.acceptQuest(player, quest.id);
      showActionMessage(
        player,
        error ? "接受失败" : "接受成功",
        error ? color.red(error) : color.green(`已接受任务「${questTitle}」。`),
        () => openQuestPlayerDetailForm(player, quest, back)
      );
    });
  }

  form.button("返回", "textures/icons/back");
  actions.push(back);

  form.show(player).then((response) => {
    if (response.canceled || response.selection === undefined) return;
    actions[response.selection]?.();
  });
}

function applyEditorControls(draft: QuestDefinition, controls: QuestEditorControls): string | undefined {
  const nextTitle = stripFormLayoutMarkers(controls.title.getData()).trim();
  if (!nextTitle) return "任务名称不能为空";

  draft.title = nextTitle;
  draft.description = controls.description.getData();
  draft.scope = questScopeOptions[controls.scopeIndex.getData()]?.value ?? "once";
  draft.completeWhen = questCompleteWhenOptions[controls.completeWhenIndex.getData()]?.value ?? "all";
  draft.enabled = controls.enabled.getData();
  draft.autoAccept = controls.autoAccept.getData();
  draft.updatedAt = Date.now();
  return undefined;
}

function addEditorFields(ddui: QuestDduiCapabilities, form: any, draft: QuestDefinition): QuestEditorControls {
  const controls: QuestEditorControls = {
    title: writableString(ddui, getQuestDisplayTitle(draft)),
    description: writableString(ddui, draft.description),
    scopeIndex: writableNumber(ddui, optionIndex(questScopeOptions, draft.scope)),
    completeWhenIndex: writableNumber(ddui, optionIndex(questCompleteWhenOptions, draft.completeWhen)),
    enabled: writableBoolean(ddui, draft.enabled),
    autoAccept: writableBoolean(ddui, draft.autoAccept),
  };

  form.header?.("基础信息");
  form.textField("任务名称", controls.title, { description: "玩家看到的任务名称" });
  form.textField("任务描述", controls.description, { description: "可留空" });
  form.dropdown("任务周期", controls.scopeIndex, dropdownItems(questScopeOptions));
  form.dropdown("完成条件", controls.completeWhenIndex, dropdownItems(questCompleteWhenOptions));
  form.toggle("启用任务", controls.enabled);
  form.toggle("玩家自动接受任务", controls.autoAccept);
  return controls;
}

export function openQuestSystemManageForm(player: Player, returnForm?: () => void): void {
  void openQuestSystemManageDdui(player, returnForm);
}

async function openQuestSystemManageDdui(player: Player, returnForm?: () => void): Promise<void> {
  const ddui = await getQuestDduiCapabilities();
  if (!ddui) {
    player.sendMessage(color.red("当前运行时不支持 DDUI，任务系统无法打开。"));
    returnForm?.();
    return;
  }

  if (!questDefinitionService.isReady()) {
    await showMessage(player, "任务系统初始化中", "任务数据库还没准备好，请稍后再打开任务系统。", returnForm);
    return;
  }

  const tasks = questDefinitionService.getAll();
  const form = createCustomForm(ddui, player, "任务系统");
  form.label(`当前已保存 ${tasks.length} 个任务。`);
  form.button("新建任务", () => {
    safeCloseForm(form);
    const draft = questDefinitionService.createDraft();
    setDraft(player, draft);
    deferOpen(() => openQuestEditor(player));
  });
  form.button("示例: 击杀僵尸", () => {
    safeCloseForm(form);
    const draft = createZombieSample();
    setDraft(player, draft);
    deferOpen(() => openQuestEditor(player));
  });
  form.divider?.();

  tasks.forEach((task) => {
    const state = task.enabled ? "启用" : "停用";
    form.button(`${getQuestDisplayTitle(task)}  ${state}  ${task.goals.length}目标/${task.rewards.length}奖励`, () => {
      safeCloseForm(form);
      setDraft(player, cloneDefinition(task));
      deferOpen(() => openQuestEditor(player));
    });
  });

  form.divider?.();
  form.button("返回", () => {
    safeCloseForm(form);
    playerDrafts.delete(player.id);
    if (returnForm) deferOpen(returnForm);
  });
  form.closeButton?.();
  await form.show();
}

function openQuestEditor(player: Player): void {
  void openQuestEditorDdui(player);
}

async function openQuestEditorDdui(player: Player): Promise<void> {
  const ddui = await getQuestDduiCapabilities();
  if (!ddui) {
    player.sendMessage(color.red("当前运行时不支持 DDUI，任务系统无法打开。"));
    return;
  }

  const draft = getDraft(player);
  const form = createCustomForm(ddui, player, `编辑任务: ${getQuestDisplayTitle(draft)}`);
  const controls = addEditorFields(ddui, form, draft);

  form.divider?.();
  form.header?.("目标");
  if (draft.goals.length === 0) form.label("还没有添加目标。");
  draft.goals.forEach((goal, index) => {
    form.label(formatGoalSummary(goal, index));
    form.button(`编辑目标 ${index + 1}`, () => {
      const error = applyEditorControls(draft, controls);
      if (error) {
        player.sendMessage(color.red(error));
        return;
      }
      safeCloseForm(form);
      deferOpen(() => openEditGoal(player, index));
    });
    form.button(`删除目标 ${index + 1}`, () => {
      draft.goals.splice(index, 1);
      draft.updatedAt = Date.now();
      setDraft(player, draft);
      safeCloseForm(form);
      deferOpen(() => openQuestEditor(player));
    });
  });
  form.button("添加目标", () => {
    const error = applyEditorControls(draft, controls);
    if (error) {
      player.sendMessage(color.red(error));
      return;
    }
    safeCloseForm(form);
    deferOpen(() => openAddGoal(player));
  });

  form.divider?.();
  form.header?.("奖励");
  if (draft.rewards.length === 0) form.label("还没有添加奖励。");
  draft.rewards.forEach((reward, index) => {
    form.label(formatRewardSummary(reward, index));
    form.button(`编辑奖励 ${index + 1}`, () => {
      const error = applyEditorControls(draft, controls);
      if (error) {
        player.sendMessage(color.red(error));
        return;
      }
      safeCloseForm(form);
      deferOpen(() => openEditReward(player, index));
    });
    form.button(`删除奖励 ${index + 1}`, () => {
      draft.rewards.splice(index, 1);
      draft.updatedAt = Date.now();
      setDraft(player, draft);
      safeCloseForm(form);
      deferOpen(() => openQuestEditor(player));
    });
  });
  form.button("添加奖励", () => {
    const error = applyEditorControls(draft, controls);
    if (error) {
      player.sendMessage(color.red(error));
      return;
    }
    safeCloseForm(form);
    deferOpen(() => openAddReward(player));
  });

  form.divider?.();
  form.header?.("预览");
  form.label(formatQuestPreview(draft));
  form.button("保存任务到数据库", () => {
    const fieldError = applyEditorControls(draft, controls);
    if (fieldError) {
      player.sendMessage(color.red(fieldError));
      return;
    }

    const error = validateDraft(draft);
    if (error) {
      player.sendMessage(color.red(error));
      return;
    }

    const saved = questDefinitionService.save(draft);
    if (!saved) {
      player.sendMessage(color.red("任务数据库暂时不可用，请稍后再试。"));
      return;
    }

    playerDrafts.delete(player.id);
    safeCloseForm(form);
    deferOpen(() => {
      void showMessage(player, "保存成功", `任务「${getQuestDisplayTitle(draft)}」已保存。`, () => openQuestSystemManageForm(player));
    });
  });

  form.button("删除任务", () => {
    const error = applyEditorControls(draft, controls);
    if (error) {
      player.sendMessage(color.red(error));
      return;
    }
    safeCloseForm(form);
    deferOpen(() => openDeleteQuestConfirm(player));
  });

  form.button("返回任务列表", () => {
    safeCloseForm(form);
    playerDrafts.delete(player.id);
    deferOpen(() => openQuestSystemManageForm(player));
  });

  form.closeButton?.();
  await form.show();
}

function openDeleteQuestConfirm(player: Player): void {
  void openDeleteQuestConfirmDdui(player);
}

async function openDeleteQuestConfirmDdui(player: Player): Promise<void> {
  const ddui = await getQuestDduiCapabilities();
  if (!ddui) return;

  const draft = getDraft(player);
  const form = createCustomForm(ddui, player, "删除任务");
  form.label(`确认删除任务「${getQuestDisplayTitle(draft)}」吗？`);
  form.button("确认删除", () => {
    questDefinitionService.delete(draft.id);
    playerDrafts.delete(player.id);
    safeCloseForm(form);
    deferOpen(() => openQuestSystemManageForm(player));
  });
  form.button("取消", () => {
    safeCloseForm(form);
    deferOpen(() => openQuestEditor(player));
  });
  form.closeButton?.();
  await form.show();
}

function openAddGoal(player: Player): void {
  void openAddGoalDdui(player);
}

async function openAddGoalDdui(player: Player): Promise<void> {
  const ddui = await getQuestDduiCapabilities();
  if (!ddui) return;

  const form = createCustomForm(ddui, player, "添加目标");
  questEventSchemas.forEach((schema) => {
    form.button(schema.key === "entity.kill" ? "击杀生物" : schema.label, () => {
      safeCloseForm(form);
      if (schema.key === "entity.kill") {
        deferOpen(() => openAddKillGoalMode(player));
        return;
      }

      const goal = questDefinitionService.createGoal(schema.key);
      deferOpen(() =>
        openGenericGoalEditor(player, goal, (savedGoal) => {
          const draft = getDraft(player);
          draft.goals.push(savedGoal);
          draft.updatedAt = Date.now();
          setDraft(player, draft);
          openQuestEditor(player);
        })
      );
    });
  });
  form.button("返回", () => {
    safeCloseForm(form);
    deferOpen(() => openQuestEditor(player));
  });
  form.closeButton?.();
  await form.show();
}

function openEditGoal(player: Player, goalIndex: number): void {
  const draft = getDraft(player);
  const goal = draft.goals[goalIndex];
  if (!goal) {
    openQuestEditor(player);
    return;
  }

  const save = (savedGoal: QuestGoalDefinition) => {
    const current = getDraft(player);
    current.goals[goalIndex] = savedGoal;
    current.updatedAt = Date.now();
    setDraft(player, current);
    openQuestEditor(player);
  };

  if (goal.event === "entity.kill") {
    openKillCumulativeGoalEditor(player, cloneGoal(goal), save);
    return;
  }
  openGenericGoalEditor(player, cloneGoal(goal), save);
}

function openAddKillGoalMode(player: Player): void {
  void openAddKillGoalModeDdui(player);
}

async function openAddKillGoalModeDdui(player: Player): Promise<void> {
  const ddui = await getQuestDduiCapabilities();
  if (!ddui) return;

  const form = createCustomForm(ddui, player, "击杀生物目标");
  form.label(["累计击杀: 僵尸或骷髅合计击杀 10 个。", "分别计数: 僵尸 10 个、骷髅 5 个，各自独立计数。"].join("\n"));
  form.button("累计击杀", () => {
    safeCloseForm(form);
    const goal = questDefinitionService.createGoal("entity.kill");
    deferOpen(() =>
      openKillCumulativeGoalEditor(player, goal, (savedGoal) => {
        const draft = getDraft(player);
        draft.goals.push(savedGoal);
        draft.updatedAt = Date.now();
        setDraft(player, draft);
        openQuestEditor(player);
      })
    );
  });
  form.button("分别计数", () => {
    safeCloseForm(form);
    deferOpen(() => openSeparateKillGoalEditor(player));
  });
  form.button("返回", () => {
    safeCloseForm(form);
    deferOpen(() => openAddGoal(player));
  });
  form.closeButton?.();
  await form.show();
}

function openKillCumulativeGoalEditor(
  player: Player,
  goal: QuestGoalDefinition,
  onSave: (goal: QuestGoalDefinition) => void
): void {
  void openKillCumulativeGoalEditorDdui(player, goal, onSave);
}

async function openKillCumulativeGoalEditorDdui(
  player: Player,
  goal: QuestGoalDefinition,
  onSave: (goal: QuestGoalDefinition) => void
): Promise<void> {
  const ddui = await getQuestDduiCapabilities();
  if (!ddui) return;

  const selectedIds = new Set(getEntityFilterIds(goal));
  const dimension = String(goal.filters.dimension?.value ?? "");
  const target = writableString(ddui, String(goal.progress.target));
  const dimensionObs = writableNumber(ddui, dimensionIndex(dimension));
  const manualEntities = writableString(ddui, "");
  const mode = writableNumber(ddui, 0);
  const mobRows = questMobCatalog.map((mob) => ({
    mob,
    selected: writableBoolean(ddui, selectedIds.has(mob.id)),
  }));

  const form = createCustomForm(ddui, player, "累计击杀目标");
  form.label("选择生物。\n勾选多个时，共用同一个击杀数量。");
  form.textField("击杀数量", target, { description: "正整数" });
  form.dropdown("维度", dimensionObs, dropdownItems(questDimensionOptions));
  form.dropdown("显示范围", mode, [
    { label: "全部生物", value: 0 },
    ...questMobCategoryOptions.map((option, index) => ({ label: option.label, value: index + 1 })),
  ]);
  form.textField("手动实体", manualEntities, { description: "可留空；多个实体用英文逗号分隔" });
  form.divider?.();

  mobRows.forEach((row) => {
    const categoryIndex = questMobCategoryOptions.findIndex((option) => option.value === row.mob.category) + 1;
    const visible = new ddui.ObservableBoolean(true);
    mode.subscribe?.((value: number) => visible.setData?.(value === 0 || value === categoryIndex));
    visible.setData?.(mode.getData() === 0 || mode.getData() === categoryIndex);
    form.toggle(row.mob.label, row.selected, { description: row.mob.id, visible });
  });

  form.divider?.();
  form.button("保存目标", () => {
    const idsFromToggles = mobRows.filter((row) => row.selected.getData()).map((row) => row.mob.id);
    const manual = manualEntities
      .getData()
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const ids = manual.length > 0 ? manual : idsFromToggles;
    if (ids.length === 0) {
      player.sendMessage(color.red("至少选择一种生物，或手动输入实体。"));
      return;
    }

    goal.progress.mode = "count";
    goal.progress.target = Math.max(1, toNumber(target.getData(), goal.progress.target));
    setEntityFilter(goal, ids);
    setDimensionFilter(goal, questDimensionOptions[dimensionObs.getData()]?.value ?? "");
    safeCloseForm(form);
    deferOpen(() => onSave(goal));
  });
  form.button("返回", () => {
    safeCloseForm(form);
    deferOpen(() => openQuestEditor(player));
  });
  form.closeButton?.();
  await form.show();
}

function openSeparateKillGoalEditor(player: Player): void {
  void openSeparateKillGoalEditorDdui(player);
}

async function openSeparateKillGoalEditorDdui(player: Player): Promise<void> {
  const ddui = await getQuestDduiCapabilities();
  if (!ddui) return;

  const dimensionObs = writableNumber(ddui, 0);
  const mode = writableNumber(ddui, 1);
  const rows = questMobCatalog.map((mob) => ({
    mob,
    selected: writableBoolean(ddui, false),
    count: writableString(ddui, "1"),
  }));

  const form = createCustomForm(ddui, player, "分别计数");
  form.label("选择生物。\n每种生物会生成一个独立目标。");
  form.dropdown("维度", dimensionObs, dropdownItems(questDimensionOptions));
  form.dropdown("显示范围", mode, [
    { label: "全部生物", value: 0 },
    ...questMobCategoryOptions.map((option, index) => ({ label: option.label, value: index + 1 })),
  ]);
  form.divider?.();

  rows.forEach((row) => {
    const categoryIndex = questMobCategoryOptions.findIndex((option) => option.value === row.mob.category) + 1;
    const visible = new ddui.ObservableBoolean(mode.getData() === 0 || mode.getData() === categoryIndex);
    mode.subscribe?.((value: number) => visible.setData?.(value === 0 || value === categoryIndex));
    form.toggle(row.mob.label, row.selected, { description: row.mob.id, visible });
    form.textField(`${row.mob.label} 击杀数量`, row.count, {
      description: "正整数",
      visible: row.selected,
    });
  });

  form.divider?.();
  form.button("生成目标", () => {
    const selectedRows = rows.filter((row) => row.selected.getData());
    if (selectedRows.length === 0) {
      player.sendMessage(color.red("至少选择一种生物。"));
      return;
    }

    const dimension = questDimensionOptions[dimensionObs.getData()]?.value ?? "";
    const goals = selectedRows.map((row) => createKillEntityGoal(row.mob.id, toNumber(row.count.getData(), 1), dimension));
    const draft = getDraft(player);
    draft.goals.push(...goals);
    draft.updatedAt = Date.now();
    setDraft(player, draft);
    safeCloseForm(form);
    deferOpen(() => {
      void showMessage(player, "已生成目标", `已添加 ${goals.length} 个击杀目标。`, () => openQuestEditor(player));
    });
  });
  form.button("返回", () => {
    safeCloseForm(form);
    deferOpen(() => openAddKillGoalMode(player));
  });
  form.closeButton?.();
  await form.show();
}

function openGenericGoalEditor(
  player: Player,
  goal: QuestGoalDefinition,
  onSave: (goal: QuestGoalDefinition) => void
): void {
  void openGenericGoalEditorDdui(player, goal, onSave);
}

async function openGenericGoalEditorDdui(
  player: Player,
  goal: QuestGoalDefinition,
  onSave: (goal: QuestGoalDefinition) => void
): Promise<void> {
  const ddui = await getQuestDduiCapabilities();
  if (!ddui) return;

  const schema = getQuestEventSchema(goal.event);
  if (!schema) {
    player.sendMessage(color.red("目标事件不存在。"));
    return;
  }

  const target = writableString(ddui, String(goal.progress.target));
  const modeIndex = writableNumber(ddui, Math.max(0, schema.progressModes.findIndex((mode) => mode === goal.progress.mode)));
  const sumFieldIndex = writableNumber(ddui, Math.max(0, (schema.sumFields ?? []).findIndex((field) => field.key === goal.progress.field)));
  const fields = schema.fields.map((field) => {
    const existing = goal.filters[field.key];
    return {
      field,
      enabled: writableBoolean(ddui, existing !== undefined),
      operatorIndex: writableNumber(ddui, Math.max(0, field.operators.findIndex((op) => op === (existing?.op ?? field.defaultOperator)))),
      value: writableString(ddui, existing ? formatFilterValue(existing.value) : ""),
    };
  });

  const form = createCustomForm(ddui, player, `编辑目标: ${schema.label}`);
  form.dropdown(
    "累计方式",
    modeIndex,
    schema.progressModes.map((mode, index) => ({
      label: questProgressModeOptions.find((option) => option.value === mode)?.label ?? mode,
      value: index,
    }))
  );
  if ((schema.sumFields ?? []).length > 0) {
    form.dropdown(
      "累加字段",
      sumFieldIndex,
      (schema.sumFields ?? []).map((field, index) => ({ label: field.label, value: index }))
    );
  }
  form.textField("目标数值", target, { description: "正整数" });
  form.divider?.();

  fields.forEach((item) => {
    form.toggle(`启用条件: ${item.field.label}`, item.enabled);
    form.dropdown(
      `${item.field.label} 判断方式`,
      item.operatorIndex,
      item.field.operators.map((op, index) => ({ label: getOperatorLabel(op), value: index })),
      { visible: item.enabled }
    );
    form.textField(`${item.field.label} 值`, item.value, { description: item.field.hint, visible: item.enabled });
  });

  form.divider?.();
  form.button("保存目标", () => {
    const selectedMode = schema.progressModes[modeIndex.getData()] ?? schema.progressModes[0] ?? "count";
    goal.progress.mode = selectedMode;
    goal.progress.target = Math.max(1, toNumber(target.getData(), goal.progress.target));
    if ((schema.sumFields ?? []).length > 0) {
      goal.progress.field = schema.sumFields?.[sumFieldIndex.getData()]?.key;
    } else {
      delete goal.progress.field;
    }

    const nextFilters: Record<string, QuestFilter> = {};
    fields.forEach((item) => {
      if (!item.enabled.getData()) return;
      const rawValue = item.value.getData().trim();
      if (!rawValue) return;
      const op = item.field.operators[item.operatorIndex.getData()] ?? item.field.defaultOperator;
      nextFilters[item.field.key] = { op, value: parseFilterValue(op, rawValue) };
    });
    goal.filters = nextFilters;
    safeCloseForm(form);
    deferOpen(() => onSave(goal));
  });
  form.button("返回", () => {
    safeCloseForm(form);
    deferOpen(() => openQuestEditor(player));
  });
  form.closeButton?.();
  await form.show();
}

function openAddReward(player: Player): void {
  void openAddRewardDdui(player);
}

async function openAddRewardDdui(player: Player): Promise<void> {
  const ddui = await getQuestDduiCapabilities();
  if (!ddui) return;

  const form = createCustomForm(ddui, player, "添加奖励");
  questRewardSchemas.forEach((schema) => {
    form.button(schema.permissionLevel === "advanced" ? `${schema.label}（高级）` : schema.label, () => {
      safeCloseForm(form);
      const reward = questDefinitionService.createReward(schema.key);
      deferOpen(() =>
        openRewardEditor(player, reward, (savedReward) => {
          const draft = getDraft(player);
          draft.rewards.push(savedReward);
          draft.updatedAt = Date.now();
          setDraft(player, draft);
          openQuestEditor(player);
        })
      );
    });
  });
  form.button("返回", () => {
    safeCloseForm(form);
    deferOpen(() => openQuestEditor(player));
  });
  form.closeButton?.();
  await form.show();
}

function openEditReward(player: Player, rewardIndex: number): void {
  const draft = getDraft(player);
  const reward = draft.rewards[rewardIndex];
  if (!reward) {
    openQuestEditor(player);
    return;
  }

  openRewardEditor(player, cloneReward(reward), (savedReward) => {
    const current = getDraft(player);
    current.rewards[rewardIndex] = savedReward;
    current.updatedAt = Date.now();
    setDraft(player, current);
    openQuestEditor(player);
  });
}

function openRewardEditor(player: Player, reward: QuestRewardDefinition, onSave: (reward: QuestRewardDefinition) => void): void {
  if (reward.action === "give_item") {
    void openGiveItemRewardEditorDdui(player, reward, onSave);
    return;
  }
  void openGenericRewardEditorDdui(player, reward, onSave);
}

async function openGiveItemRewardEditorDdui(
  player: Player,
  reward: QuestRewardDefinition,
  onSave: (reward: QuestRewardDefinition) => void
): Promise<void> {
  const ddui = await getQuestDduiCapabilities();
  if (!ddui) return;

  const item = writableString(ddui, String(reward.params.item ?? ""));
  const amount = writableString(ddui, String(reward.params.amount ?? 1));
  const form = createCustomForm(ddui, player, "给予物品");
  form.textField("物品", item, { description: "例如 minecraft:diamond" });
  form.textField("数量", amount, { description: "正整数" });
  form.divider?.();
  form.button("从背包选择物品", () => {
    reward.params.item = item.getData().trim();
    reward.params.amount = Math.max(1, toNumber(amount.getData(), 1));
    safeCloseForm(form);
    deferOpen(() => openInventoryItemRewardSelector(player, reward, onSave));
  });

  form.divider?.();
  form.button("保存奖励", () => {
    reward.params.item = item.getData().trim();
    reward.params.amount = Math.max(1, toNumber(amount.getData(), 1));
    clearStaleRewardItemSnapshot(reward);
    const error = validateReward(reward);
    if (error) {
      player.sendMessage(color.red(error));
      return;
    }
    safeCloseForm(form);
    deferOpen(() => onSave(reward));
  });
  form.button("返回", () => {
    safeCloseForm(form);
    deferOpen(() => openQuestEditor(player));
  });
  form.closeButton?.();
  await form.show();
}

function openInventoryItemRewardSelector(
  player: Player,
  reward: QuestRewardDefinition,
  onSave: (reward: QuestRewardDefinition) => void
): void {
  const container = player.getComponent("inventory")?.container;
  if (!container) {
    player.sendMessage(color.red("无法读取背包，仍可手动填写物品。"));
    openRewardEditor(player, reward, onSave);
    return;
  }

  const form = new ChestFormData("27_inv").title("选择奖励物品\n下方是你的背包");
  form.button(13, "点击下方背包物品", ["会保存附魔、耐久、名称、Lore 和容器内容", "不会扣除你的背包物品"], "minecraft:chest");

  form.show(player, { appendViewerInventory: true }).then((response: ChestFormResponse) => {
    if (response.canceled) {
      openRewardEditor(player, reward, onSave);
      return;
    }

    const slot = response.inventorySlot;
    if (slot === null || slot === undefined) {
      openRewardEditor(player, reward, onSave);
      return;
    }

    const currentContainer = player.getComponent("inventory")?.container;
    const stack = currentContainer?.getItem(slot);
    if (!stack) {
      player.sendMessage(color.red("这个背包格子没有物品。"));
      openInventoryItemRewardSelector(player, reward, onSave);
      return;
    }

    reward.params.item = stack.typeId;
    reward.params.amount = stack.amount;
    const snapshot = serializeItemStack(stack);
    reward.params.itemSnapshot = snapshot as unknown as Record<string, unknown>;
    const nestedNote = snapshot.container
      ? snapshot.containerTruncated
        ? "，已保存部分容器内容"
        : "，已保存容器内容"
      : "";
    player.sendMessage(color.green(`已选择 ${stack.typeId} x${stack.amount}，已保存完整物品数据${nestedNote}。请确认后保存奖励。`));
    openRewardEditor(player, reward, onSave);
  });
}

async function openGenericRewardEditorDdui(
  player: Player,
  reward: QuestRewardDefinition,
  onSave: (reward: QuestRewardDefinition) => void
): Promise<void> {
  const ddui = await getQuestDduiCapabilities();
  if (!ddui) return;

  const schema = getQuestRewardSchema(reward.action);
  if (!schema) {
    player.sendMessage(color.red("奖励动作不存在。"));
    return;
  }

  const fieldControls: RewardFieldControl[] = schema.fields.map((field) => {
    if (field.type === "boolean") {
      return { kind: "boolean", field, booleanValue: writableBoolean(ddui, reward.params[field.key] === true) };
    }
    return { kind: "text", field, textValue: writableString(ddui, String(reward.params[field.key] ?? "")) };
  });

  const form = createCustomForm(ddui, player, `编辑奖励: ${schema.label}`);
  fieldControls.forEach((item) => {
    if (item.kind === "boolean") {
      form.toggle(item.field.label, item.booleanValue);
    } else {
      form.textField(item.field.label, item.textValue, { description: item.field.hint });
    }
  });

  form.divider?.();
  form.button("保存奖励", () => {
    fieldControls.forEach((item) => {
      if (item.kind === "boolean") {
        reward.params[item.field.key] = item.booleanValue.getData();
      } else if (item.field.type === "number") {
        reward.params[item.field.key] = Math.max(1, toNumber(item.textValue.getData(), 1));
      } else {
        reward.params[item.field.key] = item.textValue.getData().trim();
      }
    });

    const error = validateReward(reward);
    if (error) {
      player.sendMessage(color.red(error));
      return;
    }

    safeCloseForm(form);
    deferOpen(() => onSave(reward));
  });
  form.button("返回", () => {
    safeCloseForm(form);
    deferOpen(() => openQuestEditor(player));
  });
  form.closeButton?.();
  await form.show();
}

function createZombieSample(): QuestDefinition {
  const draft = questDefinitionService.createDraft("清理僵尸");
  draft.id = "daily_kill_zombie";
  draft.description = "击杀 10 只僵尸并领取基础奖励";
  draft.scope = "daily";
  draft.goals = [
    {
      id: "goal_kill_zombie",
      event: "entity.kill",
      filters: {
        entity: { op: "eq", value: "minecraft:zombie" },
      },
      progress: {
        mode: "count",
        target: 10,
      },
    },
  ];
  draft.rewards = [
    {
      id: "reward_money",
      action: "add_money",
      params: {
        amount: 500,
      },
    },
    {
      id: "reward_message",
      action: "send_message",
      params: {
        message: "§a任务完成，奖励已发放",
      },
    },
  ];
  return draft;
}
