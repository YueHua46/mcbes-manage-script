/**
 * 普通版和 Realms 版的构建替身，确保产物不会包含 BDS 专属 server-net 导入。
 */

export interface HttpGetResponse {
  status: number;
  body?: string;
}

export function isServerNetAvailable(): boolean {
  return false;
}

export async function httpGet(): Promise<HttpGetResponse | null> {
  return null;
}
