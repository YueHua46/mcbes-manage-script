export type QuestCapabilityState = "available" | "experimental" | "unavailable";

export interface QuestCapabilityDefinition {
  id: string;
  version: number;
  state: QuestCapabilityState;
  source: string;
  verifiedAt?: number;
}

export class QuestCapabilityRegistry {
  private readonly capabilities = new Map<string, QuestCapabilityDefinition>();

  register(definition: QuestCapabilityDefinition): void {
    if (this.capabilities.has(definition.id)) {
      throw new Error(`Duplicate quest capability: ${definition.id}`);
    }
    this.capabilities.set(definition.id, { ...definition });
  }

  get(id: string): QuestCapabilityDefinition | undefined {
    const definition = this.capabilities.get(id);
    return definition ? { ...definition } : undefined;
  }

  has(id: string): boolean {
    return this.capabilities.has(id);
  }

  isAvailable(id: string): boolean {
    const state = this.capabilities.get(id)?.state;
    return state === "available" || state === "experimental";
  }

  getAll(): QuestCapabilityDefinition[] {
    return Array.from(this.capabilities.values(), (definition) => ({ ...definition }));
  }
}

export const AVAILABLE_QUEST_CAPABILITY_DEFINITIONS = [
  { id: "cap.event.item.obtain.v1", source: "playerInventoryItemChange" },
  { id: "cap.event.entity.kill.v1", source: "entityDie" },
  { id: "cap.event.block.break.v1", source: "playerBreakBlock" },
  { id: "cap.event.player.online_time.v1", source: "taskScheduler" },
  { id: "cap.event.player.dimension_enter.v1", source: "world.afterEvents.playerDimensionChange" },
  { id: "cap.event.block.place.v1", source: "world.afterEvents.playerPlaceBlock" },
  { id: "cap.event.item.use.v1", source: "world.afterEvents.itemUse" },
  { id: "cap.event.player.interact_block.v1", source: "world.afterEvents.playerInteractWithBlock" },
  { id: "cap.event.player.interact_entity.v1", source: "world.afterEvents.playerInteractWithEntity" },
  { id: "cap.event.effect.gain.v1", source: "world.afterEvents.effectAdd" },
  { id: "cap.event.crop.plant.v1", source: "world.afterEvents.playerPlaceBlock" },
  { id: "cap.event.creeper.menu.open.v1", source: "creeperQuestEvents.afterMenuResponse" },
  { id: "cap.event.creeper.waypoint.create.v1", source: "creeperQuestEvents.afterWaypointCommit" },
  { id: "cap.event.creeper.tpa.complete.v1", source: "creeperQuestEvents.afterTeleport" },
  { id: "cap.event.creeper.random_tp.complete.v1", source: "creeperQuestEvents.afterRandomTeleport" },
  { id: "cap.event.creeper.land.create.v1", source: "creeperQuestEvents.afterLandCommit" },
  { id: "cap.event.creeper.public_waypoint.use.v1", source: "creeperQuestEvents.afterPublicTeleport" },
  { id: "cap.event.creeper.market.trade.v1", source: "creeperQuestEvents.afterMarketCommit" },
  { id: "cap.event.creeper.red_packet.v1", source: "creeperQuestEvents.afterRedPacketCommit" },
  { id: "cap.event.creeper.guild.join_or_create.v1", source: "creeperQuestEvents.afterGuildCommit" },
  { id: "cap.snapshot.inventory.v1", source: "InventorySnapshotProvider.v2" },
  { id: "cap.snapshot.equipment.v1", source: "EquipmentSnapshotProvider.v2" },
  { id: "cap.snapshot.effects.v1", source: "EffectsSnapshotProvider.v1" },
  { id: "cap.snapshot.item_enchantment.v1", source: "InventorySnapshotProvider.v2" },
  { id: "cap.snapshot.equipment_enchantment.v1", source: "EquipmentSnapshotProvider.v2" },
  { id: "cap.snapshot.creeper_state.v1", source: "CreeperStateSnapshotProvider.v1" },
  { id: "cap.aggregate.boss_kill_count.v1", source: "QuestHistoricalCounterProgress.v1" },
] as const;

export const EXPERIMENTAL_QUEST_CAPABILITY_DEFINITIONS = [
  { id: "cap.event.archaeology.brush_success.v1", source: "playerInteractWithBlock.suspiciousTransition" },
  { id: "cap.event.crop.harvest.v1", source: "world.afterEvents.playerBreakBlock" },
  { id: "cap.event.entity.tame.v1", source: "playerInteractWithEntity.ownershipTransition" },
  { id: "cap.event.elytra.distance.v1", source: "taskScheduler.quest.glideDistance" },
  { id: "cap.event.player.biome_enter.v1", source: "taskScheduler.quest.biomeTransitions" },
  { id: "cap.event.player.glide.v1", source: "taskScheduler.quest.movementTransitions" },
  { id: "cap.event.player.ride.v1", source: "taskScheduler.quest.movementTransitions" },
  { id: "cap.event.vault.unlock.v1", source: "playerInteractWithBlock.vaultKeyConsumption" },
] as const;

/**
 * Known catalog capabilities whose adapters/providers are not wired and verified yet.
 * Registration prevents metadata typos; `unavailable` prevents definitions from leaking
 * into the effective catalog before their runtime evidence is trustworthy.
 */
export const UNAVAILABLE_QUEST_CAPABILITY_IDS = [
  "cap.challenge.geyser.launch_player.v1",
  "cap.challenge.happy_ghast.passenger_count.v1",
  "cap.challenge.mace.high_fall_hit.v1",
  "cap.challenge.spear.charge_hit.v1",
  "cap.challenge.sulfur_cube.feed_tnt.v1",
  "cap.content.minecraft.chaos_cubed.v1",
  "cap.content.minecraft.chase_the_skies.v1",
  "cap.content.minecraft.copper_age.v1",
  "cap.content.minecraft.drop3_experiment.v1",
  "cap.content.minecraft.mounts_of_mayhem.v1",
  "cap.content.minecraft.tiny_takeover.v1",
  "cap.event.baby_mob.encounter.v1",
  "cap.event.baby_mob.name_tagged.v1",
  "cap.event.camel_husk.claim.v1",
  "cap.event.copper_golem.create.v1",
  "cap.event.copper_golem.sort_success.v1",
  "cap.event.crafter.output.v1",
  "cap.event.creaking.encounter.v1",
  "cap.event.cushion.ride_successfully.v1",
  "cap.event.dried_ghast.hydration_started.v1",
  "cap.event.enchant.apply.v1",
  "cap.event.entity.breed.v1",
  "cap.event.ghastling.spawn_from_dried_ghast.v1",
  "cap.event.golden_dandelion.used_on_baby.v1",
  "cap.event.happy_ghast.grow.v1",
  "cap.event.note_block.trumpet_played.v1",
  "cap.event.piglin.barter.v1",
  "cap.event.player.end_gateway_travel.v1",
  "cap.event.raid.win.v1",
  "cap.event.shelf.interact_success.v1",
  "cap.event.straw_bed.used_successfully.v1",
  "cap.event.structure.enter.v1",
  "cap.event.sulfur_cube.encounter.v1",
  "cap.event.sulfur_cube.feed_success.v1",
  "cap.event.villager.trade.v1",
  "cap.event.zombie_villager.cure.v1",
  "cap.snapshot.inventory.treasure_map.v1",
  "cap.snapshot.nearby_world.active_conduit.v1",
  "cap.snapshot.nearby_world.full_beacon.v1",
] as const;

export function createDefaultQuestCapabilityRegistry(): QuestCapabilityRegistry {
  const registry = new QuestCapabilityRegistry();
  for (const definition of AVAILABLE_QUEST_CAPABILITY_DEFINITIONS) {
    registry.register({ ...definition, version: 1, state: "available" });
  }
  for (const definition of EXPERIMENTAL_QUEST_CAPABILITY_DEFINITIONS) {
    registry.register({ ...definition, version: 1, state: "experimental" });
  }
  for (const id of UNAVAILABLE_QUEST_CAPABILITY_IDS) {
    registry.register({ id, version: 1, state: "unavailable", source: "catalog_not_wired" });
  }
  return registry;
}
