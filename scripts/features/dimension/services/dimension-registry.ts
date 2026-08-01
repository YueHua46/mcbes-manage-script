import type { Player, Vector2, Vector3 } from "@minecraft/server";
import { world } from "@minecraft/server";

const REGISTRY_PROPERTY = "yuehua:registeredDimensions";
const ALIAS_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export interface DimensionSpawn {
  location: Vector3;
  rotation?: Vector2;
}

export interface RegisteredDimension {
  alias: string;
  dimensionId: string;
  displayName: string;
  /** 默认传送坐标。保持为顶层字段，便于 teleport(record.spawn) 直接使用。 */
  spawn?: Vector3;
  rotation?: Vector2;
  createdBy?: string;
  createdAt: number;
  updatedAt: number;
}

type RegistryData = Record<string, RegisteredDimension>;

function copyLocation(location: Vector3): Vector3 {
  return { x: location.x, y: location.y, z: location.z };
}

function copyRecord(record: RegisteredDimension): RegisteredDimension {
  return {
    ...record,
    spawn: record.spawn ? copyLocation(record.spawn) : undefined,
    rotation: record.rotation ? { x: record.rotation.x, y: record.rotation.y } : undefined,
  };
}

function isFiniteVector3(value: unknown): value is Vector3 {
  if (!value || typeof value !== "object") return false;
  const vector = value as Partial<Vector3>;
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}

function parseRecord(value: unknown): RegisteredDimension | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Partial<RegisteredDimension>;
  if (
    typeof item.alias !== "string" ||
    !ALIAS_PATTERN.test(item.alias) ||
    typeof item.dimensionId !== "string" ||
    item.dimensionId.trim().length === 0 ||
    typeof item.displayName !== "string" ||
    typeof item.createdAt !== "number" ||
    typeof item.updatedAt !== "number"
  )
    return undefined;

  const spawn = isFiniteVector3(item.spawn) ? copyLocation(item.spawn) : undefined;
  const rotation =
    item.rotation && Number.isFinite(item.rotation.x) && Number.isFinite(item.rotation.y)
      ? { x: item.rotation.x, y: item.rotation.y }
      : undefined;

  return {
    alias: item.alias,
    dimensionId: item.dimensionId.trim(),
    displayName: item.displayName.trim() || item.alias,
    spawn,
    rotation,
    createdBy: typeof item.createdBy === "string" ? item.createdBy : undefined,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function loadRegistry(): RegistryData {
  const raw = world.getDynamicProperty(REGISTRY_PROPERTY);
  if (typeof raw !== "string" || raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: RegistryData = {};
    for (const value of Object.values(parsed as Record<string, unknown>)) {
      const record = parseRecord(value);
      if (record) result[record.alias] = record;
    }
    return result;
  } catch (error) {
    console.warn(`[DimensionRegistry] 无法读取维度注册表：${String(error)}`);
    return {};
  }
}

function saveRegistry(registry: RegistryData): void {
  world.setDynamicProperty(REGISTRY_PROPERTY, JSON.stringify(registry));
}

export function normalizeDimensionAlias(alias: string): string {
  return alias.trim().toLowerCase();
}

export function validateDimensionAlias(alias: string): boolean {
  return ALIAS_PATTERN.test(normalizeDimensionAlias(alias));
}

function requireAlias(alias: string): string {
  const normalized = normalizeDimensionAlias(alias);
  if (!ALIAS_PATTERN.test(normalized)) {
    throw new Error("维度别名只能包含小写字母、数字、下划线或连字符，且须以字母或数字开头，最长 32 个字符");
  }
  return normalized;
}

export function listRegisteredDimensions(): RegisteredDimension[] {
  return Object.values(loadRegistry())
    .sort((a, b) => a.alias.localeCompare(b.alias))
    .map(copyRecord);
}

export function getRegisteredDimension(alias: string): RegisteredDimension | undefined {
  const record = loadRegistry()[normalizeDimensionAlias(alias)];
  return record ? copyRecord(record) : undefined;
}

/** 按固定别名、显示名称或真实维度 ID 查找，方便管理员直接使用菜单中看到的名称。 */
export function resolveRegisteredDimension(identifier: string): RegisteredDimension | undefined {
  const input = identifier.trim();
  if (!input) return undefined;
  const byAlias = getRegisteredDimension(input);
  if (byAlias) return byAlias;
  const exactMatches = listRegisteredDimensions().filter(
    (record) => record.displayName === input || record.dimensionId === input
  );
  if (exactMatches.length > 1) {
    throw new Error(`维度名称“${input}”对应多个登记，请改用固定别名`);
  }
  return exactMatches[0];
}

export function findRegisteredDimensionsById(dimensionId: string): RegisteredDimension[] {
  const id = dimensionId.trim();
  return listRegisteredDimensions().filter((record) => record.dimensionId === id);
}

export function addRegisteredDimension(
  alias: string,
  dimensionId: string,
  displayName?: string,
  actor?: string
): RegisteredDimension {
  const normalized = requireAlias(alias);
  const id = dimensionId.trim();
  if (!id) throw new Error("维度 ID 不能为空");
  const registry = loadRegistry();
  if (registry[normalized]) throw new Error(`维度别名 ${normalized} 已存在`);
  const now = Date.now();
  const record: RegisteredDimension = {
    alias: normalized,
    dimensionId: id,
    displayName: displayName?.trim() || normalized,
    createdBy: actor?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
  registry[normalized] = record;
  saveRegistry(registry);
  return copyRecord(record);
}

export function ensureRegisteredDimension(
  alias: string,
  dimensionId: string,
  displayName?: string,
  actor?: string
): RegisteredDimension {
  return getRegisteredDimension(alias) ?? addRegisteredDimension(alias, dimensionId, displayName, actor);
}

export function updateRegisteredDimensionDisplayName(alias: string, displayName: string): RegisteredDimension {
  const normalized = requireAlias(alias);
  const name = displayName.trim();
  if (!name) throw new Error("维度显示名称不能为空");
  if (name.length > 40) throw new Error("维度显示名称不能超过 40 个字符");
  const registry = loadRegistry();
  const record = registry[normalized];
  if (!record) throw new Error(`未找到维度别名 ${normalized}`);
  record.displayName = name;
  record.updatedAt = Date.now();
  saveRegistry(registry);
  return copyRecord(record);
}

export function resetRegisteredDimensionConfiguration(alias: string, defaultDisplayName?: string): RegisteredDimension {
  const normalized = requireAlias(alias);
  const registry = loadRegistry();
  const record = registry[normalized];
  if (!record) throw new Error(`未找到维度别名 ${normalized}`);
  record.displayName = defaultDisplayName?.trim() || normalized;
  record.spawn = undefined;
  record.rotation = undefined;
  record.updatedAt = Date.now();
  saveRegistry(registry);
  return copyRecord(record);
}

export function addRegisteredDimensionFromPlayer(
  alias: string,
  player: Player,
  displayName?: string,
  actor: string = player.name
): RegisteredDimension {
  const record = addRegisteredDimension(alias, player.dimension.id, displayName, actor);
  try {
    return setRegisteredDimensionSpawn(record.alias, player.location, player.getRotation());
  } catch (error) {
    removeRegisteredDimension(record.alias);
    throw error;
  }
}

export function removeRegisteredDimension(alias: string): boolean {
  const normalized = normalizeDimensionAlias(alias);
  const registry = loadRegistry();
  if (!registry[normalized]) return false;
  delete registry[normalized];
  saveRegistry(registry);
  return true;
}

export function setRegisteredDimensionSpawn(alias: string, location: Vector3, rotation?: Vector2): RegisteredDimension {
  if (!isFiniteVector3(location)) throw new Error("传送点坐标必须是有限数值");
  if (rotation && (!Number.isFinite(rotation.x) || !Number.isFinite(rotation.y))) {
    throw new Error("传送点朝向必须是有限数值");
  }
  const normalized = requireAlias(alias);
  const registry = loadRegistry();
  const record = registry[normalized];
  if (!record) throw new Error(`未找到维度别名 ${normalized}`);
  record.spawn = copyLocation(location);
  record.rotation = rotation ? { x: rotation.x, y: rotation.y } : undefined;
  record.updatedAt = Date.now();
  saveRegistry(registry);
  return copyRecord(record);
}

export function setRegisteredDimensionSpawnFromPlayer(alias: string, player: Player): RegisteredDimension {
  const record = getRegisteredDimension(alias);
  if (!record) throw new Error(`未找到维度别名 ${normalizeDimensionAlias(alias)}`);
  if (record.dimensionId !== player.dimension.id) {
    throw new Error(`玩家当前位于 ${player.dimension.id}，而 ${record.alias} 登记的是 ${record.dimensionId}`);
  }
  return setRegisteredDimensionSpawn(record.alias, player.location, player.getRotation());
}

export function getCurrentDimensionRegistration(player: Player): RegisteredDimension | undefined {
  return findRegisteredDimensionsById(player.dimension.id)[0];
}

const dimensionRegistry = {
  list: listRegisteredDimensions,
  get: getRegisteredDimension,
  resolve: resolveRegisteredDimension,
  add: addRegisteredDimension,
  ensure: ensureRegisteredDimension,
  addFromPlayer: addRegisteredDimensionFromPlayer,
  remove: removeRegisteredDimension,
  setSpawn: setRegisteredDimensionSpawn,
  setSpawnFromPlayer: setRegisteredDimensionSpawnFromPlayer,
  findByDimensionId: findRegisteredDimensionsById,
  current: getCurrentDimensionRegistration,
  updateDisplayName: updateRegisteredDimensionDisplayName,
  resetConfiguration: resetRegisteredDimensionConfiguration,
  normalizeAlias: normalizeDimensionAlias,
  validateAlias: validateDimensionAlias,
  listRegisteredDimensions,
  getRegisteredDimension,
  resolveRegisteredDimension,
  addRegisteredDimension,
  ensureRegisteredDimension,
  addRegisteredDimensionFromPlayer,
  removeRegisteredDimension,
  setRegisteredDimensionSpawn,
  setRegisteredDimensionSpawnFromPlayer,
  findRegisteredDimensionsById,
  getCurrentDimensionRegistration,
  updateRegisteredDimensionDisplayName,
  resetRegisteredDimensionConfiguration,
};

export default dimensionRegistry;
