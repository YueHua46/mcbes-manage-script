import { Container, ItemStack, Player, system } from "@minecraft/server";
import { Database } from "../../../shared/database/database";
import { deserializeItemStack, PersistedItemStack } from "../../../shared/utils/item-stack-persist";
import economic from "../../economic/services/economic";
import { isRealPlayerEntity } from "../../../shared/utils/online-players";
import questDefinitionService, {
  QuestDefinition,
  QuestFilter,
  QuestGoalDefinition,
  QuestRewardDefinition,
  formatFilterValue,
} from "./quest-definition";

export interface QuestPlayerQuestState {
  questId: string;
  acceptedAt: number;
  periodKey: string;
  progress: Record<string, number>;
  completedAt?: number;
  claimedAt?: number;
}

export interface QuestPlayerState {
  playerName: string;
  quests: Record<string, QuestPlayerQuestState>;
}

export interface QuestProgressChange {
  quest: QuestDefinition;
  goal: QuestGoalDefinition;
  current: number;
  target: number;
  completedQuest: boolean;
}

export interface QuestEventPayload {
  entity?: string;
  block?: string;
  item?: string;
  amount?: number;
  seconds?: number;
  dimension?: string;
}

function normalizePlayerKey(playerOrName: Player | string): string {
  return (typeof playerOrName === "string" ? playerOrName : playerOrName.name).trim().toLowerCase();
}

function getPeriodKey(quest: QuestDefinition, at = Date.now()): string {
  const date = new Date(at + 8 * 60 * 60 * 1000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  if (quest.scope === "daily") return `${year}-${month}-${day}`;
  if (quest.scope === "weekly") {
    const weekStart = new Date(Date.UTC(year, date.getUTCMonth(), date.getUTCDate()));
    const dayOfWeek = weekStart.getUTCDay() || 7;
    weekStart.setUTCDate(weekStart.getUTCDate() - dayOfWeek + 1);
    return `${weekStart.getUTCFullYear()}-W${String(Math.ceil(((weekStart.getTime() - Date.UTC(weekStart.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7)).padStart(2, "0")}`;
  }
  return quest.scope;
}

function normalizeDimension(value: unknown): string {
  const text = String(value ?? "");
  return text.startsWith("minecraft:") ? text.slice("minecraft:".length) : text;
}

function asList(value: QuestFilter["value"]): string[] {
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function matchesFilter(filter: QuestFilter | undefined, actual: string | number | boolean | undefined): boolean {
  if (!filter) return true;
  if (actual === undefined) return false;

  if (filter.op === "eq") return String(actual) === String(filter.value);
  if (filter.op === "in") return asList(filter.value).includes(String(actual));
  if (filter.op === "contains") return String(actual).includes(String(filter.value));

  const actualNumber = Number(actual);
  const expectedNumber = Number(filter.value);
  if (!Number.isFinite(actualNumber) || !Number.isFinite(expectedNumber)) return false;
  if (filter.op === "gte") return actualNumber >= expectedNumber;
  if (filter.op === "lte") return actualNumber <= expectedNumber;
  return false;
}

function goalMatches(goal: QuestGoalDefinition, payload: QuestEventPayload): boolean {
  return Object.entries(goal.filters).every(([key, filter]) => {
    const actual =
      key === "dimension" ? normalizeDimension(payload.dimension) : payload[key as keyof QuestEventPayload];
    return matchesFilter(filter, actual as string | number | boolean | undefined);
  });
}

function getIncrement(goal: QuestGoalDefinition, payload: QuestEventPayload): number {
  if (goal.progress.mode === "sum" && goal.progress.field) {
    const value = Number(payload[goal.progress.field as keyof QuestEventPayload] ?? 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }
  return 1;
}

function isGoalComplete(state: QuestPlayerQuestState, goal: QuestGoalDefinition): boolean {
  return (state.progress[goal.id] ?? 0) >= goal.progress.target;
}

function isQuestComplete(quest: QuestDefinition, state: QuestPlayerQuestState): boolean {
  if (quest.goals.length === 0) return false;
  if (quest.completeWhen === "any") return quest.goals.some((goal) => isGoalComplete(state, goal));
  return quest.goals.every((goal) => isGoalComplete(state, goal));
}

function getPersistedItemStack(value: unknown): PersistedItemStack | undefined {
  if (!value || typeof value !== "object") return undefined;
  const data = value as Partial<PersistedItemStack>;
  if (typeof data.typeId !== "string" || !data.typeId.trim()) return undefined;
  if (!Number.isFinite(Number(data.amount)) || Number(data.amount) <= 0) return undefined;
  return data as PersistedItemStack;
}

function addItemCopies(container: Container, player: Player, template: ItemStack, amount: number): void {
  let remaining = amount;
  const maxPerStack = Math.max(1, Math.min(template.maxAmount || 1, 255));

  while (remaining > 0) {
    const stackAmount = Math.min(maxPerStack, remaining);
    const item = template.clone();
    item.amount = stackAmount;
    const overflow = container.addItem(item);
    if (overflow) player.dimension.spawnItem(overflow, player.location);
    remaining -= stackAmount;
  }
}

class QuestPlayerService {
  private db?: Database<QuestPlayerState>;

  constructor() {
    system.run(() => {
      this.db = new Database<QuestPlayerState>("quest_player_states");
    });
  }

  isReady(): boolean {
    return this.db !== undefined;
  }

  getState(playerOrName: Player | string): QuestPlayerState {
    const key = normalizePlayerKey(playerOrName);
    const existing = this.db?.get(key);
    if (existing) return existing;
    return { playerName: typeof playerOrName === "string" ? playerOrName : playerOrName.name, quests: {} };
  }

  saveState(playerOrName: Player | string, state: QuestPlayerState): boolean {
    if (!this.db) return false;
    this.db.set(normalizePlayerKey(playerOrName), state);
    this.db.save(true);
    return true;
  }

  getEnabledQuests(): QuestDefinition[] {
    return questDefinitionService.getAll().filter((quest) => quest.enabled);
  }

  getQuestState(playerOrName: Player | string, quest: QuestDefinition): QuestPlayerQuestState | undefined {
    const state = this.getState(playerOrName).quests[quest.id];
    if (!state) return undefined;
    return state.periodKey === getPeriodKey(quest) ? state : undefined;
  }

  canAccept(playerOrName: Player | string, quest: QuestDefinition): boolean {
    const playerState = this.getState(playerOrName);
    const state = playerState.quests[quest.id];
    if (!state) return true;
    if (state.periodKey !== getPeriodKey(quest)) return true;
    return quest.scope === "repeatable" && state.claimedAt !== undefined;
  }

  acceptQuest(player: Player, questId: string): string | undefined {
    const quest = questDefinitionService.get(questId);
    if (!quest || !quest.enabled) return "任务不存在或未启用。";
    if (!this.canAccept(player, quest)) return "你已经接受了这个任务。";

    const playerState = this.getState(player);
    playerState.playerName = player.name;
    playerState.quests[quest.id] = {
      questId: quest.id,
      acceptedAt: Date.now(),
      periodKey: getPeriodKey(quest),
      progress: {},
    };
    this.saveState(player, playerState);
    return undefined;
  }

  ensureAutoAccepted(player: Player): void {
    const quests = this.getEnabledQuests().filter((quest) => quest.autoAccept && this.canAccept(player, quest));
    if (quests.length === 0) return;
    const playerState = this.getState(player);
    quests.forEach((quest) => {
      playerState.quests[quest.id] = {
        questId: quest.id,
        acceptedAt: Date.now(),
        periodKey: getPeriodKey(quest),
        progress: {},
      };
    });
    this.saveState(player, playerState);
  }

  recordEvent(player: Player, eventKey: string, payload: QuestEventPayload): QuestProgressChange[] {
    if (!isRealPlayerEntity(player)) return [];
    if (!this.isReady() || !questDefinitionService.isReady()) return [];
    this.ensureAutoAccepted(player);

    const playerState = this.getState(player);
    const changes: QuestProgressChange[] = [];

    for (const quest of this.getEnabledQuests()) {
      const state = this.getQuestState(player, quest);
      if (!state || state.claimedAt !== undefined) continue;
      if (state.completedAt !== undefined) continue;

      let changed = false;
      for (const goal of quest.goals) {
        if (goal.event !== eventKey || !goalMatches(goal, payload)) continue;
        const current = state.progress[goal.id] ?? 0;
        if (current >= goal.progress.target) continue;

        const increment = getIncrement(goal, payload);
        if (increment <= 0) continue;
        const next = Math.min(goal.progress.target, current + increment);
        state.progress[goal.id] = next;
        changed = true;

        changes.push({
          quest,
          goal,
          current: next,
          target: goal.progress.target,
          completedQuest: false,
        });
      }

      if (changed && isQuestComplete(quest, state)) {
        state.completedAt = Date.now();
        changes.forEach((change) => {
          if (change.quest.id === quest.id) change.completedQuest = true;
        });
      }
    }

    if (changes.length > 0) this.saveState(player, playerState);
    return changes;
  }

  getProgress(playerOrName: Player | string, quest: QuestDefinition, goal: QuestGoalDefinition): number {
    return this.getQuestState(playerOrName, quest)?.progress[goal.id] ?? 0;
  }

  isCompleted(playerOrName: Player | string, quest: QuestDefinition): boolean {
    const state = this.getQuestState(playerOrName, quest);
    return state ? isQuestComplete(quest, state) : false;
  }

  canClaim(playerOrName: Player | string, quest: QuestDefinition): boolean {
    const state = this.getQuestState(playerOrName, quest);
    return !!state && state.claimedAt === undefined && isQuestComplete(quest, state);
  }

  claimQuest(player: Player, questId: string): string | undefined {
    const quest = questDefinitionService.get(questId);
    if (!quest || !quest.enabled) return "任务不存在或未启用。";
    const playerState = this.getState(player);
    const state = this.getQuestState(player, quest);
    if (!state) return "你还没有接受这个任务。";
    if (state.claimedAt !== undefined) return "这个任务奖励已经领取过了。";
    if (!isQuestComplete(quest, state)) return "任务还没有完成。";

    const rewardError = this.grantRewards(player, quest.rewards);
    if (rewardError) return rewardError;

    state.completedAt ??= Date.now();
    state.claimedAt = Date.now();
    playerState.quests[quest.id] = state;
    this.saveState(player, playerState);
    return undefined;
  }

  getSummary(player: Player): {
    total: number;
    accepted: number;
    completed: number;
    claimable: number;
    available: number;
  } {
    const quests = this.getEnabledQuests();
    const acceptedStates = quests.map((quest) => this.getQuestState(player, quest)).filter(Boolean);
    const completed = quests.filter((quest) => this.isCompleted(player, quest)).length;
    return {
      total: quests.length,
      accepted: acceptedStates.length,
      completed,
      claimable: quests.filter((quest) => this.canClaim(player, quest)).length,
      available: quests.filter((quest) => this.canAccept(player, quest)).length,
    };
  }

  formatGoalProgress(player: Player, quest: QuestDefinition, goal: QuestGoalDefinition): string {
    const current = this.getProgress(player, quest, goal);
    const target = goal.progress.target;
    const filterText = Object.entries(goal.filters)
      .map(([key, filter]) => `${key} ${filter.op} ${formatFilterValue(filter.value)}`)
      .join("，");
    return `${current}/${target}${filterText ? ` · ${filterText}` : ""}`;
  }

  private grantRewards(player: Player, rewards: QuestRewardDefinition[]): string | undefined {
    for (const reward of rewards) {
      const error = this.grantReward(player, reward);
      if (error) return error;
    }
    return undefined;
  }

  private grantReward(player: Player, reward: QuestRewardDefinition): string | undefined {
    if (reward.action === "give_item") {
      const itemId = String(reward.params.item ?? "").trim();
      const amount = Math.max(1, Math.floor(Number(reward.params.amount ?? 1)));
      const container = player.getComponent("inventory")?.container;
      if (!container) return "无法读取你的背包，奖励暂未领取。";

      const itemSnapshot = getPersistedItemStack(reward.params.itemSnapshot);
      if (itemSnapshot) {
        try {
          const template = deserializeItemStack({
            ...itemSnapshot,
            amount: Math.min(Math.max(itemSnapshot.amount, 1), 255),
          });
          addItemCopies(container, player, template, amount);
          player.sendMessage({
            rawtext: [
              { text: "§a获得任务奖励：§e" },
              { translate: template.localizationKey },
              { text: ` §7(${itemSnapshot.typeId}) §ex${amount}` },
            ],
          });
          return undefined;
        } catch {
          // 继续尝试旧的 typeId 发放逻辑。
        }
      }

      try {
        const rewardStack = new ItemStack(itemId, 1);
        let remaining = amount;
        while (remaining > 0) {
          const stackAmount = Math.min(64, remaining);
          const overflow = container.addItem(new ItemStack(itemId, stackAmount));
          if (overflow) player.dimension.spawnItem(overflow, player.location);
          remaining -= stackAmount;
        }
        player.sendMessage({
          rawtext: [
            { text: "§a获得任务奖励：§e" },
            { translate: rewardStack.localizationKey },
            { text: ` §7(${itemId}) §ex${amount}` },
          ],
        });
      } catch {
        return `物品奖励配置无效：${itemId}`;
      }
      return undefined;
    }

    if (reward.action === "add_money") {
      if (!economic.isEconomyEnabled()) {
        player.sendMessage("§7经济系统已关闭，本次任务金币奖励不发放。");
        return undefined;
      }
      const amount = Math.max(1, Math.floor(Number(reward.params.amount ?? 0)));
      const added = economic.addGold(player.name, amount, "任务奖励", true);
      if (added <= 0) return "金币奖励发放失败。";
      player.sendMessage(`§a获得任务奖励：§e${added} §a金币`);
      return undefined;
    }

    if (reward.action === "add_exp") {
      const amount = Math.max(1, Math.floor(Number(reward.params.amount ?? 0)));
      player.runCommand(`xp ${amount} @s`);
      player.sendMessage(`§a获得任务奖励：§e${amount} §a经验`);
      return undefined;
    }

    if (reward.action === "send_message") {
      player.sendMessage(String(reward.params.message ?? ""));
      return undefined;
    }

    if (reward.action === "run_command") {
      const command = String(reward.params.command ?? "").replace(/\{player\}/g, player.name);
      if (command.trim()) player.runCommand(command);
      return undefined;
    }

    return `未知奖励类型：${reward.action}`;
  }
}

export default new QuestPlayerService();
