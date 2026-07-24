export interface BackroomsGenerationConfig {
    readonly algorithmVersion: number;
    readonly regionSize: number;
    readonly borderThickness: number;
    readonly edgeMargin: number;
    readonly gateWidths: readonly number[];
    readonly loopConnectionRate: number;
    readonly minimumRoomSpan: number;
    readonly targetRoomSpan: number;
    readonly maximumBspDepth: number;
    readonly openHallStopRate: number;
    readonly doubleOpeningRate: number;
    readonly mostlyOpenPartitionRate: number;
    readonly columnHallRate: number;
    readonly partialWallRate: number;
    readonly tightRoomRate: number;
    readonly repairCorridorWidth: number;
    readonly floorTraversalCost: number;
    readonly wallTraversalCost: number;
}

export const DEFAULT_BACKROOMS_CONFIG: BackroomsGenerationConfig = Object.freeze({
    algorithmVersion: 1,
    regionSize: 64,
    borderThickness: 1,
    edgeMargin: 8,
    // Repetition is intentional: three-block apertures are the visual norm.
    gateWidths: Object.freeze([3, 3, 3, 3, 4, 4, 5]),
    loopConnectionRate: 0.24,
    minimumRoomSpan: 7,
    targetRoomSpan: 16,
    maximumBspDepth: 6,
    openHallStopRate: 0.15,
    doubleOpeningRate: 0.10,
    mostlyOpenPartitionRate: 0.15,
    columnHallRate: 0.14,
    partialWallRate: 0.22,
    tightRoomRate: 0.08,
    repairCorridorWidth: 3,
    floorTraversalCost: 1,
    wallTraversalCost: 8,
});

export function createBackroomsConfig(
    overrides: Partial<BackroomsGenerationConfig> = {},
): BackroomsGenerationConfig {
    const config: BackroomsGenerationConfig = {
        ...DEFAULT_BACKROOMS_CONFIG,
        ...overrides,
        gateWidths: overrides.gateWidths
            ? Object.freeze(overrides.gateWidths.slice())
            : DEFAULT_BACKROOMS_CONFIG.gateWidths,
    };
    validateConfig(config);
    return Object.freeze(config);
}

function validateProbability(name: string, value: number): void {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new RangeError(`${name} must be between 0 and 1, received ${value}`);
    }
}

function validateConfig(config: BackroomsGenerationConfig): void {
    const integers: Array<[string, number, number]> = [
        ["algorithmVersion", config.algorithmVersion, 1],
        ["regionSize", config.regionSize, 16],
        ["borderThickness", config.borderThickness, 1],
        ["edgeMargin", config.edgeMargin, 1],
        ["minimumRoomSpan", config.minimumRoomSpan, 3],
        ["targetRoomSpan", config.targetRoomSpan, config.minimumRoomSpan],
        ["maximumBspDepth", config.maximumBspDepth, 1],
        ["repairCorridorWidth", config.repairCorridorWidth, 1],
        ["floorTraversalCost", config.floorTraversalCost, 1],
        ["wallTraversalCost", config.wallTraversalCost, 1],
    ];
    for (const [name, value, minimum] of integers) {
        if (!Number.isInteger(value) || value < minimum) {
            throw new RangeError(`${name} must be an integer >= ${minimum}, received ${value}`);
        }
    }
    if (config.borderThickness * 2 + config.minimumRoomSpan > config.regionSize) {
        throw new RangeError("regionSize is too small for the configured border and minimum room span");
    }
    if (config.repairCorridorWidth % 2 === 0) {
        throw new RangeError("repairCorridorWidth must be odd so repairs are centered on their path");
    }
    if (config.gateWidths.length === 0 || config.gateWidths.some((width) => !Number.isInteger(width) || width < 2)) {
        throw new RangeError("gateWidths must contain positive integer aperture widths >= 2");
    }
    const maximumGateWidth = Math.max(...config.gateWidths);
    if (config.edgeMargin * 2 + maximumGateWidth > config.regionSize) {
        throw new RangeError("edgeMargin leaves no room for the widest configured gate");
    }

    validateProbability("loopConnectionRate", config.loopConnectionRate);
    validateProbability("openHallStopRate", config.openHallStopRate);
    validateProbability("doubleOpeningRate", config.doubleOpeningRate);
    validateProbability("mostlyOpenPartitionRate", config.mostlyOpenPartitionRate);
    validateProbability("columnHallRate", config.columnHallRate);
    validateProbability("partialWallRate", config.partialWallRate);
    validateProbability("tightRoomRate", config.tightRoomRate);
}
