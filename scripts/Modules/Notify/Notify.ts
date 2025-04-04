import { system, world } from "@minecraft/server";
import { getNowDate } from "../../utils/utils";
import { Database } from "../Database";

interface INotify {
  id: string;
  runId?: number;
  title: string;
  content: string;
  interval: number;
  time: string;
}

class Notify {
  private db!: Database<INotify>;
  constructor() {
    system.run(() => {
      this.db = new Database<INotify>("notify");
      this.init();
    });
  }
  init() {
    this.getNotifys().forEach((n) => {
      n.runId = system.runInterval(() => {
        world.sendMessage({
          rawtext: [
            {
              text: "§r§l§e[§6通知§e]§r§f " + n.title + "§r\n",
            },
            {
              text: n.content,
            },
          ],
        });
      }, n.interval);
    });
  }
  getNotifys() {
    return this.db.values();
  }

  createNotify(notify: Omit<INotify, "id" | "time">) {
    if (!notify.title || !notify.content) return "参数错误";
    const id = Date.now().toString();
    this.db.set(id, {
      id,
      time: getNowDate(),
      ...notify,
    });
    return this.init();
  }

  deleteNotify(id: string) {
    if (!this.db.has(id)) return "该通知不存在";
    const notify = this.db.get(id);
    if (notify.runId) system.clearRun(notify.runId);
    this.db.delete(id);
    return this.init();
  }

  updateNotify(id: string, notify: Partial<INotify>) {
    if (!this.db.has(id)) return "该通知不存在";
    const oldNotify = this.db.get(id);
    if (oldNotify.runId) system.clearRun(oldNotify.runId);
    this.db.set(id, {
      ...oldNotify,
      ...notify,
    });
    return this.init();
  }
}

export default new Notify();
