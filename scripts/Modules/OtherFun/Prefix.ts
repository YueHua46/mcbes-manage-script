// Prefix功能已移除，不再使用
// import { Player, system } from "@minecraft/server";
// import "./Event";
// import { color } from "../../utils/color";
// import { namePrefixMap } from "../../glyphMap";
// import playerSetting from "../Player/PlayerSetting";

// type IPrefix = number;

// class Prefix {
//   prefix: string[] = namePrefixMap;
//   setPrefix(player: Player, _prefix: IPrefix) {
//     system.run(() => {
//       // 检查是否有其他prefix，通过getTag，然后检索玩家所有的prefix_tag，然后删除
//       const tags = player.getTags();
//       tags.forEach((tag) => {
//         if (tag.startsWith("prefix_")) {
//           player.removeTag(tag);
//         }
//       });
//       player.addTag(`prefix_${this.prefix[_prefix]}`);
//       // 设置玩家头像并更新显示
//       playerSetting.setPlayerAvatar(player, _prefix);
//       // 使用NameDisplay更新玩家显示
//       import("../Player/NameDisplay").then(({ default: nameDisplay }) => {
//         nameDisplay.forceUpdatePlayerNameDisplay(player);
//       });
//     });
//   }
//   getPrefix(player: Player) {
//     const tags = player.getTags();
//     const prefix = tags.find((tag) => tag.startsWith("prefix_"));
//     if (prefix) {
//       return prefix.replace("prefix_", "");
//     } else {
//       return this.prefix[0];
//     }
//   }
//   initPrefix(player: Player) {
//     this.setPrefix(player, 0);
//     }
// }

// export default new Prefix();
export default {} as any;
