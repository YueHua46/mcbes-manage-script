import { system } from "@minecraft/server";
import "./Event";
import { color } from "../../utils/color";
import { namePrefixMap } from "../../glyphMap";
class Prefix {
    constructor() {
        this.prefix = namePrefixMap;
    }
    setPrefix(player, _prefix) {
        system.run(() => {
            // 检查是否有其他prefix，通过getTag，然后检索玩家所有的prefix_tag，然后删除
            const tags = player.getTags();
            tags.forEach((tag) => {
                if (tag.startsWith("prefix_")) {
                    player.removeTag(tag);
                }
            });
            player.addTag(`prefix_${this.prefix[_prefix]}`);
            player.nameTag = `${this.prefix[_prefix]} ${color.aqua(player.name)}`;
        });
    }
    getPrefix(player) {
        const tags = player.getTags();
        const prefix = tags.find((tag) => tag.startsWith("prefix_"));
        if (prefix) {
            return prefix.replace("prefix_", "");
        }
        else {
            return this.prefix[0];
        }
    }
    initPrefix(player) {
        this.setPrefix(player, 0);
    }
}
export default new Prefix();
//# sourceMappingURL=Prefix.js.map