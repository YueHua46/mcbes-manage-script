/** Shared cooperative budget for deferred event and snapshot work. No progress is discarded. */
export class QuestWorkBudget {
  private tick = -1;
  private durationMs = 0;
  private jobs = 0;

  constructor(
    private readonly limitMs = 4,
    private readonly limitJobs = 64
  ) {}

  canRun(tick: number): boolean {
    if (tick !== this.tick) {
      this.tick = tick;
      this.durationMs = 0;
      this.jobs = 0;
    }
    return this.jobs < this.limitJobs && this.durationMs < this.limitMs;
  }

  run(tick: number, work: () => void): boolean {
    if (!this.canRun(tick)) return false;
    const startedAt = Date.now();
    this.jobs += 1;
    try {
      work();
    } finally {
      this.durationMs += Math.max(0, Date.now() - startedAt);
    }
    return true;
  }
}

export const questDeferredWorkBudget = new QuestWorkBudget();
