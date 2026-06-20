export interface FakePlayerSkinOption {
  id: number;
  name: string;
  textureKey: string;
}

export const FAKE_PLAYER_SKINS: FakePlayerSkinOption[] = [
  { id: 0, name: "Miku", textureKey: "skin_0" },
  { id: 1, name: "平泽唯", textureKey: "skin_1" },
  { id: 2, name: "希露菲", textureKey: "skin_2" },
  { id: 3, name: "艾莉丝·格雷拉特", textureKey: "skin_3" },
  { id: 4, name: "惠惠", textureKey: "skin_4" },
  { id: 5, name: "阿尼亚", textureKey: "skin_5" },
  { id: 6, name: "洛琪希", textureKey: "skin_6" },
  { id: 7, name: "凉宫春日", textureKey: "skin_7" },
  { id: 8, name: "长门有希", textureKey: "skin_8" },
  { id: 9, name: "艾米莉亚", textureKey: "skin_9" },
  { id: 10, name: "雷姆", textureKey: "skin_10" },
  { id: 11, name: "Saber 战斗服", textureKey: "skin_11" },
  { id: 12, name: "远坂凛", textureKey: "skin_12" },
  { id: 13, name: "Saber 常服", textureKey: "skin_13" },
  { id: 14, name: "狂三 战斗服", textureKey: "skin_14" },
  { id: 15, name: "狂三 校服", textureKey: "skin_15" },
];

export function normalizeFakePlayerSkinId(value: unknown): number {
  const id = Math.floor(Number(value));
  if (!Number.isFinite(id)) return 0;
  return FAKE_PLAYER_SKINS.some((skin) => skin.id === id) ? id : 0;
}

export function getFakePlayerSkinName(value: unknown): string {
  const id = normalizeFakePlayerSkinId(value);
  return FAKE_PLAYER_SKINS.find((skin) => skin.id === id)?.name ?? FAKE_PLAYER_SKINS[0].name;
}
