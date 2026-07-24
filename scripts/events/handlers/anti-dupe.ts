/**
 * 防刷物品（收纳袋等）
 */

import { registerAntiDupeSubscriptions } from "../../features/anti-dupe/register";
import { eventRegistry } from "../registry";

export function registerAntiDupeEvents(): void {
  registerAntiDupeSubscriptions();
}

eventRegistry.register("antiDupe", registerAntiDupeEvents);
