import {
  Dimension,
  Player,
  StructureSaveMode,
  Vector3,
  system,
  world,
} from "@minecraft/server";
import type { ILand } from "../../../core/types";
import { Database } from "../../../shared/database/database";
import { color } from "../../../shared/utils/color";
import { SystemLog } from "../../../shared/utils/common";
import setting from "../../system/services/setting";
import landManager from "./land-manager";

const DATABASE_NAME = "landSnapshots";
const MAX_STRUCTURE_X = 64;
const MAX_STRUCTURE_Y = 257;
const MAX_STRUCTURE_Z = 64;
const DEFAULT_MAX_CHUNKS = 10;
const HARD_MAX_CHUNKS = 200;

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
    Math.ceil(size.x / MAX_STRUCTURE_X) *
    Math.ceil(size.y / MAX_STRUCTURE_Y) *
    Math.ceil(size.z / MAX_STRUCTURE_Z)
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

  constructor() {
    system.run(() => {
      this.db = new Database<LandSnapshotRecord>(DATABASE_NAME);
    });
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
    system.runJob(this.createSnapshotJob(player.name, land, snapshotId, plan, options.includeEntities === true));
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

    for (const chunk of snapshot.chunks) {
      try {
        world.structureManager.delete(chunk.structureId);
      } catch (error) {
        SystemLog.warn(`[LandSnapshot] 删除结构 ${chunk.structureId} 失败: ${error}`);
      }
    }
    this.db.delete(snapshot.id);
    this.db.save();
    return true;
  }

  private *createSnapshotJob(
    playerName: string,
    land: ILand,
    snapshotId: string,
    plan: LandSnapshotPlan,
    includeEntities: boolean
  ): Generator<void, void, void> {
    const savedChunks: LandSnapshotChunk[] = [];
    try {
      const dimension = getDimension(land.dimension);
      for (const chunk of plan.chunks) {
        const structureId = makeStructureId(snapshotId, chunk.index);
        notify(
          playerName,
          color.yellow(`正在保存领地快照 ${chunk.index + 1}/${plan.chunkCount}：${land.name}`)
        );
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
      };
      this.db?.set(snapshotId, record);
      this.db?.save();
      notify(playerName, color.green(`领地 ${land.name} 快照保存完成，共 ${savedChunks.length} 个分片`), false);
    } catch (error) {
      for (const chunk of savedChunks) {
        try {
          world.structureManager.delete(chunk.structureId);
        } catch {
          /* ignore cleanup errors */
        }
      }
      SystemLog.error("[LandSnapshot] 保存快照失败", error);
      notify(playerName, color.red(`领地 ${land.name} 快照保存失败：${(error as Error).message}`), false);
    } finally {
      this.activeLandJobs.delete(land.name);
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
