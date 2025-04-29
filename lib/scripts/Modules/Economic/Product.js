import { system } from "@minecraft/server";
import { Database } from "../Database";
class Product {
    constructor() {
        system.run(() => {
            this.db = new Database("product");
        });
    }
}
export default new Product();
//# sourceMappingURL=Product.js.map