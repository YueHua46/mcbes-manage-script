import type { QuestEvent, QuestPlayerAggregate } from "../domain";

export type QuestEventSubscriber<TContext, TResult> = (event: QuestEvent, context: TContext) => TResult;

export class QuestEventBus<TContext = unknown, TResult = void> {
  private readonly subscribers = new Set<QuestEventSubscriber<TContext, TResult>>();

  subscribe(subscriber: QuestEventSubscriber<TContext, TResult>): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  publish(event: QuestEvent, context: TContext): TResult[] {
    if (!event.id.trim()) throw new Error("Quest event id is required");
    if (!event.type.trim()) throw new Error("Quest event type is required");
    if (!event.playerCmid.trim()) throw new Error("Quest event playerCmid is required");
    if (!event.source.trim()) throw new Error("Quest event source is required");
    if (!Number.isFinite(event.timestamp)) throw new Error("Quest event timestamp is invalid");
    return [...this.subscribers].map((subscriber) => subscriber(event, context));
  }
}

const DEFAULT_DEDUPE_LIMIT = 256;

export function hasProcessedQuestEvent(aggregate: QuestPlayerAggregate, dedupeKey: string | undefined): boolean {
  return !!dedupeKey && (aggregate.processedEventDedupe ?? []).includes(dedupeKey);
}

export function markQuestEventProcessed(
  aggregate: QuestPlayerAggregate,
  dedupeKey: string | undefined,
  limit = DEFAULT_DEDUPE_LIMIT
): void {
  if (!dedupeKey) return;
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Quest event dedupe limit must be positive");
  const keys = (aggregate.processedEventDedupe ?? []).filter((key) => key !== dedupeKey);
  keys.push(dedupeKey);
  aggregate.processedEventDedupe = keys.slice(-limit);
}
