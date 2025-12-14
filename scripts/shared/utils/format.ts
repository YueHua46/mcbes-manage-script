/**
 * 格式化工具函数
 */

/**
 * 格式化数字，添加千分位分隔符
 */
export function formatNumber(num: number): string {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 格式化日期时间
 */
export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN');
}

/**
 * 格式化坐标
 */
export function formatVector(x: number, y: number, z: number): string {
  return `${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)}`;
}

/**
 * 截断字符串
 */
export function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}


