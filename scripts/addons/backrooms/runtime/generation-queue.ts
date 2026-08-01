import { system } from "@minecraft/server";
import { type BackroomsRegion, type BackroomsRuntimeConfig, type RegionLayoutProvider, regionKey } from "./contracts";
import { BackroomsRegionBuilder, BackroomsTickingAreaCapacityError } from "./region-builder";

interface QueueEntry {
  region: BackroomsRegion;
  priority: number;
  requestedTick: number;
  lastRequestedTick: number;
  availableTick: number;
  attempts: number;
}

interface RegionWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
}

interface GateRetryEntry {
  region: BackroomsRegion;
  availableTick: number;
}

export type RegionQueueStatus = "absent" | "queued" | "building" | "ready" | "cooldown";

/** Deduplicating, retrying single-writer queue for deterministic region construction. */
export class BackroomsGenerationQueue {
  private readonly queued = new Map<string, QueueEntry>();
  private readonly active = new Map<string, Promise<void>>();
  private readonly ready = new Map<string, number>();
  private readonly cooldownUntil = new Map<string, number>();
  private readonly pendingGateRetries = new Map<string, GateRetryEntry>();
  private readonly waiters = new Map<string, RegionWaiter[]>();
  private intervalId: number | undefined;

  public constructor(
    private readonly config: BackroomsRuntimeConfig,
    private readonly layouts: RegionLayoutProvider,
    private readonly builder: BackroomsRegionBuilder
  ) {}

  public start(): void {
    if (this.intervalId !== undefined) return;
    this.intervalId = system.runInterval(() => this.pump(), this.config.queuePumpIntervalTicks);
  }

  public stop(): void {
    if (this.intervalId !== undefined) {
      system.clearRun(this.intervalId);
      this.intervalId = undefined;
    }
    const error = new Error("Backrooms 生成队列已停止");
    for (const waiters of this.waiters.values()) {
      for (const waiter of waiters) waiter.reject(error);
    }
    this.waiters.clear();
  }

  public request(region: BackroomsRegion, priority = 0): void {
    this.assertRegion(region);
    const key = regionKey(region);
    if (this.ready.has(key) || this.active.has(key)) return;
    const cooldown = this.cooldownUntil.get(key) ?? 0;
    const existing = this.queued.get(key);
    if (existing) {
      existing.priority = Math.min(existing.priority, priority);
      existing.lastRequestedTick = system.currentTick;
      return;
    }
    this.queued.set(key, {
      region: { ...region },
      priority,
      requestedTick: system.currentTick,
      lastRequestedTick: system.currentTick,
      availableTick: Math.max(system.currentTick, cooldown),
      attempts: 0,
    });
    this.trimQueue();
  }

  /** Explicit alias used by teleport/manifestation services. */
  public requestRegion(region: BackroomsRegion, priority = 0): void {
    this.request(region, priority);
  }

  /**
   * Resolves only after the underground ready marker has been observed or committed.
   * This permits safe teleports to arbitrarily distant, per-player manifestation slots.
   */
  public ensureRegionReady(region: BackroomsRegion, priority = -1_000): Promise<void> {
    this.assertRegion(region);
    const key = regionKey(region);
    if (this.ready.has(key)) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      let timeoutId = 0;
      const waiter: RegionWaiter = {
        resolve: () => {
          system.clearRun(timeoutId);
          resolve();
        },
        reject: (error) => {
          system.clearRun(timeoutId);
          reject(error);
        },
      };
      const existing = this.waiters.get(key);
      if (existing) existing.push(waiter);
      else this.waiters.set(key, [waiter]);
      timeoutId = system.runTimeout(() => {
        const current = this.waiters.get(key);
        if (!current || !current.includes(waiter)) return;
        const remaining = current.filter((item) => item !== waiter);
        if (remaining.length) this.waiters.set(key, remaining);
        else this.waiters.delete(key);
        reject(new Error(`等待区域 ${key} 生成超时`));
      }, this.config.ensureTimeoutTicks);
      this.request(region, priority);
    });
  }

  public getStatus(region: BackroomsRegion): RegionQueueStatus {
    const key = regionKey(region);
    if (this.ready.has(key)) return "ready";
    if (this.active.has(key)) return "building";
    const entry = this.queued.get(key);
    if (entry) return entry.availableTick > system.currentTick ? "cooldown" : "queued";
    if ((this.cooldownUntil.get(key) ?? 0) > system.currentTick) return "cooldown";
    return "absent";
  }

  public isKnownReady(region: BackroomsRegion): boolean {
    return this.ready.has(regionKey(region));
  }

  public get queuedCount(): number {
    return this.queued.size;
  }

  public get activeCount(): number {
    return this.active.size;
  }

  private pump(): void {
    this.dropExpiredRequests();
    while (this.active.size < this.config.maxConcurrentBuilds) {
      const next = this.takeNextAvailable();
      if (next) {
        const key = regionKey(next.region);
        const task = this.process(next).finally(() => this.active.delete(key));
        this.active.set(key, task);
        continue;
      }
      const gateRetry = this.takeGateRetry();
      if (!gateRetry) return;
      const activeKey = `gate:${regionKey(gateRetry.region)}`;
      const task = this.reconcileGates(gateRetry).finally(() => this.active.delete(activeKey));
      this.active.set(activeKey, task);
    }
  }

  private takeNextAvailable(): QueueEntry | undefined {
    let bestKey: string | undefined;
    let best: QueueEntry | undefined;
    for (const [key, entry] of this.queued) {
      if (entry.availableTick > system.currentTick) continue;
      const effectivePriority = entry.priority - Math.floor((system.currentTick - entry.requestedTick) / 20);
      const bestEffectivePriority = best
        ? best.priority - Math.floor((system.currentTick - best.requestedTick) / 20)
        : Number.POSITIVE_INFINITY;
      if (
        !best ||
        effectivePriority < bestEffectivePriority ||
        (effectivePriority === bestEffectivePriority && entry.requestedTick < best.requestedTick)
      ) {
        bestKey = key;
        best = entry;
      }
    }
    if (bestKey) this.queued.delete(bestKey);
    return best;
  }

  private async process(entry: QueueEntry): Promise<void> {
    const key = regionKey(entry.region);
    try {
      const plan = await this.layouts.createPlan(entry.region);
      await this.builder.build(entry.region, plan);
      this.markReady(key);
      this.resolveWaiters(key);
      this.cooldownUntil.delete(key);
      try {
        await this.builder.connectReadyNeighbors(entry.region, (neighbor) => this.isKnownReady(neighbor));
      } catch (error) {
        this.pendingGateRetries.set(key, {
          region: { ...entry.region },
          availableTick: system.currentTick + this.config.retryBaseDelayTicks,
        });
        console.warn(`[Backrooms] 区域 ${key} 已完成，但边界提交失败：${String(error)}`);
      }
    } catch (error) {
      if (error instanceof BackroomsTickingAreaCapacityError) {
        // Capacity pressure is external backpressure, not a failed deterministic build.
        entry.availableTick = system.currentTick + this.config.retryBaseDelayTicks;
        this.queued.set(key, entry);
        return;
      }
      entry.attempts++;
      if (entry.attempts < this.config.maxBuildAttempts) {
        const delay = this.config.retryBaseDelayTicks * 2 ** (entry.attempts - 1);
        entry.availableTick = system.currentTick + delay;
        this.queued.set(key, entry);
        console.warn(`[Backrooms] 区域 ${key} 构建失败，将进行第 ${entry.attempts + 1} 次尝试：${String(error)}`);
      } else {
        const cooldown = system.currentTick + this.config.retryBaseDelayTicks * 16;
        this.cooldownUntil.set(key, cooldown);
        this.rejectWaiters(key, new Error(`区域 ${key} 在 ${entry.attempts} 次尝试后仍无法生成：${String(error)}`));
        console.error(`[Backrooms] 区域 ${key} 连续构建失败，进入冷却：${String(error)}`);
      }
    }
  }

  private markReady(key: string): void {
    this.ready.delete(key);
    this.ready.set(key, system.currentTick);
    while (this.ready.size > this.config.readyCacheSize) {
      const oldest = this.ready.keys().next().value as string | undefined;
      if (!oldest) break;
      this.ready.delete(oldest);
    }
  }

  private takeGateRetry(): GateRetryEntry | undefined {
    for (const [key, entry] of this.pendingGateRetries) {
      if (entry.availableTick > system.currentTick) continue;
      this.pendingGateRetries.delete(key);
      return entry;
    }
    return undefined;
  }

  private async reconcileGates(entry: GateRetryEntry): Promise<void> {
    const key = regionKey(entry.region);
    try {
      await this.builder.connectReadyNeighbors(entry.region, (neighbor) => this.isKnownReady(neighbor));
    } catch (error) {
      entry.availableTick = system.currentTick + this.config.retryBaseDelayTicks;
      this.pendingGateRetries.set(key, entry);
    }
  }

  private resolveWaiters(key: string): void {
    const waiters = this.waiters.get(key);
    if (!waiters) return;
    this.waiters.delete(key);
    for (const waiter of waiters) waiter.resolve();
  }

  private rejectWaiters(key: string, error: Error): void {
    const waiters = this.waiters.get(key);
    if (!waiters) return;
    this.waiters.delete(key);
    for (const waiter of waiters) waiter.reject(error);
  }

  private assertRegion(region: BackroomsRegion): void {
    if (!Number.isSafeInteger(region.rx) || !Number.isSafeInteger(region.rz)) {
      throw new Error(`无效的 Backrooms 区域坐标：${region.rx},${region.rz}`);
    }
  }

  private dropExpiredRequests(): void {
    for (const [key, entry] of this.queued) {
      if (this.waiters.has(key)) continue;
      if (system.currentTick - entry.lastRequestedTick > this.config.requestTtlTicks) this.queued.delete(key);
    }
    for (const [key, tick] of this.cooldownUntil) {
      if (tick <= system.currentTick) this.cooldownUntil.delete(key);
    }
  }

  private trimQueue(): void {
    while (this.queued.size > this.config.maxQueuedRegions) {
      let victimKey: string | undefined;
      let victim: QueueEntry | undefined;
      for (const [key, entry] of this.queued) {
        if (this.waiters.has(key)) continue;
        if (
          !victim ||
          entry.priority > victim.priority ||
          (entry.priority === victim.priority && entry.lastRequestedTick < victim.lastRequestedTick)
        ) {
          victimKey = key;
          victim = entry;
        }
      }
      // Explicit ensure waiters are never evicted; a temporary overflow is safer than a hung teleport.
      if (!victimKey) return;
      this.queued.delete(victimKey);
    }
  }
}
