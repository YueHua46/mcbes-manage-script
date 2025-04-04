import { system } from "@minecraft/server";
import { getNowDate } from "../../utils/utils";
import { Database } from "../Database";
class LeaveMessage {
    constructor() {
        system.run(() => {
            this.db = new Database("leaveMessage");
        });
    }
    // 留言列表
    getLeaveMessages() {
        return this.db.values();
    }
    // 获得玩家的留言
    getPlayerLeaveMessages(player) {
        return this.getLeaveMessages().filter((lm) => lm.creator === player.name);
    }
    // 创建留言（创建的新留言添加到留言列表的最前面）
    createLeaveMessage(leaveMessage) {
        if (!leaveMessage.title || !leaveMessage.content)
            return "参数错误";
        const id = Date.now().toString();
        return this.db.set(id, Object.assign({ id, time: getNowDate() }, leaveMessage));
    }
    // 删除留言
    deleteLeaveMessage(id) {
        if (!this.db.has(id))
            return "该留言不存在";
        return this.db.delete(id);
    }
}
export default new LeaveMessage();
//# sourceMappingURL=LeaveMessage.js.map