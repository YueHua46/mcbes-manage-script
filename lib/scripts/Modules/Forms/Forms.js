import { ActionFormData, FormCancelationReason } from "@minecraft/server-ui";
import { openPlayerActionForm } from "../Player/Forms";
import { openLandManageForms } from "../Land/Forms";
import { openHelpMenuForm } from "../Help/Forms";
import { useForceOpen } from "../../hooks/hooks";
import { openBaseFunctionForm } from "../OtherFun/Forms";
import { openWayPointMenuForms } from "../WayPoint/Forms";
import { openSystemSettingForm } from "../System/Forms";
import setting from "../System/Setting";
import { openEconomyMenuForm } from "../Economic/Forms";
const menuItems = [
    {
        id: "player",
        text: "§w玩家操作",
        icon: "textures/ui/warning_alex",
        action: openPlayerActionForm,
    },
    {
        id: "wayPoint",
        text: "§w坐标点管理",
        icon: "textures/ui/world_glyph_color",
        action: openWayPointMenuForms,
    },
    {
        id: "land",
        text: "§w领地管理",
        icon: "textures/ui/icon_recipe_nature",
        action: openLandManageForms,
    },
    // 添加经济系统菜单项
    {
        id: "economy",
        text: "§w经济系统",
        icon: "textures/ui/MCoin",
        action: openEconomyMenuForm,
    },
    {
        id: "other",
        text: "§w其他功能",
        icon: "textures/ui/icon_blackfriday",
        action: openBaseFunctionForm,
    },
    {
        id: "help",
        text: "§w获取帮助",
        icon: "textures/ui/csb_purchase_amazondevicewarning",
        action: openHelpMenuForm,
    },
    {
        id: "sm",
        text: "§w给予我服务器菜单道具",
        icon: "textures/items/sm",
        action: (player) => player.runCommand("give @s yuehua:sm"),
    },
    {
        id: "setting",
        text: "服务器设置",
        icon: "textures/ui/settings_glyph_color_2x",
        action: openSystemSettingForm,
        adminOnly: true,
    },
];
function createServerMenuForm(player) {
    const isAdmin = player.getTags().includes("admin") || player.isOp();
    const form = new ActionFormData();
    form.title("§w服务器菜单");
    form.body({
        rawtext: [
            { text: "§a欢迎使用服务器菜单，请选择你的操作。\n" },
            { text: "§a此插件由 §eYuehua §a制作，B站ID： §e月花zzZ" },
        ],
    });
    menuItems
        .filter(({ id }) => {
        return setting.getState(id);
    })
        .forEach((item) => {
        if (!item.adminOnly || isAdmin) {
            form.button(item.text, item.icon);
        }
    });
    return form;
}
function openServerMenuForm(player) {
    const form = createServerMenuForm(player);
    form.show(player).then((data) => __awaiter(this, void 0, void 0, function* () {
        if (data.cancelationReason === FormCancelationReason.UserBusy) {
            player.sendMessage("§e请关闭你当前的聊天窗口，以便显示服务器菜单。");
            yield useForceOpen(player, form).then((data) => {
                if ((data === null || data === void 0 ? void 0 : data.selection) !== undefined) {
                    menuItems
                        .filter(({ id }) => {
                        return setting.getState(id);
                    })[data.selection].action(player);
                }
            });
        }
        else {
            if (data.selection !== undefined) {
                menuItems
                    .filter(({ id }) => {
                    return setting.getState(id);
                })[data.selection].action(player);
            }
        }
    }));
}
export { openServerMenuForm };
// 确保导出经济系统表单函数
export { openEconomyMenuForm };
//# sourceMappingURL=Forms.js.map