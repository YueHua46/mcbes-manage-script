import { color } from "../../utils/color";
import { world, system, BlockVolume, } from "@minecraft/server";
import { debounce, isAdmin } from "../../utils/utils";
import particle from "../Particle";
import land from "./Land";
import { useNotify } from "../../hooks/hooks";
import { MinecraftBlockTypes } from "../../types";
const isMoving = (entity) => {
    const MathRound = (x) => {
        return Math.round(x * 1000) / 1000;
    };
    /**
     * @type {{x: number, y: number, z: number}}
     */
    const vector = {
        x: MathRound(entity.getVelocity().x),
        y: MathRound(entity.getVelocity().y),
        z: MathRound(entity.getVelocity().z),
    };
    if (vector.x === 0 && vector.y === 0 && vector.z === 0)
        return false;
    else
        return true;
};
export const landAreas = new Map();
system.runInterval(() => {
    landAreas.forEach((landArea, playerId) => {
        if (landArea.lastChangeTime < Date.now() - 1000 * 60 * 10) {
            const player = world.getPlayers().find((p) => p.name === playerId);
            player === null || player === void 0 ? void 0 : player.sendMessage(color.red("领地标记坐标点已过期，请重新设置"));
            landAreas.delete(playerId);
        }
        if (landArea.start) {
            const player = world.getPlayers().find((p) => p.name === playerId);
            if (!player)
                return;
            particle.createLandParticle(player, landArea.start);
        }
        if (landArea.end) {
            const player = world.getPlayers().find((p) => p.name === playerId);
            if (!player)
                return;
            particle.createLandParticle(player, landArea.end);
        }
        if (landArea.start && landArea.end) {
            const player = world.getPlayers().find((p) => p.name === playerId);
            if (player && landArea.start && landArea.end) {
                particle.createLandParticleArea(player, [landArea.start, landArea.end]);
            }
        }
    });
}, 20);
world.afterEvents.entityHitBlock.subscribe((event) => {
    var _a, _b;
    const { damagingEntity, hitBlock: block } = event;
    if (damagingEntity.typeId !== "minecraft:player")
        return;
    const source = damagingEntity;
    // @ts-ignore
    const itemTypeId = (_b = (_a = source === null || source === void 0 ? void 0 : source.getComponent("minecraft:equippable")) === null || _a === void 0 ? void 0 : _a.getEquipment("Mainhand")) === null || _b === void 0 ? void 0 : _b.typeId;
    if (itemTypeId === null || itemTypeId === void 0 ? void 0 : itemTypeId.includes("minecraft:stick")) {
        debounce(() => {
            const playerId = source.name;
            let landArea = landAreas.get(playerId) || { lastChangeTime: Date.now() };
            if (source.isSneaking) {
                const endPos = {
                    x: block.location.x,
                    y: block.location.y + 1,
                    z: block.location.z,
                };
                source.sendMessage(color.yellow(`已设置领地结束点：${endPos.x} ${endPos.y} ${endPos.z}`));
                landArea.end = endPos;
                landArea.lastChangeTime = Date.now();
            }
            else {
                const startPos = {
                    x: block.location.x,
                    y: block.location.y + 1,
                    z: block.location.z,
                };
                source.sendMessage(color.yellow(`已设置领地起始点：${startPos.x} ${startPos.y} ${startPos.z}`));
                landArea.start = startPos;
                landArea.lastChangeTime = Date.now();
            }
            landAreas.set(playerId, landArea);
        }, 1000, source);
    }
});
const LandLog = new Map();
system.runInterval(() => {
    world.getAllPlayers().forEach((p) => {
        var _a;
        if (!isMoving(p))
            return;
        if (p.location.y <= -63)
            return;
        const location = (_a = p.dimension.getBlock(p.location)) === null || _a === void 0 ? void 0 : _a.location;
        const { isInside, insideLand } = land.testLand(location !== null && location !== void 0 ? location : p.location, p.dimension.id);
        if (isInside && insideLand && !LandLog.get(p.name)) {
            useNotify("actionbar", p, `${color.yellow("您已进入")} ${color.green(insideLand.owner)} ${color.yellow("的领地")}`);
            try {
                particle.createLandParticleArea(p, [insideLand.vectors.start, insideLand.vectors.end]);
            }
            catch (error) { }
            LandLog.set(p.name, insideLand);
        }
        else if (!isInside && LandLog.get(p.name)) {
            const landData = LandLog.get(p.name);
            if (landData) {
                useNotify("actionbar", p, `${color.yellow("您已离开")} ${color.green(landData.owner)} ${color.yellow("的领地")}`);
                try {
                    particle.createLandParticleArea(p, [landData.vectors.start, landData.vectors.end]);
                }
                catch (error) { }
                LandLog.delete(p.name);
            }
        }
    });
}, 5);
// 玩家放置方块
world.beforeEvents.playerPlaceBlock.subscribe((event) => {
    const { player, block } = event;
    const { isInside, insideLand } = land.testLand(block.location, block.dimension.id);
    if (!isInside || !insideLand)
        return;
    if (insideLand.owner === player.name)
        return;
    if (isAdmin(player))
        return;
    if (insideLand.members.includes(player.name))
        return;
    if (insideLand.public_auth.place)
        return;
    event.cancel = true;
    useNotify("chat", player, color.red(`这里是 ${color.yellow(insideLand.owner)} ${color.red("的领地，你没有权限这么做！")}`));
});
// 玩家与领地方块交互
world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    const { player, block } = event;
    const { isInside, insideLand } = land.testLand(block.location, block.dimension.id);
    if (!isInside || !insideLand)
        return;
    if (insideLand.owner === player.name)
        return;
    if (isAdmin(player))
        return;
    if (insideLand.members.includes(player.name))
        return;
    // 交互方块为箱子时判断权限是否开放
    const chests = [
        MinecraftBlockTypes.Chest,
        MinecraftBlockTypes.EnderChest,
        MinecraftBlockTypes.Beehive,
        MinecraftBlockTypes.TrappedChest,
        MinecraftBlockTypes.Barrel,
        MinecraftBlockTypes.RedShulkerBox,
        MinecraftBlockTypes.OrangeShulkerBox,
        MinecraftBlockTypes.YellowShulkerBox,
        MinecraftBlockTypes.LimeShulkerBox,
        MinecraftBlockTypes.GreenShulkerBox,
        MinecraftBlockTypes.LightBlueShulkerBox,
        MinecraftBlockTypes.CyanShulkerBox,
        MinecraftBlockTypes.BlueShulkerBox,
        MinecraftBlockTypes.PurpleShulkerBox,
        MinecraftBlockTypes.MagentaShulkerBox,
        MinecraftBlockTypes.PinkShulkerBox,
        MinecraftBlockTypes.GrayShulkerBox,
        MinecraftBlockTypes.LightGrayShulkerBox,
        MinecraftBlockTypes.BlackShulkerBox,
        MinecraftBlockTypes.BrownShulkerBox,
        MinecraftBlockTypes.WhiteShulkerBox,
        MinecraftBlockTypes.UndyedShulkerBox,
    ];
    // 交互方块为按钮时，判断是否开放权限
    const buttons = [
        MinecraftBlockTypes.StoneButton,
        MinecraftBlockTypes.BambooButton,
        MinecraftBlockTypes.SpruceButton,
        MinecraftBlockTypes.BirchButton,
        MinecraftBlockTypes.CherryButton,
        MinecraftBlockTypes.JungleButton,
        MinecraftBlockTypes.AcaciaButton,
        MinecraftBlockTypes.DarkOakButton,
        MinecraftBlockTypes.CrimsonButton,
        MinecraftBlockTypes.WarpedButton,
        MinecraftBlockTypes.MangroveButton,
        MinecraftBlockTypes.PolishedBlackstoneButton,
        MinecraftBlockTypes.WoodenButton,
        MinecraftBlockTypes.Lever,
    ];
    // 判断是否为箱子
    if (chests.includes(block.typeId)) {
        // 判断箱子权限是否开放
        if (insideLand.public_auth.isChestOpen) {
            return;
        }
        else {
            event.cancel = true;
            useNotify("chat", player, color.red(`这里是 ${color.yellow(insideLand.owner)} ${color.red("的领地，你没有权限这么做！")}`));
            return;
        }
    }
    // 判断是否为按钮
    if (buttons.includes(block.typeId)) {
        // 判断按钮权限是否开放
        if (insideLand.public_auth.useButton) {
            return;
        }
        else {
            event.cancel = true;
            useNotify("chat", player, color.red(`这里是 ${color.yellow(insideLand.owner)} ${color.red("的领地，你没有权限这么做！")}`));
            return;
        }
    }
    // 判断是否开放方块交互权限
    if (insideLand.public_auth.useBlock) {
        return;
    }
    // 拒绝交互
    event.cancel = true;
    useNotify("chat", player, color.red(`这里是 ${color.yellow(insideLand.owner)} ${color.red("的领地，你没有权限这么做！")}`));
});
// 玩家破坏领地方块
world.beforeEvents.playerBreakBlock.subscribe((event) => {
    const { player, block } = event;
    const { isInside, insideLand } = land.testLand(block.location, block.dimension.id);
    if (!isInside || !insideLand)
        return;
    if (insideLand.owner === player.name)
        return;
    if (isAdmin(player))
        return;
    if (insideLand.public_auth.break)
        return;
    if (insideLand.members.includes(player.name))
        return;
    event.cancel = true;
    useNotify("chat", player, color.red(`这里是 ${color.yellow(insideLand.owner)} ${color.red("的领地，你没有权限这么做！")}`));
});
// 玩家与领地内实体交互
world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
    const { player, target } = event;
    const { isInside, insideLand } = land.testLand(target.location, target.dimension.id);
    if (!isInside || !insideLand)
        return;
    if (insideLand.owner === player.name)
        return;
    if (isAdmin(player))
        return;
    if (insideLand.public_auth.useEntity)
        return;
    if (insideLand.members.includes(player.name))
        return;
    event.cancel = true;
    useNotify("chat", player, color.red(`这里是 ${color.yellow(insideLand.owner)} ${color.red("的领地，你没有权限这么做！")}`));
});
// 爆炸
world.beforeEvents.explosion.subscribe((event) => {
    const impactedBlocks = event.getImpactedBlocks();
    const impact = impactedBlocks.filter((block) => {
        var _a;
        const { isInside, insideLand } = land.testLand(block.location, event.dimension.id);
        // 如果在领地内且开放爆炸权限，则返回true
        // 如果不在领地内，则返回true
        // 否则返回false
        return isInside ? (_a = insideLand === null || insideLand === void 0 ? void 0 : insideLand.public_auth) === null || _a === void 0 ? void 0 : _a.explode : true;
    });
    event.setImpactedBlocks(impact);
});
// const protectEntity = ['minecraft:villager_v2', 'minecraft:horse', 'minecraft:cat', 'minecraft:wolf']
// world.afterEvents.entityHitEntity.subscribe(
//   event => {
//     const { damagingEntity } = event
//     if (damagingEntity.typeId !== 'minecraft:player') return
//     const { isInside, insideLand } = land.testLand(damagingEntity.location, damagingEntity.dimension.id)
//     if (!isInside || !insideLand) return
//     if (insideLand.owner === (damagingEntity as Player).name) return
//     if (damagingEntity.hasTag('admin') || (damagingEntity as Player).isOp()) return
//     if (insideLand.public_auth.useEntity) return
//     if (insideLand.members.includes((damagingEntity as Player).name)) return
//     useNotify(
//       'chat',
//       damagingEntity as Player,
//       color.red(`这里是 ${color.yellow(insideLand.owner)} ${color.red('的领地，你没有权限这么做！')}`)
//     )
//   },
//   {
//     entityTypes: protectEntity,
//   }
// )
const banItems = [
    "minecraft:fire_charge",
    "minecraft:flint_and_steel",
    "minecraft:water_bucket",
    "minecraft:lava_bucket",
];
// 玩家使用物品与领地方块交互时
world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    var _a;
    const { block, player, itemStack } = event;
    const { isInside, insideLand } = land.testLand({
        x: block.location.x,
        y: block.location.y + 1,
        z: block.location.z,
    }, block.dimension.id);
    if (!isInside || !insideLand)
        return;
    if (insideLand.owner === player.name)
        return;
    if (isAdmin(player))
        return;
    if (insideLand.public_auth.break)
        return;
    if (insideLand.members.includes(player.name))
        return;
    if (banItems.includes((_a = itemStack === null || itemStack === void 0 ? void 0 : itemStack.typeId) !== null && _a !== void 0 ? _a : "")) {
        event.cancel = true;
        useNotify("chat", player, color.red(`这里是 ${color.yellow(insideLand.owner)} ${color.red("的领地，你没有权限这么做！")}`));
    }
});
// 持续检测所有领地内是否有燃烧，如果领地设置不允许燃烧，则将燃烧替换为空气
// 燃烧包括：岩浆（lava）、流动岩浆（flowing_lava）、火（fire）、灵魂火（soul_fire）
system.runInterval(() => {
    const lands = land.getLandList();
    for (const land in lands) {
        const landData = lands[land];
        // 修复旧存档burn权限初始化问题
        if (landData.public_auth.burn === undefined) {
            landData.public_auth.burn = false;
        }
        if (landData.public_auth.burn)
            continue;
        try {
            clearLandFireByFill(landData);
            // BUG: 不管是getBlocks和fill的情况，在玩家离领地区块较远时，会报错，getBlocks会无法读取领地内方块，fill则显示无法在世界外放置方块
        }
        catch (error) { }
    }
}, 20);
// 通过getBlocks来清除领地内的燃烧方块
function clearLandFireByGetBlocks(landData) {
    const landArea = new BlockVolume(landData.vectors.start, landData.vectors.end);
    const blocks = world.getDimension(landData.dimension).getBlocks(landArea, {
        includeTypes: ["minecraft:lava", "minecraft:flowing_lava", "minecraft:fire", "minecraft:soul_fire"],
    });
    const blocksIterator = blocks.getBlockLocationIterator();
    for (const blockLocation of blocksIterator) {
        const block = world.getDimension(landData.dimension).getBlock(blockLocation);
        if (block) {
            block.setType("minecraft:air");
        }
    }
}
// 通过fill指令来清除领地内的燃烧方块
function clearLandFireByFill(landData) {
    const start = landData.vectors.start;
    const end = landData.vectors.end;
    // 分层填充空气，避免超过填充限制
    for (let y = Math.min(start.y, end.y); y <= Math.max(start.y, end.y); y++) {
        world
            .getDimension(landData.dimension)
            .runCommand(`fill ${start.x} ${y} ${start.z} ${end.x} ${y} ${end.z} air replace lava`);
        world
            .getDimension(landData.dimension)
            .runCommand(`fill ${start.x} ${y} ${start.z} ${end.x} ${y} ${end.z} air replace flowing_lava`);
        world
            .getDimension(landData.dimension)
            .runCommand(`fill ${start.x} ${y} ${start.z} ${end.x} ${y} ${end.z} air replace fire`);
        world
            .getDimension(landData.dimension)
            .runCommand(`fill ${start.x} ${y} ${start.z} ${end.x} ${y} ${end.z} air replace soul_fire`);
    }
}
//# sourceMappingURL=Event.js.map