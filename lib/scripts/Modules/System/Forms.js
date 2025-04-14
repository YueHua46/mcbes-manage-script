import { GameMode, world } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { color } from "../../utils/color";
import setting from "./Setting";
import { useNotify } from "../../hooks/hooks";
import { openAllPlayerLandManageForm, openLandDetailForm } from "../Land/Forms";
import land from "../Land/Land";
import { openDialogForm } from "../Forms/Dialog";
import { openServerMenuForm } from "../Forms/Forms";
import { openPlayerWayPointListForm } from "../WayPoint/Forms";
import { openNotifyForms } from "../Notify/Forms";
import { SystemLog } from "../../utils/utils";
import WayPoint from "../WayPoint/WayPoint";
import { defaultSetting } from "./Setting";
// 创建搜索玩家领地表单
function createSearchLandForm() {
    const form = new ModalFormData();
    form.title("搜索玩家领地");
    form.textField("玩家名称", "请输入要搜索的玩家名称");
    form.submitButton("搜索");
    return form;
}
// 打开搜索玩家领地表单
export function openSearchLandForm(player) {
    const form = createSearchLandForm();
    form.show(player).then((data) => {
        if (data.cancelationReason)
            return;
        const { formValues } = data;
        if (formValues === null || formValues === void 0 ? void 0 : formValues[0]) {
            const playerName = formValues[0].toString();
            const playerLands = land.getPlayerLands(playerName);
            if (playerLands.length === 0) {
                openDialogForm(player, {
                    title: "搜索结果",
                    desc: color.red("未找到该玩家的领地"),
                }, () => openSearchLandForm(player));
            }
            else {
                openSearchResultsForm(player, playerLands, playerName);
            }
        }
    });
}
// 打开搜索结果表单
const openSearchResultsForm = (player, lands, playerName, page = 1) => {
    const form = new ActionFormData();
    form.title(`搜索结果 - ${playerName}`);
    const totalPages = Math.ceil(lands.length / 10);
    const start = (page - 1) * 10;
    const end = start + 10;
    const currentPageLands = lands.slice(start, end);
    currentPageLands.forEach((landData) => {
        form.button(landData.name, "textures/ui/World");
    });
    let previousButtonIndex = currentPageLands.length;
    let nextButtonIndex = currentPageLands.length;
    if (page > 1) {
        form.button("上一页", "textures/ui/arrow_left");
        previousButtonIndex++;
        nextButtonIndex++;
    }
    if (page < totalPages) {
        form.button("下一页", "textures/ui/arrow_right");
        nextButtonIndex++;
    }
    form.button("返回", "textures/ui/dialog_bubble_point");
    form.body(`第 ${page} 页 / 共 ${totalPages} 页`);
    form.show(player).then((data) => {
        if (data.cancelationReason)
            return;
        const selectionIndex = data.selection;
        if (selectionIndex === null || selectionIndex === undefined)
            return;
        // 当前页的领地数量
        const currentPageLandsCount = currentPageLands.length;
        if (selectionIndex < currentPageLandsCount) {
            // 选择的是某个领地
            openLandDetailForm(player, currentPageLands[selectionIndex], false);
        }
        else if (selectionIndex === previousButtonIndex - 1 && page > 1) {
            // 选择的是"上一页"
            openSearchResultsForm(player, lands, playerName, page - 1);
        }
        else if (selectionIndex === nextButtonIndex - 1 && page < totalPages) {
            // 选择的是"下一页"
            openSearchResultsForm(player, lands, playerName, page + 1);
        }
        else if (selectionIndex === nextButtonIndex) {
            // 选择的是"返回"
            openSearchLandForm(player);
        }
    });
};
// 打开玩家坐标点管理表单
export const openPlayerWayPointManageForm = (player, page = 1) => {
    const form = new ActionFormData();
    form.title("§w玩家坐标点管理");
    // 从数据库中获取所有有坐标点记录的玩家列表
    const players = WayPoint.getWayPointPlayers();
    // 计算分页信息
    const pageSize = 10; // 每页显示10个玩家
    const totalPages = Math.ceil(players.length / pageSize);
    const start = (page - 1) * pageSize;
    const end = Math.min(start + pageSize, players.length);
    const currentPagePlayers = players.slice(start, end);
    // 为当前页的每个玩家添加按钮
    currentPagePlayers.forEach((playerName) => {
        const waypoints = WayPoint.getPointsByPlayer(playerName);
        const publicCount = waypoints.filter((p) => p.type === "public").length;
        const privateCount = waypoints.filter((p) => p.type === "private").length;
        form.button(`${color.blue(playerName)} 的所有坐标点\n ${color.darkPurple("公共坐标点:")} ${publicCount} | ${color.darkRed("私有坐标点:")} ${privateCount}`, "textures/ui/icon_steve");
    });
    // 添加分页按钮
    let previousButtonIndex = currentPagePlayers.length;
    let nextButtonIndex = currentPagePlayers.length;
    if (page > 1) {
        form.button("§w上一页", "textures/ui/arrow_left");
        previousButtonIndex++;
        nextButtonIndex++;
    }
    if (page < totalPages) {
        form.button("§w下一页", "textures/ui/arrow_right");
        nextButtonIndex++;
    }
    form.button("§w返回", "textures/ui/dialog_bubble_point");
    form.body(`第 ${page} 页 / 共 ${totalPages} 页`);
    form.show(player).then((data) => {
        if (data.canceled || data.cancelationReason)
            return;
        const selectionIndex = data.selection;
        if (selectionIndex === null || selectionIndex === undefined)
            return;
        // 当前页的玩家数量
        const currentPagePlayersCount = currentPagePlayers.length;
        if (selectionIndex < currentPagePlayersCount) {
            // 选择了某个玩家
            const selectedPlayerName = currentPagePlayers[selectionIndex];
            openPlayerWayPointListForm(player, selectedPlayerName, 1, () => openPlayerWayPointManageForm(player, page));
        }
        else if (selectionIndex === previousButtonIndex - 1 && page > 1) {
            // 点击了"上一页"
            openPlayerWayPointManageForm(player, page - 1);
        }
        else if (selectionIndex === nextButtonIndex - 1 && page < totalPages) {
            // 点击了"下一页"
            openPlayerWayPointManageForm(player, page + 1);
        }
        else if ((page === 1 && selectionIndex === nextButtonIndex) || (page > 1 && selectionIndex === nextButtonIndex)) {
            // 点击了"返回"
            openSystemSettingForm(player);
        }
    });
};
// 打开领地管理表单
export const openLandManageForm = (player) => {
    const form = new ActionFormData();
    form.title("§w领地管理");
    form.button("§w所有玩家领地管理", "textures/ui/icon_new");
    form.button("§w删除当前所在区域领地", "textures/ui/redX1");
    form.button("§w搜索玩家领地", "textures/ui/magnifyingGlass");
    // form.button('§w玩家坐标点管理', 'textures/ui/icon_steve')
    form.button("§w返回", "textures/ui/dialog_bubble_point");
    form.show(player).then((data) => {
        var _a, _b, _c;
        if (data.canceled || data.cancelationReason)
            return;
        switch (data.selection) {
            case 0:
                openAllPlayerLandManageForm(player);
                break;
            case 1:
                const { insideLand, isInside } = land.testLand((_b = (_a = player.dimension.getBlock(player.location)) === null || _a === void 0 ? void 0 : _a.location) !== null && _b !== void 0 ? _b : player.location, player.dimension.id);
                if (!isInside)
                    return openDialogForm(player, { title: "领地删除失败", desc: color.red("你不在任何领地内！") }, () => openLandManageForm(player));
                const res = land.removeLand((_c = insideLand === null || insideLand === void 0 ? void 0 : insideLand.name) !== null && _c !== void 0 ? _c : "");
                if (typeof res === "string")
                    return openDialogForm(player, { title: "领地删除失败", desc: color.red(res) });
                openDialogForm(player, {
                    title: "领地删除成功",
                    desc: color.green(`${insideLand === null || insideLand === void 0 ? void 0 : insideLand.owner} 的领地 ${insideLand === null || insideLand === void 0 ? void 0 : insideLand.name} 删除成功！`),
                });
                break;
            case 2:
                openSearchLandForm(player);
                break;
            // case 3:
            //   openPlayerWayPointManageForm(player)
            //   break
            case 3:
                openSystemSettingForm(player);
                break;
        }
    });
};
// 打开服务器名称设置表单
export const openServerNameForm = (player) => {
    const form = new ModalFormData();
    form.title("§w设置服务器名称");
    form.textField("服务器名称", "请输入服务器名称");
    form.submitButton("§w确定");
    form.show(player).then((data) => {
        if (data.canceled || data.cancelationReason)
            return;
        const { formValues } = data;
        if (formValues === null || formValues === void 0 ? void 0 : formValues[0]) {
            const serverName = formValues[0].toString();
            world.setDynamicProperty("serverName", serverName);
            openDialogForm(player, { title: "服务器名称设置成功", desc: color.green("服务器名称设置成功！") }, () => openSystemSettingForm(player));
        }
        else {
            useNotify("chat", player, "§c服务器名称设置失败");
        }
    });
};
// 打开功能开关表单
export const openFunctionSwitchForm = (player) => {
    var _a, _b, _c, _d, _e, _f;
    const form = new ModalFormData();
    const buttons = [
        {
            text: "§w玩家操作",
            id: "player",
            state: (_a = setting.getState("player")) !== null && _a !== void 0 ? _a : true,
        },
        {
            text: "§w领地功能",
            id: "land",
            state: (_b = setting.getState("land")) !== null && _b !== void 0 ? _b : true,
        },
        {
            text: "§w坐标点管理",
            id: "wayPoint",
            state: (_c = setting.getState("wayPoint")) !== null && _c !== void 0 ? _c : true,
        },
        {
            text: "§w其他功能",
            id: "other",
            state: (_d = setting.getState("other")) !== null && _d !== void 0 ? _d : true,
        },
        {
            text: "§w帮助",
            id: "help",
            state: (_e = setting.getState("help")) !== null && _e !== void 0 ? _e : true,
        },
        {
            text: "§w掉落物清理",
            id: "killItem",
            state: (_f = setting.getState("killItem")) !== null && _f !== void 0 ? _f : true,
        },
    ];
    form.title("§w功能开关");
    buttons.forEach(({ text, state }) => {
        form.toggle(text, state === true);
    });
    form.submitButton("§w确定");
    form.show(player).then((data) => {
        if (data.canceled || data.cancelationReason)
            return;
        const { formValues } = data;
        if (formValues) {
            formValues.forEach((value, index) => {
                if (value)
                    setting.turnOn(buttons[index].id);
                else
                    setting.turnOff(buttons[index].id);
            });
            openDialogForm(player, { title: "功能开关设置成功", desc: color.green("功能开关设置成功！") }, () => openSystemSettingForm(player));
        }
        else {
            useNotify("chat", player, "§c功能开关设置失败");
        }
    });
};
export const openKillItemSettingForm = (player) => {
    SystemLog("openKillItemSettingForm enter");
    const form = new ModalFormData();
    const killItemAmount = setting.getState("killItemAmount") || "1500";
    try {
        SystemLog("killItemAmount -->" + killItemAmount);
        form.title("§w触发掉落物清理的上限设置");
        form.textField("触发掉落物清理的数量上限", killItemAmount.toString());
        form.submitButton("§w确定");
        form.show(player).then((data) => {
            if (data.canceled || data.cancelationReason)
                return;
            const { formValues } = data;
            if (formValues === null || formValues === void 0 ? void 0 : formValues[0]) {
                const num = formValues[0].toString();
                setting.setState("killItemAmount", num);
                openDialogForm(player, {
                    title: "掉落物清理设置成功",
                    desc: color.green("掉落物清理设置成功！当世界当中的掉落物数量超过设置数量时，会触发自动清理掉落物。"),
                }, () => openSystemSettingForm(player));
            }
            else {
                useNotify("chat", player, "§c掉落物清理设置失败");
            }
        });
    }
    catch (error) {
        SystemLog("openKillItemSettingForm error -->" + error);
    }
};
export const openRandomTpSettingForm = (player) => {
    const form = new ModalFormData();
    const randomTpRange = setting.getState("randomTpRange") || 50000;
    form.title("§w设置随机传送范围");
    form.textField("随机传送范围", randomTpRange.toString());
    form.submitButton("§w确定");
    form.show(player).then((data) => {
        if (data.canceled || data.cancelationReason)
            return;
        const { formValues } = data;
        if (formValues === null || formValues === void 0 ? void 0 : formValues[0]) {
            const num = formValues[0].toString();
            setting.setState("randomTpRange", num);
        }
    });
};
// 设置每个玩家最大领地数量的表单
export const openMaxLandPerPlayerSettingForm = (player) => {
    const form = new ModalFormData();
    form.title("设置玩家最大领地数量");
    const currentValue = setting.getState("maxLandPerPlayer") || defaultSetting.maxLandPerPlayer;
    form.textField(color.white("每个玩家最大领地数量"), color.gray("请输入每个玩家最大可创建的领地数量"), currentValue.toString());
    form.show(player).then((data) => {
        if (data.cancelationReason)
            return;
        const { formValues } = data;
        if (formValues && formValues[0]) {
            const value = formValues[0].toString();
            const numValue = parseInt(value);
            if (isNaN(numValue) || numValue <= 0) {
                return openDialogForm(player, {
                    title: "设置失败",
                    desc: color.red("请输入有效的正整数！"),
                }, () => openMaxLandPerPlayerSettingForm(player));
            }
            setting.setState("maxLandPerPlayer", value);
            openDialogForm(player, {
                title: "设置成功",
                desc: color.green(`成功设置每个玩家最大领地数量为 ${value}`),
            }, () => openCommonSettingForm(player));
        }
    });
};
// 设置领地方块上限
export const openLandBlockLimitForm = (player) => {
    const form = new ModalFormData();
    const maxLandBlocks = setting.getState("maxLandBlocks") || "30000";
    form.title("§w设置领地方块上限");
    form.textField("领地方块上限", maxLandBlocks.toString());
    form.submitButton("§w确定");
    form.show(player).then((data) => {
        if (data.canceled || data.cancelationReason)
            return;
        const { formValues } = data;
        if (formValues === null || formValues === void 0 ? void 0 : formValues[0]) {
            const num = formValues[0].toString();
            setting.setState("maxLandBlocks", num);
            openDialogForm(player, {
                title: "领地方块上限设置成功",
                desc: color.green("领地方块上限设置成功！创建领地时方块数量不能超过设置的上限。"),
            }, () => openSystemSettingForm(player));
        }
        else {
            useNotify("chat", player, "§c领地方块上限设置失败");
        }
    });
};
// 设置 chat 聊天颜色的表单
export const openChatColorForm = (player) => {
    const form = new ActionFormData();
    form.title("§w设置聊天颜色");
    form.body("§w请选择聊天颜色");
    const chatColors = [
        {
            text: "§w玩家名字颜色",
            icon: "textures/ui/text_color_paintbrush",
            action: () => openChatColorSelectForm(player, "playerName"),
        },
        {
            text: "§w玩家聊天颜色",
            icon: "textures/ui/comment",
            action: () => openChatColorSelectForm(player, "playerChat"),
        },
    ];
    chatColors.forEach(({ text, icon, action }) => {
        form.button(text, icon);
    });
    form.show(player).then((data) => {
        if (data.canceled || data.cancelationReason)
            return;
        const selectionIndex = data.selection;
        if (selectionIndex === null || selectionIndex === undefined)
            return;
        chatColors[selectionIndex].action();
    });
};
// 打开聊天颜色选择表单
export const openChatColorSelectForm = (player, type) => {
    const form = new ActionFormData();
    form.title("§w选择颜色");
    form.body("§w请选择颜色");
    const colors = [
        color.white("白色"),
        color.red("红色"),
        color.green("绿色"),
        color.blue("蓝色"),
        color.yellow("黄色"),
        color.aqua("青色"),
        color.lightPurple("浅紫色"),
        color.darkPurple("深紫色"),
        color.darkRed("深红色"),
        color.darkGreen("深绿色"),
        color.darkBlue("深蓝色"),
        color.darkAqua("深青色"),
        color.black("黑色"),
        color.gold("金色"),
        color.gray("灰色"),
        color.darkGray("深灰色"),
    ];
    colors.forEach((color) => {
        form.button(color);
    });
    form.show(player).then((data) => {
        var _a, _b, _c, _d;
        if (data.canceled || data.cancelationReason)
            return;
        const selectionIndex = data.selection;
        if (selectionIndex === null || selectionIndex === undefined)
            return;
        const _color = colors[selectionIndex];
        if (type === "playerName") {
            const colorCode = (_b = (_a = _color.match(/§./g)) === null || _a === void 0 ? void 0 : _a.join("")) !== null && _b !== void 0 ? _b : "";
            setting.setState("playerNameColor", colorCode);
            openDialogForm(player, {
                title: "设置成功",
                desc: color.green(`成功设置玩家名字颜色为 ${_color}`),
            }, () => openCommonSettingForm(player));
        }
        else {
            // 筛选出颜色
            const colorCode = (_d = (_c = _color.match(/§./g)) === null || _c === void 0 ? void 0 : _c.join("")) !== null && _d !== void 0 ? _d : "";
            setting.setState("playerChatColor", colorCode);
            openDialogForm(player, {
                title: "设置成功",
                desc: color.green(`成功设置玩家聊天颜色为 ${_color}`),
            }, () => openCommonSettingForm(player));
        }
    });
};
// 打开通用系统设置表单
/**
 * 功能点：
 * 1. 设置掉落物清理数量
 * 2. 设置随机传送范围
 * 3. 设置服务器名称
 * 4. 设置服务器通知
 * 5. 设置创建领地时，领地内方块上限
 * 6. 设置chat聊天颜色（玩家名字颜色和玩家聊天颜色）
 */
export const openCommonSettingForm = (player) => {
    const form = new ActionFormData();
    form.title("§w通用系统设置");
    const buttons = [
        {
            text: "设置掉落物清理数量",
            icon: "textures/ui/icon_fall",
            action: () => openKillItemSettingForm(player),
        },
        {
            text: "设置随机传送范围",
            icon: "textures/ui/RTX_Sparkle",
            action: () => openRandomTpSettingForm(player),
        },
        {
            text: "设置服务器名称",
            icon: "textures/ui/hanging_sign",
            action: () => openServerNameForm(player),
        },
        {
            text: "设置服务器通知",
            icon: "textures/ui/icon_book_writable",
            action: () => openNotifyForms(player),
        },
        {
            text: "设置领地方块上限",
            icon: "textures/ui/icon_recipe_construction",
            action: () => openLandBlockLimitForm(player),
        },
        {
            text: "设置玩家最大领地数量",
            icon: "textures/ui/icon_recipe_nature",
            action: () => openMaxLandPerPlayerSettingForm(player),
        },
        // 新增坐标点上限设置按钮
        {
            text: "设置玩家最大坐标点数量",
            icon: "textures/ui/icon_recipe_nature",
            action: () => openMaxWayPointPerPlayerSettingForm(player),
        },
        {
            text: "设置聊天颜色",
            icon: "textures/ui/color_picker",
            action: () => openChatColorForm(player),
        },
        {
            text: "试玩模式设置",
            icon: "textures/ui/permissions_visitor_hand_hover",
            action: () => openTrialModeMainForm(player),
        },
    ];
    buttons.forEach(({ text, icon }) => form.button(text, icon));
    form.button("§w返回", "textures/ui/dialog_bubble_point");
    form.show(player).then((data) => {
        if (data.canceled || data.cancelationReason)
            return;
        switch (data.selection) {
            case buttons.length:
                openSystemSettingForm(player);
                break;
            default:
                if (typeof data.selection === "number")
                    buttons[data.selection].action();
                break;
        }
    });
};
// 打开系统设置表单
export const openSystemSettingForm = (player) => {
    const form = new ActionFormData();
    form.title("§w服务器设置");
    const buttons = [
        {
            text: "功能开关",
            icon: "textures/ui/craft_toggle_on_hover",
            action: () => openFunctionSwitchForm(player),
        },
        {
            text: "所有玩家坐标点管理",
            icon: "textures/ui/mashup_world",
            action: () => openPlayerWayPointManageForm(player),
        },
        {
            text: "领地管理",
            icon: "textures/ui/icon_new",
            action: () => openLandManageForm(player),
        },
        {
            text: "通用系统设置",
            icon: "textures/ui/settings_glyph_color_2x",
            action: () => openCommonSettingForm(player),
        },
    ];
    buttons.forEach(({ text, icon }) => form.button(text, icon));
    form.button("§w返回", "textures/ui/dialog_bubble_point");
    form.show(player).then((data) => {
        if (data.canceled || data.cancelationReason)
            return;
        switch (data.selection) {
            case buttons.length:
                openServerMenuForm(player);
                break;
            default:
                if (typeof data.selection === "number")
                    buttons[data.selection].action();
                break;
        }
    });
};
// 新增添加VIP会员的表单
export const openAddVipMemberForm = (player) => {
    const form = new ModalFormData();
    form.title("§w添加正式会员");
    // 获取所有在线玩家
    const allPlayers = world.getPlayers().map((p) => p.name);
    form.dropdown("§w选择玩家", allPlayers);
    form.submitButton("§w确认");
    form.show(player).then((data) => {
        if (data.canceled || data.cancelationReason)
            return;
        const { formValues } = data;
        if ((formValues === null || formValues === void 0 ? void 0 : formValues[0]) !== undefined) {
            const selectedPlayerName = allPlayers[Number(formValues[0])];
            const targetPlayer = world.getPlayers().find((p) => p.name === selectedPlayerName);
            if (targetPlayer) {
                targetPlayer.addTag("vip");
                targetPlayer.removeTag("trialed");
                targetPlayer.setGameMode(GameMode.survival);
                openDialogForm(player, {
                    title: "添加成功",
                    desc: color.green(`已成功将 ${selectedPlayerName} 添加为正式会员!`),
                }, () => openTrialModeMainForm(player));
            }
        }
    });
};
// 修改后的试玩模式主表单
export const openTrialModeMainForm = (player) => {
    const form = new ActionFormData();
    form.title("§w试玩模式管理");
    form.button("§w试玩模式设置", "textures/ui/permissions_visitor_hand_hover");
    form.button("§w添加正式会员", "textures/ui/village_hero_effect");
    form.button("§w移除正式会员", "textures/ui/redX1");
    form.button("§w返回", "textures/ui/dialog_bubble_point");
    form.show(player).then((data) => {
        if (data.canceled || data.cancelationReason)
            return;
        switch (data.selection) {
            case 0:
                openTrialModeSettingForm(player);
                break;
            case 1:
                openAddVipMemberForm(player);
                break;
            case 2:
                openRemoveVipMemberForm(player);
                break;
            case 3:
                openCommonSettingForm(player);
                break;
        }
    });
};
// 修改原来的试玩模式设置表单（保持原有功能）
export const openTrialModeSettingForm = (player) => {
    var _a, _b;
    const form = new ModalFormData();
    form.title("§w试玩模式设置");
    // 获取当前设置
    const isEnabled = (_a = setting.getState("trialMode")) !== null && _a !== void 0 ? _a : defaultSetting.trialMode;
    const duration = (_b = setting.getState("trialModeDuration")) !== null && _b !== void 0 ? _b : defaultSetting.trialModeDuration;
    // 添加表单元素
    form.toggle("§w启用试玩模式", isEnabled);
    form.textField("§w试玩时长(秒) 玩家在线达到此时长后，会自动退出试玩模式（变为冒险模式）", "请输入试玩时长(秒)", duration.toString());
    form.submitButton("§w确认");
    form.show(player).then((data) => {
        var _a, _b;
        if (data.canceled || data.cancelationReason)
            return;
        const { formValues } = data;
        if (formValues) {
            // 保存设置
            setting.setState("trialMode", formValues[0]);
            setting.setState("trialModeDuration", (_b = (_a = formValues[1]) === null || _a === void 0 ? void 0 : _a.toString()) !== null && _b !== void 0 ? _b : "3600");
            openDialogForm(player, { title: "设置成功", desc: color.green("试玩模式设置已保存!") }, () => openTrialModeMainForm(player));
        }
    });
};
// 新增删除VIP会员的表单
export const openRemoveVipMemberForm = (player) => {
    const form = new ModalFormData();
    form.title("§w删除正式会员");
    // 获取所有VIP玩家
    const vipPlayers = world
        .getPlayers()
        .filter((p) => p.hasTag("vip"))
        .map((p) => p.name);
    if (vipPlayers.length === 0) {
        return openDialogForm(player, {
            title: "删除正式会员",
            desc: color.red("当前没有正式会员可删除"),
        }, () => openTrialModeMainForm(player));
    }
    form.dropdown("§w选择VIP会员", vipPlayers);
    form.submitButton("§w确认删除");
    form.show(player).then((data) => {
        if (data.canceled || data.cancelationReason)
            return;
        const { formValues } = data;
        if ((formValues === null || formValues === void 0 ? void 0 : formValues[0]) !== undefined) {
            const selectedPlayerName = vipPlayers[Number(formValues[0])];
            const targetPlayer = world.getPlayers().find((p) => p.name === selectedPlayerName);
            if (targetPlayer) {
                targetPlayer.removeTag("vip");
                openDialogForm(player, {
                    title: "删除成功",
                    desc: color.green(`已成功将 ${selectedPlayerName} 从正式会员中移除!`),
                }, () => openTrialModeMainForm(player));
            }
        }
    });
};
export const openMaxWayPointPerPlayerSettingForm = (player) => {
    const form = new ModalFormData();
    form.title("设置玩家最大坐标点数量");
    const currentValue = setting.getState("maxPointsPerPlayer") || defaultSetting.maxPointsPerPlayer;
    form.textField(color.white("每个玩家最大坐标点数量"), color.gray("请输入每个玩家最大可创建的坐标点数量"), currentValue.toString());
    form.show(player).then((data) => {
        if (data.cancelationReason)
            return;
        const { formValues } = data;
        if (formValues && formValues[0]) {
            const value = formValues[0].toString();
            const numValue = parseInt(value);
            if (isNaN(numValue) || numValue <= 0) {
                return openDialogForm(player, {
                    title: "设置失败",
                    desc: color.red("请输入有效的正整数！"),
                }, () => openMaxWayPointPerPlayerSettingForm(player));
            }
            setting.setState("maxPointsPerPlayer", value);
            openDialogForm(player, {
                title: "设置成功",
                desc: color.green(`成功设置每个玩家最大坐标点数量为 ${value}`),
            }, () => openCommonSettingForm(player));
        }
    });
};
//# sourceMappingURL=Forms.js.map