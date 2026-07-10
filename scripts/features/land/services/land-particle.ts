/**
 * 领地粒子效果服务
 * 完整迁移自 Modules/Particle.ts
 */

import { MolangVariableMap, Player, system, Vector3 } from "@minecraft/server";
import { color } from "../../../shared/utils/color";
import { getDebugUtilities, isDebugUtilitiesAvailable } from "../../platform/sapi-capabilities";

/** 预览粒子间距（方块距离 / 步数）。保持轮廓可读，同时避免移动预览时糊屏。 */
const PARTICLE_SPACING = 2.8;
const ACCENT_PARTICLE_SPACING = 8;
/** 单次 runJob 时间片内最多生成的粒子数，避免单 tick 过重触发 Watchdog */
const PARTICLES_PER_JOB_SLICE = 72;
/** 单条边上采样步数上限（含端点共 steps+1 个粒子）；过大领地防止刷爆脚本 */
const MAX_STEPS_PER_LINE = 512;
/** 单次 createLandParticleArea 粒子总数上限（跨所有边） */
/** 12 条边 × (MAX_STEPS_PER_LINE+1) 端点粒子时的上界约 6156，略留余量 */
const MAX_PARTICLES_PER_AREA_CALL = 6200;
const DEBUG_RENDER_TTL_TICKS = 120;
const DEBUG_RENDER_TTL_SECONDS = DEBUG_RENDER_TTL_TICKS / 20;
const PULSE_PARTICLES_PER_EDGE = 1;
const MAX_GRID_LINES_PER_AXIS = 4;
const AMBIENT_EDGE_SPACING = 1.55;
const AMBIENT_GROUND_SPACING = 0.9;
const AMBIENT_WALL_SPACING = 2.8;
const AMBIENT_SCAN_STREAKS_PER_EDGE = 3;
const AMBIENT_SCAN_TRAIL_PARTICLES = 4;
const AMBIENT_MAX_STEPS_PER_LINE = 320;
const AMBIENT_MAX_PARTICLES_PER_AREA_CALL = 3600;
const AMBIENT_PARTICLES_PER_JOB_SLICE = 64;
const AMBIENT_BOTTOM_LAYER_OFFSET = 0.16;
const AMBIENT_TOP_LAYER_OFFSET = 0.58;
const AMBIENT_CORNER_MARKER_SPACING = 5.5;
const AMBIENT_CORNER_MARKER_MIN_PARTICLES = 5;
const AMBIENT_CORNER_MARKER_MAX_PARTICLES = 18;
const AMBIENT_WALL_HEIGHT = 2.05;
const AMBIENT_WALL_LAYERS = 2;
const AMBIENT_FOUNDATION_MARKER_INTERVAL = 4;

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
  accents: Edge[];
  corners: Vector3[];
}

interface AmbientBoundaryOptions {
  seed?: string;
  variant?: AmbientBoundaryVariant;
  detail?: "low" | "balanced" | "high";
}

interface AmbientPalette {
  edge: RgbaColor;
  flow: RgbaColor;
  corner: RgbaColor;
  height: RgbaColor;
  ground: RgbaColor;
  wall: RgbaColor;
  scan: RgbaColor;
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
    system.run(() => {
      if (!player.isValid) {
        return;
      }
      const startPos = pos[0];
      const endPos = pos[1];
      const plan = this.getAreaParticlePlan(startPos, endPos);
      if (plan.edges.length === 0) {
        return;
      }
      void this.tryCreateDebugLandArea(player, startPos, endPos).then((rendered) => {
        this.spawnAreaPulse(player, plan.bounds, plan.edges);
        if (!rendered) {
          system.runJob(this.areaParticleGenerator(player, plan));
        }
      });
    });
  }

  /**
   * 常显领地边界：地面霓虹带 + 低矮能量墙 + 扫描光。
   */
  createLandAmbientBoundary(player: Player, pos: Vector3[], options: AmbientBoundaryOptions = {}): void {
    system.run(() => {
      if (!player.isValid) {
        return;
      }
      const startPos = pos[0];
      const endPos = pos[1];
      const bounds = this.getBounds(startPos, endPos);
      const bottomY = bounds.min.y + AMBIENT_BOTTOM_LAYER_OFFSET;
      const topY = bounds.max.y + (bounds.max.y > bounds.min.y ? AMBIENT_TOP_LAYER_OFFSET : 0.34);
      const bottomEdges = this.getFootprintEdgesAtY(bounds, bottomY);
      const topEdges = this.getFootprintEdgesAtY(bounds, topY);
      const verticalEdges = this.getVerticalEdges(bounds, bottomY, topY);
      const detail = options.detail ?? "balanced";
      const visibleTopEdges = detail === "low" ? [] : topEdges;
      const visibleVerticalEdges = detail === "low" ? [] : verticalEdges;
      const frameEdges = [...bottomEdges, ...visibleTopEdges, ...visibleVerticalEdges];
      if (frameEdges.length === 0) {
        return;
      }

      const palette = this.getAmbientPalette(options.seed ?? `${startPos.x}:${startPos.z}:${endPos.x}:${endPos.z}`, options.variant);
      if (detail !== "low") this.spawnAmbientCornerMarkers(player, bounds, bottomY, topY, palette);
      system.runJob(
        this.ambientBoundaryGenerator(player, bottomEdges, visibleTopEdges, visibleVerticalEdges, palette, detail)
      );
    });
  }

  /**
   * 常显边界的高频扫描层。单独调度，避免扫描光跟随主边界刷新而跳帧。
   */
  createLandAmbientBoundaryScan(player: Player, pos: Vector3[], options: AmbientBoundaryOptions = {}): void {
    system.run(() => {
      if (!player.isValid) {
        return;
      }
      const startPos = pos[0];
      const endPos = pos[1];
      const bounds = this.getBounds(startPos, endPos);
      const bottomY = bounds.min.y + AMBIENT_BOTTOM_LAYER_OFFSET;
      const bottomEdges = this.getFootprintEdgesAtY(bounds, bottomY);
      if (bottomEdges.length === 0) {
        return;
      }

      const seed = options.seed ?? `${startPos.x}:${startPos.z}:${endPos.x}:${endPos.z}`;
      const palette = this.getAmbientPalette(seed, options.variant);
      this.spawnAmbientScanSparks(player, bottomEdges, palette, seed);
    });
  }

  createLandAmbientBoundaryBurst(player: Player, pos: Vector3[], options: AmbientBoundaryOptions = {}): void {
    this.createLandAmbientBoundary(player, pos, options);
    this.createLandAmbientBoundaryScan(player, pos, options);
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
        const plan = this.getAreaParticlePlan(guide.start, endPos);
        void this.tryCreateDebugSelectionGuide(player, guide, guide.start, endPos).then((rendered) => {
          this.spawnAreaPulse(player, plan.bounds, plan.edges);
          this.spawnSelectionGuideBeacons(player, guide.start!, endPos, guide);
          this.spawnOverlapLandPulses(player, guide.overlaps);
          if (!rendered) {
            system.runJob(this.areaParticleGenerator(player, plan));
            system.runJob(this.overlapParticleGenerator(player, guide.overlaps));
          }
        });
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
      accents: this.getGridLines(bounds),
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

  private *areaParticleGenerator(player: Player, plan: AreaParticlePlan): Generator<void, void, void> {
    let spawnedTotal = 0;
    let sliceCount = 0;

    for (const corner of plan.corners) {
      if (spawnedTotal >= MAX_PARTICLES_PER_AREA_CALL || !player.isValid) return;
      this.spawnCornerAnchorParticles(player, corner);
      spawnedTotal += 5;
      sliceCount += 5;
      if (sliceCount >= PARTICLES_PER_JOB_SLICE) {
        sliceCount = 0;
        yield;
      }
    }

    for (const [startPos, endPos] of plan.edges) {
      let edgeStep = 0;
      for (const particle of this.iterLineParticles(player, startPos, endPos, MAX_STEPS_PER_LINE)) {
        if (spawnedTotal >= MAX_PARTICLES_PER_AREA_CALL) {
          return;
        }
        if (!player.isValid) {
          return;
        }
        this.spawnBoundaryParticle(player, particle, edgeStep);
        spawnedTotal++;
        sliceCount++;
        edgeStep++;
        if (sliceCount >= PARTICLES_PER_JOB_SLICE) {
          sliceCount = 0;
          yield;
        }
      }
    }

    for (const [startPos, endPos] of plan.accents) {
      let accentStep = 0;
      for (const particle of this.iterLineParticles(player, startPos, endPos, 96, ACCENT_PARTICLE_SPACING)) {
        if (spawnedTotal >= MAX_PARTICLES_PER_AREA_CALL) {
          return;
        }
        if (!player.isValid) {
          return;
        }
        this.spawnAccentParticle(player, particle, accentStep);
        spawnedTotal++;
        sliceCount++;
        accentStep++;
        if (sliceCount >= PARTICLES_PER_JOB_SLICE) {
          sliceCount = 0;
          yield;
        }
      }
    }
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
    bottomEdges: Edge[],
    topEdges: Edge[],
    verticalEdges: Edge[],
    palette: AmbientPalette,
    detail: "low" | "balanced" | "high"
  ): Generator<void, void, void> {
    let spawnedTotal = 0;
    let sliceCount = 0;

    const wallLayers = detail === "high" ? AMBIENT_WALL_LAYERS : detail === "balanced" ? 1 : 0;
    for (const [startPos, endPos] of bottomEdges) {
      let edgeStep = 0;
      for (const particle of this.iterLineParticles(
        player,
        startPos,
        endPos,
        AMBIENT_MAX_STEPS_PER_LINE,
        AMBIENT_GROUND_SPACING
      )) {
        if (!player.isValid || spawnedTotal >= AMBIENT_MAX_PARTICLES_PER_AREA_CALL) {
          return;
        }
        this.spawnAmbientGroundParticle(player, particle, edgeStep, palette);
        spawnedTotal++;
        sliceCount++;
        edgeStep++;
        if (sliceCount >= AMBIENT_PARTICLES_PER_JOB_SLICE) {
          sliceCount = 0;
          yield;
        }
      }
    }

    for (const edge of [...bottomEdges, ...topEdges, ...verticalEdges]) {
      let edgeStep = 0;
      for (const particle of this.iterLineParticles(
        player,
        edge[0],
        edge[1],
        AMBIENT_MAX_STEPS_PER_LINE,
        AMBIENT_EDGE_SPACING
      )) {
        if (!player.isValid || spawnedTotal >= AMBIENT_MAX_PARTICLES_PER_AREA_CALL) {
          return;
        }
        this.spawnAmbientBoundaryParticle(player, particle, edgeStep, palette);
        spawnedTotal++;
        sliceCount++;
        edgeStep++;
        if (sliceCount >= AMBIENT_PARTICLES_PER_JOB_SLICE) {
          sliceCount = 0;
          yield;
        }
      }
    }

    for (const [startPos, endPos] of bottomEdges) {
      let edgeStep = 0;
      for (const particle of this.iterLineParticles(
        player,
        startPos,
        endPos,
        AMBIENT_MAX_STEPS_PER_LINE,
        AMBIENT_WALL_SPACING
      )) {
        for (let layer = 0; layer < wallLayers; layer++) {
          if (!player.isValid || spawnedTotal >= AMBIENT_MAX_PARTICLES_PER_AREA_CALL) {
            return;
          }
          this.spawnAmbientWallParticle(player, particle, edgeStep, layer, palette);
          spawnedTotal++;
          sliceCount++;
          if (sliceCount >= AMBIENT_PARTICLES_PER_JOB_SLICE) {
            sliceCount = 0;
            yield;
          }
        }
        edgeStep++;
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
    this.spawnLandEdgeParticleSafe(player, {
      x: pos.x + 0.5,
      y: pos.y + 0.18,
      z: pos.z + 0.5,
    }, { red: 0.14, green: 0.95, blue: 1, alpha: 0.52 });

    if (stepIndex % 6 === 0) {
      this.spawnLandEdgeParticleSafe(player, {
        x: pos.x + 0.5,
        y: pos.y + 0.32,
        z: pos.z + 0.5,
      }, { red: 0.78, green: 1, blue: 0.7, alpha: 0.44 });
    }
  }

  private spawnAccentParticle(player: Player, pos: Vector3, stepIndex: number): void {
    if (stepIndex % 3 !== 0) return;
    this.spawnLandEdgeParticleSafe(player, {
      x: pos.x + 0.5,
      y: pos.y + 0.14,
      z: pos.z + 0.5,
    }, { red: 0.46, green: 1, blue: 0.88, alpha: 0.22 });
  }

  private spawnCornerAnchorParticles(player: Player, pos: Vector3): void {
    const center = { x: pos.x, y: pos.y, z: pos.z };
    this.spawnLandAnchorRingParticleSafe(player, center, { red: 0.84, green: 1, blue: 0.42, alpha: 0.68 });
    this.spawnLandCornerParticleSafe(player, { ...center, y: center.y + 0.34 }, { red: 0.26, green: 1, blue: 0.86, alpha: 0.58 });
  }

  private spawnOverlapBoundaryParticle(player: Player, pos: Vector3, stepIndex: number): void {
    if (stepIndex % 3 !== 0) return;
    this.spawnLandEdgeParticleSafe(player, {
      x: pos.x + 0.5,
      y: pos.y + 0.24,
      z: pos.z + 0.5,
    }, { red: 1, green: 0.34, blue: 0.18, alpha: 0.54 });
  }

  private spawnOverlapCornerParticles(player: Player, pos: Vector3): void {
    const center = { x: pos.x, y: pos.y, z: pos.z };
    this.spawnLandCornerParticleSafe(player, center, { red: 1, green: 0.32, blue: 0.16, alpha: 0.66 });
  }

  private spawnAmbientBoundaryParticle(player: Player, pos: Vector3, stepIndex: number, palette: AmbientPalette): void {
    const pulse = this.getAmbientPulse(stepIndex);
    const base = {
      x: pos.x + 0.5,
      y: pos.y + 0.18,
      z: pos.z + 0.5,
    };
    this.spawnLandEdgeParticleSafe(player, base, this.withAlpha(palette.edge, palette.edge.alpha * pulse));

    if ((stepIndex + Math.floor(system.currentTick / 5)) % 5 === 0) {
      this.spawnLandEdgeParticleSafe(player, { ...base, y: base.y + 0.14 }, this.withAlpha(palette.flow, palette.flow.alpha * 1.08));
    }
  }

  private spawnAmbientGroundParticle(player: Player, pos: Vector3, stepIndex: number, palette: AmbientPalette): void {
    const pulse = this.getAmbientPulse(stepIndex + 11);
    const base = {
      x: pos.x + 0.5,
      y: pos.y + 0.075,
      z: pos.z + 0.5,
    };
    this.spawnCustomColoredParticleSafe(player, "rbb:land_ground_band", base, this.withAlpha(palette.ground, palette.ground.alpha * (0.98 + pulse * 0.18)));

    const markerPhase = Math.floor(system.currentTick / 8) % AMBIENT_FOUNDATION_MARKER_INTERVAL;
    if (stepIndex % AMBIENT_FOUNDATION_MARKER_INTERVAL === markerPhase) {
      this.spawnLandEdgeParticleSafe(player, { ...base, y: base.y + 0.2 }, this.withAlpha(palette.flow, palette.flow.alpha * 0.72));
    }
  }

  private spawnAmbientWallParticle(
    player: Player,
    pos: Vector3,
    stepIndex: number,
    layerIndex: number,
    palette: AmbientPalette
  ): void {
    const t = (layerIndex + 1) / (AMBIENT_WALL_LAYERS + 1);
    const alpha = palette.wall.alpha * (0.72 - t * 0.24) * this.getAmbientPulse(stepIndex + layerIndex * 9);
    this.spawnCustomColoredParticleSafe(player, "rbb:land_wall_panel", {
      x: pos.x + 0.5,
      y: pos.y + 0.18 + AMBIENT_WALL_HEIGHT * t,
      z: pos.z + 0.5,
    }, this.withAlpha(palette.wall, alpha));
  }

  private spawnAmbientScanSparks(player: Player, edges: Edge[], palette: AmbientPalette, seed: string): void {
    const tickOffset = ((system.currentTick + Math.abs(this.hashString(seed)) % 96) % 96) / 96;
    for (const [edgeIndex, edge] of edges.entries()) {
      for (let i = 0; i < AMBIENT_SCAN_STREAKS_PER_EDGE; i++) {
        const headT = (tickOffset + i / AMBIENT_SCAN_STREAKS_PER_EDGE + edgeIndex * 0.041) % 1;
        for (let trail = 0; trail < AMBIENT_SCAN_TRAIL_PARTICLES; trail++) {
          const trailT = (headT - trail * 0.048 + 1) % 1;
          const pos = this.lerp(edge[0], edge[1], trailT);
          const fade = 1 - trail / (AMBIENT_SCAN_TRAIL_PARTICLES + 0.6);
          const lift = 0.42 + Math.sin((system.currentTick + trail * 3 + edgeIndex * 7) / 8) * 0.04;
          const particleType = trail === 0 || trail === 1 ? "rbb:land_scan_streak" : "rbb:land_scan_spark";
          this.spawnCustomColoredParticleSafe(player, particleType, {
            x: pos.x + 0.5,
            y: pos.y + lift,
            z: pos.z + 0.5,
          }, this.withAlpha(palette.scan, palette.scan.alpha * fade * fade));
          if (trail === 0) {
            this.spawnLandEdgeParticleSafe(player, {
              x: pos.x + 0.5,
              y: pos.y + 0.22,
              z: pos.z + 0.5,
            }, this.withAlpha(palette.flow, palette.flow.alpha * 0.82));
          }
        }
      }
    }
  }

  private spawnAmbientCornerMarkers(player: Player, bounds: Bounds, bottomY: number, topY: number, palette: AmbientPalette): void {
    const corners = this.getFootprintCorners(bounds);
    const markerCount = this.getAmbientCornerMarkerCount(topY - bottomY);

    for (const corner of corners) {
      const bottom = { x: corner.x + 0.5, y: bottomY + 0.08, z: corner.z + 0.5 };
      const top = { x: corner.x + 0.5, y: topY, z: corner.z + 0.5 };

      this.spawnLandAnchorRingParticleSafe(player, bottom, palette.corner);
      this.spawnLandAnchorRingParticleSafe(player, top, palette.height);

      for (let i = 0; i < markerCount; i++) {
        const t = markerCount === 1 ? 0 : i / (markerCount - 1);
        const color = this.mixColor(palette.corner, palette.height, t);
        const pulse = this.getAmbientPulse(i * 5);
        this.spawnLandCornerParticleSafe(player, {
          x: bottom.x,
          y: bottom.y + (top.y - bottom.y) * t,
          z: bottom.z,
        }, this.withAlpha(color, color.alpha * (0.68 + pulse * 0.2)));
      }
    }
  }

  private getAmbientCornerMarkerCount(height: number): number {
    const adaptiveCount = Math.ceil(Math.max(0, height) / AMBIENT_CORNER_MARKER_SPACING) + 1;
    return Math.max(
      AMBIENT_CORNER_MARKER_MIN_PARTICLES,
      Math.min(AMBIENT_CORNER_MARKER_MAX_PARTICLES, adaptiveCount)
    );
  }

  private getAmbientPulse(offset: number): number {
    return 0.78 + Math.sin((system.currentTick + offset) / 7) * 0.22;
  }

  private mixColor(from: RgbaColor, to: RgbaColor, t: number): RgbaColor {
    const clamped = Math.max(0, Math.min(1, t));
    return {
      red: from.red + (to.red - from.red) * clamped,
      green: from.green + (to.green - from.green) * clamped,
      blue: from.blue + (to.blue - from.blue) * clamped,
      alpha: from.alpha + (to.alpha - from.alpha) * clamped,
    };
  }

  private withAlpha(color: RgbaColor, alpha: number): RgbaColor {
    return {
      red: color.red,
      green: color.green,
      blue: color.blue,
      alpha: Math.max(0, Math.min(1, alpha)),
    };
  }

  private spawnAreaPulse(player: Player, bounds: Bounds, edges: Edge[]): void {
    if (!player.isValid) return;
    const tickOffset = (system.currentTick % 120) / 120;

    for (const [edgeIndex, [start, end]] of edges.entries()) {
      for (let i = 0; i < PULSE_PARTICLES_PER_EDGE; i++) {
        const t = (tickOffset + i / PULSE_PARTICLES_PER_EDGE + edgeIndex * 0.037) % 1;
        const pos = this.lerp(start, end, t);
        this.spawnLandEdgeParticleSafe(player, {
          x: pos.x + 0.5,
          y: pos.y + 0.28,
          z: pos.z + 0.5,
        }, { red: 0.7, green: 1, blue: 0.82, alpha: 0.5 });
      }
    }

    this.spawnLandCornerParticleSafe(player, {
      x: bounds.center.x,
      y: bounds.min.y + 0.38,
      z: bounds.center.z,
    }, { red: 0.22, green: 0.9, blue: 1, alpha: 0.34 });
  }

  private spawnOverlapLandPulses(player: Player, overlaps: LandSelectionOverlapInfo[] | undefined): void {
    if (!overlaps?.length || !player.isValid) return;

    for (const overlap of overlaps.slice(0, 4)) {
      const plan = this.getAreaParticlePlan(overlap.start, overlap.end);
      for (const [edgeIndex, [start, end]] of plan.edges.entries()) {
        const t = ((system.currentTick % 60) / 60 + edgeIndex * 0.071) % 1;
        const pos = this.lerp(start, end, t);
        this.spawnLandEdgeParticleSafe(player, {
          x: pos.x + 0.5,
          y: pos.y + 0.26,
          z: pos.z + 0.5,
        }, { red: 1, green: 0.28, blue: 0.16, alpha: 0.48 });
      }
    }
  }

  private spawnMarkerParticles(player: Player, pos: Vector3): void {
    const center = { x: pos.x + 0.5, y: pos.y + 0.35, z: pos.z + 0.5 };
    this.spawnLandAnchorRingParticleSafe(player, center, { red: 0.82, green: 1, blue: 0.36, alpha: 0.72 });
    this.spawnLandCornerParticleSafe(player, { ...center, y: center.y + 0.34 }, { red: 0.18, green: 0.95, blue: 1, alpha: 0.52 });
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

  private getAmbientPalette(_seed: string, variant: AmbientBoundaryOptions["variant"] = "foreign"): AmbientPalette {
    const palettes: Record<AmbientBoundaryVariant, AmbientPalette> = {
      owner: {
        edge: { red: 0.1, green: 0.95, blue: 1, alpha: 0.78 },
        flow: { red: 0.75, green: 1, blue: 0.92, alpha: 0.78 },
        corner: { red: 0.95, green: 1, blue: 0.42, alpha: 0.98 },
        height: { red: 0.28, green: 0.95, blue: 1, alpha: 0.68 },
        ground: { red: 0.05, green: 0.8, blue: 1, alpha: 0.76 },
        wall: { red: 0.05, green: 0.9, blue: 1, alpha: 0.34 },
        scan: { red: 0.9, green: 1, blue: 0.62, alpha: 1 },
      },
      trusted: {
        edge: { red: 0.32, green: 1, blue: 0.58, alpha: 0.74 },
        flow: { red: 0.78, green: 1, blue: 0.48, alpha: 0.74 },
        corner: { red: 0.74, green: 1, blue: 0.3, alpha: 0.92 },
        height: { red: 0.42, green: 1, blue: 0.72, alpha: 0.62 },
        ground: { red: 0.16, green: 0.95, blue: 0.5, alpha: 0.72 },
        wall: { red: 0.12, green: 0.9, blue: 0.45, alpha: 0.3 },
        scan: { red: 0.92, green: 1, blue: 0.48, alpha: 0.94 },
      },
      guild: {
        edge: { red: 0.16, green: 0.74, blue: 1, alpha: 0.78 },
        flow: { red: 1, green: 0.84, blue: 0.2, alpha: 0.82 },
        corner: { red: 1, green: 0.74, blue: 0.18, alpha: 1 },
        height: { red: 0.28, green: 0.92, blue: 1, alpha: 0.66 },
        ground: { red: 0.08, green: 0.62, blue: 1, alpha: 0.76 },
        wall: { red: 0.08, green: 0.68, blue: 1, alpha: 0.34 },
        scan: { red: 1, green: 0.9, blue: 0.25, alpha: 1 },
      },
      public: {
        edge: { red: 0.7, green: 0.86, blue: 1, alpha: 0.7 },
        flow: { red: 0.96, green: 0.94, blue: 1, alpha: 0.7 },
        corner: { red: 0.9, green: 0.94, blue: 1, alpha: 0.86 },
        height: { red: 0.7, green: 0.86, blue: 1, alpha: 0.56 },
        ground: { red: 0.45, green: 0.7, blue: 1, alpha: 0.68 },
        wall: { red: 0.42, green: 0.68, blue: 1, alpha: 0.28 },
        scan: { red: 0.96, green: 0.98, blue: 1, alpha: 0.88 },
      },
      foreign: {
        edge: { red: 1, green: 0.46, blue: 0.24, alpha: 0.76 },
        flow: { red: 1, green: 0.8, blue: 0.26, alpha: 0.76 },
        corner: { red: 1, green: 0.28, blue: 0.18, alpha: 0.96 },
        height: { red: 1, green: 0.56, blue: 0.24, alpha: 0.64 },
        ground: { red: 1, green: 0.28, blue: 0.14, alpha: 0.74 },
        wall: { red: 1, green: 0.22, blue: 0.12, alpha: 0.32 },
        scan: { red: 1, green: 0.74, blue: 0.22, alpha: 0.96 },
      },
      personal: {
        edge: { red: 0.1, green: 0.88, blue: 1, alpha: 0.74 },
        flow: { red: 0.58, green: 1, blue: 0.82, alpha: 0.74 },
        corner: { red: 0.88, green: 1, blue: 0.42, alpha: 0.92 },
        height: { red: 0.35, green: 0.92, blue: 1, alpha: 0.6 },
        ground: { red: 0.05, green: 0.72, blue: 1, alpha: 0.72 },
        wall: { red: 0.06, green: 0.78, blue: 1, alpha: 0.3 },
        scan: { red: 0.82, green: 1, blue: 0.56, alpha: 0.92 },
      },
    };

    return palettes[variant];
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

  private getFootprintCorners(bounds: Bounds): Vector3[] {
    const y = bounds.min.y;
    return [
      { x: bounds.min.x, y, z: bounds.min.z },
      { x: bounds.max.x, y, z: bounds.min.z },
      { x: bounds.min.x, y, z: bounds.max.z },
      { x: bounds.max.x, y, z: bounds.max.z },
    ];
  }

  private getFootprintEdges(bounds: Bounds): Edge[] {
    return this.getFootprintEdgesAtY(bounds, bounds.min.y);
  }

  private getFootprintEdgesAtY(bounds: Bounds, y: number): Edge[] {
    const corners = this.getFootprintCorners(bounds);
    return [
      [
        { x: corners[0].x, y, z: corners[0].z },
        { x: corners[1].x, y, z: corners[1].z },
      ],
      [
        { x: corners[1].x, y, z: corners[1].z },
        { x: corners[3].x, y, z: corners[3].z },
      ],
      [
        { x: corners[3].x, y, z: corners[3].z },
        { x: corners[2].x, y, z: corners[2].z },
      ],
      [
        { x: corners[2].x, y, z: corners[2].z },
        { x: corners[0].x, y, z: corners[0].z },
      ],
    ];
  }

  private getVerticalEdges(bounds: Bounds, bottomY: number, topY: number): Edge[] {
    const corners = this.getFootprintCorners(bounds);
    return [
      [
        { x: corners[0].x, y: bottomY, z: corners[0].z },
        { x: corners[0].x, y: topY, z: corners[0].z },
      ],
      [
        { x: corners[1].x, y: bottomY, z: corners[1].z },
        { x: corners[1].x, y: topY, z: corners[1].z },
      ],
      [
        { x: corners[2].x, y: bottomY, z: corners[2].z },
        { x: corners[2].x, y: topY, z: corners[2].z },
      ],
      [
        { x: corners[3].x, y: bottomY, z: corners[3].z },
        { x: corners[3].x, y: topY, z: corners[3].z },
      ],
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
