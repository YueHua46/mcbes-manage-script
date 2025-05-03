import { world, ItemStack, system, GameMode, ItemLockMode, ItemDurabilityComponent, ItemEnchantableComponent, EntityEquippableComponent, EquipmentSlot, } from "@minecraft/server";
import { splitGroups, getRadiusRange, calcGameTicks } from "@mcbe-mods/utils";
import setting from "../System/Setting";
function isSurvivalPlayer(dimension, player) {
    return dimension.getPlayers({ gameMode: GameMode.Survival }).some((p) => p.name === player.name);
}
const isStrippedLog = (typeId) => typeId.includes("stripped_");
const getPlayerMainhand = (player) => {
    const entityEquippableComponent = player.getComponent(EntityEquippableComponent.componentId);
    return entityEquippableComponent.getEquipmentSlot(EquipmentSlot.Mainhand);
};
// The player is not stalking or not holding an axe, one of the conditions is not met will end directly
const getPlayerAction = (player) => { var _a; return player.isSneaking && ((_a = getPlayerMainhand(player)) === null || _a === void 0 ? void 0 : _a.hasTag("is_axe")); };
function isTree(dimension, locations) {
    const leaves = ["leaves", "warped_wart_block", "nether_wart_block"];
    for (const location of locations) {
        const blocksLocation = getRadiusRange(location);
        const is = blocksLocation.some((block) => {
            var _a;
            const typeId = (_a = dimension.getBlock(block)) === null || _a === void 0 ? void 0 : _a.typeId;
            if (!typeId)
                return false;
            return leaves.some((item) => typeId.includes(item));
        });
        if (is)
            return true;
    }
    return false;
}
function consumeAxeDurability(player, logLocations) {
    var _a;
    const mainHand = getPlayerMainhand(player);
    try {
        if (!mainHand)
            return;
        mainHand.lockMode = ItemLockMode.slot;
        const item = mainHand.getItem();
        if (!item)
            return;
        const itemDurability = item.getComponent(ItemDurabilityComponent.componentId);
        const enchantments = item.getComponent(ItemEnchantableComponent.componentId);
        if (!enchantments || !itemDurability)
            return;
        const unbreaking = ((_a = enchantments.getEnchantment("unbreaking")) === null || _a === void 0 ? void 0 : _a.level) || 0;
        // https://minecraft.fandom.com/wiki/Unbreaking
        const itemMaxDamage = itemDurability.damage * (1 + unbreaking);
        const itemMaxDurability = itemDurability.maxDurability * (1 + unbreaking);
        const consumeItemMaxDamage = itemMaxDamage + logLocations.length;
        const overproof = consumeItemMaxDamage >= itemMaxDurability ? consumeItemMaxDamage - itemMaxDurability : 0;
        if (overproof > 0)
            logLocations.splice(-overproof);
        // Set axe damage level
        const damage = Math.ceil((consumeItemMaxDamage * 1) / (1 + unbreaking));
        itemDurability.damage = damage > itemDurability.maxDurability ? itemDurability.maxDurability : damage;
        mainHand.setItem(item);
    }
    catch (error) {
        // eslint-disable-next-line no-console
        console.warn("tree cut error:", error);
    }
    finally {
        system.runTimeout(() => {
            if (mainHand)
                mainHand.lockMode = ItemLockMode.none;
        }, calcGameTicks(1000));
    }
}
function getLogLocations(dimension, location, currentBreakBlockTypeId) {
    const visited = new Set();
    const logLocations = [];
    const locations = getRadiusRange(location);
    const reg = /(_log|crimson_stem|warped_stem)$/;
    for (const vector3 of locations) {
        const pos = Object.values(vector3).join(",");
        if (visited.has(pos))
            continue;
        visited.add(pos);
        const block = dimension.getBlock(vector3);
        if (block && block.typeId === currentBreakBlockTypeId && reg.test(block.typeId)) {
            logLocations.push(vector3);
            locations.push(...getRadiusRange(block.location));
        }
    }
    return logLocations.sort((a, b) => a.y - b.y);
}
function treeCut(location, dimension, logLocations) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!logLocations.length)
            return;
        const block = dimension.getBlock(logLocations[0]);
        const typeId = block.typeId;
        for (const location of logLocations) {
            const block = dimension.getBlock(location);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            block.setType("air");
        }
        splitGroups(logLocations.length).forEach((group) => {
            dimension.spawnItem(new ItemStack(typeId, group), location);
        });
    });
}
// eslint-disable-next-line max-statements
function clearLeaves(dimension, logLocations) {
    return __awaiter(this, void 0, void 0, function* () {
        const visited = new Set();
        const batchSize = 27; // Size of each batch
        let counter = 0;
        for (const logLocation of logLocations) {
            const locations = getRadiusRange(logLocation);
            for (const location of locations) {
                const pos = Object.values(location).join(",");
                if (visited.has(pos))
                    continue;
                visited.add(pos);
                const block = dimension.getBlock(location);
                if (block && block.typeId.includes("leaves")) {
                    const isIncludesLog = getRadiusRange(block.location, 2).some((location) => {
                        const block = dimension.getBlock(location);
                        if (!block)
                            return false;
                        const typeId = block.typeId;
                        if (isStrippedLog(typeId))
                            return false;
                        if (/_log$/.test(typeId))
                            return true;
                    });
                    // eslint-disable-next-line max-depth
                    if (isIncludesLog)
                        continue;
                    locations.push(...getRadiusRange(block.location));
                    // eslint-disable-next-line max-depth
                    if (counter === batchSize) {
                        // Add a short delay to allow the event loop to execute the toggle
                        yield new Promise((resolve) => system.runTimeout(resolve));
                        counter = 0;
                    }
                    counter++;
                    const command = `setblock ${Object.values(location).join(" ")} air destroy`;
                    dimension.runCommand(command);
                }
            }
        }
    });
}
world.afterEvents.playerBreakBlock.subscribe((e) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!setting.getState("enableTreeCutOneClick"))
            return;
        const { dimension, player, block } = e;
        const currentBreakBlock = e.brokenBlockPermutation;
        const currentBreakBlockTypeId = currentBreakBlock.type.id;
        if (isStrippedLog(currentBreakBlockTypeId))
            return;
        const action = getPlayerAction(player);
        if (!action)
            return;
        const logLocations = getLogLocations(dimension, block.location, currentBreakBlockTypeId);
        const _isTree = isTree(dimension, logLocations);
        if (!_isTree)
            return;
        const survivalPlayer = isSurvivalPlayer(dimension, player);
        if (survivalPlayer)
            consumeAxeDurability(player, logLocations);
        yield treeCut(block.location, dimension, logLocations);
        clearLeaves(dimension, logLocations);
    }
    catch (error) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const err = error;
        /* eslint-disable no-console */
        console.log("error", err);
        console.log("error.stack", err && err.stack);
        console.log("error.message", err && err.message);
        /* eslint-enable no-console */
    }
}));
//# sourceMappingURL=Tree.js.map