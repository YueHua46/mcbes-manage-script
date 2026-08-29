import { Player, world } from "@minecraft/server";
import { CreeperActionFormData as ActionFormData } from "../../creeper-action-form";
import { CreeperMessageFormData as MessageFormData } from "../../creeper-message-form";
import { CreeperModalFormData as ModalFormData } from "../../creeper-modal-form";
import { ChestFormData, ChestFormResponse } from "../../components/chest-ui";
import { color } from "../../../shared/utils/color";
import { PersistedItemStack, serializeItemStack } from "../../../shared/utils/item-stack-persist";
import questPlayerService from "../../../features/quest/services/quest-player";
import questCatalogService from "../../../features/quest/services/quest-catalog";
import type {
  PresetPackServerState,
  QuestChapterDefinition,
  QuestDefinitionV2,
  QuestPackDefinition,
  QuestRewardDefinitionV2,
} from "../../../features/quest/domain";
import questNotificationService from "../../../features/quest/notifications/quest-notification-service";
import { getQuestExperienceTheme } from "../../../features/quest/notifications/quest-experience-theme";
import questSnapshotRuntime from "../../../features/quest/snapshots/runtime-snapshot-queue";
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
import { isQuestSystemEnabled } from "../../../features/quest/services/quest-runtime-policy";

const playerDrafts = new Map<string, QuestDefinition>();
const addableQuestRewardSchemas = questRewardSchemas.filter((schema) => schema.key !== "send_message");
const FORM_LAYOUT_MARKER_REGEX = /(?:§c§h§e§s§t|§f§u§r§n§a§c§e)(?:§[0-9a-z])*(?:§r)?/gi;

const questDimensionOptions = [
  { label: "不限维度", value: "" },
  { label: "主世界", value: "overworld" },
  { label: "下界", value: "nether" },
  { label: "末地", value: "the_end" },
];

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

function getQuestPlayerDisplayTitle(quest: QuestDefinition): string {
  const theme = getQuestExperienceTheme(quest.rarity);
  return `${theme.color}${theme.icon} §f${getQuestDisplayTitle(quest)} §8· ${theme.color}${theme.label}`;
}

function formatProgressBar(current: number, target: number, quest: QuestDefinition): string {
  const theme = getQuestExperienceTheme(quest.rarity);
  const filled = Math.min(8, Math.max(0, Math.round((current / Math.max(1, target)) * 8)));
  return `§8[${theme.color}${"=".repeat(filled)}§8${"-".repeat(8 - filled)}§8]`;
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
  return Math.max(
    0,
    options.findIndex((option) => option.value === value)
  );
}

function dimensionIndex(value: string | undefined): number {
  return Math.max(
    0,
    questDimensionOptions.findIndex((option) => option.value === (value ?? ""))
  );
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
  const modeLabel =
    questProgressModeOptions.find((option) => option.value === goal.progress.mode)?.label ?? goal.progress.mode;
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
  const modeLabel =
    questProgressModeOptions.find((option) => option.value === goal.progress.mode)?.label ?? goal.progress.mode;
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
    `完成提示: ${draft.completionMessage?.trim() || "使用默认文案"} · 奖励可在冒险日志领取`,
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
  const form = new ActionFormData().title(title).body(body).button("确认", "textures/icons/accept");
  await form.show(player);
  afterClose?.();
}

function showActionMessage(player: Player, title: string, body: string, afterClose?: () => void): void {
  const form = new ActionFormData()
    .title(stripFormLayoutMarkersFromText(title))
    .body(stripFormLayoutMarkersFromText(body));
  form.button("确认", "textures/icons/accept");
  form.show(player).then(() => afterClose?.());
}

function formatPlayerGoalLine(
  player: Player,
  quest: QuestDefinition,
  goal: QuestGoalDefinition,
  index: number
): string {
  const current = questPlayerService.getProgress(player, quest, goal);
  const target = goal.progress.target;
  const schema = getQuestEventSchema(goal.event);
  const objective =
    goal.displayText ??
    (goal.event === "entity.kill"
      ? `击杀${formatEntityFilterLabel(goal.filters.entity)}`
      : goal.event === "item.obtain" && goal.filters.item
        ? `获得 ${formatFilterValue(goal.filters.item.value)}`
        : (schema?.label ?? goal.event));
  return stripFormLayoutMarkersFromText(
    `${index + 1}. §f${objective}  §7${current}/${target}\n   ${formatProgressBar(current, target, quest)}`
  );
}

function formatPlayerRewardLine(reward: QuestRewardDefinition, index: number): string {
  const amount = Number(reward.params.amount ?? 0);
  if (reward.action === "add_money") return `${index + 1}. §6金币 +${amount}`;
  if (reward.action === "add_exp") return `${index + 1}. §a经验 +${amount}`;
  if (reward.action === "give_item") {
    const item = String(reward.params.item ?? "物品奖励").replace(/^minecraft:/, "");
    return `${index + 1}. §b${item} ×${Math.max(1, amount)}`;
  }
  if (reward.action === "send_message") return `${index + 1}. §f额外冒险提示`;
  if (reward.action === "run_command") return `${index + 1}. §d服务器专属奖励`;
  return `${index + 1}. §f${getQuestRewardSchema(reward.action)?.label ?? reward.action}`;
}

function formatPlayerQuestDetail(player: Player, quest: QuestDefinition): string {
  const state = questPlayerService.getQuestState(player, quest);
  const status = !state
    ? "等你接手"
    : state.claimedAt
      ? "奖励已落袋"
      : questPlayerService.canClaim(player, quest)
        ? "奖励在招手"
        : questPlayerService.isCompleted(player, quest)
          ? "已经收工"
          : "正在推进";
  const lines = [
    getQuestPlayerDisplayTitle(quest),
    "§8任务说明",
    quest.description ? `§f${stripFormLayoutMarkersFromText(quest.description)}` : "§7这趟冒险没有留下额外说明。",
    "§8────────────────────",
    `§7状态  §f${status}    §7周期  §f${getScopeLabel(quest.scope)}`,
    `§7规则  §f${getCompleteWhenLabel(quest.completeWhen)}`,
    "§8目标进度",
    ...quest.goals.map((goal, index) => `§7${formatPlayerGoalLine(player, quest, goal, index)}`),
    "§8完成奖励",
    ...(quest.rewards.length > 0
      ? quest.rewards.map((reward, index) => `§7${formatPlayerRewardLine(reward, index)}`)
      : ["§7这趟主要收获是经历。"]),
  ];
  return stripFormLayoutMarkersFromText(lines.filter((line) => line !== "").join("\n"));
}

export function openQuestPlayerForm(player: Player, returnForm?: () => void): void {
  if (!isQuestSystemEnabled()) {
    showActionMessage(player, "冒险日志", "任务系统当前已关闭。", returnForm);
    return;
  }
  if (!questDefinitionService.isReady() || !questPlayerService.isReady()) {
    showActionMessage(player, "冒险日志", "纸和墨还在准备，再给它一点点时间。", returnForm);
    return;
  }

  const summary = questPlayerService.getSummary(player);
  const form = new ActionFormData()
    .title("冒险日志")
    .body(
      [
        "§6✦ 冒险日志 §8· §7每一步都算数",
        "§8────────────────────",
        `§7已发布 §f${summary.total}   §7进行中 §a${summary.accepted}`,
        `§7待领奖 §6${summary.claimable}   §7可接取 §b${summary.available}`,
      ].join("\n")
    );

  const actions: Array<() => void> = [];
  if (summary.claimable > 0) {
    form.button(`待领取奖励 (${summary.claimable})\n点这里把辛苦费收好`, "textures/icons/gift");
    actions.push(() => openQuestClaimableListForm(player, () => openQuestPlayerForm(player, returnForm)));
  }
  form.button(`正在忙的 (${summary.accepted})\n看看做到哪一步了`, "textures/icons/quest_log");
  actions.push(() => openQuestAcceptedListForm(player, () => openQuestPlayerForm(player, returnForm)));
  form.button(`等你接手的 (${summary.available})\n看看又有什么新活儿`, "textures/icons/marker_quest");
  actions.push(() => openQuestAvailableListForm(player, () => openQuestPlayerForm(player, returnForm)));
  form.button("返回", "textures/icons/back");
  actions.push(() => returnForm?.());

  form.show(player).then((response) => {
    if (response.canceled || response.selection === undefined) return;
    actions[response.selection]?.();
  });
}

function getAcceptedQuestRows(player: Player): QuestDefinition[] {
  return questPlayerService.getJournalQuests(player).filter((quest) => questPlayerService.getQuestState(player, quest));
}

function openQuestClaimableListForm(player: Player, back: () => void): void {
  const quests = questPlayerService
    .getJournalQuests(player)
    .filter((quest) => questPlayerService.canClaim(player, quest));
  if (quests.length === 0) {
    showActionMessage(player, "待领取奖励", "这里已经收拾干净啦，暂时没有落下的奖励。", back);
    return;
  }
  const form = new ActionFormData()
    .title("待领取奖励")
    .body("完成提示里说的奖励都在这里。挑一项打开，就能把辛苦费收入囊中。");
  quests.forEach((quest) =>
    form.button(`${getQuestPlayerDisplayTitle(quest)}\n奖励已经备好，点开即可领取`, "textures/icons/gift")
  );
  form.button("返回", "textures/icons/back");
  form.show(player).then((response) => {
    if (response.canceled || response.selection === undefined) return;
    if (response.selection >= quests.length) return back();
    openQuestPlayerDetailForm(player, quests[response.selection], () => openQuestClaimableListForm(player, back));
  });
}

function openQuestAcceptedListForm(player: Player, back: () => void): void {
  const quests = getAcceptedQuestRows(player);
  if (quests.length === 0) {
    showActionMessage(player, "正在忙的", "日志这页还是空的。出去转一圈，活儿自然会找上门。", back);
    return;
  }

  const form = new ActionFormData().title("正在忙的").body("挑一项看看进度，做完的奖励也别忘了带走。");
  quests.forEach((quest) => {
    const canClaim = questPlayerService.canClaim(player, quest);
    const completed = questPlayerService.isCompleted(player, quest);
    const state = questPlayerService.getQuestState(player, quest);
    const status = state?.claimedAt ? "奖励已落袋" : canClaim ? "奖励在招手" : completed ? "已经收工" : "正在推进";
    form.button(
      `${getQuestPlayerDisplayTitle(quest)}\n${status}`,
      canClaim ? "textures/icons/gift" : "textures/icons/quest_log"
    );
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
    showActionMessage(player, "等你接手的", "眼下没有新活儿。先把手头的忙完，好事通常在下一铲后面。", back);
    return;
  }

  const form = new ActionFormData().title("等你接手的").body("挑个顺眼的看看，奖励和目标都明明白白写着。");
  quests.forEach((quest) => {
    form.button(
      `${getQuestPlayerDisplayTitle(quest)}\n${quest.goals.length}目标 · ${quest.rewards.length}奖励`,
      "textures/icons/marker_quest"
    );
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
  const form = new ActionFormData().title("这趟冒险").body(formatPlayerQuestDetail(player, quest));
  const actions: Array<() => void> = [];

  if (canClaim) {
    form.button("把奖励收入囊中", "textures/icons/gift");
    actions.push(() => {
      void questPlayerService
        .claimQuest(player, quest.id)
        .then((error) => {
          if (!error) questNotificationService.notifyClaimed(player, questTitle, quest.rarity, quest.id);
          showActionMessage(
            player,
            error ? "奖励卡住了" : "奖励落袋",
            error ? color.red(error) : color.green(`「${questTitle}」的辛苦费已经稳稳收好。`),
            () => openQuestPlayerDetailForm(player, quest, back)
          );
        })
        .catch((error) => {
          showActionMessage(player, "奖励卡住了", color.red(`冒险日志没能保存这次领取：${String(error)}`), () =>
            openQuestPlayerDetailForm(player, quest, back)
          );
        });
    });
  }

  if (canAccept) {
    form.button("这活儿我接了", "textures/icons/marker_quest");
    actions.push(() => {
      const error = questPlayerService.acceptQuest(player, quest.id);
      if (!error) {
        questNotificationService.notifyAccepted(player, questTitle, quest.rarity, quest.id);
        questSnapshotRuntime.markAll(player, "quest_accept");
      }
      showActionMessage(
        player,
        error ? "暂时接不了" : "说干就干",
        error ? color.red(error) : color.green(`「${questTitle}」已经写进你的冒险日志。`),
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

export function openQuestSystemManageForm(player: Player, returnForm?: () => void): void {
  if (!questDefinitionService.isReady()) {
    void showMessage(player, "任务系统初始化中", "任务数据库还没准备好，请稍后再打开任务系统。", returnForm);
    return;
  }
  const tasks = questDefinitionService.getAll();
  const form = new ActionFormData()
    .title("任务管理")
    .body(`§6任务工坊 §8· §7统一 JSON UI\n§8────────────────────\n§7已保存 §f${tasks.length} §7个自定义任务`)
    .button("预设任务管理\n任务包、类型、单任务与奖励", "textures/icons/quest_log")
    .button("新建任务\n从空白草稿开始", "textures/icons/add")
    .button("载入示例\n击杀僵尸日常任务", "textures/icons/sword");
  tasks.forEach((task) => {
    form.button(
      `${getQuestDisplayTitle(task)}  ${task.enabled ? "§2启用" : "§8停用"}\n${task.goals.length}目标 · ${task.rewards.length}奖励`,
      "textures/icons/edit2"
    );
  });
  form.button("返回", "textures/icons/back");
  form.show(player).then((response) => {
    if (response.canceled || response.selection === undefined) return;
    if (response.selection === 0)
      return openPresetPackList(player, () => openQuestSystemManageForm(player, returnForm));
    if (response.selection === 1) {
      setDraft(player, questDefinitionService.createDraft());
      return openQuestEditor(player);
    }
    if (response.selection === 2) {
      setDraft(player, createZombieSample());
      return openQuestEditor(player);
    }
    const taskIndex = response.selection - 3;
    if (taskIndex >= 0 && taskIndex < tasks.length) {
      setDraft(player, cloneDefinition(tasks[taskIndex]));
      return openQuestEditor(player);
    }
    playerDrafts.delete(player.id);
    returnForm?.();
  });
}

function defaultPresetState(pack: QuestPackDefinition): PresetPackServerState {
  return {
    packId: pack.id,
    enabled: pack.defaultEnabled,
    rewardScale: 1,
    overrideChapterEnabled: {},
    overrideQuestEnabled: {},
    overrideQuestRewards: {},
    gameplayExperimentConfirmation: {},
    updatedAt: 0,
  };
}

function getPresetState(pack: QuestPackDefinition): PresetPackServerState {
  return questCatalogService.getServerState(pack.id) ?? defaultPresetState(pack);
}

function refreshPresetRuntime(): void {
  for (const onlinePlayer of world.getAllPlayers()) {
    questPlayerService.ensureAutoAccepted(onlinePlayer);
    questSnapshotRuntime.markAll(onlinePlayer, "preset_override_changed");
  }
}

function savePresetState(
  player: Player,
  state: PresetPackServerState,
  successMessage: string,
  afterSave: () => void
): void {
  if (!questCatalogService.saveServerState(state)) {
    showActionMessage(
      player,
      "预设设置没有保存",
      color.red("覆盖内容无效或任务目录尚未准备好。官方预设没有被修改，请检查目录诊断。"),
      afterSave
    );
    return;
  }
  refreshPresetRuntime();
  showActionMessage(player, "预设设置已保存", color.green(successMessage), afterSave);
}

function openPresetPackList(player: Player, back: () => void): void {
  if (!questCatalogService.isReady()) {
    showActionMessage(player, "预设目录初始化中", color.red("请稍后再打开预设任务管理。"), back);
    return;
  }
  const packs = questCatalogService.getPresetPacks();
  const form = new ActionFormData()
    .title("预设任务管理")
    .body("官方任务定义保持只读。这里保存的是本服务器覆盖设置，只影响运行时目录与未来完成奖励。");
  packs.forEach((pack) => {
    const state = getPresetState(pack);
    const questCount = questCatalogService.getPresetQuests(pack.id).length;
    const taskOverrides = Object.keys(state.overrideQuestEnabled ?? {}).length;
    const rewardOverrides = Object.keys(state.overrideQuestRewards ?? {}).length;
    form.button(
      `${pack.title}  ${state.enabled ? "§2已启用" : "§8已停用"}\n${questCount} 个任务 · ${taskOverrides} 个开关覆盖 · ${rewardOverrides} 个奖励覆盖`,
      "textures/icons/quest_log"
    );
  });
  form.button("返回", "textures/icons/back");
  form.show(player).then((response) => {
    if (response.canceled || response.selection === undefined) return;
    if (response.selection >= packs.length) return back();
    openPresetPackEditor(player, packs[response.selection], () => openPresetPackList(player, back));
  });
}

function openPresetPackEditor(player: Player, pack: QuestPackDefinition, back: () => void): void {
  const state = getPresetState(pack);
  const chapters = questCatalogService.getPresetChapters(pack.id);
  const quests = questCatalogService.getPresetQuests(pack.id);
  const diagnostics = questCatalogService
    .getDiagnostics()
    .filter(
      (diagnostic) =>
        diagnostic.definitionId === pack.id ||
        chapters.some((chapter) => chapter.id === diagnostic.definitionId) ||
        quests.some((quest) => quest.id === diagnostic.definitionId)
    );
  const form = new ActionFormData()
    .title(pack.title)
    .body(
      [
        pack.description,
        "§8────────────────────",
        `任务包：${state.enabled ? "§2启用" : "§8停用"}`,
        `奖励倍率：§6${state.rewardScale ?? 1}x`,
        `任务类型：${chapters.length} · 任务：${quests.length}`,
        `目录诊断：${diagnostics.length === 0 ? "§2正常" : `§c${diagnostics.length} 项`}`,
      ].join("\n")
    )
    .button("任务包设置\n总开关与默认奖励倍率", "textures/icons/settings");
  chapters.forEach((chapter) => {
    const enabled = state.overrideChapterEnabled?.[chapter.id] ?? true;
    form.button(
      `${chapter.title}  ${enabled ? "§2开启" : "§8关闭"}\n任务类型开关 · ${chapter.questIds.length} 个任务`,
      chapter.icon ?? "textures/icons/catalogue"
    );
  });
  form.button("按任务管理\n单任务开关和奖励覆盖", "textures/icons/edit2");
  form.button("查看目录诊断\n冲突、越界覆盖与无效奖励", "textures/icons/status_bar_settings");
  form.button("返回", "textures/icons/back");
  form.show(player).then((response) => {
    if (response.canceled || response.selection === undefined) return;
    if (response.selection === 0)
      return openPresetPackSettings(player, pack, () => openPresetPackEditor(player, pack, back));
    const chapterIndex = response.selection - 1;
    if (chapterIndex >= 0 && chapterIndex < chapters.length) {
      return openPresetChapterEditor(player, pack, chapters[chapterIndex], () =>
        openPresetPackEditor(player, pack, back)
      );
    }
    if (response.selection === chapters.length + 1) {
      return openPresetQuestList(player, pack, undefined, () => openPresetPackEditor(player, pack, back));
    }
    if (response.selection === chapters.length + 2) {
      return openPresetDiagnostics(player, pack, () => openPresetPackEditor(player, pack, back));
    }
    back();
  });
}

function openPresetPackSettings(player: Player, pack: QuestPackDefinition, back: () => void): void {
  const state = getPresetState(pack);
  new ModalFormData()
    .title(`${pack.title} · 设置`)
    .toggle("启用整个任务包", { defaultValue: state.enabled })
    .textField("默认奖励倍率", "例如 0.5、1、1.5、2；只影响未来完成的任务", {
      defaultValue: String(state.rewardScale ?? 1),
    })
    .submitButton("保存任务包设置")
    .show(player)
    .then((response) => {
      if (response.canceled || !response.formValues) return;
      const [enabled, rawScale] = response.formValues;
      const rewardScale = Number(rawScale);
      if (!Number.isFinite(rewardScale) || rewardScale < 0 || rewardScale > 100) {
        showActionMessage(player, "奖励倍率不正确", color.red("请输入 0 到 100 之间的数字。"), () =>
          openPresetPackSettings(player, pack, back)
        );
        return;
      }
      savePresetState(
        player,
        { ...state, enabled: Boolean(enabled), rewardScale },
        `${pack.title}已${enabled ? "启用" : "停用"}，未来完成奖励按 ${rewardScale}x 冻结。`,
        back
      );
    });
}

function openPresetChapterEditor(
  player: Player,
  pack: QuestPackDefinition,
  chapter: QuestChapterDefinition,
  back: () => void
): void {
  const state = getPresetState(pack);
  const enabled = state.overrideChapterEnabled?.[chapter.id] ?? true;
  new ActionFormData()
    .title(chapter.title)
    .body(
      `${chapter.description}\n§8────────────────────\n任务类型状态：${enabled ? "§2开启" : "§8关闭"}\n关闭后未完成任务冻结，历史领奖权仍保留。`
    )
    .button(
      enabled ? "关闭这个任务类型" : "开启这个任务类型",
      enabled ? "textures/icons/whitelist_remove" : "textures/icons/accept"
    )
    .button("管理该类型的任务\n单任务开关与奖励", "textures/icons/edit2")
    .button("返回", "textures/icons/back")
    .show(player)
    .then((response) => {
      if (response.canceled || response.selection === undefined) return;
      if (response.selection === 0) {
        const next = { ...state, overrideChapterEnabled: { ...state.overrideChapterEnabled, [chapter.id]: !enabled } };
        return savePresetState(player, next, `${chapter.title}已${!enabled ? "开启" : "关闭"}。`, () =>
          openPresetChapterEditor(player, pack, chapter, back)
        );
      }
      if (response.selection === 1)
        return openPresetQuestList(player, pack, chapter.id, () =>
          openPresetChapterEditor(player, pack, chapter, back)
        );
      back();
    });
}

function openPresetQuestList(
  player: Player,
  pack: QuestPackDefinition,
  chapterId: string | undefined,
  back: () => void
): void {
  const quests = questCatalogService.getPresetQuests(pack.id, chapterId);
  const form = new ActionFormData()
    .title(chapterId ? "任务类型中的任务" : "预设任务列表")
    .body("单任务开关优先于官方默认值；奖励覆盖仅用于未来完成实例。");
  quests.forEach((quest) => {
    const entry = questCatalogService.getEffectiveQuest(quest.id);
    const rewardOverridden = !!getPresetState(pack).overrideQuestRewards?.[quest.id];
    form.button(
      `${quest.title}  ${entry?.questEnabled ? "§2开启" : "§8关闭"}\n${quest.rewards.length} 项官方奖励${rewardOverridden ? " · §6服务器已覆盖" : ""}`,
      "textures/icons/marker_quest"
    );
  });
  form.button("返回", "textures/icons/back");
  form.show(player).then((response) => {
    if (response.canceled || response.selection === undefined) return;
    if (response.selection >= quests.length) return back();
    openPresetQuestEditor(player, pack, quests[response.selection], () =>
      openPresetQuestList(player, pack, chapterId, back)
    );
  });
}

function openPresetQuestEditor(
  player: Player,
  pack: QuestPackDefinition,
  officialQuest: QuestDefinitionV2,
  back: () => void
): void {
  const state = getPresetState(pack);
  const entry = questCatalogService.getEffectiveQuest(officialQuest.id);
  if (!entry) return back();
  const explicitQuestEnabled = state.overrideQuestEnabled?.[officialQuest.id] ?? officialQuest.enabled;
  const hasRewardOverride = Object.prototype.hasOwnProperty.call(state.overrideQuestRewards ?? {}, officialQuest.id);
  const rewardLines = entry.definition.rewards.map((reward, index) => formatRewardSummary(reward, index));
  const form = new ActionFormData()
    .title(officialQuest.title)
    .body(
      [
        officialQuest.description,
        "§8────────────────────",
        `单任务开关：${explicitQuestEnabled ? "§2开启" : "§8关闭"}`,
        `实际可运行：${entry.packEnabled && entry.chapterEnabled && entry.questEnabled ? "§2是" : "§8否"}`,
        `任务类型：${entry.chapterEnabled ? "§2开启" : "§8关闭"}`,
        `任务包：${entry.packEnabled ? "§2开启" : "§8关闭"}`,
        `奖励来源：${hasRewardOverride ? "§6服务器覆盖" : "§7官方默认"}`,
        ...rewardLines,
      ].join("\n")
    )
    .button(
      explicitQuestEnabled ? "关闭这个任务" : "开启这个任务",
      explicitQuestEnabled ? "textures/icons/whitelist_remove" : "textures/icons/accept"
    )
    .button("编辑任务奖励\n只影响未来完成的任务", "textures/icons/gift");
  if (hasRewardOverride) form.button("恢复官方奖励\n删除服务器奖励覆盖", "textures/icons/requeue");
  form.button("返回", "textures/icons/back");
  form.show(player).then((response) => {
    if (response.canceled || response.selection === undefined) return;
    if (response.selection === 0) {
      const next = {
        ...state,
        overrideQuestEnabled: { ...state.overrideQuestEnabled, [officialQuest.id]: !explicitQuestEnabled },
      };
      return savePresetState(player, next, `${officialQuest.title}已${!explicitQuestEnabled ? "开启" : "关闭"}。`, () =>
        openPresetQuestEditor(player, pack, officialQuest, back)
      );
    }
    if (response.selection === 1) {
      return openPresetRewardList(player, pack, officialQuest, () =>
        openPresetQuestEditor(player, pack, officialQuest, back)
      );
    }
    if (hasRewardOverride && response.selection === 2) {
      return resetPresetRewards(player, pack, officialQuest, () =>
        openPresetQuestEditor(player, pack, officialQuest, back)
      );
    }
    back();
  });
}

function getPresetRewards(pack: QuestPackDefinition, quest: QuestDefinitionV2): QuestRewardDefinitionV2[] {
  return (
    questCatalogService.getEffectiveQuest(quest.id)?.definition.rewards ??
    questCatalogService.getOfficialPresetQuest(quest.id)?.rewards ??
    []
  ).map((reward) => ({ ...reward, params: { ...reward.params } }));
}

function savePresetRewards(
  player: Player,
  pack: QuestPackDefinition,
  quest: QuestDefinitionV2,
  rewards: QuestRewardDefinitionV2[],
  message: string,
  back: () => void
): void {
  const state = getPresetState(pack);
  savePresetState(
    player,
    {
      ...state,
      overrideQuestRewards: { ...state.overrideQuestRewards, [quest.id]: rewards },
    },
    message,
    back
  );
}

function resetPresetRewards(
  player: Player,
  pack: QuestPackDefinition,
  quest: QuestDefinitionV2,
  back: () => void
): void {
  const state = getPresetState(pack);
  const overrides = { ...state.overrideQuestRewards };
  delete overrides[quest.id];
  savePresetState(player, { ...state, overrideQuestRewards: overrides }, `${quest.title}已恢复官方默认奖励。`, back);
}

function openPresetRewardList(
  player: Player,
  pack: QuestPackDefinition,
  quest: QuestDefinitionV2,
  back: () => void
): void {
  const rewards = getPresetRewards(pack, quest);
  const hasOverride = Object.prototype.hasOwnProperty.call(getPresetState(pack).overrideQuestRewards ?? {}, quest.id);
  const form = new ActionFormData()
    .title(`${quest.title} · 奖励`)
    .body(
      `当前使用${hasOverride ? "服务器覆盖奖励" : "官方默认奖励"}。修改后只影响尚未完成的任务，已经冻结的完成奖励不会改变。`
    );
  rewards.forEach((reward, index) =>
    form.button(formatRewardSummary(reward, index), getQuestRewardSchema(reward.action)?.icon ?? "textures/icons/gift")
  );
  form.button("添加奖励", "textures/icons/add");
  if (hasOverride) form.button("恢复官方奖励", "textures/icons/requeue");
  form.button("返回", "textures/icons/back");
  form.show(player).then((response) => {
    if (response.canceled || response.selection === undefined) return;
    if (response.selection < rewards.length) {
      return openPresetRewardActions(player, pack, quest, response.selection, () =>
        openPresetRewardList(player, pack, quest, back)
      );
    }
    if (response.selection === rewards.length) {
      return openPresetAddReward(player, pack, quest, () => openPresetRewardList(player, pack, quest, back));
    }
    if (hasOverride && response.selection === rewards.length + 1) {
      return resetPresetRewards(player, pack, quest, () => openPresetRewardList(player, pack, quest, back));
    }
    back();
  });
}

function openPresetAddReward(
  player: Player,
  pack: QuestPackDefinition,
  quest: QuestDefinitionV2,
  back: () => void
): void {
  const form = new ActionFormData()
    .title("添加预设任务奖励")
    .body("完成提示由任务通知单独负责，因此这里不提供“发送消息”奖励。");
  addableQuestRewardSchemas.forEach((schema) => form.button(schema.label, schema.icon));
  form.button("返回", "textures/icons/back");
  form.show(player).then((response) => {
    if (response.canceled || response.selection === undefined) return;
    if (response.selection >= addableQuestRewardSchemas.length) return back();
    const schema = addableQuestRewardSchemas[response.selection];
    const rewards = getPresetRewards(pack, quest);
    let suffix = 1;
    while (rewards.some((reward) => reward.id === `override.reward.${schema.key}.${suffix}`)) suffix += 1;
    openPresetRewardForm(
      player,
      pack,
      quest,
      { id: `override.reward.${schema.key}.${suffix}`, action: schema.key, params: {} },
      undefined,
      back
    );
  });
}

function openPresetRewardActions(
  player: Player,
  pack: QuestPackDefinition,
  quest: QuestDefinitionV2,
  rewardIndex: number,
  back: () => void
): void {
  const rewards = getPresetRewards(pack, quest);
  const reward = rewards[rewardIndex];
  if (!reward) return back();
  new ActionFormData()
    .title(`管理奖励 ${rewardIndex + 1}`)
    .body(formatRewardDetail(reward))
    .button("编辑奖励", "textures/icons/edit2")
    .button("删除奖励", "textures/icons/whitelist_remove")
    .button("返回", "textures/icons/back")
    .show(player)
    .then((response) => {
      if (response.canceled || response.selection === undefined) return;
      if (response.selection === 0) return openPresetRewardForm(player, pack, quest, reward, rewardIndex, back);
      if (response.selection === 1) {
        return new MessageFormData()
          .title("删除预设任务奖励")
          .body(`确认从「${quest.title}」的服务器覆盖中删除这项${getRewardLabel(reward.action)}吗？`)
          .button1("取消")
          .button2("确认删除")
          .show(player)
          .then((confirm) => {
            if (confirm.canceled || confirm.selection !== 1) return back();
            rewards.splice(rewardIndex, 1);
            savePresetRewards(player, pack, quest, rewards, `${quest.title}的奖励覆盖已更新。`, back);
          });
      }
      back();
    });
}

function openPresetRewardForm(
  player: Player,
  pack: QuestPackDefinition,
  quest: QuestDefinitionV2,
  reward: QuestRewardDefinitionV2,
  rewardIndex: number | undefined,
  back: () => void
): void {
  const schema = getQuestRewardSchema(reward.action);
  if (!schema) return showActionMessage(player, "奖励类型不存在", color.red(reward.action), back);
  const form = new ModalFormData().title(`${quest.title} · ${schema.label}`);
  schema.fields.forEach((field) =>
    form.textField(field.label, field.hint, { defaultValue: String(reward.params[field.key] ?? "") })
  );
  form
    .submitButton("保存奖励覆盖")
    .show(player)
    .then((response) => {
      if (response.canceled || !response.formValues) return;
      const nextReward: QuestRewardDefinitionV2 = {
        ...reward,
        params: { ...reward.params },
      };
      schema.fields.forEach((field, index) => {
        const raw = response.formValues?.[index];
        nextReward.params[field.key] = field.type === "number" ? Math.floor(Number(raw)) : String(raw ?? "").trim();
      });
      const error = validateReward(nextReward);
      if (error)
        return showActionMessage(player, "奖励内容不正确", color.red(error), () =>
          openPresetRewardForm(player, pack, quest, reward, rewardIndex, back)
        );
      const rewards = getPresetRewards(pack, quest);
      if (rewardIndex === undefined) rewards.push(nextReward);
      else rewards[rewardIndex] = nextReward;
      savePresetRewards(player, pack, quest, rewards, `${quest.title}的奖励覆盖已保存。`, back);
    });
}

function openPresetDiagnostics(player: Player, pack: QuestPackDefinition, back: () => void): void {
  const relatedIds = new Set([
    pack.id,
    ...questCatalogService.getPresetChapters(pack.id).map((chapter) => chapter.id),
    ...questCatalogService.getPresetQuests(pack.id).map((quest) => quest.id),
  ]);
  const diagnostics = questCatalogService
    .getDiagnostics()
    .filter((diagnostic) => !diagnostic.definitionId || relatedIds.has(diagnostic.definitionId));
  const body =
    diagnostics.length === 0
      ? "§2目录、服务器覆盖和自定义任务 ID 均未发现冲突。"
      : diagnostics
          .map(
            (diagnostic, index) =>
              `${index + 1}. ${diagnostic.severity === "error" ? "§c" : "§6"}${diagnostic.code}\n§7${diagnostic.message}`
          )
          .join("\n\n");
  new ActionFormData().title("预设目录诊断").body(body).button("返回", "textures/icons/back").show(player).then(back);
}

function openQuestEditor(player: Player): void {
  const draft = getDraft(player);
  const form = new ActionFormData().title("任务编辑器").body(formatQuestPreview(draft));
  const actions: Array<() => void> = [];
  form.button("编辑基础信息\n名称、说明、周期与开关", "textures/icons/settings");
  actions.push(() => openQuestBasicEditor(player));
  draft.goals.forEach((goal, index) => {
    form.button(
      `目标 ${index + 1} · ${getEventLabel(goal.event)}\n点击查看、编辑或删除`,
      "textures/icons/status_bar_settings"
    );
    actions.push(() => openGoalActions(player, index));
  });
  form.button("添加目标\n定义玩家需要完成的事情", "textures/icons/add");
  actions.push(() => openAddGoal(player));
  draft.rewards.forEach((reward, index) => {
    form.button(`奖励 ${index + 1} · ${getRewardLabel(reward.action)}\n点击查看、编辑或删除`, "textures/icons/rewards");
    actions.push(() => openRewardActions(player, index));
  });
  form.button("添加奖励\n金币、经验、物品或高级动作", "textures/icons/gift");
  actions.push(() => openAddReward(player));
  form.button("保存任务\n校验后写入任务数据库", "textures/icons/accept");
  actions.push(() => {
    const error = validateDraft(draft);
    if (error) {
      showActionMessage(player, "暂时不能保存", color.red(error), () => openQuestEditor(player));
      return;
    }
    const saved = questDefinitionService.save(draft);
    if (!saved) {
      showActionMessage(player, "保存失败", color.red("任务数据库暂时不可用，请稍后再试。"), () =>
        openQuestEditor(player)
      );
      return;
    }
    playerDrafts.delete(player.id);
    void showMessage(player, "保存成功", `任务「${getQuestDisplayTitle(draft)}」已保存。`, () =>
      openQuestSystemManageForm(player)
    );
  });
  const persisted = questDefinitionService.get(draft.id) !== undefined;
  form.button(persisted ? "删除任务\n需要再次确认" : "放弃草稿\n不保存本次编辑", "textures/icons/whitelist_remove");
  actions.push(() => openDeleteQuestConfirm(player));
  form.button("返回任务列表\n放弃尚未保存的修改", "textures/icons/back");
  actions.push(() => {
    playerDrafts.delete(player.id);
    openQuestSystemManageForm(player);
  });
  form.show(player).then((response) => {
    if (response.canceled || response.selection === undefined) return;
    actions[response.selection]?.();
  });
}

function openQuestBasicEditor(player: Player): void {
  const draft = getDraft(player);
  new ModalFormData()
    .title("任务基础信息")
    .textField("任务名称", "玩家看到的任务名称", { defaultValue: getQuestDisplayTitle(draft) })
    .textField("任务描述", "说明目标、背景或注意事项", { defaultValue: draft.description })
    .textField("完成提示语", "右上角完成提示中的个性文案，最多 40 字；领奖位置会自动附加", {
      defaultValue: draft.completionMessage ?? "",
    })
    .dropdown(
      "任务周期",
      questScopeOptions.map((option) => option.label),
      { defaultValueIndex: optionIndex(questScopeOptions, draft.scope) }
    )
    .dropdown(
      "完成条件",
      questCompleteWhenOptions.map((option) => option.label),
      { defaultValueIndex: optionIndex(questCompleteWhenOptions, draft.completeWhen) }
    )
    .toggle("启用任务", { defaultValue: draft.enabled })
    .toggle("玩家自动接受任务", { defaultValue: draft.autoAccept })
    .submitButton("保存基础信息")
    .show(player)
    .then((response) => {
      if (response.canceled || !response.formValues) return;
      const [title, description, completionMessage, scopeIndex, completeWhenIndex, enabled, autoAccept] =
        response.formValues;
      const nextTitle = stripFormLayoutMarkers(String(title ?? "")).trim();
      if (!nextTitle) {
        showActionMessage(player, "名称不能为空", color.red("请填写玩家能够识别的任务名称。"), () =>
          openQuestBasicEditor(player)
        );
        return;
      }
      draft.title = nextTitle;
      draft.description = String(description ?? "");
      draft.completionMessage = stripFormLayoutMarkersFromText(String(completionMessage ?? ""))
        .replace(/[\r\n\t]+/g, " ")
        .trim()
        .slice(0, 40);
      draft.scope = questScopeOptions[Number(scopeIndex)]?.value ?? "once";
      draft.completeWhen = questCompleteWhenOptions[Number(completeWhenIndex)]?.value ?? "all";
      draft.enabled = Boolean(enabled);
      draft.autoAccept = Boolean(autoAccept);
      draft.updatedAt = Date.now();
      setDraft(player, draft);
      openQuestEditor(player);
    });
}

function openDeleteQuestConfirm(player: Player): void {
  const draft = getDraft(player);
  const persisted = questDefinitionService.get(draft.id) !== undefined;
  new MessageFormData()
    .title(persisted ? "删除任务" : "放弃草稿")
    .body(
      persisted
        ? `确认永久删除任务「${getQuestDisplayTitle(draft)}」吗？`
        : `确认放弃草稿「${getQuestDisplayTitle(draft)}」吗？`
    )
    .button1("取消")
    .button2(persisted ? "确认删除" : "确认放弃")
    .show(player)
    .then((response) => {
      if (response.canceled || response.selection !== 1) return openQuestEditor(player);
      if (persisted) questDefinitionService.delete(draft.id);
      playerDrafts.delete(player.id);
      openQuestSystemManageForm(player);
    });
}

function openAddGoal(player: Player): void {
  const form = new ActionFormData().title("添加任务目标").body("选择玩家需要完成的行为类型。");
  questEventSchemas.forEach((schema) => {
    form.button(
      schema.key === "entity.kill" ? "击杀生物\n按生物种类累计" : `${schema.label}\n配置数值与筛选条件`,
      schema.icon
    );
  });
  form.button("返回", "textures/icons/back");
  form.show(player).then((response) => {
    if (response.canceled || response.selection === undefined) return;
    if (response.selection >= questEventSchemas.length) return openQuestEditor(player);
    const schema = questEventSchemas[response.selection];
    if (schema.key === "entity.kill") return openAddKillGoalMode(player);
    openGenericGoalEditor(player, questDefinitionService.createGoal(schema.key), (savedGoal) => {
      const draft = getDraft(player);
      draft.goals.push(savedGoal);
      draft.updatedAt = Date.now();
      setDraft(player, draft);
      openQuestEditor(player);
    });
  });
}

function openGoalActions(player: Player, goalIndex: number): void {
  const draft = getDraft(player);
  const goal = draft.goals[goalIndex];
  if (!goal) return openQuestEditor(player);
  new ActionFormData()
    .title(`管理目标 ${goalIndex + 1}`)
    .body(formatGoalDetail(goal))
    .button("编辑目标", "textures/icons/edit2")
    .button("删除目标", "textures/icons/whitelist_remove")
    .button("返回", "textures/icons/back")
    .show(player)
    .then((response) => {
      if (response.canceled || response.selection === undefined) return;
      if (response.selection === 0) return openEditGoal(player, goalIndex);
      if (response.selection === 1) return openDeleteGoalConfirm(player, goalIndex);
      openQuestEditor(player);
    });
}

function openDeleteGoalConfirm(player: Player, goalIndex: number): void {
  const draft = getDraft(player);
  const goal = draft.goals[goalIndex];
  if (!goal) return openQuestEditor(player);
  new MessageFormData()
    .title("删除任务目标")
    .body(`确认删除目标 ${goalIndex + 1}「${getEventLabel(goal.event)}」吗？`)
    .button1("取消")
    .button2("确认删除")
    .show(player)
    .then((response) => {
      if (!response.canceled && response.selection === 1) {
        draft.goals.splice(goalIndex, 1);
        draft.updatedAt = Date.now();
        setDraft(player, draft);
        return openQuestEditor(player);
      }
      openGoalActions(player, goalIndex);
    });
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
  new ActionFormData()
    .title("击杀生物目标")
    .body("累计击杀：多种生物共用一个数量。\n分别计数：每种生物生成独立目标。")
    .button("累计击杀\n多个生物共用进度", "textures/icons/sword")
    .button("分别计数\n每种生物独立进度", "textures/icons/status_bar_settings")
    .button("返回", "textures/icons/back")
    .show(player)
    .then((response) => {
      if (response.canceled || response.selection === undefined) return;
      if (response.selection === 0) {
        const goal = questDefinitionService.createGoal("entity.kill");
        openKillCumulativeGoalEditor(player, goal, (savedGoal) => {
          const draft = getDraft(player);
          draft.goals.push(savedGoal);
          draft.updatedAt = Date.now();
          setDraft(player, draft);
          openQuestEditor(player);
        });
        return;
      }
      if (response.selection === 1) return openSeparateKillGoalEditor(player);
      openAddGoal(player);
    });
}

function openKillCumulativeGoalEditor(
  player: Player,
  goal: QuestGoalDefinition,
  onSave: (goal: QuestGoalDefinition) => void
): void {
  const dimension = String(goal.filters.dimension?.value ?? "");
  new ModalFormData()
    .title("累计击杀目标")
    .textField("击杀数量", "正整数", { defaultValue: String(goal.progress.target) })
    .dropdown(
      "维度",
      questDimensionOptions.map((option) => option.label),
      {
        defaultValueIndex: dimensionIndex(dimension),
      }
    )
    .textField("生物实体 ID（多个用英文逗号分隔）", "例如 minecraft:zombie,minecraft:skeleton", {
      defaultValue: getEntityFilterIds(goal).join(","),
    })
    .submitButton("保存目标")
    .show(player)
    .then((response) => {
      if (response.canceled || !response.formValues) return;
      const ids = String(response.formValues[2] ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      if (ids.length === 0) {
        showActionMessage(player, "还缺击杀对象", color.red("至少填写一种生物实体 ID。"), () =>
          openKillCumulativeGoalEditor(player, goal, onSave)
        );
        return;
      }
      goal.progress.mode = "count";
      goal.progress.target = Math.max(1, toNumber(String(response.formValues[0] ?? ""), goal.progress.target));
      setEntityFilter(goal, ids);
      setDimensionFilter(goal, questDimensionOptions[Number(response.formValues[1])]?.value ?? "");
      onSave(goal);
    });
}

function openSeparateKillGoalEditor(player: Player): void {
  new ModalFormData()
    .title("分别计数")
    .dropdown(
      "维度",
      questDimensionOptions.map((option) => option.label),
      { defaultValueIndex: 0 }
    )
    .textField("生物与数量（英文逗号分隔）", "例如 minecraft:zombie=10,minecraft:skeleton=5")
    .submitButton("生成独立目标")
    .show(player)
    .then((response) => {
      if (response.canceled || !response.formValues) return;
      const entries = String(response.formValues[1] ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          const [rawId, rawCount] = entry.split("=");
          return { id: rawId?.trim(), count: Math.max(1, toNumber(rawCount?.trim() ?? "1", 1)) };
        })
        .filter((entry) => entry.id);
      if (entries.length === 0) {
        showActionMessage(player, "还没有填写生物", color.red("请按 生物ID=数量 的格式至少填写一项。"), () =>
          openSeparateKillGoalEditor(player)
        );
        return;
      }
      const dimension = questDimensionOptions[Number(response.formValues[0])]?.value ?? "";
      const goals = entries.map((entry) => createKillEntityGoal(entry.id, entry.count, dimension));
      const draft = getDraft(player);
      draft.goals.push(...goals);
      draft.updatedAt = Date.now();
      setDraft(player, draft);
      void showMessage(player, "已生成目标", `已添加 ${goals.length} 个击杀目标。`, () => openQuestEditor(player));
    });
}

function openGenericGoalEditor(
  player: Player,
  goal: QuestGoalDefinition,
  onSave: (goal: QuestGoalDefinition) => void
): void {
  const schema = getQuestEventSchema(goal.event);
  if (!schema) {
    showActionMessage(player, "目标事件不存在", color.red(goal.event), () => openQuestEditor(player));
    return;
  }
  const form = new ModalFormData().title(`编辑目标 · ${schema.label}`);
  form.dropdown(
    "累计方式",
    schema.progressModes.map((mode) => questProgressModeOptions.find((option) => option.value === mode)?.label ?? mode),
    { defaultValueIndex: Math.max(0, schema.progressModes.indexOf(goal.progress.mode)) }
  );
  if ((schema.sumFields ?? []).length > 0) {
    form.dropdown(
      "累加字段",
      (schema.sumFields ?? []).map((field) => field.label),
      {
        defaultValueIndex: Math.max(
          0,
          (schema.sumFields ?? []).findIndex((field) => field.key === goal.progress.field)
        ),
      }
    );
  }
  form.textField("目标数值", "正整数", { defaultValue: String(goal.progress.target) });
  schema.fields.forEach((field) => {
    const existing = goal.filters[field.key];
    form.toggle(`启用条件 · ${field.label}`, { defaultValue: existing !== undefined });
    form.dropdown(`${field.label} · 判断方式`, field.operators.map(getOperatorLabel), {
      defaultValueIndex: Math.max(0, field.operators.indexOf(existing?.op ?? field.defaultOperator)),
    });
    form.textField(`${field.label} · 值`, field.hint, {
      defaultValue: existing ? formatFilterValue(existing.value) : "",
    });
  });
  form.submitButton("保存目标");
  form.show(player).then((response) => {
    if (response.canceled || !response.formValues) return;
    const values = response.formValues;
    let cursor = 0;
    const modeIndex = Number(values[cursor++]);
    const sumFieldIndex = (schema.sumFields ?? []).length > 0 ? Number(values[cursor++]) : -1;
    const target = String(values[cursor++] ?? "");
    const selectedMode = schema.progressModes[modeIndex] ?? schema.progressModes[0] ?? "count";
    goal.progress.mode = selectedMode;
    goal.progress.target = Math.max(1, toNumber(target, goal.progress.target));
    if ((schema.sumFields ?? []).length > 0) {
      goal.progress.field = schema.sumFields?.[sumFieldIndex]?.key;
    } else {
      delete goal.progress.field;
    }
    const nextFilters: Record<string, QuestFilter> = {};
    schema.fields.forEach((field) => {
      const enabled = Boolean(values[cursor++]);
      const operatorIndex = Number(values[cursor++]);
      const rawValue = String(values[cursor++] ?? "").trim();
      if (!enabled) return;
      if (!rawValue) return;
      const op = field.operators[operatorIndex] ?? field.defaultOperator;
      nextFilters[field.key] = { op, value: parseFilterValue(op, rawValue) };
    });
    goal.filters = nextFilters;
    onSave(goal);
  });
}

function openAddReward(player: Player): void {
  const form = new ActionFormData().title("添加任务奖励").body("选择完成任务后需要发放的奖励类型。");
  addableQuestRewardSchemas.forEach((schema) => {
    form.button(
      schema.permissionLevel === "advanced"
        ? `${schema.label}（高级）\n请确认服务器权限`
        : `${schema.label}\n配置奖励内容`,
      schema.icon
    );
  });
  form.button("返回", "textures/icons/back");
  form.show(player).then((response) => {
    if (response.canceled || response.selection === undefined) return;
    if (response.selection >= addableQuestRewardSchemas.length) return openQuestEditor(player);
    const reward = questDefinitionService.createReward(addableQuestRewardSchemas[response.selection].key);
    openRewardEditor(player, reward, (savedReward) => {
      const draft = getDraft(player);
      draft.rewards.push(savedReward);
      draft.updatedAt = Date.now();
      setDraft(player, draft);
      openQuestEditor(player);
    });
  });
}

function openRewardActions(player: Player, rewardIndex: number): void {
  const draft = getDraft(player);
  const reward = draft.rewards[rewardIndex];
  if (!reward) return openQuestEditor(player);
  new ActionFormData()
    .title(`管理奖励 ${rewardIndex + 1}`)
    .body(formatRewardDetail(reward))
    .button("编辑奖励", "textures/icons/edit2")
    .button("删除奖励", "textures/icons/whitelist_remove")
    .button("返回", "textures/icons/back")
    .show(player)
    .then((response) => {
      if (response.canceled || response.selection === undefined) return;
      if (response.selection === 0) return openEditReward(player, rewardIndex);
      if (response.selection === 1) return openDeleteRewardConfirm(player, rewardIndex);
      openQuestEditor(player);
    });
}

function openDeleteRewardConfirm(player: Player, rewardIndex: number): void {
  const draft = getDraft(player);
  const reward = draft.rewards[rewardIndex];
  if (!reward) return openQuestEditor(player);
  new MessageFormData()
    .title("删除任务奖励")
    .body(`确认删除奖励 ${rewardIndex + 1}「${getRewardLabel(reward.action)}」吗？`)
    .button1("取消")
    .button2("确认删除")
    .show(player)
    .then((response) => {
      if (!response.canceled && response.selection === 1) {
        draft.rewards.splice(rewardIndex, 1);
        draft.updatedAt = Date.now();
        setDraft(player, draft);
        return openQuestEditor(player);
      }
      openRewardActions(player, rewardIndex);
    });
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

function openRewardEditor(
  player: Player,
  reward: QuestRewardDefinition,
  onSave: (reward: QuestRewardDefinition) => void
): void {
  if (reward.action === "give_item") {
    openGiveItemRewardEditor(player, reward, onSave);
    return;
  }
  openGenericRewardEditor(player, reward, onSave);
}

function openGiveItemRewardEditor(
  player: Player,
  reward: QuestRewardDefinition,
  onSave: (reward: QuestRewardDefinition) => void
): void {
  new ActionFormData()
    .title("给予物品")
    .body(formatRewardDetail(reward))
    .button("手动填写物品\n输入物品 ID 与数量", "textures/icons/edit2")
    .button("从背包选择\n保留附魔、名称与容器数据", "textures/icons/gift")
    .button("保存奖励", "textures/icons/accept")
    .button("返回任务编辑器", "textures/icons/back")
    .show(player)
    .then((response) => {
      if (response.canceled || response.selection === undefined) return;
      if (response.selection === 0) return openGiveItemRewardFields(player, reward, onSave);
      if (response.selection === 1) return openInventoryItemRewardSelector(player, reward, onSave);
      if (response.selection === 2) {
        clearStaleRewardItemSnapshot(reward);
        const error = validateReward(reward);
        if (error) {
          showActionMessage(player, "奖励信息不完整", color.red(error), () =>
            openGiveItemRewardEditor(player, reward, onSave)
          );
          return;
        }
        return onSave(reward);
      }
      openQuestEditor(player);
    });
}

function openGiveItemRewardFields(
  player: Player,
  reward: QuestRewardDefinition,
  onSave: (reward: QuestRewardDefinition) => void
): void {
  new ModalFormData()
    .title("手动填写物品奖励")
    .textField("物品", "例如 minecraft:diamond", { defaultValue: String(reward.params.item ?? "") })
    .textField("数量", "正整数", { defaultValue: String(reward.params.amount ?? 1) })
    .submitButton("应用")
    .show(player)
    .then((response) => {
      if (response.canceled || !response.formValues) return;
      reward.params.item = String(response.formValues[0] ?? "").trim();
      reward.params.amount = Math.max(1, toNumber(String(response.formValues[1] ?? ""), 1));
      clearStaleRewardItemSnapshot(reward);
      openGiveItemRewardEditor(player, reward, onSave);
    });
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
  form.button(
    13,
    "点击下方背包物品",
    ["会保存附魔、耐久、名称、Lore 和容器内容", "不会扣除你的背包物品"],
    "minecraft:chest"
  );

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
    player.sendMessage({
      rawtext: [
        { text: "§a已选择 " },
        { translate: stack.localizationKey },
        { text: ` §7(${stack.typeId}) §ax${stack.amount}，已保存完整物品数据${nestedNote}。请确认后保存奖励。` },
      ],
    });
    openRewardEditor(player, reward, onSave);
  });
}

function openGenericRewardEditor(
  player: Player,
  reward: QuestRewardDefinition,
  onSave: (reward: QuestRewardDefinition) => void
): void {
  const schema = getQuestRewardSchema(reward.action);
  if (!schema) {
    showActionMessage(player, "奖励动作不存在", color.red(reward.action), () => openQuestEditor(player));
    return;
  }
  const form = new ModalFormData().title(`编辑奖励 · ${schema.label}`);
  schema.fields.forEach((field) => {
    if (field.type === "boolean") {
      form.toggle(field.label, { defaultValue: reward.params[field.key] === true });
    } else {
      form.textField(field.label, field.hint, { defaultValue: String(reward.params[field.key] ?? "") });
    }
  });
  form.submitButton("保存奖励");
  form.show(player).then((response) => {
    if (response.canceled || !response.formValues) return;
    schema.fields.forEach((field, index) => {
      const value = response.formValues?.[index];
      if (field.type === "boolean") {
        reward.params[field.key] = Boolean(value);
      } else if (field.type === "number") {
        reward.params[field.key] = Math.max(1, toNumber(String(value ?? ""), 1));
      } else {
        reward.params[field.key] = String(value ?? "").trim();
      }
    });
    const error = validateReward(reward);
    if (error) {
      showActionMessage(player, "奖励信息不完整", color.red(error), () =>
        openGenericRewardEditor(player, reward, onSave)
      );
      return;
    }
    onSave(reward);
  });
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
