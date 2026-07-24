/**
 * 普通版和 Realms 版的构建替身，确保产物不会包含 BDS 专属 server-admin 导入。
 */

export function isServerAdminAvailable(): boolean {
  return false;
}

export async function subscribeAsyncPlayerJoin(): Promise<boolean> {
  return false;
}
