export interface HudMessageOptions {
  source: string;
  priority: number;
  ttl: number;
  replaceKey?: string;
}

export interface QuestToastInput {
  message: string;
  priority?: number;
  ttl?: number;
  delayTicks?: number;
  replaceKey?: string;
  onDisplay?: () => void;
}

export interface ChapterBannerInput {
  message: string;
  priority?: number;
  ttl?: number;
  replaceKey?: string;
}

export interface HudFrame {
  actionBar: string;
  title: string;
  actionSource?: string;
  titleSource?: string;
}

interface HudMessage {
  message: string;
  source: string;
  priority: number;
  expiresAt: number;
  notBefore: number;
  ttl: number;
  replaceKey?: string;
  onDisplay?: () => void;
}

interface PlayerHudState {
  persistent?: { message: string; source: string };
  hints: HudMessage[];
  toastQueue: HudMessage[];
  currentToast?: HudMessage;
  bannerQueue: HudMessage[];
  currentBanner?: HudMessage;
}

function message(
  input: string,
  options: HudMessageOptions,
  now: number,
  delayTicks = 0,
  onDisplay?: () => void
): HudMessage {
  if (!options.source.trim()) throw new Error("HUD source is required");
  if (!Number.isFinite(options.priority)) throw new Error("HUD priority is invalid");
  if (!Number.isInteger(options.ttl) || options.ttl < 1) throw new Error("HUD TTL must be a positive integer");
  if (!Number.isInteger(delayTicks) || delayTicks < 0) throw new Error("HUD delay must be a non-negative integer");
  return {
    message: input,
    source: options.source,
    priority: options.priority,
    expiresAt: now + delayTicks + options.ttl,
    notBefore: now + delayTicks,
    ttl: options.ttl,
    replaceKey: options.replaceKey,
    onDisplay,
  };
}

function replaceQueued(queue: HudMessage[], next: HudMessage): HudMessage[] {
  if (!next.replaceKey) return [...queue, next];
  return [...queue.filter((entry) => entry.replaceKey !== next.replaceKey), next];
}

export class HudMessageBroker {
  private readonly players = new Map<string, PlayerHudState>();

  setPersistentStatus(playerCmid: string, status: string, source = "persistent_status"): void {
    this.state(playerCmid).persistent = { message: status, source };
  }

  clearPersistentStatus(playerCmid: string): void {
    this.state(playerCmid).persistent = undefined;
  }

  showActionHint(playerCmid: string, text: string, options: HudMessageOptions, now: number): void {
    const state = this.state(playerCmid);
    const next = message(text, options, now);
    state.hints = next.replaceKey
      ? [...state.hints.filter((entry) => entry.replaceKey !== next.replaceKey), next]
      : [...state.hints, next];
  }

  enqueueQuestToast(playerCmid: string, toast: QuestToastInput, now: number): void {
    const state = this.state(playerCmid);
    if (state.currentToast && state.currentToast.expiresAt <= now) state.currentToast = undefined;
    const next = message(
      toast.message,
      { source: "quest", priority: toast.priority ?? 30, ttl: toast.ttl ?? 60, replaceKey: toast.replaceKey },
      now,
      toast.delayTicks ?? 0,
      toast.onDisplay
    );
    if (state.currentToast?.replaceKey && state.currentToast.replaceKey === next.replaceKey && next.notBefore <= now)
      this.activateQuestToast(state, next, now);
    else state.toastQueue = replaceQueued(state.toastQueue, next);
    this.promoteQuestToast(state, now);
  }

  showChapterBanner(playerCmid: string, banner: ChapterBannerInput, now: number): void {
    const state = this.state(playerCmid);
    const next = message(
      banner.message,
      { source: "quest", priority: banner.priority ?? 40, ttl: banner.ttl ?? 80, replaceKey: banner.replaceKey },
      now
    );
    if (state.currentBanner?.replaceKey && state.currentBanner.replaceKey === next.replaceKey)
      state.currentBanner = next;
    else if (!state.currentBanner) state.currentBanner = next;
    else state.bannerQueue = replaceQueued(state.bannerQueue, next);
  }

  clearSource(playerCmid: string, source: string): void {
    const state = this.players.get(playerCmid);
    if (!state) return;
    if (state.persistent?.source === source) state.persistent = undefined;
    state.hints = state.hints.filter((entry) => entry.source !== source);
    state.toastQueue = state.toastQueue.filter((entry) => entry.source !== source);
    state.bannerQueue = state.bannerQueue.filter((entry) => entry.source !== source);
    if (state.currentToast?.source === source) state.currentToast = undefined;
    if (state.currentBanner?.source === source) state.currentBanner = undefined;
  }

  getFrame(playerCmid: string, now: number): HudFrame {
    const state = this.state(playerCmid);
    state.hints = state.hints.filter((entry) => entry.expiresAt > now);
    if (state.currentToast && state.currentToast.expiresAt <= now) state.currentToast = undefined;
    this.promoteQuestToast(state, now);
    if (state.currentBanner && state.currentBanner.expiresAt <= now) state.currentBanner = undefined;
    if (!state.currentBanner) {
      state.currentBanner = state.bannerQueue.shift();
      if (state.currentBanner) state.currentBanner.expiresAt = now + state.currentBanner.ttl;
    }

    const actionCandidates = state.currentToast ? [...state.hints, state.currentToast] : state.hints;
    const action = actionCandidates.sort((left, right) => right.priority - left.priority)[0];
    return {
      actionBar: action?.message ?? state.persistent?.message ?? "",
      title: state.currentBanner?.message ?? "",
      actionSource: action?.source ?? state.persistent?.source,
      titleSource: state.currentBanner?.source,
    };
  }

  disconnect(playerCmid: string): void {
    this.players.delete(playerCmid);
  }

  private state(playerCmid: string): PlayerHudState {
    if (!playerCmid.trim()) throw new Error("HUD playerCmid is required");
    let state = this.players.get(playerCmid);
    if (!state) {
      state = { hints: [], toastQueue: [], bannerQueue: [] };
      this.players.set(playerCmid, state);
    }
    return state;
  }

  private promoteQuestToast(state: PlayerHudState, now: number): void {
    let bestIndex = -1;
    for (let index = 0; index < state.toastQueue.length; index++) {
      const candidate = state.toastQueue[index];
      if (candidate.notBefore > now) continue;
      if (bestIndex < 0 || candidate.priority > state.toastQueue[bestIndex].priority) bestIndex = index;
    }
    if (bestIndex < 0) return;

    const next = state.toastQueue[bestIndex];
    if (state.currentToast?.replaceKey && state.currentToast.replaceKey === next.replaceKey) {
      state.toastQueue.splice(bestIndex, 1);
      this.activateQuestToast(state, next, now);
      return;
    }
    if (state.currentToast && state.currentToast.priority >= next.priority) return;
    state.toastQueue.splice(bestIndex, 1);
    if (state.currentToast) state.toastQueue.push(state.currentToast);
    this.activateQuestToast(state, next, now);
  }

  private activateQuestToast(state: PlayerHudState, next: HudMessage, now: number): void {
    next.expiresAt = now + next.ttl;
    state.currentToast = next;
    const onDisplay = next.onDisplay;
    next.onDisplay = undefined;
    onDisplay?.();
  }
}
