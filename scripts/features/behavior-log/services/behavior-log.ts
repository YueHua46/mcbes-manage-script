import { Entity, Player, Vector3, system, world } from "@minecraft/server";
import { Database } from "../../../shared/database/database";
import { color } from "../../../shared/utils/color";
import setting from "../../system/services/setting";

const DATABASE_NAME = "behaviorLog";
const STORE_KEY = "state";
const DEFAULT_MAX_ENTRIES = 20000;
const DEFAULT_LOCATION_INTERVAL_SECONDS = 60;
const FLUSH_INTERVAL_TICKS = 100;
const MAX_CHAT_LENGTH = 96;
const MAX_META_LENGTH = 80;
const MAX_PLAYER_NAME_LENGTH = 32;

export type BehaviorEventType =
  | "playerJoin"
  | "playerLeave"
  | "playerChat"
  | "playerDeath"
  | "pvpHit"
  | "placeWater"
  | "placeLava"
  | "igniteFire"
  | "placeTnt"
  | "summonWither"
  | "enterLand"
  | "leaveLand"
  | "attackMobInLand"
  | "openChest"
  | "openBarrel"
  | "openShulker"
  | "openOtherContainer"
  | "locationSnapshot";

export interface BehaviorLogEntry {
  t: number;
  p: string;
  e: BehaviorEventType;
  d?: number;
  x?: number;
  y?: number;
  z?: number;
  m?: string;
  l?: string;
  v?: string;
}

export interface BehaviorLogState {
  v: 2;
  ps: string[];
  es: BehaviorLogEntry[];
  ls: BehaviorLogEntry[];
}

export interface BehaviorLogQuery {
  playerName?: string;
  eventTypes?: BehaviorEventType[];
  startTime?: number;
  endTime?: number;
  keyword?: string;
  landOnly?: boolean;
  dangerousOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface BehaviorLogQueryResult {
  total: number;
  items: BehaviorLogEntry[];
}

export interface LandLogInfo {
  name: string;
  owner?: string;
}

export interface BehaviorLogStats {
  playerCount: number;
  entryCount: number;
  locationCount: number;
  totalCount: number;
  maxEntries: number;
}

export const behaviorEventDefinitions: Array<{
  type: BehaviorEventType;
  label: string;
  settingKey: string;
  group: "basic" | "dangerous" | "land" | "container" | "location" | "combat";
  isDangerous?: boolean;
}> = [
  { type: "playerJoin", label: "玩家登录", settingKey: "logPlayerJoin", group: "basic" },
  { type: "playerLeave", label: "玩家离线", settingKey: "logPlayerLeave", group: "basic" },
  { type: "playerChat", label: "玩家聊天", settingKey: "logPlayerChat", group: "basic" },
  { type: "playerDeath", label: "玩家死亡", settingKey: "logPlayerDeath", group: "combat" },
  { type: "pvpHit", label: "PVP 攻击", settingKey: "logPvpHit", group: "combat" },
  { type: "placeWater", label: "放水", settingKey: "logPlaceWater", group: "dangerous", isDangerous: true },
  { type: "placeLava", label: "放岩浆", settingKey: "logPlaceLava", group: "dangerous", isDangerous: true },
  { type: "igniteFire", label: "点火/打火石", settingKey: "logIgniteFire", group: "dangerous", isDangerous: true },
  { type: "placeTnt", label: "放置 TNT", settingKey: "logPlaceTnt", group: "dangerous", isDangerous: true },
  { type: "summonWither", label: "召唤凋零", settingKey: "logSummonWither", group: "dangerous", isDangerous: true },
  { type: "enterLand", label: "进入领地", settingKey: "logEnterLand", group: "land" },
  { type: "leaveLand", label: "离开领地", settingKey: "logLeaveLand", group: "land" },
  { type: "attackMobInLand", label: "领地内攻击生物", settingKey: "logAttackMobInLand", group: "land" },
  { type: "openChest", label: "打开箱子", settingKey: "logOpenChest", group: "container" },
  { type: "openBarrel", label: "打开木桶", settingKey: "logOpenBarrel", group: "container" },
  { type: "openShulker", label: "打开潜影盒", settingKey: "logOpenShulker", group: "container" },
  {
    type: "openOtherContainer",
    label: "打开其他容器",
    settingKey: "logOpenOtherContainers",
    group: "container",
  },
  {
    type: "locationSnapshot",
    label: "定时坐标记录",
    settingKey: "logLocationSnapshot",
    group: "location",
  },
];

const behaviorEventSettingMap = Object.fromEntries(
  behaviorEventDefinitions.map((definition) => [definition.type, definition.settingKey])
) as Record<BehaviorEventType, string>;

const dangerousEventTypeSet = new Set<BehaviorEventType>(
  behaviorEventDefinitions.filter((definition) => definition.isDangerous).map((definition) => definition.type)
);

const DEFAULT_STATE: BehaviorLogState = {
  v: 2,
  ps: [],
  es: [],
  ls: [],
};

const dimensionCodeMap: Record<string, number> = {
  "minecraft:overworld": 0,
  "minecraft:nether": 1,
  "minecraft:the_end": 2,
  overworld: 0,
  nether: 1,
  the_end: 2,
};

const dimensionLabelMap: Record<number, string> = {
  0: "主世界",
  1: "下界",
  2: "末地",
};

const eventLabelMap = Object.fromEntries(
  behaviorEventDefinitions.map((definition) => [definition.type, definition.label])
) as Record<BehaviorEventType, string>;

function cloneState(state: BehaviorLogState): BehaviorLogState {
  return {
    v: 2,
    ps: [...state.ps],
    es: [...state.es],
    ls: [...state.ls],
  };
}

function normalizeText(text: string, maxLength: number = MAX_META_LENGTH): string {
  return text.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function shortTypeId(typeId: string | undefined): string {
  if (!typeId) return "unknown";
  return typeId.replace("minecraft:", "");
}

function toDimensionCode(dimensionId: string | undefined): number | undefined {
  if (!dimensionId) return undefined;
  return dimensionCodeMap[dimensionId];
}

function toLocation(location: Vector3 | undefined) {
  if (!location) return {};
  return {
    x: Math.floor(location.x),
    y: Math.floor(location.y),
    z: Math.floor(location.z),
  };
}

function formatLandLabel(land: LandLogInfo | undefined): string | undefined {
  if (!land?.name) return undefined;
  return land.owner ? `${land.name} (${land.owner})` : land.name;
}

export function getBehaviorEventLabel(type: BehaviorEventType): string {
  return eventLabelMap[type] ?? type;
}

export function getBehaviorDimensionLabel(code: number | undefined): string {
  if (typeof code !== "number") return "未知维度";
  return dimensionLabelMap[code] ?? "未知维度";
}

export function formatBehaviorTimestamp(timestamp: number): string {
  // Minecraft Script 运行环境里时间经常按 UTC 处理，这里固定转成 UTC+8（北京时间）
  const utc8Date = new Date(timestamp + 8 * 60 * 60 * 1000);
  const yyyy = utc8Date.getUTCFullYear();
  const mm = `${utc8Date.getUTCMonth() + 1}`.padStart(2, "0");
  const dd = `${utc8Date.getUTCDate()}`.padStart(2, "0");
  const hh = `${utc8Date.getUTCHours()}`.padStart(2, "0");
  const mi = `${utc8Date.getUTCMinutes()}`.padStart(2, "0");
  const ss = `${utc8Date.getUTCSeconds()}`.padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

export function summarizeBehaviorEntry(entry: BehaviorLogEntry): string {
  const eventLabel = getBehaviorEventLabel(entry.e);
  const coord =
    typeof entry.x === "number" && typeof entry.y === "number" && typeof entry.z === "number"
      ? ` @ ${entry.x}, ${entry.y}, ${entry.z}`
      : "";
  const land = entry.l ? ` | 领地:${entry.l}` : "";
  const target = entry.v ? ` | 对象:${entry.v}` : "";
  const meta = entry.m ? ` | ${entry.m}` : "";
  return `[${formatBehaviorTimestamp(entry.t)}] ${eventLabel}${coord}${land}${target}${meta}`;
}

function formatBehaviorShortTimestamp(timestamp: number): string {
  const full = formatBehaviorTimestamp(timestamp);
  return full.slice(5);
}

function buildBehaviorExtraParts(entry: BehaviorLogEntry): string[] {
  const parts: string[] = [];

  if (typeof entry.x === "number" && typeof entry.y === "number" && typeof entry.z === "number") {
    parts.push(`坐标 ${entry.x}, ${entry.y}, ${entry.z}`);
  }
  if (entry.l) {
    parts.push(`领地 ${entry.l}`);
  }
  if (entry.v) {
    parts.push(`对象 ${entry.v}`);
  }
  if (entry.m) {
    parts.push(entry.m);
  }

  return parts;
}

function buildBehaviorSearchText(entry: BehaviorLogEntry): string {
  const parts = [
    entry.p,
    getBehaviorEventLabel(entry.e),
    entry.m ?? "",
    entry.l ?? "",
    entry.v ?? "",
  ];

  if (typeof entry.d === "number") {
    parts.push(getBehaviorDimensionLabel(entry.d));
  }

  if (entry.l) {
    parts.push("领地");
  }

  if (typeof entry.x === "number" && typeof entry.y === "number" && typeof entry.z === "number") {
    parts.push(`${entry.x} ${entry.y} ${entry.z}`);
    parts.push("坐标");
  }

  return parts.join(" ").toLowerCase();
}

export function formatBehaviorListEntry(entry: BehaviorLogEntry, index?: number): string {
  const numberPrefix =
    typeof index === "number" ? `${color.darkGray(`${index + 1}.`.padStart(2, " "))} ` : "";
  const line1 =
    `${numberPrefix}${color.gray(formatBehaviorShortTimestamp(entry.t))} ` +
    `${color.aqua(getBehaviorEventLabel(entry.e))} ${color.darkGray("·")} ${color.yellow(entry.p)}`;

  const extraParts = buildBehaviorExtraParts(entry);
  if (extraParts.length === 0) {
    return line1;
  }

  return `${line1}\n${color.darkGray("   ")}${color.gray(extraParts.join(` ${color.darkGray("·")} `))}`;
}

function formatBehaviorMessageBoxEntry(entry: BehaviorLogEntry, index: number): string {
  const dimensionText = typeof entry.d === "number" ? getBehaviorDimensionLabel(entry.d) : "未知维度";
  const playerLabel = entry.e === "summonWither" ? "召唤人" : "玩家";
  const lines = [
    `${color.darkGray(`#${index + 1}`)} ${color.gray(`[${formatBehaviorShortTimestamp(entry.t)}]`)} ${color.yellow(`[${entry.p}]`)} ${color.darkGray(`(${playerLabel})`)} ${color.lightPurple(`[${dimensionText}]`)} ${color.aqua(getBehaviorEventLabel(entry.e))}`,
  ];

  const detailParts: string[] = [];

  if (entry.e === "summonWither") {
    detailParts.push(`${color.gray("召唤人")} ${color.yellow(entry.p)}`);
  }
  if (typeof entry.x === "number" && typeof entry.y === "number" && typeof entry.z === "number") {
    detailParts.push(`${color.gray("坐标")} ${color.white(`${entry.x}, ${entry.y}, ${entry.z}`)}`);
  }
  if (entry.l) {
    detailParts.push(`${color.gray("领地")} ${color.lightPurple(entry.l)}`);
  }
  if (entry.v) {
    detailParts.push(`${color.gray("对象")} ${color.green(entry.v)}`);
  }
  if (entry.m) {
    detailParts.push(`${color.gray("备注")} ${color.white(entry.m)}`);
  }

  if (detailParts.length > 0) {
    lines.push(detailParts.join(` ${color.darkGray("·")} `));
  }

  lines.push(color.darkGray("--------------------------------"));

  return lines.join("\n");
}

export function formatBehaviorMessageBoxPage(
  summary: string,
  entries: BehaviorLogEntry[],
  page: number,
  totalPages: number,
  total: number
): string {
  const summaryContent = summary.replace(/^筛选条件：/, "");
  const summaryParts = summaryContent.split(" / ");
  const playerPart = summaryParts[0] ?? "全部玩家";
  const timePart = summaryParts[1] ?? "全部时间";
  const eventPart = summaryParts.slice(2).join(" / ") || "全部事件";

  const lines = [
    `${color.yellow(playerPart)} ${color.darkGray("·")} ${color.white(timePart)} ${color.darkGray("·")} ${color.aqua(eventPart)}`,
    `${color.darkGray(`第 ${page + 1} / ${Math.max(1, totalPages)} 页 · 共 ${total} 条`)}`,
    `${color.darkGray("================================")}`,
    "",
  ];

  if (entries.length === 0) {
    lines.push(color.gray("当前条件下没有匹配到日志。"));
  } else {
    lines.push(entries.map((entry, index) => formatBehaviorMessageBoxEntry(entry, index)).join("\n"));
  }

  lines.push(color.darkGray("使用底部按钮翻页或返回筛选。"));

  return lines.join("\n");
}

export function describeBehaviorEntry(entry: BehaviorLogEntry): string {
  const playerLabel = entry.e === "summonWither" ? "召唤人" : "玩家";
  const lines = [
    `${color.darkGray("日志详情")}`,
    `${color.gold("时间：")}${color.white(formatBehaviorTimestamp(entry.t))}`,
    `${color.gold(`${playerLabel}：`)}${color.yellow(entry.p)}`,
    `${color.gold("事件：")}${color.aqua(getBehaviorEventLabel(entry.e))}`,
  ];

  if (typeof entry.d === "number") {
    lines.push(`${color.gold("维度：")}${color.white(getBehaviorDimensionLabel(entry.d))}`);
  }

  if (typeof entry.x === "number" && typeof entry.y === "number" && typeof entry.z === "number") {
    lines.push(`${color.gold("坐标：")}${color.white(`${entry.x}, ${entry.y}, ${entry.z}`)}`);
  }

  if (entry.l) {
    lines.push(`${color.gold("领地：")}${color.lightPurple(entry.l)}`);
  }

  if (entry.v) {
    lines.push(`${color.gold("对象：")}${color.green(entry.v)}`);
  }

  if (entry.m) {
    lines.push(`${color.gold("附加：")}${color.gray(entry.m)}`);
  }

  return lines.join("\n");
}

class BehaviorLogService {
  private db?: Database<BehaviorLogState>;
  private queue: BehaviorLogEntry[] = [];
  private locationQueue: BehaviorLogEntry[] = [];

  constructor() {
    system.run(() => {
      this.db = new Database<BehaviorLogState>(DATABASE_NAME);
      this.ensureState();
      this.flush();
    });

    system.runInterval(() => {
      this.flush();
    }, FLUSH_INTERVAL_TICKS);
  }

  getEventTypes(): BehaviorEventType[] {
    return behaviorEventDefinitions.map((definition) => definition.type);
  }

  getEventDefinitions() {
    return behaviorEventDefinitions;
  }

  getKnownPlayers(): string[] {
    this.flush();
    const state = this.getState();
    const playerSet = new Set<string>(state.ps);
    for (const player of world.getAllPlayers()) {
      playerSet.add(player.name);
    }

    return [...playerSet].sort((a, b) => a.localeCompare(b, "zh-CN"));
  }

  getStats(): BehaviorLogStats {
    this.flush();
    const state = this.getState();
    return {
      playerCount: state.ps.length,
      entryCount: state.es.length,
      locationCount: state.ls.length,
      totalCount: state.es.length + state.ls.length,
      maxEntries: this.getMaxEntries(),
    };
  }

  clear(): void {
    if (!this.db) return;
    this.queue = [];
    this.locationQueue = [];
    this.db.set(STORE_KEY, cloneState(DEFAULT_STATE));
  }

  query(query: BehaviorLogQuery = {}): BehaviorLogQueryResult {
    this.flush();
    const {
      playerName,
      eventTypes,
      startTime,
      endTime,
      keyword,
      landOnly,
      dangerousOnly,
      limit = 10,
      offset = 0,
    } = query;

    const state = this.getState();
    const keywordValue = keyword ? normalizeText(keyword).toLowerCase() : "";
    const eventTypeSet = eventTypes?.length ? new Set(eventTypes) : undefined;
    const mergedEntries = [...state.es, ...state.ls]
      .sort((a, b) => b.t - a.t)
      .filter((entry) => {
        if (playerName && entry.p !== playerName) return false;
        if (eventTypeSet && !eventTypeSet.has(entry.e)) return false;
        if (typeof startTime === "number" && entry.t < startTime) return false;
        if (typeof endTime === "number" && entry.t > endTime) return false;
        if (landOnly && !entry.l) return false;
        if (dangerousOnly && !dangerousEventTypeSet.has(entry.e)) return false;
        if (keywordValue) {
          const haystack = buildBehaviorSearchText(entry);
          if (!haystack.includes(keywordValue)) return false;
        }
        return true;
      });

    return {
      total: mergedEntries.length,
      items: mergedEntries.slice(offset, offset + limit),
    };
  }

  shouldTrack(eventType: BehaviorEventType): boolean {
    if (!this.isEnabled()) return false;
    const settingKey = behaviorEventSettingMap[eventType];
    if (!settingKey) return false;
    return setting.getState(settingKey as never) !== false;
  }

  isDangerousEvent(eventType: BehaviorEventType): boolean {
    return dangerousEventTypeSet.has(eventType);
  }

  getLocationIntervalSeconds(): number {
    const rawValue = Number(setting.getState("behaviorLogLocationIntervalSec" as never));
    if (!Number.isFinite(rawValue) || rawValue <= 0) {
      return DEFAULT_LOCATION_INTERVAL_SECONDS;
    }

    return Math.min(Math.floor(rawValue), 3600);
  }

  getContainerEventType(typeId: string | undefined): BehaviorEventType | undefined {
    if (!typeId || typeId === "minecraft:ender_chest") return undefined;

    if (
      typeId === "minecraft:chest" ||
      typeId === "minecraft:trapped_chest" ||
      typeId === "minecraft:chest_boat" ||
      typeId === "minecraft:chest_minecart"
    ) {
      return "openChest";
    }

    if (typeId === "minecraft:barrel") {
      return "openBarrel";
    }

    if (typeId.includes("shulker_box")) {
      return "openShulker";
    }

    if (
      typeId === "minecraft:hopper" ||
      typeId === "minecraft:hopper_minecart" ||
      typeId === "minecraft:furnace" ||
      typeId === "minecraft:blast_furnace" ||
      typeId === "minecraft:smoker" ||
      typeId === "minecraft:dropper" ||
      typeId === "minecraft:dispenser"
    ) {
      return "openOtherContainer";
    }

    return undefined;
  }

  logJoin(player: Player): void {
    this.append({
      p: player.name,
      e: "playerJoin",
      d: toDimensionCode(player.dimension.id),
      ...toLocation(player.location),
    });
  }

  logLeave(playerName: string): void {
    this.append({
      p: playerName,
      e: "playerLeave",
    });
  }

  logChat(player: Player, message: string): void {
    const cleanMessage = normalizeText(message, MAX_CHAT_LENGTH);
    if (!cleanMessage) return;

    this.append({
      p: player.name,
      e: "playerChat",
      d: toDimensionCode(player.dimension.id),
      ...toLocation(player.location),
      m: cleanMessage,
    });
  }

  logDeath(player: Player, reason: string): void {
    this.append({
      p: player.name,
      e: "playerDeath",
      d: toDimensionCode(player.dimension.id),
      ...toLocation(player.location),
      m: normalizeText(reason, MAX_META_LENGTH),
    });
  }

  logPvpHit(attacker: Player, victim: Player): void {
    this.append({
      p: attacker.name,
      e: "pvpHit",
      d: toDimensionCode(victim.dimension.id),
      ...toLocation(victim.location),
      v: victim.name,
    });
  }

  logPlaceWater(player: Player, location: Vector3, dimensionId: string): void {
    this.append({
      p: player.name,
      e: "placeWater",
      d: toDimensionCode(dimensionId),
      ...toLocation(location),
    });
  }

  logPlaceLava(player: Player, location: Vector3, dimensionId: string): void {
    this.append({
      p: player.name,
      e: "placeLava",
      d: toDimensionCode(dimensionId),
      ...toLocation(location),
    });
  }

  logIgniteFire(player: Player, location: Vector3, dimensionId: string, targetTypeId?: string): void {
    this.append({
      p: player.name,
      e: "igniteFire",
      d: toDimensionCode(dimensionId),
      ...toLocation(location),
      v: shortTypeId(targetTypeId),
    });
  }

  logPlaceTnt(player: Player, location: Vector3, dimensionId: string): void {
    this.append({
      p: player.name,
      e: "placeTnt",
      d: toDimensionCode(dimensionId),
      ...toLocation(location),
    });
  }

  logSummonWither(playerName: string, location: Vector3, dimensionId: string, meta?: string): void {
    this.append({
      p: playerName,
      e: "summonWither",
      d: toDimensionCode(dimensionId),
      ...toLocation(location),
      m: meta ? normalizeText(meta) : undefined,
    });
  }

  logEnterLand(player: Player, land: LandLogInfo): void {
    this.append({
      p: player.name,
      e: "enterLand",
      d: toDimensionCode(player.dimension.id),
      ...toLocation(player.location),
      l: formatLandLabel(land),
    });
  }

  logLeaveLand(playerName: string, location: Vector3, dimensionId: string, land: LandLogInfo): void {
    this.append({
      p: playerName,
      e: "leaveLand",
      d: toDimensionCode(dimensionId),
      ...toLocation(location),
      l: formatLandLabel(land),
    });
  }

  logAttackMobInLand(
    player: Player,
    targetTypeId: string,
    location: Vector3,
    dimensionId: string,
    land: LandLogInfo
  ): void {
    this.append({
      p: player.name,
      e: "attackMobInLand",
      d: toDimensionCode(dimensionId),
      ...toLocation(location),
      l: formatLandLabel(land),
      v: shortTypeId(targetTypeId),
    });
  }

  logOpenContainer(
    player: Player,
    eventType: BehaviorEventType,
    typeId: string,
    location: Vector3,
    dimensionId: string,
    land?: LandLogInfo
  ): void {
    this.append({
      p: player.name,
      e: eventType,
      d: toDimensionCode(dimensionId),
      ...toLocation(location),
      l: formatLandLabel(land),
      v: shortTypeId(typeId),
    });
  }

  logLocationSnapshot(player: Player, land?: LandLogInfo): void {
    this.append(
      {
        p: player.name,
        e: "locationSnapshot",
        d: toDimensionCode(player.dimension.id),
        ...toLocation(player.location),
        l: formatLandLabel(land),
      },
      true
    );
  }

  private append(entry: Omit<BehaviorLogEntry, "t"> & { t?: number }, isLocation = false): void {
    if (!this.shouldTrack(entry.e)) return;

    const targetQueue = isLocation ? this.locationQueue : this.queue;
    targetQueue.push({
      ...entry,
      t: entry.t ?? Date.now(),
      p: normalizeText(entry.p, MAX_PLAYER_NAME_LENGTH),
      m: entry.m ? normalizeText(entry.m, MAX_META_LENGTH) : undefined,
      l: entry.l ? normalizeText(entry.l, MAX_META_LENGTH) : undefined,
      v: entry.v ? normalizeText(entry.v, MAX_META_LENGTH) : undefined,
    });

    if (this.queue.length + this.locationQueue.length >= 12) {
      this.flush();
    }
  }

  private flush(): void {
    if (!this.db || (this.queue.length === 0 && this.locationQueue.length === 0)) return;

    const state = cloneState(this.getState());
    const playerSet = new Set(state.ps);

    for (const entry of this.queue) {
      state.es.push(entry);
      playerSet.add(entry.p);
    }

    for (const entry of this.locationQueue) {
      state.ls.push(entry);
      playerSet.add(entry.p);
    }

    state.ps = [...playerSet].sort((a, b) => a.localeCompare(b, "zh-CN"));
    this.trimToMaxEntries(state);

    this.queue = [];
    this.locationQueue = [];
    this.db.set(STORE_KEY, state);
  }

  private getState(): BehaviorLogState {
    if (!this.db) {
      return cloneState(DEFAULT_STATE);
    }

    const state = this.db.get(STORE_KEY);
    if (!state || !Array.isArray(state.ps)) {
      const defaultState = cloneState(DEFAULT_STATE);
      this.db.set(STORE_KEY, defaultState);
      return defaultState;
    }

    const normalizedState: BehaviorLogState = {
      v: 2,
      ps: [...state.ps],
      es: Array.isArray((state as Partial<BehaviorLogState>).es) ? [...(state as BehaviorLogState).es] : [],
      ls: Array.isArray((state as Partial<BehaviorLogState>).ls) ? [...(state as BehaviorLogState).ls] : [],
    };

    return normalizedState;
  }

  private ensureState(): void {
    if (!this.db) return;
    if (!this.db.get(STORE_KEY)) {
      this.db.set(STORE_KEY, cloneState(DEFAULT_STATE));
    }
  }

  private getMaxEntries(): number {
    const rawValue = Number(setting.getState("behaviorLogMaxEntries" as never));
    if (!Number.isFinite(rawValue) || rawValue <= 0) {
      return DEFAULT_MAX_ENTRIES;
    }

    return Math.min(Math.floor(rawValue), 200000);
  }

  private isEnabled(): boolean {
    return setting.getState("behaviorLogEnabled" as never) !== false;
  }

  private trimToMaxEntries(state: BehaviorLogState): void {
    const maxEntries = this.getMaxEntries();
    const totalEntries = state.es.length + state.ls.length;
    if (totalEntries <= maxEntries) {
      return;
    }

    const merged = [
      ...state.es.map((entry) => ({ entry, source: "es" as const })),
      ...state.ls.map((entry) => ({ entry, source: "ls" as const })),
    ];

    merged.sort((a, b) => a.entry.t - b.entry.t);
    const kept = merged.slice(merged.length - maxEntries);

    state.es = kept.filter((item) => item.source === "es").map((item) => item.entry);
    state.ls = kept.filter((item) => item.source === "ls").map((item) => item.entry);
  }
}

const behaviorLog = new BehaviorLogService();

export default behaviorLog;
