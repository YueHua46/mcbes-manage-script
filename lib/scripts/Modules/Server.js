import { world } from "@minecraft/server";
import getTPS from "../utils/tps";
import { oneSecondRunInterval } from "../utils/utils";
class Server {
    constructor() {
        this.TPS = 0;
        this.organismLength = 0;
        this.itemsLength = 0;
        this.getTps();
        this.getEntityLength();
        this.getItemsLength();
    }
    //   获取服务器TPS
    getTps() {
        oneSecondRunInterval(() => (this.TPS = getTPS()));
    }
    //   获取实体数量
    getEntityLength() {
        oneSecondRunInterval(() => {
            const owLength = world.getDimension("overworld").getEntities({
                excludeTypes: ["item"],
            }).length;
            const netherLength = world.getDimension("nether").getEntities({
                excludeTypes: ["item"],
            }).length;
            const endLength = world.getDimension("the_end").getEntities({
                excludeTypes: ["item"],
            }).length;
            this.organismLength = owLength + netherLength + endLength;
        });
    }
    //   获取掉落物数量
    getItemsLength() {
        oneSecondRunInterval(() => {
            const owLength = world.getDimension("overworld").getEntities({
                type: "item",
            }).length;
            const netherLength = world.getDimension("nether").getEntities({
                type: "item",
            }).length;
            const endLength = world.getDimension("the_end").getEntities({
                type: "item",
            }).length;
            this.itemsLength = owLength + netherLength + endLength;
        });
    }
}
export default new Server();
//# sourceMappingURL=Server.js.map