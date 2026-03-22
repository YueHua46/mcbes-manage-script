/**
 * 领地内飞行：注册定时器与事件
 */

import { initLandFlight } from "../../features/land/services/land-flight";
import { eventRegistry } from "../registry";

export function registerLandFlightEvents(): void {
  initLandFlight();
}

eventRegistry.register("landFlight", registerLandFlightEvents);
