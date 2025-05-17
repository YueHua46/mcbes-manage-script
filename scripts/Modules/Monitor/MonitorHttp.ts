import { HttpHeader, HttpRequest, HttpRequestMethod, http } from "@minecraft/server-net";
import { MonitorEvents } from "./MonitorLog";

/**
 * 定义发送到后端的事件载荷结构。
 * @template T - 事件数据的具体类型。
 */
interface GameEventPayload<T = any> {
  eventName: keyof MonitorEvents;
  eventData: T;
  timestamp: number;
}

/**
 * 统一的事件发送函数。
 * 后续你需要在这里实现实际的 HTTP 请求逻辑。
 * @param eventName 事件的名称，例如 "player_use_fire"。
 * @param eventData 与事件相关的数据对象。
 */
async function sendGameEvent<TData = any>(eventName: keyof MonitorEvents, eventData: TData): Promise<void> {
  const payload: GameEventPayload<TData> = {
    eventName,
    eventData,
    timestamp: Date.now(),
  };

  console.log(`[Game Event Service] Preparing to send event: ${eventName}`, payload);
  const req = new HttpRequest("http://127.0.0.1:3000/" + eventName);
  req.method = HttpRequestMethod.Post;
  req.body = JSON.stringify(payload);
  req.headers = [new HttpHeader("Content-Type", "application/json")];
  await http.request(req);
}

export { sendGameEvent };
