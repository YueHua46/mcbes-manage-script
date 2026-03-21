/**
 * 公会玩家 → 公会 ID 索引库单例（与 GuildService 共用同一 Database，避免缓存不一致）
 */

import { system } from "@minecraft/server";
import { Database } from "../../../shared/database/database";

const DB_PLAYER_INDEX = "guild_player_index";

let indexDb: Database<string> | undefined;

export function getGuildPlayerIndexDb(): Database<string> {
  if (!indexDb) {
    indexDb = new Database<string>(DB_PLAYER_INDEX);
  }
  return indexDb;
}

system.run(() => {
  getGuildPlayerIndexDb();
});
