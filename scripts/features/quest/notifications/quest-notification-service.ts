import { Player, world } from "@minecraft/server";
import hudBroker from "../../hud/runtime-hud-broker";
import type { QuestProgressChange } from "../services/quest-player";
import type { QuestDefinition } from "../services/quest-definition";
import type { QuestRarity } from "../domain";
import {
  getQuestExperienceTheme,
  getQuestFeedbackSound,
  getQuestIconMarker,
  sanitizeQuestDisplayText,
  type QuestFeedbackKind,
} from "./quest-experience-theme";

const PROGRESS_SOUND_COOLDOWN_MS = 900;
const QUEST_TOAST_EXTENSION_TICKS = 60;
const QUEST_ACCEPT_TOAST_TTL_TICKS = 48 + QUEST_TOAST_EXTENSION_TICKS;
const QUEST_AUTO_ACCEPT_TOAST_TTL_TICKS = 58 + QUEST_TOAST_EXTENSION_TICKS;
const QUEST_PROGRESS_TOAST_TTL_TICKS = 36 + QUEST_TOAST_EXTENSION_TICKS;
const QUEST_COMPLETION_TOAST_TTL_TICKS = 70 + QUEST_TOAST_EXTENSION_TICKS;
const QUEST_CLAIM_TOAST_TTL_TICKS = 54 + QUEST_TOAST_EXTENSION_TICKS;
export const QUEST_AUTO_ACCEPT_FOLLOW_UP_DELAY_TICKS = QUEST_COMPLETION_TOAST_TTL_TICKS + 10;
const QUEST_COMPLETION_PRIORITY_BASE = 100;
const QUEST_COMPLETION_MESSAGE_MAX_LENGTH = 40;
const QUEST_REWARD_LOCATION_HINT = "奖励已解锁 · 可到任务「冒险日志」领取";

function feedbackLabel(kind: QuestFeedbackKind): string {
  if (kind === "accept") return "新活儿到账";
  if (kind === "progress") return "进度有动静";
  if (kind === "complete") return "漂亮，收工";
  return "奖励落袋";
}

class QuestNotificationService {
  private readonly lastProgressSoundAt = new Map<string, number>();

  notifyAccepted(
    player: Player,
    title: string,
    rarity: QuestRarity = "common",
    questId?: string,
    delayTicks = 0
  ): void {
    this.showQuestFeedback(
      player,
      "accept",
      title,
      rarity,
      "目标已写进日志",
      QUEST_ACCEPT_TOAST_TTL_TICKS,
      questId,
      delayTicks
    );
  }

  notifyAutoAccepted(player: Player, quests: readonly QuestDefinition[], delayTicks = 0): void {
    if (quests.length === 0) return;
    if (quests.length === 1) {
      this.notifyAccepted(player, quests[0].title, quests[0].rarity, quests[0].id, delayTicks);
      return;
    }
    const rarityOrder: QuestRarity[] = ["common", "rare", "epic", "legendary"];
    const rarity = quests.reduce<QuestRarity>((highest, quest) => {
      const next = quest.rarity ?? "common";
      return rarityOrder.indexOf(next) > rarityOrder.indexOf(highest) ? next : highest;
    }, "common");
    const theme = getQuestExperienceTheme(rarity);
    hudBroker.enqueueQuestToast(player, {
      message: `${theme.marker}${theme.color}地图上又有活儿了  §0${quests.length} 项新目标 §8· 已写进日志`,
      priority: theme.priority,
      ttl: QUEST_AUTO_ACCEPT_TOAST_TTL_TICKS,
      delayTicks,
      replaceKey: "quest.auto_accept.batch",
      onDisplay: () => this.playSound(player, rarity, "accept"),
    });
  }

  notifyClaimed(player: Player, title: string, rarity: QuestRarity = "common", questId?: string): void {
    this.showQuestFeedback(player, "claim", title, rarity, "奖励已经收好", QUEST_CLAIM_TOAST_TTL_TICKS, questId);
  }

  notifyProgressChanges(player: Player, changes: readonly QuestProgressChange[]): void {
    const completedNotified = new Set<string>();
    for (const change of changes) {
      try {
        if (change.completedQuest) {
          if (completedNotified.has(change.quest.id)) continue;
          completedNotified.add(change.quest.id);
          const rarity = change.quest.rarity ?? "common";
          const customCompletionMessage = sanitizeQuestDisplayText(change.quest.completionMessage ?? "").slice(
            0,
            QUEST_COMPLETION_MESSAGE_MAX_LENGTH
          );
          const completionMessage = customCompletionMessage
            ? `${customCompletionMessage} · ${QUEST_REWARD_LOCATION_HINT}`
            : QUEST_REWARD_LOCATION_HINT;
          this.showQuestFeedback(
            player,
            "complete",
            change.quest.title,
            rarity,
            completionMessage,
            QUEST_COMPLETION_TOAST_TTL_TICKS,
            change.quest.id
          );
          this.broadcastCompletion(player, change.quest.title, rarity);
          continue;
        }
        const rarity = change.quest.rarity ?? "common";
        const theme = getQuestExperienceTheme(rarity);
        const title = sanitizeQuestDisplayText(change.quest.title);
        hudBroker.showActionHint(
          player,
          `${theme.marker}${getQuestIconMarker(change.quest.id)}${theme.color}${feedbackLabel("progress")}  §0${title} §8· ${theme.color}${change.current}/${change.target}`,
          {
            source: "quest",
            priority: Math.max(20, theme.priority - 10),
            ttl: QUEST_PROGRESS_TOAST_TTL_TICKS,
            replaceKey: `quest.progress:${change.quest.id}:${change.goal.id}`,
          }
        );
        this.playProgressSound(player, rarity, `${change.quest.id}:${change.goal.id}`);
      } catch (error) {
        console.warn(`[QuestNotification] ${player.name}: ${String(error)}`);
      }
    }
  }

  private showQuestFeedback(
    player: Player,
    kind: Exclude<QuestFeedbackKind, "progress">,
    rawTitle: string,
    rarity: QuestRarity,
    detail: string,
    ttl: number,
    questId?: string,
    delayTicks = 0
  ): void {
    const theme = getQuestExperienceTheme(rarity);
    const title = sanitizeQuestDisplayText(rawTitle);
    const safeDetail = sanitizeQuestDisplayText(detail);
    hudBroker.enqueueQuestToast(player, {
      message: `${theme.marker}${getQuestIconMarker(questId)}${theme.color}${feedbackLabel(kind)}  §0${title} §8· ${safeDetail}`,
      priority: theme.priority + (kind === "complete" ? QUEST_COMPLETION_PRIORITY_BASE : 0),
      ttl,
      delayTicks,
      replaceKey: `quest.${kind}:${questId ?? title}`,
      onDisplay: () => this.playSound(player, rarity, kind),
    });
  }

  private playProgressSound(player: Player, rarity: QuestRarity, key: string): void {
    const cooldownKey = `${player.id}:${key}`;
    const now = Date.now();
    if (now - (this.lastProgressSoundAt.get(cooldownKey) ?? 0) < PROGRESS_SOUND_COOLDOWN_MS) return;
    this.lastProgressSoundAt.set(cooldownKey, now);
    this.playSound(player, rarity, "progress");
  }

  private playSound(player: Player, rarity: QuestRarity, kind: QuestFeedbackKind): void {
    try {
      player.playSound(getQuestFeedbackSound(rarity, kind), { volume: kind === "progress" ? 0.36 : 0.58, pitch: 1 });
    } catch (error) {
      console.warn(`[QuestNotification] sound failed for ${player.name}: ${String(error)}`);
    }
  }

  private broadcastCompletion(player: Player, rawTitle: string, rarity: QuestRarity): void {
    const theme = getQuestExperienceTheme(rarity);
    const playerName = sanitizeQuestDisplayText(player.name);
    const title = sanitizeQuestDisplayText(rawTitle);
    world.sendMessage(
      `§8╭─ ${theme.color}${theme.icon} 冒险纪事 §8· ${theme.color}${theme.label}\n` +
        `§8╰ §f${playerName} §7完成了 ${theme.color}「${title}」`
    );
  }
}

export default new QuestNotificationService();
