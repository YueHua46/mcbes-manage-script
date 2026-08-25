import type { FrozenQuestReward, QuestPlayerAggregate, RewardDeliveryState } from "../domain";

export type RewardHandlerIdempotency = "strong" | "recoverable" | "non_idempotent";
export type RewardRecoveryResult = "granted" | "not_granted" | "ambiguous";

export interface RewardValidationResult {
  ok: boolean;
  error?: string;
}

export interface QuestRewardHandler<TContext = unknown> {
  id: string;
  version: number;
  action: string;
  idempotency: RewardHandlerIdempotency;
  validate(reward: FrozenQuestReward, context: TContext): RewardValidationResult;
  grant(reward: FrozenQuestReward, context: TContext, idempotencyKey: string): void | Promise<void>;
  recover?(
    reward: FrozenQuestReward,
    context: TContext,
    idempotencyKey: string
  ): RewardRecoveryResult | Promise<RewardRecoveryResult>;
}

export class QuestRewardHandlerRegistry<TContext = unknown> {
  private readonly handlers = new Map<string, QuestRewardHandler<TContext>>();

  register(handler: QuestRewardHandler<TContext>): void {
    if (this.handlers.has(handler.action)) throw new Error(`Duplicate reward handler action: ${handler.action}`);
    this.handlers.set(handler.action, handler);
  }

  get(action: string): QuestRewardHandler<TContext> | undefined {
    return this.handlers.get(action);
  }
}

export interface ClaimQuestRewardsInput<TContext> {
  aggregate: QuestPlayerAggregate;
  instanceId: string;
  handlers: QuestRewardHandlerRegistry<TContext>;
  context: TContext;
  persist: (aggregate: QuestPlayerAggregate) => void | Promise<void>;
  now: () => number;
}

export type ClaimQuestRewardsResult =
  | { status: "claimed" }
  | { status: "already_claimed" }
  | { status: "validation_failed"; error: string }
  | { status: "retryable_error"; error: string }
  | { status: "recovery_required"; error: string };

export function createRewardDeliveryKey(playerCmid: string, instanceId: string, rewardId: string): string {
  return `${playerCmid}|${instanceId}|${rewardId}`;
}

async function persistRecoveryRequired<TContext>(
  input: ClaimQuestRewardsInput<TContext>,
  delivery: RewardDeliveryState,
  error: string
): Promise<ClaimQuestRewardsResult> {
  delivery.state = "recovery_required";
  delivery.error = error;
  const instance = input.aggregate.instances[input.instanceId];
  instance.lifecycle = "recovery_required";
  await input.persist(input.aggregate);
  return { status: "recovery_required", error };
}

export async function claimQuestRewards<TContext>(
  input: ClaimQuestRewardsInput<TContext>
): Promise<ClaimQuestRewardsResult> {
  const instance = input.aggregate.instances[input.instanceId];
  if (!instance) return { status: "validation_failed", error: "Quest instance does not exist" };
  if (instance.lifecycle === "claimed") return { status: "already_claimed" };
  if (instance.lifecycle === "recovery_required") {
    return { status: "recovery_required", error: "Quest reward recovery is required" };
  }
  if (!instance.completionSnapshot || (instance.lifecycle !== "completed" && instance.lifecycle !== "claiming")) {
    return { status: "validation_failed", error: "Quest instance is not claimable" };
  }

  const preparedHandlers: Array<{
    reward: FrozenQuestReward;
    handler: QuestRewardHandler<TContext>;
  }> = [];
  for (const reward of instance.completionSnapshot.rewards) {
    const handler = input.handlers.get(reward.action);
    if (!handler) return { status: "validation_failed", error: `Unknown reward action: ${reward.action}` };
    const validation = handler.validate(reward, input.context);
    if (!validation.ok) {
      return { status: "validation_failed", error: validation.error ?? `Invalid reward: ${reward.id}` };
    }
    preparedHandlers.push({ reward, handler });
  }

  instance.lifecycle = "claiming";
  await input.persist(input.aggregate);

  for (const { reward, handler } of preparedHandlers) {
    const deliveryKey = createRewardDeliveryKey(input.aggregate.playerCmid, instance.instanceId, reward.id);
    let delivery = input.aggregate.rewardLedger[deliveryKey];
    if (delivery?.state === "granted") continue;
    if (delivery?.state === "recovery_required") {
      return persistRecoveryRequired(input, delivery, delivery.error ?? `Reward ${reward.id} requires recovery`);
    }

    if (delivery?.state === "prepared") {
      if (handler.idempotency === "non_idempotent") {
        return persistRecoveryRequired(input, delivery, `Ambiguous non-idempotent reward: ${reward.id}`);
      }
      if (handler.idempotency === "recoverable") {
        if (!handler.recover) {
          return persistRecoveryRequired(input, delivery, `Reward handler cannot recover: ${handler.id}`);
        }
        const recovered = await handler.recover(reward, input.context, delivery.idempotencyKey);
        if (recovered === "ambiguous") {
          return persistRecoveryRequired(input, delivery, `Ambiguous recoverable reward: ${reward.id}`);
        }
        if (recovered === "granted") {
          delivery.state = "granted";
          delivery.grantedAt = input.now();
          delivery.error = undefined;
          await input.persist(input.aggregate);
          continue;
        }
      }
    } else {
      delivery = {
        rewardId: reward.id,
        instanceId: instance.instanceId,
        state: "prepared",
        idempotencyKey: deliveryKey,
        preparedAt: input.now(),
        handlerId: handler.id,
        handlerVersion: handler.version,
      };
      input.aggregate.rewardLedger[deliveryKey] = delivery;
      await input.persist(input.aggregate);
    }

    try {
      await handler.grant(reward, input.context, delivery.idempotencyKey);
    } catch (error) {
      delivery.error = String(error);
      if (handler.idempotency === "non_idempotent") {
        return persistRecoveryRequired(input, delivery, `Ambiguous reward execution: ${reward.id}: ${String(error)}`);
      }
      await input.persist(input.aggregate);
      return { status: "retryable_error", error: String(error) };
    }

    delivery.state = "granted";
    delivery.grantedAt = input.now();
    delivery.error = undefined;
    await input.persist(input.aggregate);
  }

  instance.lifecycle = "claimed";
  instance.claimedAt = input.now();
  await input.persist(input.aggregate);
  return { status: "claimed" };
}
