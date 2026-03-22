/**
 * 北京时间（UTC+8）格式化。
 * Minecraft Script 运行环境里 Date 的本地/Intl 行为不可靠，用「时间戳 + 偏移 + getUTC*」得到墙钟。
 */

export const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * 将 Unix 毫秒时间戳格式化为北京时间 `YYYY-MM-DD HH:mm:ss`
 */
export function formatDateTimeBeijing(timestamp: number): string {
  const utc8Date = new Date(timestamp + BEIJING_OFFSET_MS);
  const yyyy = utc8Date.getUTCFullYear();
  const mm = `${utc8Date.getUTCMonth() + 1}`.padStart(2, "0");
  const dd = `${utc8Date.getUTCDate()}`.padStart(2, "0");
  const hh = `${utc8Date.getUTCHours()}`.padStart(2, "0");
  const mi = `${utc8Date.getUTCMinutes()}`.padStart(2, "0");
  const ss = `${utc8Date.getUTCSeconds()}`.padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

/**
 * 将 Unix 毫秒时间戳格式化为北京日历日 `YYYY-MM-DD`（用于每日重置等）
 */
export function formatDateOnlyBeijing(timestamp: number): string {
  const utc8Date = new Date(timestamp + BEIJING_OFFSET_MS);
  const yyyy = utc8Date.getUTCFullYear();
  const mm = `${utc8Date.getUTCMonth() + 1}`.padStart(2, "0");
  const dd = `${utc8Date.getUTCDate()}`.padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
