/**
 * TPS（每秒刻数）监控工具
 */

import { system } from "@minecraft/server";

const SAMPLE_TICKS = 20;
const samples: number[] = [];
let lastSampleTick = system.currentTick;
let lastSampleTime = Date.now();
let tps = 20;

system.runInterval(() => {
  const now = Date.now();
  const currentTick = system.currentTick;
  const elapsedMs = now - lastSampleTime;
  const elapsedTicks = currentTick - lastSampleTick;

  lastSampleTime = now;
  lastSampleTick = currentTick;
  if (elapsedMs <= 0 || elapsedTicks <= 0) return;

  const sample = Math.min(20, (elapsedTicks * 1000) / elapsedMs);
  if (!Number.isFinite(sample)) return;
  samples.push(sample);
  if (samples.length > 10) samples.shift();
  tps = samples.reduce((sum, value) => sum + value, 0) / samples.length;
}, SAMPLE_TICKS);

/**
 * 获取当前TPS
 */
export function getTPS(): number {
  return Math.round(Math.max(0, Math.min(20, tps)) * 100) / 100;
}

export default getTPS;
