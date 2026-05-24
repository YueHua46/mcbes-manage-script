import { ItemTypes } from "@minecraft/server";
import setting from "./setting";
import { runtimeIdMap } from "../../../assets/runtime-id-map.js";
import { SystemLog } from "../../../shared/utils/common";

const OWN_NAMESPACES = new Set(["yuehua"]);
const FALLBACK_OFFSET_START_ID = 257;
const DIAGNOSTIC_CACHE_TTL_MS = 30000;
const BUILTIN_CUSTOM_ICON_MAP: Record<string, string> = {
  "yuehua:sm": "textures/items/sm",
};

let cachedOffsetStartId: number | undefined;
let cachedRegistrySnapshot: ChestUiIconRegistrySnapshot | undefined;

function normalizeOffset(value: unknown): number {
  const num = Math.floor(Number(value));
  if (!Number.isFinite(num)) return 0;
  return Math.max(-10000, Math.min(10000, num));
}

function getNamespace(typeId: string): string {
  return typeId.split(":", 1)[0] || "minecraft";
}

export function getChestUiIconOffset(): number {
  return normalizeOffset(setting.getState("chestUiIconOffset"));
}

export function setChestUiIconOffset(offset: number): number {
  const normalized = normalizeOffset(offset);
  setting.setState("chestUiIconOffset", String(normalized));
  return normalized;
}

function normalizeTexturePath(path: string): string {
  const trimmed = path.trim().replace(/\\/g, "/").replace(/\.png$/i, "");
  if (!trimmed) return "";
  if (trimmed.startsWith("textures/")) return trimmed;
  return `textures/items/${trimmed.replace(/^items\//, "")}`;
}

export function getChestUiCustomIconMap(): Record<string, string> {
  const raw = setting.getState("chestUiCustomIconMap");
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([typeId, texture]) => typeId.includes(":") && typeof texture === "string")
        .map(([typeId, texture]) => [typeId, normalizeTexturePath(texture as string)])
        .filter(([, texture]) => texture.length > 0)
    );
  } catch {
    return {};
  }
}

export function setChestUiCustomIcon(typeId: string, texturePath: string): void {
  const normalizedTypeId = typeId.trim();
  const normalizedTexturePath = normalizeTexturePath(texturePath);
  if (!normalizedTypeId.includes(":") || !normalizedTexturePath) return;
  const map = getChestUiCustomIconMap();
  map[normalizedTypeId] = normalizedTexturePath;
  setting.setState("chestUiCustomIconMap", JSON.stringify(map));
}

export function removeChestUiCustomIcon(typeId: string): void {
  const map = getChestUiCustomIconMap();
  delete map[typeId];
  setting.setState("chestUiCustomIconMap", JSON.stringify(map));
}

export function resolveChestUiCustomIconTexture(typeId: string): string | undefined {
  return BUILTIN_CUSTOM_ICON_MAP[typeId] ?? getChestUiCustomIconMap()[typeId];
}

export function guessChestUiCustomIconTexture(typeId: string): string {
  const [, name = typeId] = typeId.split(":");
  return `textures/items/${name}`;
}

export function shouldApplyChestUiIconOffset(typeId: string): boolean {
  const id = runtimeIdMap.get(typeId);
  if (id === undefined) return typeId.includes(":") && !typeId.startsWith("minecraft:");
  return shouldApplyChestUiIconOffsetById(id);
}

export function shouldApplyChestUiIconOffsetById(id: number): boolean {
  return id > 0 && id >= getChestUiIconOffsetStartId();
}

export function applyChestUiIconOffset(typeId: string, id: number): number {
  if (!shouldApplyChestUiIconOffsetById(id)) return id;
  return id + getChestUiIconOffset();
}

export function getChestUiIconOffsetStartId(): number {
  if (cachedOffsetStartId !== undefined) return cachedOffsetStartId;
  const ownIds = Array.from(runtimeIdMap.entries())
    .filter(([typeId]) => OWN_NAMESPACES.has(getNamespace(typeId)))
    .map(([, id]) => id)
    .filter((id) => Number.isFinite(id) && id > 0);
  cachedOffsetStartId = ownIds.length === 0 ? FALLBACK_OFFSET_START_ID : Math.min(...ownIds);
  return cachedOffsetStartId;
}

interface ChestUiIconRegistrySnapshot {
  createdAtMs: number;
  scanMs: number;
  totalItemTypes: number;
  minecraftItemCount: number;
  customItemCount: number;
  ownCustomItemIds: string[];
  externalCustomItemIds: string[];
  mappedOwnCustomItemIds: string[];
  offsetStartId: number;
  affectedMappedItemCount: number;
}

export interface ChestUiIconDiagnosticResult {
  totalItemTypes: number;
  minecraftItemCount: number;
  customItemCount: number;
  ownCustomItemIds: string[];
  externalCustomItemIds: string[];
  mappedOwnCustomItemIds: string[];
  customIconMappedItemIds: string[];
  currentOffset: number;
  recommendedOffset: number;
  offsetStartId: number;
  affectedMappedItemCount: number;
  scanMs: number;
  cacheAgeMs: number;
  needsAttention: boolean;
}

function scanChestUiIconRegistry(force: boolean = false): ChestUiIconRegistrySnapshot {
  const now = Date.now();
  if (!force && cachedRegistrySnapshot && now - cachedRegistrySnapshot.createdAtMs < DIAGNOSTIC_CACHE_TTL_MS) {
    return cachedRegistrySnapshot;
  }

  const startedAt = Date.now();
  const itemIds = ItemTypes.getAll()
    .map((itemType) => itemType.id)
    .sort();

  const customItemIds = itemIds.filter((id) => !id.startsWith("minecraft:"));
  const ownCustomItemIds = customItemIds.filter((id) => OWN_NAMESPACES.has(getNamespace(id)));
  const externalCustomItemIds = customItemIds.filter((id) => !OWN_NAMESPACES.has(getNamespace(id)));
  const mappedOwnCustomItemIds = ownCustomItemIds.filter((id) => runtimeIdMap.has(id));
  const offsetStartId = getChestUiIconOffsetStartId();
  const affectedMappedItemCount = Array.from(runtimeIdMap.values()).filter(
    (id) => Number.isFinite(id) && id > 0 && id >= offsetStartId
  ).length;

  cachedRegistrySnapshot = {
    createdAtMs: now,
    scanMs: Date.now() - startedAt,
    totalItemTypes: itemIds.length,
    minecraftItemCount: itemIds.length - customItemIds.length,
    customItemCount: customItemIds.length,
    ownCustomItemIds,
    externalCustomItemIds,
    mappedOwnCustomItemIds,
    offsetStartId,
    affectedMappedItemCount,
  };
  return cachedRegistrySnapshot;
}

export function diagnoseChestUiIconOffset(force: boolean = false): ChestUiIconDiagnosticResult {
  const snapshot = scanChestUiIconRegistry(force);
  const customIconMap = getChestUiCustomIconMap();
  const customItemIds = [...snapshot.ownCustomItemIds, ...snapshot.externalCustomItemIds];
  const customIconMappedItemIds = customItemIds.filter((id) => Boolean(BUILTIN_CUSTOM_ICON_MAP[id] ?? customIconMap[id]));
  const currentOffset = getChestUiIconOffset();
  const recommendedOffset = snapshot.externalCustomItemIds.length;

  return {
    totalItemTypes: snapshot.totalItemTypes,
    minecraftItemCount: snapshot.minecraftItemCount,
    customItemCount: snapshot.customItemCount,
    ownCustomItemIds: snapshot.ownCustomItemIds,
    externalCustomItemIds: snapshot.externalCustomItemIds,
    mappedOwnCustomItemIds: snapshot.mappedOwnCustomItemIds,
    customIconMappedItemIds,
    currentOffset,
    recommendedOffset,
    offsetStartId: snapshot.offsetStartId,
    affectedMappedItemCount: snapshot.affectedMappedItemCount,
    scanMs: snapshot.scanMs,
    cacheAgeMs: Date.now() - snapshot.createdAtMs,
    needsAttention: snapshot.externalCustomItemIds.length > 0 && currentOffset !== recommendedOffset,
  };
}

export function autoApplyChestUiIconFixOnStartup(): void {
  const result = diagnoseChestUiIconOffset(true);
  const saved = setChestUiIconOffset(result.recommendedOffset);
  SystemLog.info(
    `[物品图标修复] 已在本次启动自动应用修复值 ${saved}（检测到其他附加包自定义物品 ${result.externalCustomItemIds.length} 个）`
  );
}

export function formatChestUiIconDiagnostic(result: ChestUiIconDiagnosticResult): string {
  const externalPreview =
    result.externalCustomItemIds.length > 0
      ? result.externalCustomItemIds.slice(0, 12).join("\n")
      : "无";
  const hiddenCount = Math.max(0, result.externalCustomItemIds.length - 12);
  const hiddenLine = hiddenCount > 0 ? `\n...另有 ${hiddenCount} 个` : "";

  return [
    "§b这个工具用于修复商店、拍卖行、背包查看等界面里的物品图标显示错误。",
    "§7如果服务器还安装了其他附加包，里面的自定义物品可能会让部分图标串位，例如某个物品显示成另一个物品的图标。",
    "§7服务器每次启动时都会自动检测并应用一次修复；如果仍有个别自定义物品显示为占位图，请为它单独指定贴图。",
    "",
    `§f已检测到的物品总数: §e${result.totalItemTypes}`,
    `§f其他附加包的自定义物品: §e${result.externalCustomItemIds.length}`,
    `§f已单独指定贴图的自定义物品: §e${result.customIconMappedItemIds.length}`,
    "",
    `§f本次启动已应用的修复值: §e${result.currentOffset}`,
    `§f当前检测建议值: §e${result.recommendedOffset}`,
    "",
    result.needsAttention
      ? "§e当前检测结果与已应用值不同。重启服务器后会自动应用新的检测结果。"
      : "§a当前自动修复值看起来已经匹配。如果仍有个别自定义物品显示不对，请单独指定它的贴图。",
    "",
    "§8高级信息:",
    `§8影响范围: 数字 ID >= ${result.offsetStartId}，约 ${result.affectedMappedItemCount} 条映射`,
    `§8扫描耗时: ${result.scanMs}ms，缓存 ${Math.floor(result.cacheAgeMs / 1000)} 秒`,
    "",
    "§7检测到的其他附加包物品:",
    `§8${externalPreview}${hiddenLine}`,
  ].join("\n");
}
