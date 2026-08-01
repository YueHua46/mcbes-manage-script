export interface StartupVariant {
  readonly id: "standard" | "realms" | "bds";
  readonly buildDescription: string;
  readonly fakePlayerFeature: string;
  readonly extraFeatureLines: readonly string[];
  readonly readyMessage: string;
}

export const startupVariants = {
  standard: {
    id: "standard",
    buildDescription: "标准兼容版（本地 / BDS）",
    fakePlayerFeature: "假人模拟玩家系统",
    extraFeatureLines: [],
    readyMessage: "标准兼容版运行正常",
  },
  realms: {
    id: "realms",
    buildDescription: "Realms 兼容版（仅旧版实体假人）",
    fakePlayerFeature: "旧版实体假人系统",
    extraFeatureLines: [],
    readyMessage: "Realms 兼容版运行正常",
  },
  bds: {
    id: "bds",
    buildDescription: "BDS 增强版（仅 BDS 服务器）",
    fakePlayerFeature: "假人模拟玩家系统",
    extraFeatureLines: ["黑名单进服前校验"],
    readyMessage: "BDS 增强版运行正常",
  },
} as const satisfies Record<StartupVariant["id"], StartupVariant>;
