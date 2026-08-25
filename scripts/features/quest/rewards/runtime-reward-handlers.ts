import { Container, ItemStack, Player } from "@minecraft/server";
import { deserializeItemStack, PersistedItemStack } from "../../../shared/utils/item-stack-persist";
import economic from "../../economic/services/economic";
import type { FrozenQuestReward } from "../domain";
import { QuestRewardHandlerRegistry, type RewardValidationResult } from "./reward-ledger";

function getPositiveInteger(value: unknown): number | undefined {
  const amount = Math.floor(Number(value));
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

function getPersistedItemStack(value: unknown): PersistedItemStack | undefined {
  if (!value || typeof value !== "object") return undefined;
  const data = value as Partial<PersistedItemStack>;
  if (typeof data.typeId !== "string" || !data.typeId.trim()) return undefined;
  if (!getPositiveInteger(data.amount)) return undefined;
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

function validateItemReward(reward: FrozenQuestReward, player: Player): RewardValidationResult {
  if (!player.getComponent("inventory")?.container) return { ok: false, error: "无法读取你的背包，奖励暂未领取。" };
  if (!getPositiveInteger(reward.params.amount ?? 1)) return { ok: false, error: `物品奖励数量无效：${reward.id}` };

  const snapshot = getPersistedItemStack(reward.params.itemSnapshot);
  if (snapshot) {
    try {
      deserializeItemStack({ ...snapshot, amount: Math.min(Math.max(snapshot.amount, 1), 255) });
      return { ok: true };
    } catch {
      // 兼容旧定义：快照无效时继续验证 typeId。
    }
  }

  const itemId = String(reward.params.item ?? "").trim();
  if (!itemId) return { ok: false, error: `物品奖励未配置物品：${reward.id}` };
  try {
    new ItemStack(itemId, 1);
    return { ok: true };
  } catch {
    return { ok: false, error: `物品奖励配置无效：${itemId}` };
  }
}

function grantItemReward(reward: FrozenQuestReward, player: Player): void {
  const amount = getPositiveInteger(reward.params.amount ?? 1)!;
  const container = player.getComponent("inventory")?.container;
  if (!container) throw new Error("无法读取你的背包，奖励发放状态未知。");
  const snapshot = getPersistedItemStack(reward.params.itemSnapshot);

  if (snapshot) {
    try {
      const template = deserializeItemStack({ ...snapshot, amount: Math.min(Math.max(snapshot.amount, 1), 255) });
      addItemCopies(container, player, template, amount);
      player.sendMessage({
        rawtext: [
          { text: "§a获得任务奖励：§e" },
          { translate: template.localizationKey },
          { text: ` §7(${snapshot.typeId}) §ex${amount}` },
        ],
      });
      return;
    } catch {
      // 兼容旧定义：快照反序列化失败时继续使用 typeId。
    }
  }

  const itemId = String(reward.params.item ?? "").trim();
  const template = new ItemStack(itemId, 1);
  addItemCopies(container, player, template, amount);
  player.sendMessage({
    rawtext: [
      { text: "§a获得任务奖励：§e" },
      { translate: template.localizationKey },
      { text: ` §7(${itemId}) §ex${amount}` },
    ],
  });
}

export function createRuntimeQuestRewardHandlers(): QuestRewardHandlerRegistry<Player> {
  const handlers = new QuestRewardHandlerRegistry<Player>();

  handlers.register({
    id: "minecraft.give_item",
    version: 1,
    action: "give_item",
    idempotency: "non_idempotent",
    validate: validateItemReward,
    grant: grantItemReward,
  });
  handlers.register({
    id: "creeper.economy.add_money",
    version: 1,
    action: "add_money",
    idempotency: "non_idempotent",
    validate: (reward) => {
      if (!economic.isEconomyEnabled()) return { ok: false, error: "经济系统已关闭，金币奖励保留待领取。" };
      return getPositiveInteger(reward.params.amount)
        ? { ok: true }
        : { ok: false, error: `金币奖励数量无效：${reward.id}` };
    },
    grant: (reward, player) => {
      const amount = getPositiveInteger(reward.params.amount)!;
      const added = economic.addGold(player.name, amount, "任务奖励", true);
      if (added !== amount) throw new Error(`金币奖励发放不完整：期望 ${amount}，实际 ${added}`);
      player.sendMessage(`§a获得任务奖励：§e${added} §a金币`);
    },
  });
  handlers.register({
    id: "minecraft.add_exp",
    version: 1,
    action: "add_exp",
    idempotency: "non_idempotent",
    validate: (reward) =>
      getPositiveInteger(reward.params.amount) ? { ok: true } : { ok: false, error: `经验奖励数量无效：${reward.id}` },
    grant: (reward, player) => {
      const amount = getPositiveInteger(reward.params.amount)!;
      player.runCommand(`xp ${amount} @s`);
      player.sendMessage(`§a获得任务奖励：§e${amount} §a经验`);
    },
  });
  handlers.register({
    id: "minecraft.send_message",
    version: 1,
    action: "send_message",
    idempotency: "non_idempotent",
    validate: () => ({ ok: true }),
    grant: (reward, player) => player.sendMessage(String(reward.params.message ?? "")),
  });
  handlers.register({
    id: "minecraft.run_command",
    version: 1,
    action: "run_command",
    idempotency: "non_idempotent",
    validate: (reward) =>
      String(reward.params.command ?? "").trim()
        ? { ok: true }
        : { ok: false, error: `命令奖励未配置命令：${reward.id}` },
    grant: (reward, player) => {
      player.runCommand(String(reward.params.command).replace(/\{player\}/g, player.name));
    },
  });

  return handlers;
}
