/**
 * @minecraft/server-net 能力包装（BDS 增强版专用）。
 * 所有 HTTP 出站请求应经此模块，避免在业务层散落动态 import。
 */

import { isBdsBuild } from "./build-flags";

export interface HttpGetResponse {
  status: number;
  body?: string;
}

export function isServerNetAvailable(): boolean {
  return isBdsBuild();
}

/**
 * 发起 GET 请求。非 BDS 构建或模块不可用时返回 null。
 */
export async function httpGet(url: string): Promise<HttpGetResponse | null> {
  if (!isBdsBuild()) return null;

  try {
    const { http } = await import("@minecraft/server-net");
    const response = await http.get(url);
    return { status: response.status, body: response.body };
  } catch {
    return null;
  }
}
