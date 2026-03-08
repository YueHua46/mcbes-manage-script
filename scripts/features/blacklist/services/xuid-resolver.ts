/**
 * XUID 解析服务
 *
 * 通过第三方公开 API 按优先级依序查询玩家 Gamertag 对应的 xuid：
 * 1. MCProfile  https://mcprofile.io/api/v1/bedrock/gamertag/{gamertag}
 * 2. mc-api.io  https://mc-api.io/uuid/{name}/bedrock
 * 3. GeyserMC   https://api.geysermc.org/v2/xbox/xuid/{gamertag}
 *
 * 注意：此文件在运行时依赖 @minecraft/server-net（BDS 版专用）。
 * 由调用方保证仅在 server-net 可用时调用。
 */

import { SystemLog } from "../../../shared/utils/common";

/**
 * 尝试通过 MCProfile API 获取 xuid
 * 响应示例：{ "xuid": "25332248730d7792", "gamertag": "...", ... }
 */
async function resolveFromMCProfile(gamertag: string): Promise<string | null> {
  try {
    // 动态 import 避免顶层 static import，防止在非 BDS 环境加载 main.js 时触发 Module unrecognized 错误
    const { http } = await import("@minecraft/server-net");
    const url = `https://mcprofile.io/api/v1/bedrock/gamertag/${encodeURIComponent(gamertag)}`;
    const response = await http.get(url);
    if (response.status === 200 && response.body) {
      const body = JSON.parse(response.body);
      const xuid = body?.xuid;
      if (xuid && String(xuid).trim() !== "") {
        return String(xuid).trim();
      }
    }
  } catch (e) {
    SystemLog.info(`[BlacklistXuid] MCProfile 查询失败: ${e}`);
  }
  return null;
}

/**
 * 尝试通过 mc-api.io API 获取 xuid
 * 响应字段不确定，防御性解析多个可能的字段名
 */
async function resolveFromMCApiIO(gamertag: string): Promise<string | null> {
  try {
    const { http } = await import("@minecraft/server-net");
    const url = `https://mc-api.io/uuid/${encodeURIComponent(gamertag)}/bedrock`;
    const response = await http.get(url);
    if (response.status === 200 && response.body) {
      const body = JSON.parse(response.body);
      const xuid = body?.xuid ?? body?.id ?? body?.uuid ?? null;
      if (xuid && String(xuid).trim() !== "") {
        return String(xuid).trim();
      }
    }
  } catch (e) {
    SystemLog.info(`[BlacklistXuid] mc-api.io 查询失败: ${e}`);
  }
  return null;
}

/**
 * 尝试通过 GeyserMC API 获取 xuid
 * 响应示例：{ "xuid": 2535432196048835 }
 * 注意：仅缓存了进过 Geyser/Floodgate 服务器的玩家
 */
async function resolveFromGeyserMC(gamertag: string): Promise<string | null> {
  try {
    const { http } = await import("@minecraft/server-net");
    const url = `https://api.geysermc.org/v2/xbox/xuid/${encodeURIComponent(gamertag)}`;
    const response = await http.get(url);
    if (response.status === 200 && response.body) {
      const body = JSON.parse(response.body);
      const xuid = body?.xuid;
      if (xuid !== undefined && xuid !== null && String(xuid).trim() !== "" && String(xuid) !== "0") {
        return String(xuid).trim();
      }
    }
  } catch (e) {
    SystemLog.info(`[BlacklistXuid] GeyserMC 查询失败: ${e}`);
  }
  return null;
}

/**
 * 按优先级依序查询玩家 xuid
 * MCProfile → mc-api.io → GeyserMC
 *
 * @param gamertag 玩家当前的 Xbox Gamertag（即 player.name）
 * @returns xuid 字符串，或 null（全部 API 均失败/查无此人）
 */
export async function resolveXuid(gamertag: string): Promise<string | null> {
  SystemLog.info(`[BlacklistXuid] 开始查询 xuid，gamertag: ${gamertag}`);

  // 1. MCProfile（优先，覆盖范围最广）
  const fromMCProfile = await resolveFromMCProfile(gamertag);
  if (fromMCProfile) {
    SystemLog.info(`[BlacklistXuid] MCProfile 命中，xuid: ${fromMCProfile}`);
    return fromMCProfile;
  }

  // 2. mc-api.io（备用）
  const fromMCApiIO = await resolveFromMCApiIO(gamertag);
  if (fromMCApiIO) {
    SystemLog.info(`[BlacklistXuid] mc-api.io 命中，xuid: ${fromMCApiIO}`);
    return fromMCApiIO;
  }

  // 3. GeyserMC（最后备用，仅 Geyser/Floodgate 缓存玩家）
  const fromGeyserMC = await resolveFromGeyserMC(gamertag);
  if (fromGeyserMC) {
    SystemLog.info(`[BlacklistXuid] GeyserMC 命中，xuid: ${fromGeyserMC}`);
    return fromGeyserMC;
  }

  SystemLog.info(`[BlacklistXuid] 所有 API 均未能解析 gamertag: ${gamertag}`);
  return null;
}
