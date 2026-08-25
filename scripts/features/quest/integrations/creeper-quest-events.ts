import type { Player } from "@minecraft/server";
import questNotificationService, {
  QUEST_AUTO_ACCEPT_FOLLOW_UP_DELAY_TICKS,
} from "../notifications/quest-notification-service";
import questPlayerService, { type QuestEventPayload } from "../services/quest-player";

export const CREEPER_QUEST_SUCCESS_EVENTS = {
  menuOpen: "creeper.menu.open",
  waypointCreate: "creeper.waypoint.create",
  tpaComplete: "creeper.tpa.complete",
  randomTeleportComplete: "creeper.random_tp.complete",
  landCreate: "creeper.land.create",
  publicWaypointUse: "creeper.public_waypoint.use",
  marketTrade: "creeper.market.trade",
  redPacket: "creeper.red_packet",
  guildJoinOrCreate: "creeper.guild.join_or_create",
} as const;

export type CreeperQuestSuccessEvent = keyof typeof CREEPER_QUEST_SUCCESS_EVENTS;

export interface CreeperQuestSuccessOptions {
  payload?: QuestEventPayload;
  dedupeKey?: string;
}

/**
 * Records an already-committed CreeperMenu business outcome.
 * Callers must invoke this only after their own persistence/teleport transaction succeeds.
 * Quest progress and HUD failures are isolated so they can never roll back business state.
 */
export function recordCreeperQuestSuccess(
  player: Player,
  event: CreeperQuestSuccessEvent,
  options: CreeperQuestSuccessOptions = {}
): void {
  try {
    const changes = questPlayerService.recordEvent(player, CREEPER_QUEST_SUCCESS_EVENTS[event], options.payload ?? {}, {
      source: "creeper_menu.business_success",
      dedupeKey: options.dedupeKey,
    });
    questNotificationService.notifyProgressChanges(player, changes);
    const autoAccepted = questPlayerService.consumeAutoAccepted(player);
    const followUpDelay = changes.some((change) => change.completedQuest) ? QUEST_AUTO_ACCEPT_FOLLOW_UP_DELAY_TICKS : 0;
    questNotificationService.notifyAutoAccepted(player, autoAccepted, followUpDelay);
  } catch (error) {
    console.warn(`[CreeperQuestIntegration] ${event}: ${String(error)}`);
  } finally {
    // Open-menu completion can auto-accept the remaining guide quests. Reconcile
    // business state on the next tick so existing waypoint/land/guild evidence applies.
    void import("../snapshots/runtime-snapshot-queue")
      .then(({ default: snapshotQueue }) => {
        if (player.isValid) snapshotQueue.mark(player, "creeper_state", `creeper_success:${event}`);
      })
      .catch(() => undefined);
  }
}
