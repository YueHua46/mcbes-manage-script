import { ItemStack, Player } from "@minecraft/server";
import { Item as DbItem } from "../ItemDatabase";

export interface IAddItemToCategory {
  player: Player;
  categoryName: string;
  item: ItemStack;
  price: number;
  cb: () => void;
}

export interface OfficeShopItemMetaData {
  category: string;
  price: number;
  amount: number;
  createdAt: number;
}

export interface OfficeShopItemData {
  item: ItemStack;
  data: OfficeShopItemMetaData;
  itemDB: DbItem;
}
