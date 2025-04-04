import { system, world } from '@minecraft/server';
import { color } from '../utils/color';
import { MinecraftDimensionTypes } from '../types';
export function useGetAllPlayer() {
    return world.getAllPlayers();
}
export function useGetAllPlayerNames() {
    return world.getAllPlayers().map(player => player.name);
}
export function usePlayerByName(name) {
    return world.getAllPlayers().find(player => player.name === name);
}
export function useNotify(type, player, message) {
    switch (type) {
        case 'chat':
            player.sendMessage(message);
            break;
        case 'actionbar':
            player.onScreenDisplay.setActionBar(message);
            break;
        case 'title':
            player.onScreenDisplay.setTitle(message);
            break;
    }
}
export function useFormatListInfo(infos) {
    const formatInfo = {
        rawtext: [], // 初始化为空数组
    };
    infos.forEach(info => {
        var _a, _b, _c;
        if (info.title)
            (_a = formatInfo === null || formatInfo === void 0 ? void 0 : formatInfo.rawtext) === null || _a === void 0 ? void 0 : _a.push({
                text: `${color.green.bold(info.title)}\n`,
            });
        if (info.desc)
            (_b = formatInfo === null || formatInfo === void 0 ? void 0 : formatInfo.rawtext) === null || _b === void 0 ? void 0 : _b.push({
                text: `   ${color.yellow(info.desc)}\n`,
            });
        if ((_c = info === null || info === void 0 ? void 0 : info.list) === null || _c === void 0 ? void 0 : _c.length)
            info.list.forEach(item => {
                var _a;
                (_a = formatInfo === null || formatInfo === void 0 ? void 0 : formatInfo.rawtext) === null || _a === void 0 ? void 0 : _a.push({
                    text: `   - ${color.green(item)}\n`,
                });
            });
    });
    return formatInfo;
}
export function useFormatInfo(info) {
    var _a, _b;
    const formatInfo = {
        rawtext: [],
    };
    if (info.title) {
        (_a = formatInfo.rawtext) === null || _a === void 0 ? void 0 : _a.push({
            text: color.green.bold(info.title) + '\n',
        });
    }
    if (info.desc) {
        (_b = formatInfo.rawtext) === null || _b === void 0 ? void 0 : _b.push({
            text: color.yellow(info.desc) + '\n',
        });
    }
    return formatInfo;
}
export const useForceOpen = (player_1, form_1, ...args_1) => __awaiter(void 0, [player_1, form_1, ...args_1], void 0, function* (player, form, timeout = 1200) {
    let startTick = system.currentTick;
    while (system.currentTick - startTick < timeout) {
        const response = yield form.show(player);
        if (response.cancelationReason !== 'UserBusy')
            return response;
    }
    return undefined;
});
export const useItems = () => {
    const owItems = world
        .getDimension(MinecraftDimensionTypes.Overworld)
        .getEntities()
        .filter(e => e.typeId === 'minecraft:item');
    const netherItems = world
        .getDimension(MinecraftDimensionTypes.Nether)
        .getEntities()
        .filter(e => e.typeId === 'minecraft:item');
    const endItems = world
        .getDimension(MinecraftDimensionTypes.TheEnd)
        .getEntities()
        .filter(e => e.typeId === 'minecraft:item');
    const allItems = owItems.concat(netherItems).concat(endItems);
    return allItems;
};
//# sourceMappingURL=hooks.js.map