import { Dimension, Player, StructureSaveMode, Vector3, system, world } from "@minecraft/server";
import type { ILand } from "../../../core/types";
import { Database } from "../../../shared/database/database";
import { color } from "../../../shared/utils/color";
import { SystemLog } from "../../../shared/utils/common";
import setting from "../../system/services/setting";
import landManager from "./land-manager";
import { taskScheduler } from "../../platform/scheduler";

const DATABASE_NAME = "landSnapshots";
const MAX_STRUCTURE_X = 64;
const MAX_STRUCTURE_Y = 257;
const MAX_STRUCTURE_Z = 64;
const DEFAULT_MAX_CHUNKS = 10;
const HARD_MAX_CHUNKS = 200;
const AUTO_SNAPSHOT_CHECK_TICKS = 1200;
const AUTO_SNAPSHOT_WORKER_TICKS = 100;
const DEFAULT_AUTO_INTERVAL_MINUTES = 360;
const DEFAULT_AUTO_MAX_PER_LAND = 3;

export interface LandSnapshotChunk {
  index: number;
  structureId: string;
  from: Vector3;
  to: Vector3;
  size: Vector3;
}

export interface LandSnapshotRecord {
  id: string;
  landName: string;
  landOwner: string;
  landGuildId?: string;
  createdAt: number;
  createdBy: string;
  dimensionId: string;
  bounds: {
    from: Vector3;
    to: Vector3;
    size: Vector3;
  };
  chunkCount: number;
  chunks: LandSnapshotChunk[];
  includeEntities: boolean;
  source?: "manual" | "auto";
}

export interface LandSnapshotPlan {
  from: Vector3;
  to: Vector3;
  size: Vector3;
  chunkCount: number;
  chunks: Array<Omit<LandSnapshotChunk, "structureId">>;
}

export interface CreateLandSnapshotOptions {
  includeEntities?: boolean;
  source?: "manual" | "auto";
  createdBy?: string;
}

function floorVector(v: Vector3): Vector3 {
  return {
    x: Math.floor(v.x),
    y: Math.floor(v.y),
    z: Math.floor(v.z),
  };
}

function getBounds(land: ILand): { from: Vector3; to: Vector3; size: Vector3 } {
  const a = floorVector(land.vectors.start);
  const b = floorVector(land.vectors.end);
  const from = {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    z: Math.min(a.z, b.z),
  };
  const to = {
    x: Math.max(a.x, b.x),
    y: Math.max(a.y, b.y),
    z: Math.max(a.z, b.z),
  };
  return {
    from,
    to,
    size: {
      x: to.x - from.x + 1,
      y: to.y - from.y + 1,
      z: to.z - from.z + 1,
    },
  };
}

function chunkCountForSize(size: Vector3): number {
  return (
    Math.ceil(size.x / MAX_STRUCTURE_X) * Math.ceil(size.y / MAX_STRUCTURE_Y) * Math.ceil(size.z / MAX_STRUCTURE_Z)
  );
}

function cloneVector(v: Vector3): Vector3 {
  return { x: v.x, y: v.y, z: v.z };
}

function getDimension(dimensionId: string): Dimension {
  return world.getDimension(dimensionId.replace(/^minecraft:/, "") as "overworld" | "nether" | "the_end");
}

function makeSnapshotId(): string {
  return `${Date.now().toString(36)}_${Math.floor(Math.random() * 0xffff).toString(36)}`;
}

function makeStructureId(snapshotId: string, chunkIndex: number): string {
  return `yuehua:land_snapshot_${snapshotId}_${chunkIndex}`;
}

function notify(playerName: string, message: string, actionBar = true): void {
  const player = world.getPlayers({ name: playerName })[0];
  if (!player?.isValid) return;
  if (actionBar) {
    player.onScreenDisplay.setActionBar(message);
  } else {
    player.sendMessage(message);
  }
}

function formatVector(v: Vector3): string {
  return `${v.x}, ${v.y}, ${v.z}`;
}

function clearNonPlayerEntities(dimension: Dimension, from: Vector3, size: Vector3): number {
  let removed = 0;
  const entities = dimension.getEntities({
    location: from,
    volume: size,
  });

  for (const entity of entities) {
    if (entity.typeId === "minecraft:player") continue;
    try {
      entity.remove();
      removed++;
    } catch {
      /* ignore invalid or non-removable entities */
    }
  }

  return removed;
}

class LandSnapshotService {
  private db?: Database<LandSnapshotRecord>;
  private activeLandJobs = new Set<string>();
  private activeAutoJob = false;
  private autoQueue: string[] = [];
  private nextAutoRunAt = 0;

  constructor() {
    system.run(() => {
      this.db = new Database<LandSnapshotRecord>(DATABASE_NAME);
    });
    this.registerAutoSnapshotScheduler();
  }

  getChunkLimit(): number {
    const raw = Number(setting.getState("landSnapshotMaxChunks" as never));
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_MAX_CHUNKS;
    return Math.min(Math.floor(raw), HARD_MAX_CHUNKS);
  }

  setChunkLimit(value: number): string | true {
    const n = Math.floor(value);
    if (!Number.isFinite(n) || n < 1) return "切块上限必须是大于 0 的整数";
    if (n > HARD_MAX_CHUNKS) return `切块上限不能超过 ${HARD_MAX_CHUNKS}`;
    setting.setState("landSnapshotMaxChunks" as never, String(n));
    return true;
  }

  isAutoEnabled(): boolean {
    return setting.getState("landSnapshotAutoEnabled" as never) === true;
  }

  getAutoIntervalMinutes(): number {
    const raw = Number(setting.getState("landSnapshotAutoIntervalMinutes" as never));
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_AUTO_INTERVAL_MINUTES;
    return Math.max(5, Math.floor(raw));
  }

  getAutoMaxPerLand(): number {
    const raw = Number(setting.getState("landSnapshotAutoMaxPerLand" as never));
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_AUTO_MAX_PER_LAND;
    return Math.min(Math.floor(raw), 50);
  }

  getAutoIncludeEntities(): boolean {
    return setting.getState("landSnapshotAutoIncludeEntities" as never) === true;
  }

  setAutoConfig(config: {
    enabled: boolean;
    intervalMinutes: number;
    maxPerLand: number;
    includeEntities: boolean;
  }): string | true {
    const interval = Math.floor(config.intervalMinutes);
    const maxPerLand = Math.floor(config.maxPerLand);
    if (!Number.isFinite(interval) || interval < 5) return "自动保存间隔不能小于 5 分钟";
    if (!Number.isFinite(maxPerLand) || maxPerLand < 1 || maxPerLand > 50) {
      return "每块领地自动快照上限必须是 1～50";
    }

    setting.setState("landSnapshotAutoEnabled" as never, config.enabled);
    setting.setState("landSnapshotAutoIntervalMinutes" as never, String(interval));
    setting.setState("landSnapshotAutoMaxPerLand" as never, String(maxPerLand));
    setting.setState("landSnapshotAutoIncludeEntities" as never, config.includeEntities);
    this.nextAutoRunAt = Date.now() + interval * 60 * 1000;
    if (!config.enabled) {
      this.autoQueue = [];
    }
    return true;
  }

  describeAutoConfig(): string {
    const enabled = this.isAutoEnabled();
    const maxPerLand = this.getAutoMaxPerLand();
    return [
      `${color.gray("状态：")}${enabled ? color.green("已开启") : color.red("已关闭")}`,
      `${color.gray("间隔：")}${color.yellow(`${this.getAutoIntervalMinutes()} 分钟`)}`,
      `${color.gray("每块领地自动快照上限：")}${color.yellow(String(maxPerLand))}`,
      `${color.gray("包含实体：")}${this.getAutoIncludeEntities() ? color.green("是") : color.gray("否")}`,
      color.darkGray(`达到 ${maxPerLand} 个自动快照后，会自动删除最旧的自动快照。手动快照不会被自动覆盖。`),
    ].join("\n");
  }

  buildPlan(land: ILand): LandSnapshotPlan {
    const bounds = getBounds(land);
    const chunks: LandSnapshotPlan["chunks"] = [];
    let index = 0;

    for (let x = bounds.from.x; x <= bounds.to.x; x += MAX_STRUCTURE_X) {
      for (let y = bounds.from.y; y <= bounds.to.y; y += MAX_STRUCTURE_Y) {
        for (let z = bounds.from.z; z <= bounds.to.z; z += MAX_STRUCTURE_Z) {
          const from = { x, y, z };
          const to = {
            x: Math.min(x + MAX_STRUCTURE_X - 1, bounds.to.x),
            y: Math.min(y + MAX_STRUCTURE_Y - 1, bounds.to.y),
            z: Math.min(z + MAX_STRUCTURE_Z - 1, bounds.to.z),
          };
          chunks.push({
            index,
            from,
            to,
            size: {
              x: to.x - from.x + 1,
              y: to.y - from.y + 1,
              z: to.z - from.z + 1,
            },
          });
          index++;
        }
      }
    }

    return {
      ...bounds,
      chunkCount: chunkCountForSize(bounds.size),
      chunks,
    };
  }

  describePlan(land: ILand): string {
    const plan = this.buildPlan(land);
    const limit = this.getChunkLimit();
    const lines = [
      `${color.gray("范围：")}${color.white(`${formatVector(plan.from)} -> ${formatVector(plan.to)}`)}`,
      `${color.gray("尺寸：")}${color.yellow(`${plan.size.x} x ${plan.size.y} x ${plan.size.z}`)}`,
      `${color.gray("结构分片：")}${plan.chunkCount > limit ? color.red(String(plan.chunkCount)) : color.green(String(plan.chunkCount))}${color.gray(` / 上限 ${limit}`)}`,
      `${color.darkGray(`单结构最大 ${MAX_STRUCTURE_X} x ${MAX_STRUCTURE_Y} x ${MAX_STRUCTURE_Z}`)}`,
    ];
    if (plan.chunkCount > limit) {
      lines.push(color.red("该领地超过当前自动切块上限，无法保存快照。"));
      lines.push(color.gray("可在领地系统管理中调整上限，但过大领地会在保存/恢复时造成明显卡顿。"));
    }
    return lines.join("\n");
  }

  listByLand(landName: string): LandSnapshotRecord[] {
    if (!this.db) return [];
    return this.db
      .values()
      .filter((snapshot) => snapshot.landName === landName)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  listAutoByLand(landName: string): LandSnapshotRecord[] {
    return this.listByLand(landName).filter((snapshot) => snapshot.source === "auto");
  }

  getSnapshot(snapshotId: string): LandSnapshotRecord | undefined {
    return this.db?.get(snapshotId);
  }

  createSnapshot(player: Player, landName: string, options: CreateLandSnapshotOptions = {}): string | true {
    const land = landManager.getLand(landName);
    if (typeof land === "string") return land;
    if (!this.db) return "快照数据库尚未初始化，请稍后再试";
    if (this.activeLandJobs.has(land.name)) return "该领地已有快照任务正在执行";

    const plan = this.buildPlan(land);
    const limit = this.getChunkLimit();
    if (plan.chunkCount > limit) {
      return `该领地需要 ${plan.chunkCount} 个结构分片，超过当前上限 ${limit}。请缩小领地或由管理员谨慎提高上限。`;
    }

    const snapshotId = makeSnapshotId();
    this.activeLandJobs.add(land.name);
    system.runJob(
      this.createSnapshotJob(
        options.createdBy ?? player.name,
        land,
        snapshotId,
        plan,
        options.includeEntities === true,
        options.source ?? "manual"
      )
    );
    return true;
  }

  restoreSnapshot(player: Player, snapshotId: string): string | true {
    const snapshot = this.getSnapshot(snapshotId);
    if (!snapshot) return "快照不存在或已被删除";
    if (this.activeLandJobs.has(snapshot.landName)) return "该领地已有快照任务正在执行";

    const land = landManager.getLand(snapshot.landName);
    if (typeof land === "string") return "快照所属领地不存在，无法恢复";
    if (land.dimension !== snapshot.dimensionId) return "领地维度与快照维度不一致，无法恢复";

    this.activeLandJobs.add(snapshot.landName);
    system.runJob(this.restoreSnapshotJob(player.name, snapshot));
    return true;
  }

  deleteSnapshot(snapshotId: string): string | true {
    const snapshot = this.getSnapshot(snapshotId);
    if (!snapshot || !this.db) return "快照不存在或已被删除";
    if (this.activeLandJobs.has(snapshot.landName)) return "该领地已有快照任务正在执行";

    this.deleteSnapshotRecord(snapshot);
    return true;
  }

  private deleteSnapshotRecord(snapshot: LandSnapshotRecord): void {
    for (const chunk of snapshot.chunks) {
      try {
        world.structureManager.delete(chunk.structureId);
      } catch (error) {
        SystemLog.warn(`[LandSnapshot] 删除结构 ${chunk.structureId} 失败: ${error}`);
      }
    }
    this.db?.delete(snapshot.id);
    this.db?.save();
  }

  private registerAutoSnapshotScheduler(): void {
    taskScheduler.register({
      id: "land.snapshotAutoEnqueue",
      label: "领地快照自动入队",
      category: "land",
      intervalTicks: AUTO_SNAPSHOT_CHECK_TICKS,
      when: () => setting.getState("land") === true,
      run: () => this.enqueueAutoSnapshotsIfDue(),
    });

    taskScheduler.register({
      id: "land.snapshotAutoWorker",
      label: "领地快照队列处理",
      category: "land",
      intervalTicks: AUTO_SNAPSHOT_WORKER_TICKS,
      when: () => setting.getState("land") === true,
      skipIfRunning: true,
      run: () => this.processAutoSnapshotQueue(),
    });
  }

  private enqueueAutoSnapshotsIfDue(): void {
    if (!this.db || !this.isAutoEnabled()) return;
    const now = Date.now();
    if (this.nextAutoRunAt === 0) {
      this.nextAutoRunAt = now + this.getAutoIntervalMinutes() * 60 * 1000;
      return;
    }
    if (now < this.nextAutoRunAt) return;

    const queued = new Set(this.autoQueue);
    for (const land of Object.values(landManager.getLandList())) {
      if (!queued.has(land.name) && !this.activeLandJobs.has(land.name)) {
        this.autoQueue.push(land.name);
      }
    }

    this.nextAutoRunAt = now + this.getAutoIntervalMinutes() * 60 * 1000;
    SystemLog.info(`[LandSnapshot] 已排队 ${this.autoQueue.length} 个自动快照任务`);
  }

  private processAutoSnapshotQueue(): void {
    if (!this.db || !this.isAutoEnabled() || this.activeAutoJob) return;
    const landName = this.autoQueue.shift();
    if (!landName) return;

    const land = landManager.getLand(landName);
    if (typeof land === "string") return;
    if (this.activeLandJobs.has(land.name)) {
      this.autoQueue.push(land.name);
      return;
    }

    const plan = this.buildPlan(land);
    const limit = this.getChunkLimit();
    if (plan.chunkCount > limit) {
      SystemLog.warn(`[LandSnapshot] 自动快照跳过 ${land.name}: 分片 ${plan.chunkCount} 超过上限 ${limit}`);
      return;
    }

    const snapshotId = makeSnapshotId();
    this.activeLandJobs.add(land.name);
    this.activeAutoJob = true;
    system.runJob(this.createSnapshotJob("自动保存", land, snapshotId, plan, this.getAutoIncludeEntities(), "auto"));
  }

  private trimAutoSnapshots(landName: string): void {
    const max = this.getAutoMaxPerLand();
    const snapshots = this.listAutoByLand(landName).sort((a, b) => b.createdAt - a.createdAt);
    for (const snapshot of snapshots.slice(max)) {
      this.deleteSnapshotRecord(snapshot);
    }
  }

  private *createSnapshotJob(
    playerName: string,
    land: ILand,
    snapshotId: string,
    plan: LandSnapshotPlan,
    includeEntities: boolean,
    source: "manual" | "auto"
  ): Generator<void, void, void> {
    const savedChunks: LandSnapshotChunk[] = [];
    try {
      const dimension = getDimension(land.dimension);
      for (const chunk of plan.chunks) {
        const structureId = makeStructureId(snapshotId, chunk.index);
        notify(playerName, color.yellow(`正在保存领地快照 ${chunk.index + 1}/${plan.chunkCount}：${land.name}`));
        world.structureManager.createFromWorld(structureId, dimension, chunk.from, chunk.to, {
          includeBlocks: true,
          includeEntities,
          saveMode: StructureSaveMode.World,
        });
        savedChunks.push({
          ...chunk,
          structureId,
          from: cloneVector(chunk.from),
          to: cloneVector(chunk.to),
          size: cloneVector(chunk.size),
        });
        yield;
      }

      const record: LandSnapshotRecord = {
        id: snapshotId,
        landName: land.name,
        landOwner: land.owner,
        landGuildId: land.guildId,
        createdAt: Date.now(),
        createdBy: playerName,
        dimensionId: land.dimension,
        bounds: {
          from: cloneVector(plan.from),
          to: cloneVector(plan.to),
          size: cloneVector(plan.size),
        },
        chunkCount: savedChunks.length,
        chunks: savedChunks,
        includeEntities,
        source,
      };
      this.db?.set(snapshotId, record);
      this.db?.save();
      if (source === "auto") {
        this.trimAutoSnapshots(land.name);
        SystemLog.info(`[LandSnapshot] 自动快照完成: ${land.name} (${savedChunks.length} 分片)`);
      } else {
        notify(playerName, color.green(`领地 ${land.name} 快照保存完成，共 ${savedChunks.length} 个分片`), false);
      }
    } catch (error) {
      for (const chunk of savedChunks) {
        try {
          world.structureManager.delete(chunk.structureId);
        } catch {
          /* ignore cleanup errors */
        }
      }
      SystemLog.error("[LandSnapshot] 保存快照失败", error);
      if (source === "auto") {
        SystemLog.warn(`[LandSnapshot] 自动快照失败 ${land.name}: ${(error as Error).message}`);
      } else {
        notify(playerName, color.red(`领地 ${land.name} 快照保存失败：${(error as Error).message}`), false);
      }
    } finally {
      this.activeLandJobs.delete(land.name);
      if (source === "auto") {
        this.activeAutoJob = false;
      }
      yield;
    }
  }

  private *restoreSnapshotJob(playerName: string, snapshot: LandSnapshotRecord): Generator<void, void, void> {
    try {
      const dimension = getDimension(snapshot.dimensionId);
      for (const chunk of snapshot.chunks) {
        notify(
          playerName,
          color.yellow(`正在恢复领地快照 ${chunk.index + 1}/${snapshot.chunkCount}：${snapshot.landName}`)
        );
        if (snapshot.includeEntities) {
          clearNonPlayerEntities(dimension, chunk.from, chunk.size);
          yield;
        }
        world.structureManager.place(chunk.structureId, dimension, chunk.from, {
          includeBlocks: true,
          includeEntities: snapshot.includeEntities === true,
        });
        yield;
      }
      notify(playerName, color.green(`领地 ${snapshot.landName} 已恢复到选定快照`), false);
    } catch (error) {
      SystemLog.error("[LandSnapshot] 恢复快照失败", error);
      notify(playerName, color.red(`领地 ${snapshot.landName} 快照恢复失败：${(error as Error).message}`), false);
    } finally {
      this.activeLandJobs.delete(snapshot.landName);
      yield;
    }
  }
}

export const landSnapshotService = new LandSnapshotService();
export default landSnapshotService;
