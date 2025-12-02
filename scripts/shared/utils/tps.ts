/**
 * TPS（每秒刻数）监控工具
 */

import * as mc from '@minecraft/server';

let lastTick = Date.now();
let TPS = 20;
let timeArray: number[] = [];

mc.system.runInterval(() => {
  if (timeArray.length === 20) timeArray.shift();
  timeArray.push(Math.round((1000 / (Date.now() - lastTick)) * 100) / 100);
  TPS = timeArray.reduce((a, b) => a + b) / timeArray.length;
  lastTick = Date.now();
});

/**
 * 获取当前TPS
 */
export function getTPS(): number {
  if (TPS > 20) return 20;
  return Math.floor(TPS);
}

export default getTPS;


