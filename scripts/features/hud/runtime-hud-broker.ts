import { Player, system, world } from "@minecraft/server";
import identityService from "../player/services/identity-service";
import {
  HudMessageBroker,
  type ChapterBannerInput,
  type HudMessageOptions,
  type QuestToastInput,
} from "./hud-message-broker";

const RENDER_INTERVAL_TICKS = 5;
const FORCE_REFRESH_TICKS = 40;

class RuntimeHudBroker {
  private readonly broker = new HudMessageBroker();
  private readonly players = new Map<string, Player>();
  private readonly lastActionBar = new Map<string, string>();
  private readonly lastTitle = new Map<string, string>();
  private readonly lastRenderTick = new Map<string, number>();

  constructor() {
    system.runInterval(() => this.render(), RENDER_INTERVAL_TICKS);
    world.afterEvents.playerLeave.subscribe((event) => this.disconnect(event.playerId));
  }

  setPersistentStatus(player: Player, status: string): void {
    const cmid = this.remember(player);
    this.broker.setPersistentStatus(cmid, status, "player_status");
  }

  clearPersistentStatus(player: Player): void {
    const cmid = this.remember(player);
    this.broker.clearPersistentStatus(cmid);
  }

  showActionHint(player: Player, text: string, options: HudMessageOptions): void {
    const cmid = this.remember(player);
    this.broker.showActionHint(cmid, text, options, system.currentTick);
  }

  enqueueQuestToast(player: Player, toast: QuestToastInput): void {
    const cmid = this.remember(player);
    this.broker.enqueueQuestToast(cmid, toast, system.currentTick);
  }

  showChapterBanner(player: Player, banner: ChapterBannerInput): void {
    const cmid = this.remember(player);
    this.broker.showChapterBanner(cmid, banner, system.currentTick);
  }

  clearSource(player: Player, source: string): void {
    const cmid = this.remember(player);
    this.broker.clearSource(cmid, source);
  }

  private remember(player: Player): string {
    const cmid = identityService.resolvePlayerKeyForPlayer(player);
    this.players.set(cmid, player);
    return cmid;
  }

  private disconnect(runtimePlayerId: string): void {
    for (const [cmid, player] of this.players) {
      if (player.id !== runtimePlayerId) continue;
      this.players.delete(cmid);
      this.lastActionBar.delete(cmid);
      this.lastTitle.delete(cmid);
      this.lastRenderTick.delete(cmid);
      this.broker.disconnect(cmid);
    }
  }

  private render(): void {
    for (const [cmid, player] of this.players) {
      if (!player.isValid) {
        this.players.delete(cmid);
        this.broker.disconnect(cmid);
        continue;
      }
      try {
        const frame = this.broker.getFrame(cmid, system.currentTick);
        const force = system.currentTick - (this.lastRenderTick.get(cmid) ?? 0) >= FORCE_REFRESH_TICKS;
        if (force || this.lastActionBar.get(cmid) !== frame.actionBar) {
          player.onScreenDisplay.setActionBar(frame.actionBar);
          this.lastActionBar.set(cmid, frame.actionBar);
        }
        if (this.lastTitle.get(cmid) !== frame.title) {
          player.onScreenDisplay.setTitle(frame.title, { fadeInDuration: 2, stayDuration: 20, fadeOutDuration: 5 });
          this.lastTitle.set(cmid, frame.title);
        }
        this.lastRenderTick.set(cmid, system.currentTick);
      } catch (error) {
        console.warn(`[HudBroker] render failed for ${player.name}: ${String(error)}`);
      }
    }
  }
}

export default new RuntimeHudBroker();
