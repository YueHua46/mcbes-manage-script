import type {
  FrozenQuestReward,
  QuestCompletionSnapshot,
  QuestDefinitionV2,
  QuestInstanceState,
  QuestRewardDefinitionV2,
} from "../domain";

const SCALABLE_REWARD_ACTIONS = new Set(["add_money", "add_exp", "give_item"]);
const MAX_REWARD_AMOUNT = 2_147_483_647;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function freezeReward(reward: QuestRewardDefinitionV2, rewardScale: number): FrozenQuestReward {
  const frozen = clone(reward) as FrozenQuestReward;
  if (!SCALABLE_REWARD_ACTIONS.has(reward.action)) return frozen;

  const amount = Number(reward.params.amount);
  if (!Number.isFinite(amount) || amount <= 0) return frozen;
  const scaled = Math.min(MAX_REWARD_AMOUNT, Math.max(1, Math.floor(amount * rewardScale)));
  frozen.params.amount = scaled;
  frozen.scaledFrom = amount;
  return frozen;
}

export function createQuestCompletionSnapshot(
  definition: QuestDefinitionV2,
  instanceId: string,
  completedAt: number,
  rewardScale: number
): QuestCompletionSnapshot {
  const scale = Number.isFinite(rewardScale) && rewardScale >= 0 ? rewardScale : 1;
  return {
    questId: definition.id,
    instanceId,
    definitionVersion: definition.definitionVersion,
    title: definition.title,
    description: definition.description,
    rarity: definition.rarity,
    completedAt,
    rewardScale: scale,
    rewards: definition.rewards.map((reward) => freezeReward(reward, scale)),
  };
}

export function completeQuestInstance(
  instance: QuestInstanceState,
  definition: QuestDefinitionV2,
  completedAt: number,
  rewardScale: number
): boolean {
  if (instance.lifecycle !== "accepted") return false;
  if (instance.questId !== definition.id) throw new Error("Quest completion definition mismatch");
  instance.lifecycle = "completed";
  instance.completedAt = completedAt;
  instance.completionSnapshot = createQuestCompletionSnapshot(
    definition,
    instance.instanceId,
    completedAt,
    rewardScale
  );
  return true;
}
