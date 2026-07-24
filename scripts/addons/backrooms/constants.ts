export const BACKROOMS_ALIAS = "backrooms";
export const BACKROOMS_DIMENSION_ID = "yuehua:backrooms";
export const BACKROOMS_DISPLAY_NAME = "backrooms";

/** 管理员显式填写坐标时的兼容出生点；普通进入使用每玩家独立 manifestation。 */
export const BACKROOMS_SPAWN = { x: 31.5, y: 100, z: 31.5 } as const;
export const BACKROOMS_FOG_ID = "yuehua:backrooms";
export const BACKROOMS_FOG_STACK_ID = "yuehua_backrooms";

export const BACKROOMS_FLOOR_Y = 99;
export const BACKROOMS_WALK_Y = 100;
export const BACKROOMS_CEILING_Y = 104;
export const BACKROOMS_RECOVERY_Y = 92;

export const BACKROOMS_REGION_SIZE = 64;
/** 相邻 manifestation 相隔 262144 格，避免 Level 0 中的玩家互相发现。 */
export const BACKROOMS_MANIFESTATION_STRIDE_REGIONS = 4096;
