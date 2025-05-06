import { BlockVolume, system, world } from "@minecraft/server";
import { Database } from "../Database";
import setting from "../System/Setting";
import { defaultSetting } from "../System/Setting";
import { isAdmin } from "../../utils/utils";
import { color } from "@mcbe-mods/utils";
import economic from "../Economic/Economic";
import { colorCodes } from "../../utils/color";
import { openConfirmDialogForm } from "../Forms/Dialog";
/**
 * Land module
 */
class Land {
    constructor() {
        system.run(() => {
            this.db = new Database("lands");
        });
    }
    createVector3(str) {
        const [x, y, z] = str.split(" ").map(Number);
        if (isNaN(x) || isNaN(y) || isNaN(z)) {
            return "坐标格式错误";
        }
        return {
            x,
            y,
            z,
        };
    }
    getLand(name) {
        if (!this.db.has(name))
            return "领地不存在";
        return this.db.get(name);
    }
    removeLand(name) {
        if (!this.db.has(name))
            return "领地不存在";
        return this.db.delete(name);
    }
    getLandList() {
        return this.db.getAll();
    }
    setLand(name, land) {
        if (!this.db.has(name))
            return "领地不存在";
        return this.db.set(name, land);
    }
    addMember(name, member) {
        if (!this.db.has(name))
            return "领地不存在";
        const land = this.db.get(name);
        if (land.members.includes(member))
            return "成员已存在";
        land.members.push(member);
        return this.db.set(name, land);
    }
    removeMember(name, member) {
        if (!this.db.has(name))
            return "领地不存在";
        const land = this.db.get(name);
        if (!land.members.includes(member))
            return "成员不存在";
        land.members = land.members.filter((m) => m !== member);
        return this.db.set(name, land);
    }
    setPublicAuth(name, auth) {
        if (!this.db.has(name))
            return "领地不存在";
        const land = this.db.get(name);
        land.public_auth = auth;
        return this.db.set(name, land);
    }
    // 检查领地是否重叠
    checkOverlap(land) {
        const lands = this.db.getAll();
        const landArea = new BlockVolume(land.vectors.start, land.vectors.end);
        const overlaps = [];
        for (const key in lands) {
            if (land.dimension !== lands[key].dimension)
                continue;
            const area = new BlockVolume(lands[key].vectors.start, lands[key].vectors.end);
            console.log(`new area -> ${area.from.x},${area.from.y},${area.from.z} -> ${area.to.x},${area.to.y},${area.to.z}`);
            console.log(`loop area -> ${area.from.x},${area.from.y},${area.from.z} -> ${area.to.x},${area.to.y},${area.to.z}`);
            if (landArea.doesVolumeTouchFaces(area)) {
                overlaps.push(lands[key]);
            }
        }
        return overlaps;
    }
    isInsideLand(location, land) {
        const isInside = Math.round(location.x) >= Math.min(land.vectors.start.x, land.vectors.end.x) &&
            Math.round(location.x) <= Math.max(land.vectors.start.x, land.vectors.end.x) &&
            Math.round(location.y) >= Math.min(land.vectors.start.y, land.vectors.end.y) - 1 &&
            Math.round(location.y) <= Math.max(land.vectors.start.y, land.vectors.end.y) &&
            Math.round(location.z) >= Math.min(land.vectors.start.z, land.vectors.end.z) &&
            Math.round(location.z) <= Math.max(land.vectors.start.z, land.vectors.end.z);
        return { isInside, insideLand: land };
    }
    // 检查某个坐标是否在某个领地内
    testLand(location, dimension) {
        const lands = this.db.values();
        const land = lands.find((land) => {
            if (land.dimension != dimension)
                return false;
            return this.isInsideLand(location, land).isInside;
        });
        return land
            ? {
                isInside: true,
                insideLand: land,
            }
            : {
                isInside: false,
                insideLand: null,
            };
    }
    // 获取所有有领地的玩家
    getLandPlayers() {
        return Array.from(new Set(Object.values(this.db.getAll()).map((land) => land.owner)));
    }
    // 获取指定玩家的所有领地
    getPlayerLands(playerName) {
        return Object.values(this.db.getAll()).filter((land) => land.owner === playerName);
    }
    // 领地转让
    transferLand(name, playerName) {
        if (!this.db.has(name))
            return "领地不存在";
        const land = this.db.get(name);
        land.owner = playerName;
        return this.db.set(name, land);
    }
    // 获取玩家拥有的领地数量
    getPlayerLandCount(playerName) {
        const lands = this.db.values();
        return lands.filter((land) => land.owner === playerName).length;
    }
    // 计算两个坐标点之间的方块数量
    calculateBlockCount(start, end) {
        const bv = new BlockVolume(start, end);
        return bv.getCapacity();
    }
    // 创建领地时添加方块数量验证
    createLand(landData) {
        return __awaiter(this, void 0, void 0, function* () {
            const player = world.getPlayers({ name: landData.owner })[0];
            if (this.db.has(landData.name))
                return "领地名冲突，已存在，请尝试其他领地名称";
            const overlaps = this.checkOverlap(landData);
            if (overlaps.length > 0) {
                // 只提示第一个重叠的领地，也可以遍历所有重叠领地
                const info = overlaps
                    .map((o) => `与玩家 ${color.yellow(o.owner)} ${color.red("的领地")} ${color.yellow(o.name)} ${color.red("重叠")}\n${color.red("位置")}： ${color.yellow(`${o.vectors.start.x}`)},${color.yellow(`${o.vectors.start.y}`)},${color.yellow(color.yellow(`${o.vectors.start.z}`))} -> ${color.yellow(`${o.vectors.end.x}`)},${color.yellow(`${o.vectors.end.y}`)},${color.yellow(`${o.vectors.end.z}`)}`)
                    .join("\n");
                return `领地重叠，请重新设置领地范围。\n${info}`;
            }
            // 检查玩家领地数量是否达到上限
            const maxLandPerPlayer = Number(setting.getState("maxLandPerPlayer") || defaultSetting.maxLandPerPlayer);
            if (!isAdmin(player) && this.getPlayerLandCount(landData.owner) >= maxLandPerPlayer) {
                return `您已达到最大领地数量限制(${maxLandPerPlayer})，无法创建更多领地`;
            }
            // 获取领地方块上限
            const maxLandBlocks = Number(setting.getState("maxLandBlocks") || "30000");
            // 计算领地方块数量
            const blockCount = this.calculateBlockCount(landData.vectors.start, landData.vectors.end);
            // 验证方块数量是否超过上限
            if (blockCount > maxLandBlocks) {
                return `领地方块数量(${blockCount})超过上限(${maxLandBlocks})，请重新设置领地。确保其不超过系统设置方块上限\n管理员可通过 【服务器设置】 -> 【通用系统设置】 -> 【设置领地方块上限】 来更改上限`;
            }
            const { cost, balance, canAfford, isCancel } = yield this.confirmAndCreateLandAsync(player, landData.vectors.start, landData.vectors.end);
            if (isCancel)
                return "领地创建已取消";
            if (!canAfford)
                return `${colorCodes.red}你的余额不足，无法创建领地，需要  ${colorCodes.yellow}${cost} ${colorCodes.red} 金币，你的余额为  ${colorCodes.yellow}${balance}  金币`;
            // 支付领地创建费用
            economic.removeGold(player.name, cost, "领地创建费用");
            this.db.set(landData.name, landData);
            return true;
        });
    }
    // 封装成 Promise
    confirmAndCreateLandAsync(player, start, end) {
        return new Promise((resolve) => {
            const cost = economic.calculateLandPrice(start, end);
            const balance = economic.getWallet(player.name).gold;
            const canAfford = balance >= cost;
            openConfirmDialogForm(player, "领地创建确认", `你将支付 ${cost} 金币来圈地，是否继续？`, () => resolve({ canAfford, cost, balance, isCancel: false }), () => resolve({ canAfford, cost, balance, isCancel: true }));
        });
    }
}
export default new Land();
//# sourceMappingURL=Land.js.map