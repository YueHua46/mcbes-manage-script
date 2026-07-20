import { Player, system } from "@minecraft/server";
import { Database } from "../../../shared/database/database";
import { generateId, SystemLog } from "../../../shared/utils/common";

const DB_IDENTITIES = "player_identities";
const DB_NAME_INDEX = "player_identity_name_index";
const IDENTITY_PROPERTY = "creeperMenuIdentityId";

export interface PlayerIdentityProfile {
  id: string;
  currentName: string;
  knownNames: string[];
  createdAt: number;
  lastSeenAt: number;
  lastRuntimeId?: string;
  persistentIds?: string[];
  xuids?: string[];
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function uniquePush(list: string[] | undefined, value: string | undefined): string[] {
  const next = Array.isArray(list) ? [...list] : [];
  const normalized = value?.trim();
  if (!normalized) return next;
  if (!next.some((item) => item.toLowerCase() === normalized.toLowerCase())) {
    next.push(normalized);
  }
  return next;
}

class IdentityService {
  private profilesDb?: Database<PlayerIdentityProfile>;
  private nameIndexDb?: Database<string>;

  constructor() {
    system.run(() => {
      this.ensureDbs();
    });
  }

  private ensureDbs(): boolean {
    if (!this.profilesDb) {
      this.profilesDb = new Database<PlayerIdentityProfile>(DB_IDENTITIES);
    }
    if (!this.nameIndexDb) {
      this.nameIndexDb = new Database<string>(DB_NAME_INDEX);
    }
    return true;
  }

  private createProfile(playerName: string): PlayerIdentityProfile {
    const now = Date.now();
    return {
      id: `cmid_${generateId()}`,
      currentName: playerName,
      knownNames: [playerName],
      createdAt: now,
      lastSeenAt: now,
    };
  }

  private getIdentityProperty(player: Player): string | undefined {
    try {
      const value = player.getDynamicProperty(IDENTITY_PROPERTY);
      return typeof value === "string" && value.length > 0 ? value : undefined;
    } catch {
      return undefined;
    }
  }

  private setIdentityProperty(player: Player, id: string): void {
    try {
      player.setDynamicProperty(IDENTITY_PROPERTY, id);
    } catch (error) {
      SystemLog.warn(`[Identity] 写入玩家身份属性失败：${player.name} ${String(error)}`);
    }
  }

  private saveProfile(profile: PlayerIdentityProfile): void {
    if (!this.ensureDbs() || !this.profilesDb || !this.nameIndexDb) return;
    this.profilesDb.set(profile.id, profile);
    for (const name of profile.knownNames) {
      this.nameIndexDb.set(normalizeName(name), profile.id);
    }
    this.nameIndexDb.set(normalizeName(profile.currentName), profile.id);
    this.profilesDb.save();
    this.nameIndexDb.save();
  }

  bindPlayer(player: Player, extra?: { persistentId?: string | null; xuid?: string | null }): PlayerIdentityProfile {
    this.ensureDbs();
    const name = player.name;
    const now = Date.now();
    const storedId = this.getIdentityProperty(player);
    const indexedId = this.nameIndexDb?.get(normalizeName(name));
    const id = storedId || indexedId;
    let profile = id ? this.profilesDb?.get(id) : undefined;

    if (!profile) {
      profile = this.createProfile(name);
    }

    profile.currentName = name;
    profile.knownNames = uniquePush(profile.knownNames, name);
    profile.lastSeenAt = now;
    profile.lastRuntimeId = player.id;
    profile.persistentIds = uniquePush(profile.persistentIds, extra?.persistentId ?? undefined);
    profile.xuids = uniquePush(profile.xuids, extra?.xuid ?? undefined);

    this.setIdentityProperty(player, profile.id);
    this.saveProfile(profile);
    return profile;
  }

  rememberPreJoinIdentity(name: string, extra: { persistentId?: string | null; xuid?: string | null }): void {
    this.ensureDbs();
    const normalizedName = normalizeName(name);
    const indexedId = this.nameIndexDb?.get(normalizedName);
    const now = Date.now();
    let profile = indexedId ? this.profilesDb?.get(indexedId) : undefined;
    if (!profile) {
      profile = this.createProfile(name);
    }
    profile.currentName = name;
    profile.knownNames = uniquePush(profile.knownNames, name);
    profile.lastSeenAt = now;
    profile.persistentIds = uniquePush(profile.persistentIds, extra.persistentId ?? undefined);
    profile.xuids = uniquePush(profile.xuids, extra.xuid ?? undefined);
    this.saveProfile(profile);
  }

  getProfileById(id: string | undefined): PlayerIdentityProfile | undefined {
    if (!id || !this.ensureDbs()) return undefined;
    return this.profilesDb?.get(id);
  }

  getProfileByName(name: string | undefined): PlayerIdentityProfile | undefined {
    if (!name || !this.ensureDbs()) return undefined;
    const id = this.nameIndexDb?.get(normalizeName(name));
    return id ? this.profilesDb?.get(id) : undefined;
  }

  getProfileForPlayer(player: Player): PlayerIdentityProfile {
    const id = this.getIdentityProperty(player);
    const profile = this.getProfileById(id);
    return profile ?? this.bindPlayer(player);
  }

  resolvePlayerKey(name: string): string {
    return this.getProfileByName(name)?.id ?? name;
  }

  resolvePlayerKeyForPlayer(player: Player): string {
    return this.getProfileForPlayer(player).id;
  }

  getKnownNames(nameOrId: string): string[] {
    const profile = nameOrId.startsWith("cmid_") ? this.getProfileById(nameOrId) : this.getProfileByName(nameOrId);
    return profile?.knownNames?.length ? [...profile.knownNames] : [nameOrId];
  }

  getDisplayName(nameOrId: string): string {
    if (!nameOrId.startsWith("cmid_")) return nameOrId;
    return this.getProfileById(nameOrId)?.currentName ?? nameOrId;
  }
}

const identityService = new IdentityService();
export default identityService;
