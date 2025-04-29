import { system } from "@minecraft/server";
import { Database } from "../Database";

export interface IProduct {
  name: string;
  description?: string;
  icon?: string;
  price: number;
  category: string;
  created: string;
  createBy: string;
}

class Product {
  db!: Database<IProduct>;

  constructor() {
    system.run(() => {
      this.db = new Database("product");
    });
  }
}

export default new Product();
