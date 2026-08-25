import type { Player } from "@minecraft/server";
import guildService from "../../guild/services/guild-service";
import landManager from "../../land/services/land-manager";
import identityService from "../../player/services/identity-service";
import wayPoint from "../../waypoint/services/waypoint";
import { createCreeperStateSnapshotSummary } from "../snapshots/snapshot-summary";

export const CREEPER_STATE_SNAPSHOT_PROVIDER_VERSION = 1;

function uniqueNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

/** Builds authoritative current-state evidence without exposing business databases to Quest. */
export function buildPlayerCreeperStateSummary(player: Player, now = Date.now()) {
  const profile = identityService.getProfileForPlayer(player);
  const knownNames = uniqueNames([player.name, profile.currentName, ...profile.knownNames]);
  const guildId = guildService.getPersistedGuildIdForIdentity(profile.id, knownNames);
  const hasPrivateWaypoint = wayPoint.hasPrivatePointForKnownNames(knownNames);
  const hasLand = landManager.hasLandForIdentity(profile.id, knownNames, guildId);

  return createCreeperStateSnapshotSummary(
    {
      playerCmid: profile.id,
      playerName: player.name,
      knownNames,
      guildId,
      hasPrivateWaypoint,
      hasLand,
      hasGuild: guildId !== undefined,
    },
    now,
    CREEPER_STATE_SNAPSHOT_PROVIDER_VERSION
  );
}
