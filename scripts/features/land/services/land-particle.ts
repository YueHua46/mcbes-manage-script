/**
 * 领地粒子效果服务
 * 完整迁移自 Modules/Particle.ts
 */

import { MolangVariableMap, Player, system, Vector3 } from "@minecraft/server";
import {
  FRAME_LIFETIME,
  FRAME_CROSSFADE,
  FRAME_PROFILES,
  boundaryPointDistance,
  planBoundaryMarkers,
  reserveBoundaryParticles,
  BoundaryFrameBudget,
} from "./land-boundary-frame";
import { color } from "../../../shared/utils/color";
import { landBoundaryColors } from "./land-boundary-colors";
import { getDebugUtilities, isDebugUtilitiesAvailable } from "../../platform/sapi-capabilities";
import { BoundaryDetail, BoundaryRenderPlan, createBoundaryRenderPlan } from "./land-boundary-render-plan";
import {
  boundaryCluster,
  boundaryWakeDelay,
  boundaryWakeOrigin,
  boundaryWakePatches,
  boundarySurfacePatches,
} from "./land-boundary-choreography";

/** 预览粒子间距（方块距离 / 步数）。保持轮廓可读，同时避免移动预览时糊屏。 */
const PARTICLE_SPACING = 2.8;
/** 单次 runJob 时间片内最多生成的粒子数，避免单 tick 过重触发 Watchdog */
const PARTICLES_PER_JOB_SLICE = 72;
/** 单条边上采样步数上限（含端点共 steps+1 个粒子）；过大领地防止刷爆脚本 */
const MAX_STEPS_PER_LINE = 512;
const DEBUG_RENDER_TTL_TICKS = 120;
const DEBUG_RENDER_TTL_SECONDS = DEBUG_RENDER_TTL_TICKS / 20;
const MAX_GRID_LINES_PER_AXIS = 4;
const AMBIENT_PARTICLES_PER_JOB_SLICE = 64;
/** 进出领地时保持约 3 秒，再用粒子自身的 0.15 秒尾段淡出。 */
const BOUNDARY_BURST_TICKS = 60;

type Edge = readonly [Vector3, Vector3];
type DebugShapeHandle = { remove: () => void };

interface DebugShapeGroup {
  shapes: DebugShapeHandle[];
  cleanupRunId?: number;
}

interface Bounds {
  min: Vector3;
  max: Vector3;
  size: Vector3;
  center: Vector3;
}

interface AreaParticlePlan {
  bounds: Bounds;
  edges: Edge[];
  corners: Vector3[];
}

interface AmbientBoundaryOptions {
  seed?: string;
  variant?: AmbientBoundaryVariant;
  detail?: BoundaryDetail;
  budget?: BoundaryFrameBudget;
  duration?: number;
  emphasis?: boolean;
  tint?: RgbaColor;
  active?: () => boolean;
}

interface AmbientPalette {
  runePrimary: RgbaColor;
}

type AmbientBoundaryVariant = "owner" | "trusted" | "guild" | "public" | "foreign" | "personal";

interface RgbaColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

export interface LandSelectionOverlapInfo {
  name: string;
  owner: string;
  start: Vector3;
  end: Vector3;
}

export interface LandSelectionGuideInfo {
  start?: Vector3;
  end?: Vector3;
  preview?: Vector3;
  blockCount?: number;
  maxBlocks?: number;
  cost?: number;
  balance?: number;
  overlapCount?: number;
  overlaps?: LandSelectionOverlapInfo[];
  complete: boolean;
  status: "preview" | "valid" | "warning" | "invalid";
  hint: string;
}

class LandParticle {
  private readonly debugShapeGroups = new Map<string, DebugShapeGroup>();
  private readonly frameLeases = new Map<string, number>();
  private readonly pendingRefreshes = new Set<string>();
  private readonly wakeBudgets = new Map<string, { tick: number; remaining: number }>();
  private readonly colorMolangCache = new Map<string, MolangVariableMap>();

  /**
   * 在指定位置创建领地标记粒子
   */
  createLandParticle(player: Player, pos: Vector3): void {
    system.run(() => {
      if (!player.isValid) return;
      void this.tryCreateDebugMarker(player, pos).then((rendered) => {
        if (!rendered) {
          this.spawnMarkerParticles(player, pos);
        }
      });
    });
  }

  /**
   * 创建领地区域粒子效果（方框）
   */
  createLandParticleArea(player: Player, pos: Vector3[]): void {
    this.createLandAmbientBoundary(player, pos, { emphasis: true, variant: "personal" });
  }

  /** 光团与晶屑构成的粒子结界；所有附近领地共享玩家本次刷新的粒子预算。 */
  createLandAmbientBoundary(player: Player, pos: Vector3[], options: AmbientBoundaryOptions = {}): void {
    if (!player.isValid || pos.length < 2) return;
    const dimensionId = player.dimension.id;
    const requestedTick = system.currentTick;
    const leaseKey = [player.id, dimensionId, ...pos.flatMap((point) => [point.x, point.y, point.z])].join(":");
    for (const [key, expiry] of this.frameLeases) if (expiry <= requestedTick) this.frameLeases.delete(key);
    const expiry = this.frameLeases.get(leaseKey);
    if (expiry !== undefined) {
      if (options.active && !this.pendingRefreshes.has(leaseKey)) {
        this.pendingRefreshes.add(leaseKey);
        system.runTimeout(() => {
          this.pendingRefreshes.delete(leaseKey);
          if (player.isValid && player.dimension.id === dimensionId && options.active!())
            this.createLandAmbientBoundary(player, pos, options);
        }, expiry - requestedTick);
      }
      return;
    }
    // Prevent timer/menu/entry effects painting the same frame on top of itself.
    if (this.frameLeases.size >= 512) this.frameLeases.delete(this.frameLeases.keys().next().value!);
    this.frameLeases.set(
      leaseKey,
      requestedTick + Math.round(((options.duration ?? FRAME_LIFETIME) - FRAME_CROSSFADE) * 20)
    );
    system.run(() => {
      if (!player.isValid || player.dimension.id !== dimensionId) return;
      const detail = options.detail ?? "balanced";
      const seed = options.seed ?? pos.map((point) => `${point.x}:${point.y}:${point.z}`).join(":");
      const plan = createBoundaryRenderPlan(pos[0], pos[1], detail, seed);
      const palette = this.getAmbientPalette(seed, options.variant);
      if (options.tint) palette.runePrimary = options.tint;
      const budget = options.budget ?? { remaining: FRAME_PROFILES[detail].particles };
      const alive = () =>
        player.isValid &&
        player.dimension.id === dimensionId &&
        system.currentTick - requestedTick < 20 &&
        (options.active?.() ?? true);
      system.runJob(
        this.ambientBoundaryGenerator(
          player,
          plan,
          palette,
          detail,
          budget,
          options.duration ?? FRAME_LIFETIME,
          options.emphasis ?? false,
          alive,
          seed
        )
      );
    });
  }

  /** 进出领地保持三秒；已有粒子时接续剩余时长，避免去重吞掉提示或重复叠加。 */
  createLandAmbientBoundaryBurst(player: Player, pos: Vector3[], options: AmbientBoundaryOptions = {}): void {
    if (!player.isValid || pos.length < 2) return;
    const dimensionId = player.dimension.id;
    const untilTick = system.currentTick + BOUNDARY_BURST_TICKS;
    this.createBoundaryWake(player, pos, options);
    const leaseKey = [player.id, dimensionId, ...pos.flatMap((point) => [point.x, point.y, point.z])].join(":");
    const continueBurst = () => {
      if (!player.isValid || player.dimension.id !== dimensionId || system.currentTick >= untilTick) return;
      const expiry = this.frameLeases.get(leaseKey) ?? system.currentTick;
      if (expiry >= untilTick) return;
      if (expiry > system.currentTick) {
        system.runTimeout(continueBurst, expiry - system.currentTick);
        return;
      }
      this.createLandAmbientBoundary(player, pos, {
        ...options,
        duration: (untilTick - system.currentTick) / 20 + FRAME_CROSSFADE,
        emphasis: true,
      });
    };
    continueBurst();
  }

  /** A bounded local accent responds immediately even when the ambient lease is active. */
  private createBoundaryWake(player: Player, pos: Vector3[], options: AmbientBoundaryOptions): void {
    const tick = system.currentTick;
    const dimensionId = player.dimension.id;
    const detail = options.detail ?? "balanced";
    for (const [key, value] of this.wakeBudgets)
      if (tick - value.tick >= BOUNDARY_BURST_TICKS) this.wakeBudgets.delete(key);
    let budget = this.wakeBudgets.get(player.id);
    if (!budget) {
      if (this.wakeBudgets.size >= 512) this.wakeBudgets.delete(this.wakeBudgets.keys().next().value!);
      budget = { tick, remaining: Math.floor(FRAME_PROFILES[detail].particles / 15) };
      this.wakeBudgets.set(player.id, budget);
    }
    if (budget.remaining < 3) return;
    // Preserve part of the shared window for a quick return crossing.
    const sharedBudget = budget;
    const localBudget = {
      remaining: Math.min(budget.remaining, Math.ceil((FRAME_PROFILES[detail].particles / 3) * 0.07)),
    };
    sharedBudget.remaining -= localBudget.remaining;
    const seed = options.seed ?? "wake";
    const plan = createBoundaryRenderPlan(pos[0], pos[1], detail, seed);
    const origin = boundaryWakeOrigin(plan.bounds, player.location);
    const palette = this.getAmbientPalette(seed, options.variant);
    if (options.tint) palette.runePrimary = options.tint;
    const alive = () => player.isValid && player.dimension.id === dimensionId && system.currentTick - tick < 20;
    // Shared across this player's transitions for three seconds, separate from the ambient refresh budget.
    const wake = this.ambientBoundaryGenerator(
      player,
      plan,
      palette,
      detail,
      localBudget,
      3.15,
      true,
      alive,
      seed,
      origin
    );
    system.runJob(
      (function* () {
        try {
          yield* wake;
        } finally {
          sharedBudget.remaining += localBudget.remaining;
        }
      })()
    );
  }

  /**
   * 在两点之间创建粒子线（异步分片，不阻塞当前 tick）
   */
  createParticleLine(player: Player, startPos: Vector3, endPos: Vector3): void {
    system.run(() => {
      if (!player.isValid) {
        return;
      }
      void this.tryCreateDebugLine(player, startPos, endPos).then((rendered) => {
        if (!rendered) {
          system.runJob(this.lineParticleGenerator(player, startPos, endPos, MAX_STEPS_PER_LINE));
        }
      });
    });
  }

  /**
   * 创建圈地过程中的引导式预览。
   */
  createLandSelectionGuide(player: Player, guide: LandSelectionGuideInfo): void {
    system.run(() => {
      if (!player.isValid) return;
      const endPos = guide.end ?? guide.preview;

      if (guide.start && endPos) {
        this.spawnSelectionGuideBeacons(player, guide.start, endPos, guide);
        this.spawnOverlapLandPulses(player, guide.overlaps);
        this.createLandAmbientBoundary(player, [guide.start, endPos], {
          duration: 1.15,
          emphasis: true,
          tint: this.getGuidePalette(guide.status).edge,
        });
        system.runJob(this.overlapParticleGenerator(player, guide.overlaps));
        return;
      }

      if (guide.start) {
        void this.tryCreateDebugMarker(player, guide.start, "起点").then((rendered) => {
          if (!rendered) this.spawnMarkerParticles(player, guide.start!);
        });
        return;
      }

      if (guide.end) {
        void this.tryCreateDebugMarker(player, guide.end, "终点").then((rendered) => {
          if (!rendered) this.spawnMarkerParticles(player, guide.end!);
        });
      }
    });
  }

  clearLandSelectionGuide(player: Player): void {
    this.removeDebugShapeGroup(this.getSelectionGuideDebugKey(player));
  }

  private getAreaParticlePlan(startPos: Vector3, endPos: Vector3): AreaParticlePlan {
    const bounds = this.getBounds(startPos, endPos);
    const edges = this.getLandAreaEdges(bounds);
    return {
      bounds,
      edges,
      corners: this.getRenderCorners(bounds),
    };
  }

  private getLandAreaEdges(bounds: Bounds): Edge[] {
    const min = bounds.min;
    const max = bounds.max;

    if (min.y === max.y) {
      const corners = [
        { x: min.x, y: min.y, z: min.z },
        { x: max.x, y: min.y, z: min.z },
        { x: min.x, y: min.y, z: max.z },
        { x: max.x, y: min.y, z: max.z },
      ];
      return [
        [corners[0], corners[1]],
        [corners[1], corners[3]],
        [corners[3], corners[2]],
        [corners[2], corners[0]],
      ];
    }

    const corners = [
      { x: min.x, y: min.y, z: min.z },
      { x: max.x, y: min.y, z: min.z },
      { x: min.x, y: max.y, z: min.z },
      { x: max.x, y: max.y, z: min.z },
      { x: min.x, y: min.y, z: max.z },
      { x: max.x, y: min.y, z: max.z },
      { x: min.x, y: max.y, z: max.z },
      { x: max.x, y: max.y, z: max.z },
    ];
    return [
      [corners[0], corners[1]],
      [corners[1], corners[3]],
      [corners[3], corners[2]],
      [corners[2], corners[0]],
      [corners[4], corners[5]],
      [corners[5], corners[7]],
      [corners[7], corners[6]],
      [corners[6], corners[4]],
      [corners[0], corners[4]],
      [corners[1], corners[5]],
      [corners[2], corners[6]],
      [corners[3], corners[7]],
    ];
  }

  private *overlapParticleGenerator(
    player: Player,
    overlaps: LandSelectionOverlapInfo[] | undefined
  ): Generator<void, void, void> {
    if (!overlaps?.length) return;
    let sliceCount = 0;

    for (const overlap of overlaps.slice(0, 4)) {
      const plan = this.getAreaParticlePlan(overlap.start, overlap.end);
      for (const corner of plan.corners) {
        if (!player.isValid) return;
        this.spawnOverlapCornerParticles(player, corner);
        sliceCount += 4;
        if (sliceCount >= PARTICLES_PER_JOB_SLICE) {
          sliceCount = 0;
          yield;
        }
      }

      for (const [startPos, endPos] of plan.edges) {
        let stepIndex = 0;
        for (const particle of this.iterLineParticles(player, startPos, endPos, 256, 1.8)) {
          if (!player.isValid) return;
          this.spawnOverlapBoundaryParticle(player, particle, stepIndex);
          sliceCount++;
          stepIndex++;
          if (sliceCount >= PARTICLES_PER_JOB_SLICE) {
            sliceCount = 0;
            yield;
          }
        }
      }
    }
  }

  private *lineParticleGenerator(
    player: Player,
    startPos: Vector3,
    endPos: Vector3,
    maxSteps: number
  ): Generator<void, void, void> {
    let sliceCount = 0;
    let edgeStep = 0;
    for (const particle of this.iterLineParticles(player, startPos, endPos, maxSteps)) {
      if (!player.isValid) {
        return;
      }
      this.spawnBoundaryParticle(player, particle, edgeStep);
      sliceCount++;
      edgeStep++;
      if (sliceCount >= PARTICLES_PER_JOB_SLICE) {
        sliceCount = 0;
        yield;
      }
    }
  }

  private *ambientBoundaryGenerator(
    player: Player,
    plan: BoundaryRenderPlan,
    palette: AmbientPalette,
    detail: BoundaryDetail,
    budget: BoundaryFrameBudget,
    duration: number,
    emphasis: boolean,
    alive: () => boolean,
    seed: string,
    wakeOrigin?: Vector3
  ): Generator<void, void, void> {
    if (!alive()) return;
    const viewer = player.location;
    const spawn = (identifier: string, position: Vector3, tint: RgbaColor, values: Record<string, number> = {}) => {
      const molang = new MolangVariableMap();
      molang.setColorRGBA("variable.color", tint);
      molang.setFloat("variable.duration", duration);
      for (const [key, value] of Object.entries(values)) molang.setFloat(`variable.${key}`, value);
      try {
        player.spawnParticle(identifier, position, molang);
      } catch {
        // Unloaded chunks and unavailable resources should not abort the other visible segments.
      }
    };
    let sliceCount = 0;
    const patch = (
      position: Vector3,
      span: Vector3,
      count: number,
      alpha: number,
      focus = false,
      outline = false
    ): boolean => {
      if (alpha <= 0) return true;
      if (wakeOrigin && boundaryPointDistance(position, wakeOrigin) > 24) return true;
      const variation = boundaryCluster(seed, position);
      count = outline ? count : Math.max(2, Math.round(count * (0.55 + variation * 0.8)));
      if (!reserveBoundaryParticles(budget, count)) return false;
      const crystalCount = !wakeOrigin && count >= 4 && variation < 0.12 ? 1 : 0;
      const glowCount = wakeOrigin ? count : Math.ceil(count * 0.7);
      const dustCount = count - glowCount - crystalCount;
      const spread = 0.45 + variation * 0.3;
      const values: Record<string, number> = {
        span_x: span.x * spread,
        span_y: span.y * spread,
        span_z: span.z * spread,
        phase: variation * 360,
        delay: wakeOrigin ? boundaryWakeDelay(wakeOrigin, position) : 0,
        focus: focus ? 1 : 0,
        clock: system.currentTick / 20,
        fade: Math.min(FRAME_CROSSFADE, duration / 2),
        size_scale: outline ? (focus ? 1.3 : 1) : 1,
      };
      for (const axis of ["x", "y", "z"] as const) {
        values[`min_${axis}`] = Math.max(-span[axis] / 2, plan.bounds.min[axis] - position[axis]);
        values[`max_${axis}`] = Math.min(span[axis] / 2, plan.bounds.max[axis] - position[axis]);
      }
      if (outline) {
        // A single fixed core, with no per-particle random position/size/rotation.
        spawn("rbb:land_mote_marker", position, this.withAlpha(palette.runePrimary, 1), { ...values, count: 1 });
        sliceCount++;
        return true;
      }
      for (const [kind, amount] of [
        ["glow", glowCount],
        ["crystal", crystalCount],
        ["dust", dustCount],
      ] as const) {
        if (!amount) continue;
        const tint =
          kind === "crystal"
            ? {
                red: 0.15 + palette.runePrimary.red * 0.85,
                green: 0.15 + palette.runePrimary.green * 0.85,
                blue: 0.15 + palette.runePrimary.blue * 0.85,
                alpha: alpha * 0.65,
              }
            : this.withAlpha(palette.runePrimary, alpha);
        spawn(`rbb:land_mote_${wakeOrigin ? "wake" : kind}`, position, tint, { ...values, count: amount });
        sliceCount++;
      }
      return true;
    };
    const edgeCount = detail === "low" ? 4 : detail === "balanced" ? 6 : 8;
    // Wake surface cells take priority, so tall claims still react at the crossing height.
    if (wakeOrigin) {
      const panels = boundaryWakePatches(plan.bounds, wakeOrigin, seed);
      if (!patch(wakeOrigin, { x: 0.85, y: 1.3, z: 0.85 }, 6, 1, true)) return;
      for (const panel of panels) {
        if (!alive()) return;
        if (
          !patch(
            panel.position,
            panel.span,
            edgeCount,
            0.8 * (1 - boundaryPointDistance(panel.position, wakeOrigin) / 22)
          )
        )
          return;
        if (sliceCount >= AMBIENT_PARTICLES_PER_JOB_SLICE) {
          sliceCount = 0;
          yield;
        }
      }
      return;
    }
    // The real cuboid is the primary guide: identical spacing and motes on every edge.
    const profile = FRAME_PROFILES[detail];
    const canonicalBudget = Math.floor(profile.particles / profile.maxLands);
    const outlineBudget = Math.min(Math.floor(budget.remaining * 0.9), Math.floor(canonicalBudget * 0.9));
    const cluster = (position: Vector3, corner = false): boolean => {
      const count = corner ? 9 : 3;
      if (!reserveBoundaryParticles(budget, count)) return false;
      const span = corner ? { x: 0.7, y: 0.7, z: 0.7 } : { x: 0.35, y: 0.35, z: 0.35 };
      const values: Record<string, number> = {
        outline: 1,
        size_scale: corner ? 1.8 : 1.35,
        phase: boundaryCluster(seed, position) * 360,
        delay: 0,
        focus: 0,
        clock: system.currentTick / 20,
        fade: Math.min(FRAME_CROSSFADE, duration / 2),
      };
      for (const axis of ["x", "y", "z"] as const) {
        values[`span_${axis}`] = span[axis];
        values[`min_${axis}`] = Math.max(-span[axis] / 2, plan.bounds.min[axis] - position[axis]);
        values[`max_${axis}`] = Math.min(span[axis] / 2, plan.bounds.max[axis] - position[axis]);
      }
      for (const [kind, amount, alpha] of [
        [corner ? "corner" : "marker", 1, 1],
        ["glow", corner ? 4 : 1, 0.8],
        ["crystal", corner ? 2 : 1, 0.8],
        ["dust", corner ? 2 : 0, 0.65],
      ] as const) {
        if (!amount) continue;
        spawn(`rbb:land_mote_${kind}`, position, this.withAlpha(palette.runePrimary, alpha), {
          ...values,
          count: amount,
        });
        sliceCount++;
      }
      return true;
    };
    for (const corner of plan.corners) {
      if (!alive()) return;
      if (boundaryPointDistance(corner, viewer) >= profile.distance) continue;
      if (!cluster(corner, true)) return;
    }
    // Reserve all eight corner clusters before planning a single common lattice.
    const samples = Math.max(0, Math.floor((outlineBudget - 72) / 3));
    for (const point of planBoundaryMarkers(plan, viewer, detail, samples, 1)) {
      if (!alive()) return;
      if (!cluster(point)) return;
      if (sliceCount >= AMBIENT_PARTICLES_PER_JOB_SLICE) {
        sliceCount = 0;
        yield;
      }
    }
    for (const panel of boundarySurfacePatches(plan.bounds, viewer, seed, profile.wallDistance, profile.maxPanels)) {
      if (!alive()) return;
      const count = detail === "low" ? 3 : detail === "balanced" ? 5 : 7;
      if (!patch(panel.position, panel.span, count, emphasis ? 0.16 : 0.1)) return;
      if (sliceCount >= AMBIENT_PARTICLES_PER_JOB_SLICE) {
        sliceCount = 0;
        yield;
      }
    }
  }

  private *iterLineParticles(
    player: Player,
    startPos: Vector3,
    endPos: Vector3,
    maxSteps: number,
    spacing: number = PARTICLE_SPACING
  ): Generator<Vector3, void, void> {
    const distance = Math.sqrt(
      Math.pow(endPos.x - startPos.x, 2) + Math.pow(endPos.y - startPos.y, 2) + Math.pow(endPos.z - startPos.z, 2)
    );

    if (distance === 0) {
      return;
    }

    let steps = Math.ceil(distance / spacing);
    if (steps > maxSteps) {
      steps = maxSteps;
    }
    if (steps < 1) {
      steps = 1;
    }

    const step = {
      x: (endPos.x - startPos.x) / steps,
      y: (endPos.y - startPos.y) / steps,
      z: (endPos.z - startPos.z) / steps,
    };

    for (let i = 0; i <= steps; i++) {
      const pos = {
        x: startPos.x + step.x * i,
        y: startPos.y + step.y * i,
        z: startPos.z + step.z * i,
      };

      if (isNaN(pos.x) || isNaN(pos.y) || isNaN(pos.z)) {
        player.sendMessage(color.red("错误：生成粒子时出现无效坐标"));
        return;
      }

      yield pos;
    }
  }

  private spawnBoundaryParticle(player: Player, pos: Vector3, stepIndex: number): void {
    this.spawnLandEdgeParticleSafe(
      player,
      {
        x: pos.x + 0.5,
        y: pos.y + 0.18,
        z: pos.z + 0.5,
      },
      { red: 0.14, green: 0.95, blue: 1, alpha: 0.52 }
    );

    if (stepIndex % 6 === 0) {
      this.spawnLandEdgeParticleSafe(
        player,
        {
          x: pos.x + 0.5,
          y: pos.y + 0.32,
          z: pos.z + 0.5,
        },
        { red: 0.78, green: 1, blue: 0.7, alpha: 0.44 }
      );
    }
  }

  private spawnOverlapBoundaryParticle(player: Player, pos: Vector3, stepIndex: number): void {
    if (stepIndex % 3 !== 0) return;
    this.spawnLandEdgeParticleSafe(
      player,
      {
        x: pos.x + 0.5,
        y: pos.y + 0.24,
        z: pos.z + 0.5,
      },
      { red: 1, green: 0.34, blue: 0.18, alpha: 0.54 }
    );
  }

  private spawnOverlapCornerParticles(player: Player, pos: Vector3): void {
    const center = { x: pos.x, y: pos.y, z: pos.z };
    this.spawnLandCornerParticleSafe(player, center, { red: 1, green: 0.32, blue: 0.16, alpha: 0.66 });
  }

  private withAlpha(color: RgbaColor, alpha: number): RgbaColor {
    return {
      red: color.red,
      green: color.green,
      blue: color.blue,
      alpha: Math.max(0, Math.min(1, alpha)),
    };
  }

  private spawnOverlapLandPulses(player: Player, overlaps: LandSelectionOverlapInfo[] | undefined): void {
    if (!overlaps?.length || !player.isValid) return;

    for (const overlap of overlaps.slice(0, 4)) {
      const plan = this.getAreaParticlePlan(overlap.start, overlap.end);
      for (const [edgeIndex, [start, end]] of plan.edges.entries()) {
        const t = ((system.currentTick % 60) / 60 + edgeIndex * 0.071) % 1;
        const pos = this.lerp(start, end, t);
        this.spawnLandEdgeParticleSafe(
          player,
          {
            x: pos.x + 0.5,
            y: pos.y + 0.26,
            z: pos.z + 0.5,
          },
          { red: 1, green: 0.28, blue: 0.16, alpha: 0.48 }
        );
      }
    }
  }

  private spawnMarkerParticles(player: Player, pos: Vector3): void {
    const center = { x: pos.x + 0.5, y: pos.y + 0.35, z: pos.z + 0.5 };
    this.spawnLandAnchorRingParticleSafe(player, center, { red: 0.82, green: 1, blue: 0.36, alpha: 0.72 });
    this.spawnLandCornerParticleSafe(
      player,
      { ...center, y: center.y + 0.34 },
      { red: 0.18, green: 0.95, blue: 1, alpha: 0.52 }
    );
  }

  private spawnParticleSafe(player: Player, particleType: string, pos: Vector3): void {
    try {
      player.spawnParticle(particleType, pos);
    } catch {
      // 忽略粒子生成错误
    }
  }

  private spawnColoredParticleSafe(player: Player, pos: Vector3, color: RgbaColor): void {
    try {
      player.spawnParticle("minecraft:colored_flame_particle", pos, this.getColorMolang(color));
    } catch {
      // 保持边界体系风格统一，不再回退到原版白色粒子。
    }
  }

  private spawnLandEdgeParticleSafe(player: Player, pos: Vector3, color: RgbaColor): void {
    this.spawnCustomColoredParticleSafe(player, "rbb:land_edge_dot", pos, color);
  }

  private spawnLandCornerParticleSafe(player: Player, pos: Vector3, color: RgbaColor): void {
    this.spawnCustomColoredParticleSafe(player, "rbb:land_corner_dot", pos, color);
  }

  private spawnLandAnchorRingParticleSafe(player: Player, pos: Vector3, color: RgbaColor): void {
    this.spawnCustomColoredParticleSafe(player, "rbb:land_anchor_ring", pos, color);
  }

  private spawnCustomColoredParticleSafe(player: Player, particleType: string, pos: Vector3, color: RgbaColor): void {
    try {
      player.spawnParticle(particleType, pos, this.getColorMolang(color));
    } catch {
      // 自定义资源包粒子不可用时静默失败，避免回退到原版白色粒子破坏统一风格。
    }
  }

  private getColorMolang(color: RgbaColor): MolangVariableMap {
    const key = `${color.red.toFixed(3)}:${color.green.toFixed(3)}:${color.blue.toFixed(3)}:${color.alpha.toFixed(3)}`;
    const cached = this.colorMolangCache.get(key);
    if (cached) return cached;

    const molang = new MolangVariableMap();
    molang.setColorRGBA("variable.color", color);
    this.colorMolangCache.set(key, molang);
    return molang;
  }

  private async tryCreateDebugMarker(player: Player, pos: Vector3, label: string = "领地点"): Promise<boolean> {
    if (!isDebugUtilitiesAvailable()) return false;
    const debug = await getDebugUtilities();
    if (!debug || !player.isValid) return false;

    try {
      const location = { x: pos.x + 0.5, y: pos.y + 0.65, z: pos.z + 0.5 };
      const sphere = new debug.DebugSphere(location);
      sphere.scale = 0.45;
      sphere.color = { red: 0.2, green: 1, blue: 0.65, alpha: 0.95 };
      sphere.visibleTo = [player];
      sphere.timeLeft = DEBUG_RENDER_TTL_SECONDS;

      const text = new debug.DebugText({ x: location.x, y: location.y + 0.75, z: location.z }, label);
      text.color = { red: 0.9, green: 1, blue: 1, alpha: 1 };
      text.backgroundColorOverride = { red: 0.02, green: 0.08, blue: 0.1, alpha: 0.55 };
      text.visibleTo = [player];
      text.timeLeft = DEBUG_RENDER_TTL_SECONDS;

      this.addDebugShapeGroup(this.getMarkerDebugKey(player, pos), [sphere, text], player);
      return true;
    } catch {
      return false;
    }
  }

  private async tryCreateDebugLine(player: Player, startPos: Vector3, endPos: Vector3): Promise<boolean> {
    if (!isDebugUtilitiesAvailable()) return false;
    const debug = await getDebugUtilities();
    if (!debug || !player.isValid) return false;

    try {
      const line = new debug.DebugLine(this.toBlockCenter(startPos), this.toBlockCenter(endPos));
      line.color = { red: 0.15, green: 0.85, blue: 1, alpha: 1 };
      line.visibleTo = [player];
      line.timeLeft = DEBUG_RENDER_TTL_SECONDS;
      this.addDebugShapeGroup(this.getLineDebugKey(player, startPos, endPos), [line], player);
      return true;
    } catch {
      return false;
    }
  }

  private async tryCreateDebugLandArea(player: Player, startPos: Vector3, endPos: Vector3): Promise<boolean> {
    if (!isDebugUtilitiesAvailable()) return false;
    const debug = await getDebugUtilities();
    if (!debug || !player.isValid) return false;

    try {
      const bounds = this.getBounds(startPos, endPos);
      const shapes: DebugShapeHandle[] = [];
      const box = new debug.DebugBox(bounds.center);
      box.bound = bounds.size;
      box.color = { red: 0.05, green: 0.75, blue: 1, alpha: 0.6 };
      box.visibleTo = [player];
      box.timeLeft = DEBUG_RENDER_TTL_SECONDS;
      box.maximumRenderDistance = 256;
      shapes.push(box);

      for (const [start, end] of this.getRenderEdges(bounds)) {
        const line = new debug.DebugLine(start, end);
        line.color = { red: 0.8, green: 1, blue: 0.35, alpha: 0.95 };
        line.visibleTo = [player];
        line.timeLeft = DEBUG_RENDER_TTL_SECONDS;
        line.maximumRenderDistance = 256;
        shapes.push(line);
      }

      for (const [start, end] of this.getGridLines(bounds)) {
        const line = new debug.DebugLine(this.toRenderPoint(start), this.toRenderPoint(end));
        line.color = { red: 0.35, green: 0.95, blue: 1, alpha: 0.42 };
        line.visibleTo = [player];
        line.timeLeft = DEBUG_RENDER_TTL_SECONDS;
        line.maximumRenderDistance = 256;
        shapes.push(line);
      }

      const centerBeam = new debug.DebugLine(
        { x: bounds.center.x, y: bounds.min.y + 0.5, z: bounds.center.z },
        { x: bounds.center.x, y: bounds.max.y + 0.5, z: bounds.center.z }
      );
      centerBeam.color = { red: 0.95, green: 1, blue: 0.45, alpha: 0.5 };
      centerBeam.visibleTo = [player];
      centerBeam.timeLeft = DEBUG_RENDER_TTL_SECONDS;
      centerBeam.maximumRenderDistance = 256;
      shapes.push(centerBeam);

      for (const corner of this.getRenderCorners(bounds)) {
        const sphere = new debug.DebugSphere(corner);
        sphere.scale = 0.42;
        sphere.color = { red: 1, green: 0.9, blue: 0.25, alpha: 1 };
        sphere.visibleTo = [player];
        sphere.timeLeft = DEBUG_RENDER_TTL_SECONDS;
        sphere.maximumRenderDistance = 256;
        shapes.push(sphere);
      }

      const text = new debug.DebugText(
        { x: bounds.center.x, y: bounds.max.y + 1.65, z: bounds.center.z },
        `领地范围 ${bounds.size.x}x${bounds.size.y}x${bounds.size.z}`
      );
      text.color = { red: 0.95, green: 1, blue: 1, alpha: 1 };
      text.backgroundColorOverride = { red: 0.02, green: 0.08, blue: 0.1, alpha: 0.58 };
      text.visibleTo = [player];
      text.timeLeft = DEBUG_RENDER_TTL_SECONDS;
      text.maximumRenderDistance = 256;
      shapes.push(text);

      this.addDebugShapeGroup(this.getAreaDebugKey(player, bounds), shapes, player);
      return true;
    } catch {
      return false;
    }
  }

  private async tryCreateDebugSelectionGuide(
    player: Player,
    guide: LandSelectionGuideInfo,
    startPos: Vector3,
    endPos: Vector3
  ): Promise<boolean> {
    if (!isDebugUtilitiesAvailable()) return false;
    const debug = await getDebugUtilities();
    if (!debug || !player.isValid) return false;

    try {
      const bounds = this.getBounds(startPos, endPos);
      const palette = this.getGuidePalette(guide.status);
      const shapes: DebugShapeHandle[] = [];

      const box = new debug.DebugBox(bounds.center);
      box.bound = bounds.size;
      box.color = palette.box;
      box.visibleTo = [player];
      box.timeLeft = DEBUG_RENDER_TTL_SECONDS;
      box.maximumRenderDistance = 256;
      shapes.push(box);

      for (const [edgeStart, edgeEnd] of this.getRenderEdges(bounds)) {
        const line = new debug.DebugLine(edgeStart, edgeEnd);
        line.color = palette.edge;
        line.visibleTo = [player];
        line.timeLeft = DEBUG_RENDER_TTL_SECONDS;
        line.maximumRenderDistance = 256;
        shapes.push(line);
      }

      for (const [gridStart, gridEnd] of this.getGridLines(bounds)) {
        const line = new debug.DebugLine(this.toRenderPoint(gridStart), this.toRenderPoint(gridEnd));
        line.color = palette.grid;
        line.visibleTo = [player];
        line.timeLeft = DEBUG_RENDER_TTL_SECONDS;
        line.maximumRenderDistance = 256;
        shapes.push(line);
      }

      const arrow = new debug.DebugArrow(this.toBlockCenter(startPos), this.toBlockCenter(endPos));
      arrow.color = palette.arrow;
      arrow.headLength = 0.8;
      arrow.headRadius = 0.28;
      arrow.visibleTo = [player];
      arrow.timeLeft = DEBUG_RENDER_TTL_SECONDS;
      arrow.maximumRenderDistance = 256;
      shapes.push(arrow);

      const startAnchor = new debug.DebugSphere(this.toBlockCenter(startPos));
      startAnchor.scale = 0.5;
      startAnchor.color = { red: 0.25, green: 1, blue: 0.7, alpha: 1 };
      startAnchor.visibleTo = [player];
      startAnchor.timeLeft = DEBUG_RENDER_TTL_SECONDS;
      startAnchor.maximumRenderDistance = 256;
      shapes.push(startAnchor);

      const endAnchor = new debug.DebugSphere(this.toBlockCenter(endPos));
      endAnchor.scale = guide.complete ? 0.52 : 0.4;
      endAnchor.color = guide.complete
        ? { red: 1, green: 0.92, blue: 0.28, alpha: 1 }
        : { red: 0.45, green: 0.9, blue: 1, alpha: 0.9 };
      endAnchor.visibleTo = [player];
      endAnchor.timeLeft = DEBUG_RENDER_TTL_SECONDS;
      endAnchor.maximumRenderDistance = 256;
      shapes.push(endAnchor);

      const label = new debug.DebugText(
        { x: bounds.center.x, y: bounds.max.y + 1.9, z: bounds.center.z },
        this.buildGuideDebugText(guide, bounds)
      );
      label.color = palette.text;
      label.backgroundColorOverride = { red: 0.02, green: 0.08, blue: 0.1, alpha: 0.65 };
      label.visibleTo = [player];
      label.timeLeft = DEBUG_RENDER_TTL_SECONDS;
      label.maximumRenderDistance = 256;
      shapes.push(label);

      for (const overlap of guide.overlaps?.slice(0, 4) ?? []) {
        const overlapBounds = this.getBounds(overlap.start, overlap.end);
        const overlapBox = new debug.DebugBox(overlapBounds.center);
        overlapBox.bound = overlapBounds.size;
        overlapBox.color = { red: 1, green: 0.2, blue: 0.08, alpha: 0.38 };
        overlapBox.visibleTo = [player];
        overlapBox.timeLeft = DEBUG_RENDER_TTL_SECONDS;
        overlapBox.maximumRenderDistance = 256;
        shapes.push(overlapBox);

        for (const [edgeStart, edgeEnd] of this.getRenderEdges(overlapBounds)) {
          const line = new debug.DebugLine(edgeStart, edgeEnd);
          line.color = { red: 1, green: 0.36, blue: 0.12, alpha: 1 };
          line.visibleTo = [player];
          line.timeLeft = DEBUG_RENDER_TTL_SECONDS;
          line.maximumRenderDistance = 256;
          shapes.push(line);
        }

        const overlapLabel = new debug.DebugText(
          { x: overlapBounds.center.x, y: overlapBounds.max.y + 1.25, z: overlapBounds.center.z },
          `重叠领地\n${overlap.name} / ${overlap.owner}`
        );
        overlapLabel.color = { red: 1, green: 0.68, blue: 0.52, alpha: 1 };
        overlapLabel.backgroundColorOverride = { red: 0.12, green: 0.02, blue: 0.01, alpha: 0.68 };
        overlapLabel.visibleTo = [player];
        overlapLabel.timeLeft = DEBUG_RENDER_TTL_SECONDS;
        overlapLabel.maximumRenderDistance = 256;
        shapes.push(overlapLabel);
      }

      this.addDebugShapeGroup(this.getSelectionGuideDebugKey(player), shapes, player);
      return true;
    } catch {
      return false;
    }
  }

  private spawnSelectionGuideBeacons(
    player: Player,
    startPos: Vector3,
    endPos: Vector3,
    guide: LandSelectionGuideInfo
  ): void {
    this.spawnGuideBeacon(player, this.toBlockCenter(startPos), "start");
    this.spawnGuideBeacon(player, this.toBlockCenter(endPos), guide.complete ? "end" : "preview");
  }

  private spawnGuideBeacon(player: Player, center: Vector3, kind: "start" | "preview" | "end"): void {
    const anchorColor =
      kind === "start"
        ? { red: 0.3, green: 1, blue: 0.72, alpha: 0.7 }
        : kind === "end"
          ? { red: 0.95, green: 1, blue: 0.42, alpha: 0.76 }
          : { red: 0.28, green: 0.82, blue: 1, alpha: 0.52 };
    const dotColor =
      kind === "end"
        ? { red: 1, green: 0.92, blue: 0.32, alpha: 0.64 }
        : { red: 0.3, green: 1, blue: 0.9, alpha: 0.52 };

    this.spawnLandAnchorRingParticleSafe(player, center, anchorColor);
    this.spawnLandCornerParticleSafe(player, { ...center, y: center.y + 0.34 }, dotColor);
  }

  private addDebugShapeGroup(key: string, shapes: DebugShapeHandle[], player: Player): void {
    const previous = this.debugShapeGroups.get(key);
    if (previous) {
      this.removeDebugShapeGroup(key);
    }

    void getDebugUtilities().then((debug) => {
      if (!debug || !player.isValid) return;
      try {
        for (const shape of shapes) {
          debug.debugDrawer.addShape(shape as never, player.dimension);
        }
      } catch {
        return;
      }

      const cleanupRunId = system.runTimeout(() => {
        const group = this.debugShapeGroups.get(key);
        if (!group || group.shapes !== shapes) return;
        group.shapes.forEach((shape) => {
          try {
            shape.remove();
          } catch {
            // 形状可能已经被调试绘制器自动移除。
          }
        });
        this.debugShapeGroups.delete(key);
      }, DEBUG_RENDER_TTL_TICKS);

      this.debugShapeGroups.set(key, { shapes, cleanupRunId });
    });
  }

  private removeDebugShapeGroup(key: string): void {
    const group = this.debugShapeGroups.get(key);
    if (!group) return;
    if (group.cleanupRunId !== undefined) {
      system.clearRun(group.cleanupRunId);
    }
    group.shapes.forEach((shape) => {
      try {
        shape.remove();
      } catch {
        // 形状可能已经被调试绘制器自动移除。
      }
    });
    this.debugShapeGroups.delete(key);
  }

  private getBounds(startPos: Vector3, endPos: Vector3): Bounds {
    const min = {
      x: Math.min(startPos.x, endPos.x),
      y: Math.min(startPos.y, endPos.y),
      z: Math.min(startPos.z, endPos.z),
    };
    const max = {
      x: Math.max(startPos.x, endPos.x),
      y: Math.max(startPos.y, endPos.y),
      z: Math.max(startPos.z, endPos.z),
    };
    const size = {
      x: max.x - min.x + 1,
      y: max.y - min.y + 1,
      z: max.z - min.z + 1,
    };
    return {
      min,
      max,
      size,
      center: {
        x: min.x + size.x / 2,
        y: min.y + size.y / 2,
        z: min.z + size.z / 2,
      },
    };
  }

  private getGuidePalette(status: LandSelectionGuideInfo["status"]) {
    if (status === "invalid") {
      return {
        box: { red: 1, green: 0.12, blue: 0.12, alpha: 0.42 },
        edge: { red: 1, green: 0.22, blue: 0.18, alpha: 0.95 },
        grid: { red: 1, green: 0.32, blue: 0.26, alpha: 0.32 },
        arrow: { red: 1, green: 0.45, blue: 0.25, alpha: 1 },
        text: { red: 1, green: 0.62, blue: 0.55, alpha: 1 },
      };
    }
    if (status === "warning") {
      return {
        box: { red: 1, green: 0.72, blue: 0.1, alpha: 0.38 },
        edge: { red: 1, green: 0.84, blue: 0.18, alpha: 0.95 },
        grid: { red: 1, green: 0.86, blue: 0.3, alpha: 0.32 },
        arrow: { red: 1, green: 0.92, blue: 0.35, alpha: 1 },
        text: { red: 1, green: 0.92, blue: 0.55, alpha: 1 },
      };
    }
    if (status === "valid") {
      return {
        box: { red: 0.08, green: 0.9, blue: 0.52, alpha: 0.38 },
        edge: { red: 0.2, green: 1, blue: 0.65, alpha: 0.98 },
        grid: { red: 0.35, green: 1, blue: 0.78, alpha: 0.34 },
        arrow: { red: 0.4, green: 1, blue: 0.85, alpha: 1 },
        text: { red: 0.82, green: 1, blue: 0.9, alpha: 1 },
      };
    }
    return {
      box: { red: 0.08, green: 0.56, blue: 1, alpha: 0.32 },
      edge: { red: 0.1, green: 0.78, blue: 1, alpha: 0.9 },
      grid: { red: 0.3, green: 0.86, blue: 1, alpha: 0.28 },
      arrow: { red: 0.38, green: 0.9, blue: 1, alpha: 0.95 },
      text: { red: 0.85, green: 0.96, blue: 1, alpha: 1 },
    };
  }

  private getAmbientPalette(seed: string, variant: AmbientBoundaryOptions["variant"] = "foreign"): AmbientPalette {
    const assigned = landBoundaryColors.get(seed);
    if (assigned) return { runePrimary: assigned };
    const tones: Record<AmbientBoundaryVariant, RgbaColor> = {
      owner: { red: 0.3, green: 0.82, blue: 1, alpha: 0.6 },
      trusted: { red: 0.36, green: 0.9, blue: 0.67, alpha: 0.6 },
      guild: { red: 0.95, green: 0.75, blue: 0.35, alpha: 0.6 },
      public: { red: 0.6, green: 0.76, blue: 0.88, alpha: 0.6 },
      foreign: { red: 0.95, green: 0.55, blue: 0.35, alpha: 0.6 },
      personal: { red: 0.3, green: 0.82, blue: 1, alpha: 0.6 },
    };
    const identities = [
      [0.22, 0.85, 1],
      [0.65, 0.42, 1],
      [0.32, 0.75, 1],
      [0.42, 0.9, 1],
      [0.6, 0.55, 1],
      [0.3, 0.55, 1],
      [0.5, 0.68, 1],
      [0.52, 0.82, 1],
    ];
    const identity = identities[(this.hashString(seed) >>> 0) % identities.length];
    const base = tones[variant];
    return {
      runePrimary: {
        red: identity[0] * 0.9 + base.red * 0.1,
        green: identity[1] * 0.9 + base.green * 0.1,
        blue: identity[2] * 0.9 + base.blue * 0.1,
        alpha: base.alpha,
      },
    };
  }

  private hashString(value: string): number {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
      hash = (hash << 5) - hash + value.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }

  private buildGuideDebugText(guide: LandSelectionGuideInfo, bounds: Bounds): string {
    const parts = [guide.complete ? "领地预览" : "圈地引导", `${bounds.size.x}x${bounds.size.y}x${bounds.size.z}`];
    if (typeof guide.blockCount === "number") {
      parts.push(`${guide.blockCount}格`);
    }
    if (typeof guide.cost === "number") {
      parts.push(`${guide.cost}金币`);
    }
    return `${parts.join("  ")}\n${guide.hint}`;
  }

  private getRenderCorners(bounds: Bounds): Vector3[] {
    const min = { x: bounds.min.x + 0.5, y: bounds.min.y + 0.5, z: bounds.min.z + 0.5 };
    const max = { x: bounds.max.x + 0.5, y: bounds.max.y + 0.5, z: bounds.max.z + 0.5 };
    if (bounds.min.y === bounds.max.y) {
      return [
        { x: min.x, y: min.y, z: min.z },
        { x: max.x, y: min.y, z: min.z },
        { x: min.x, y: min.y, z: max.z },
        { x: max.x, y: min.y, z: max.z },
      ];
    }
    return [
      { x: min.x, y: min.y, z: min.z },
      { x: max.x, y: min.y, z: min.z },
      { x: min.x, y: max.y, z: min.z },
      { x: max.x, y: max.y, z: min.z },
      { x: min.x, y: min.y, z: max.z },
      { x: max.x, y: min.y, z: max.z },
      { x: min.x, y: max.y, z: max.z },
      { x: max.x, y: max.y, z: max.z },
    ];
  }

  private getGridLines(bounds: Bounds): Edge[] {
    const lines: Edge[] = [];
    const yLevels = bounds.min.y === bounds.max.y ? [bounds.min.y] : [bounds.min.y, bounds.max.y];
    const xLines = this.getGridCoordinates(bounds.min.x, bounds.max.x);
    const zLines = this.getGridCoordinates(bounds.min.z, bounds.max.z);

    for (const y of yLevels) {
      for (const x of xLines) {
        lines.push([
          { x, y, z: bounds.min.z },
          { x, y, z: bounds.max.z },
        ]);
      }

      for (const z of zLines) {
        lines.push([
          { x: bounds.min.x, y, z },
          { x: bounds.max.x, y, z },
        ]);
      }
    }

    return lines.slice(0, MAX_GRID_LINES_PER_AXIS * 4);
  }

  private getGridCoordinates(min: number, max: number): number[] {
    const length = max - min + 1;
    if (length < 6) return [];
    const count = Math.min(MAX_GRID_LINES_PER_AXIS, Math.floor(length / 8) + 1);
    const coords: number[] = [];
    for (let i = 1; i <= count; i++) {
      coords.push(min + (length * i) / (count + 1) - 0.5);
    }
    return coords;
  }

  private getRenderEdges(bounds: Bounds): Edge[] {
    const corners = this.getRenderCorners(bounds);
    if (corners.length === 4) {
      return [
        [corners[0], corners[1]],
        [corners[1], corners[3]],
        [corners[3], corners[2]],
        [corners[2], corners[0]],
      ];
    }
    return [
      [corners[0], corners[1]],
      [corners[1], corners[3]],
      [corners[3], corners[2]],
      [corners[2], corners[0]],
      [corners[4], corners[5]],
      [corners[5], corners[7]],
      [corners[7], corners[6]],
      [corners[6], corners[4]],
      [corners[0], corners[4]],
      [corners[1], corners[5]],
      [corners[2], corners[6]],
      [corners[3], corners[7]],
    ];
  }

  private toRenderPoint(pos: Vector3): Vector3 {
    return { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 };
  }

  private toBlockCenter(pos: Vector3): Vector3 {
    return { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 };
  }

  private lerp(start: Vector3, end: Vector3, t: number): Vector3 {
    return {
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
      z: start.z + (end.z - start.z) * t,
    };
  }

  private getAreaDebugKey(player: Player, bounds: Bounds): string {
    return [
      "area",
      player.id,
      player.dimension.id,
      bounds.min.x,
      bounds.min.y,
      bounds.min.z,
      bounds.max.x,
      bounds.max.y,
      bounds.max.z,
    ].join(":");
  }

  private getMarkerDebugKey(player: Player, pos: Vector3): string {
    return ["marker", player.id, player.dimension.id, pos.x, pos.y, pos.z].join(":");
  }

  private getLineDebugKey(player: Player, startPos: Vector3, endPos: Vector3): string {
    return [
      "line",
      player.id,
      player.dimension.id,
      startPos.x,
      startPos.y,
      startPos.z,
      endPos.x,
      endPos.y,
      endPos.z,
    ].join(":");
  }

  private getSelectionGuideDebugKey(player: Player): string {
    return ["selection-guide", player.id, player.dimension.id].join(":");
  }

  /**
   * 计算区域方块数量
   */
  getAreaBlocks(startPos: Vector3, endPos: Vector3): number {
    const x = Math.abs(startPos.x - endPos.x) + 1;
    const y = Math.abs(startPos.y - endPos.y) + 1;
    const z = Math.abs(startPos.z - endPos.z) + 1;
    return x * y * z;
  }
}

export default new LandParticle();
